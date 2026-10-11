import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import express from 'express';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { MAPS, SERVER_PORT, type Project, type TaskSpec } from '@hive/shared/types';
import { authMiddleware, initAuth, wsAuthenticate } from './auth.ts';
import { serverWrite, syncTaskStates } from './doc.ts';
import { initModels } from './llm.ts';
import { initMirror } from './mongo.ts';
import { DATA_DIR } from './paths.ts';
import {
  createProject, docFile, getProject, inProject, loadedDocs, loadProjects, registryExists, setOpener, setProjectDoc,
} from './projects.ts';
import { api, errorHandler } from './routes.ts';
import { disposeSandbox, warmSandbox } from './sandbox.ts';
import { getEpoch, initEpoch, settings } from './settings.ts';
import { preloadSessions, recover, watchTasks } from './session.ts';
import { connectMongo, flushSessionsDb, loadDocDb, loadSessionsDb, mongoOn, saveDocDb } from './store.ts';
import { ensureWorkspace } from './workspace.ts';

const PORT = Number(process.env.PORT || SERVER_PORT);
let saver: NodeJS.Timeout | undefined;
// Every 2 s, save the docs that changed: to MongoDB when it is the store, else data/projects/<id>/doc.bin.
const dirty = new Set<string>();
let saving: Promise<unknown> = Promise.resolve();
function saveAll(): Promise<unknown> {
  const ids = [...dirty];
  dirty.clear();
  const docs = loadedDocs();
  saving = saving.then(() => Promise.all(ids.map(async (id) => {
    const state = Y.encodeStateAsUpdate(docs.get(id)!);
    try {
      if (mongoOn()) await saveDocDb(id, state);
      else writeFileSync(docFile(id), state);
    } catch (e) {
      dirty.add(id);   // try again next round
      console.error(`Saving project ${id} failed: ${(e as Error).message}`);
    }
  })));
  return saving;
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return void res.sendStatus(204);
  next();
});
app.use('/api', authMiddleware, settings, api);
app.use(errorHandler);

const server = new Server({
  name: 'hive',
  quiet: true,
  // Each project is one doc named by its id, kept in MongoDB or data/projects/<id>/doc.bin.
  async onLoadDocument({ documentName, document }) {
    if (!getProject(documentName)) throw new Error(`Unknown project ${documentName}`);
    const state = mongoOn() ? await loadDocDb(documentName) : existsSync(docFile(documentName)) ? readFileSync(docFile(documentName)) : null;
    if (state) Y.applyUpdate(document, state);
  },
  onAuthenticate: (data) => wsAuthenticate(data, getEpoch()),
  // Our direct connection keeps the doc loaded, so Hocuspocus's own shutdown would wait forever.
  stopOnSignals: false,
  // Hand plain HTTP requests to Express; rejecting with null skips Hocuspocus's default response.
  onRequest({ request, response }) {
    return new Promise((_resolve, reject) => {
      app(request, response);
      reject(null);
    });
  },
});

// A server-side connection keeps each project's doc loaded even with no browsers open; server code uses it via doc.ts.
async function open(p: Project, seed?: TaskSpec[]) {
  const direct = await server.hocuspocus.openDirectConnection(p.id);
  setProjectDoc(p.id, direct.document!);
  direct.document!.on('update', () => dirty.add(p.id));
  await inProject(p.id, async () => {
    await ensureWorkspace();
    if (mongoOn()) preloadSessions(await loadSessionsDb(p.id));
    if (seed) serverWrite(() => { for (const t of seed) direct.document!.getMap<TaskSpec>(MAPS.tasks).set(t.id, t); });
    syncTaskStates();
    recover();
    watchTasks();
  });
}
setOpener((p) => open(p));

mkdirSync(DATA_DIR, { recursive: true });
await connectMongo();
initMirror();
await initEpoch(!registryExists());   // a fresh data/ (first run or `pnpm reset`) gets a new epoch
const projects = await loadProjects();
initAuth();
await initModels();
await server.listen(PORT);
for (const p of projects) await open(p);
// HIVE_SEED names a JSON file of tasks for a first project (the smoke test uses smoke-seed.json).
const seed = process.env.HIVE_SEED;
if (seed && !projects.length) {
  await open(await createProject('URL shortener', 'A tiny URL shortener API with tests.', 'seed'), (JSON.parse(readFileSync(seed, 'utf8')) as { tasks: TaskSpec[] }).tasks);
  console.log(`Seeded a project from ${seed}`);
}
warmSandbox();
saver = setInterval(() => void saveAll(), 2000);
// Save once and exit on Ctrl+C / kill, so no orphan keeps writing an old doc.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(saver);
    for (const id of loadedDocs().keys()) dirty.add(id);
    void Promise.all([saveAll(), flushSessionsDb(), disposeSandbox()]).finally(() => process.exit(0));
  });
}

console.log(`Hive server on http://localhost:${PORT} (${projects.length} project${projects.length === 1 ? '' : 's'})`);
