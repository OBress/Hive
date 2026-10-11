import { Binary, MongoClient, type Db } from 'mongodb';
import type { Project, UserSummary } from '@hive/shared/types';

// Durable storage for the hosted server. With MONGODB_URI set, MongoDB holds the project list, every project's
// Y.Doc, agent transcripts and the doc epoch, so a redeploy loses nothing but the git folders (keep those on a
// volume). Without it, everything stays in files under data/ as before. Collections:
//   projects  Project, _id = project id
//   docs      {_id: project id, state: Binary (Y.encodeStateAsUpdate), at}
//   sessions  {_id: "<project>/<session id>", project, data: SessionData}
//   meta      {_id: 'epoch', value}
//   users     UserSummary, _id = lowercased login (people who signed in, for sharing)
//   steps, chat  history mirror tagged with `project` (see mongo.ts)

let db: Db | null = null;
export const mongoOn = () => db !== null;
export const mongo = () => db;

export async function connectMongo(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.log('Storage: files under data/ (MONGODB_URI not set)');
    return;
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  await client.connect();   // with a URI set, MongoDB is the store: fail loudly rather than start with nothing
  let name = 'hive';
  try { name = decodeURIComponent(new URL(uri).pathname.slice(1)) || 'hive'; } catch { /* keep default */ }
  db = client.db(process.env.MONGODB_DB?.trim() || name);
  await Promise.all([
    db.collection('steps').createIndex({ project: 1, taskId: 1, n: 1 }),
    db.collection('chat').createIndex({ project: 1, at: 1 }),
    db.collection('sessions').createIndex({ project: 1 }),
  ]);
  console.log(`Storage: MongoDB (database "${db.databaseName}")`);
}

// ---- projects ----

export async function loadProjectsDb(): Promise<Project[]> {
  const rows = await db!.collection<Project & { _id: string }>('projects').find().sort({ createdAt: 1 }).toArray();
  return rows.map(({ _id, ...p }) => p as Project);
}

export async function saveProjectDb(p: Project): Promise<void> {
  await db!.collection<{ _id: string }>('projects').replaceOne({ _id: p.id }, { ...p, _id: p.id }, { upsert: true });
}

// A deleted project: its row, doc, transcripts and history.
export async function deleteProjectDb(id: string): Promise<void> {
  await Promise.all([
    db!.collection<{ _id: string }>('projects').deleteOne({ _id: id }),
    db!.collection<{ _id: string }>('docs').deleteOne({ _id: id }),
    db!.collection('sessions').deleteMany({ project: id }),
    db!.collection('steps').deleteMany({ project: id }),
    db!.collection('chat').deleteMany({ project: id }),
  ]);
}

// ---- people who have signed in (for sharing) ----

export async function loadUsersDb(): Promise<UserSummary[]> {
  const rows = await db!.collection<UserSummary & { _id: string }>('users').find().toArray();
  return rows.map(({ _id, ...u }) => u as UserSummary);
}
export async function saveUserDb(u: UserSummary): Promise<void> {
  await db!.collection<{ _id: string }>('users').replaceOne({ _id: u.login.toLowerCase() }, { ...u, _id: u.login.toLowerCase() }, { upsert: true });
}

// ---- docs ----

export async function loadDocDb(id: string): Promise<Uint8Array | null> {
  const row = await db!.collection<{ _id: string; state: Binary }>('docs').findOne({ _id: id });
  return row ? row.state.buffer.subarray(0, row.state.position) : null;   // the buffer can be longer than the content
}

export async function saveDocDb(id: string, state: Uint8Array): Promise<void> {
  await db!.collection<{ _id: string }>('docs').replaceOne({ _id: id }, { _id: id, state: new Binary(state), at: new Date() }, { upsert: true });
}

// ---- agent transcripts ----

export async function loadSessionsDb(project: string): Promise<{ id: string; data: unknown }[]> {
  const rows = await db!.collection<{ _id: string; project: string; data: { id: string } }>('sessions').find({ project }).toArray();
  return rows.map((r) => ({ id: r.data.id, data: r.data }));
}

// Writes for one session run in order, so an older snapshot never lands after a newer one.
const chains = new Map<string, Promise<unknown>>();
export function saveSessionDb(project: string, s: { id: string }): Promise<unknown> {
  const key = `${project}/${s.id}`;
  const row = { _id: key, project, data: JSON.parse(JSON.stringify(s)), at: new Date() };
  const next = (chains.get(key) ?? Promise.resolve())
    .then(() => db!.collection<{ _id: string }>('sessions').replaceOne({ _id: key }, row, { upsert: true }))
    .catch((e: Error) => console.error(`MongoDB session save failed: ${e.message}`));
  chains.set(key, next);
  return next;
}

// Wait for transcript writes still in flight (on shutdown).
export const flushSessionsDb = () => Promise.all(chains.values());

// ---- epoch ----

export async function epochDb(): Promise<string | null> {
  return (await db!.collection<{ _id: string; value: string }>('meta').findOne({ _id: 'epoch' }))?.value ?? null;
}
export async function setEpochDb(value: string): Promise<void> {
  await db!.collection<{ _id: string }>('meta').replaceOne({ _id: 'epoch' }, { _id: 'epoch', value }, { upsert: true });
}
