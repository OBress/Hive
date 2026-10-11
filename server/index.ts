import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import express from 'express';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { DOC_NAME, MAPS, SERVER_PORT, type TaskSpec } from '@hive/shared/types';
import seed from '@hive/shared/seed.json' with { type: 'json' };
import { authMiddleware, initAuth, wsAuthenticate } from './auth.ts';
import { getDoc, setDoc } from './doc.ts';
import { initModels } from './llm.ts';
import { initMongo } from './mongo.ts';
import { DATA_DIR, DOC_FILE } from './paths.ts';
import { errorHandler, routes } from './routes.ts';
import { recover, watchTasks } from './session.ts';
import { ensureWorkspace } from './workspace.ts';

const PORT = Number(process.env.PORT || SERVER_PORT);
let doc: Y.Doc | null = null;
let saver: NodeJS.Timeout | undefined;
const save = () => writeFileSync(DOC_FILE, Y.encodeStateAsUpdate(getDoc()));

// Fill a freshly created doc from data/doc.bin, or from the seed on first run / after `pnpm reset`.
function loadInto(doc: Y.Doc) {
  if (existsSync(DOC_FILE)) {
    Y.applyUpdate(doc, readFileSync(DOC_FILE));
    console.log('Loaded data/doc.bin');
    return;
  }
  const tasks = doc.getMap<TaskSpec>(MAPS.tasks);
  doc.transact(() => {
    for (const t of seed.tasks as TaskSpec[]) tasks.set(t.id, t);
  }, 'server');
  console.log('Loaded shared/seed.json');
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
app.use('/api', authMiddleware, routes);
app.use(errorHandler);

const server = new Server({
  name: 'hive',
  quiet: true,
  async onLoadDocument({ documentName, document }) {
    if (documentName !== DOC_NAME) throw new Error(`Unknown document ${documentName}`);
    loadInto(document);
  },
  onAuthenticate: wsAuthenticate,
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

mkdirSync(DATA_DIR, { recursive: true });
await ensureWorkspace();
initAuth();
await Promise.all([initModels(), initMongo()]);
await server.listen(PORT);

// A server-side connection keeps the doc loaded even with no browsers open; server code uses it via doc.ts.
const direct = await server.hocuspocus.openDirectConnection(DOC_NAME);
doc = direct.document!;
setDoc(doc);
recover();
watchTasks();
saver = setInterval(save, 2000);
// Save once and exit on Ctrl+C / kill, so no orphan keeps writing an old doc to data/doc.bin.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(saver);
    if (doc) save();
    process.exit(0);
  });
}

console.log(`Hive server on http://localhost:${PORT} (ws doc "${DOC_NAME}")`);
