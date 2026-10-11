import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { DOC_NAME, MAPS, SERVER_PORT, type Section } from '@hive/shared/types';
import seed from '@hive/shared/seed.json' with { type: 'json' };

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const DOC_FILE = DATA_DIR + 'doc.bin';
const PORT = Number(process.env.PORT ?? SERVER_PORT);

// Fill a freshly created doc from data/doc.bin, or from the seed on first run / after `pnpm reset`.
function loadInto(doc: Y.Doc) {
  if (existsSync(DOC_FILE)) {
    Y.applyUpdate(doc, readFileSync(DOC_FILE));
    console.log('Loaded data/doc.bin');
    return;
  }
  const sections = doc.getMap<Section>(MAPS.sections);
  doc.transact(() => {
    for (const s of seed.sections as Section[]) sections.set(s.id, s);
  });
  console.log('Loaded shared/seed.json');
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return void res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, sections: getDoc().getMap(MAPS.sections).size });
});

const server = new Server({
  name: 'hive',
  quiet: true,
  async onLoadDocument({ documentName, document }) {
    if (documentName !== DOC_NAME) throw new Error(`Unknown document ${documentName}`);
    loadInto(document);
  },
  // Hand plain HTTP requests to Express; rejecting with null skips Hocuspocus's default response.
  onRequest({ request, response }) {
    return new Promise((_resolve, reject) => {
      app(request, response);
      reject(null);
    });
  },
});

// A server-side connection keeps the doc loaded even with no browsers open,
// and is the handle the orchestrator and agents use to read and write it.
let doc: Y.Doc | null = null;
export function getDoc(): Y.Doc {
  if (!doc) throw new Error('Doc not loaded yet');
  return doc;
}

await server.listen(PORT);
const direct = await server.hocuspocus.openDirectConnection(DOC_NAME);
doc = direct.document!;

mkdirSync(DATA_DIR, { recursive: true });
setInterval(() => writeFileSync(DOC_FILE, Y.encodeStateAsUpdate(getDoc())), 2000);

console.log(`Hive server on http://localhost:${PORT} (ws doc "${DOC_NAME}")`);
