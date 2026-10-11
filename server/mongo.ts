import { MongoClient, type Db } from 'mongodb';
import type { Step } from '@hive/shared/types';
import { mirrors, steps } from './doc.ts';
import { currentId } from './projects.ts';

// Optional history mirror. The Y.Doc stays the live source of truth; Mongo never blocks the demo.
let db: Db | null = null;
const logErr = (what: string) => (e: Error) => console.error(`MongoDB ${what} failed: ${e.message}`);

export async function initMongo() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return;
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    await client.connect();
    let name = 'hive';
    try { name = decodeURIComponent(new URL(uri).pathname.slice(1)) || 'hive'; } catch { /* keep default */ }
    db = client.db(name);
    mirrors.step = (s) => void db?.collection('steps').insertOne({ ...s, project: currentId() }).catch(logErr('step insert'));
    mirrors.chat = (m) => void db?.collection('chat').insertOne({ ...m, project: currentId() }).catch(logErr('chat insert'));
    console.log(`MongoDB mirror on (database "${name}")`);
  } catch (e) {
    console.log(`MongoDB mirror off: ${(e as Error).message}`);
  }
}

export function saveTranscript(s: { id: string; taskId: string }) {
  void db?.collection<{ _id: string }>('sessions').replaceOne({ _id: `${currentId()}/${s.id}` }, { ...s, _id: `${currentId()}/${s.id}`, project: currentId() }, { upsert: true }).catch(logErr('session save'));
}

export async function history(taskId: string): Promise<{ steps: Step[]; source: 'mongo' | 'doc' }> {
  if (db) {
    try {
      const rows = await db.collection<Step>('steps').find({ taskId, project: currentId() }, { projection: { _id: 0 }, maxTimeMS: 2000 }).sort({ n: 1 }).toArray();
      return { steps: rows as Step[], source: 'mongo' };
    } catch (e) {
      logErr('history read')(e as Error);
    }
  }
  return { steps: steps().toArray().filter((s) => s.taskId === taskId), source: 'doc' };
}
