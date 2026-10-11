import type { Step } from '@hive/shared/types';
import { mirrors, steps } from './doc.ts';
import { currentId } from './projects.ts';
import { mongo, saveSessionDb } from './store.ts';

// History in MongoDB (when MONGODB_URI is set): every step and chat message, tagged with its project, so
// catch-up answers and summaries can read a task's whole history. The Y.Doc stays the live source of truth.
const logErr = (what: string) => (e: Error) => console.error(`MongoDB ${what} failed: ${e.message}`);

export function initMirror() {
  const db = mongo();
  if (!db) return;
  mirrors.step = (s) => void db.collection('steps').insertOne({ ...s, project: currentId() }).catch(logErr('step insert'));
  mirrors.chat = (m) => void db.collection('chat').insertOne({ ...m, project: currentId() }).catch(logErr('chat insert'));
}

export function saveTranscript(s: { id: string; taskId: string }) {
  if (mongo()) void saveSessionDb(currentId(), s);
}

export async function history(taskId: string): Promise<{ steps: Step[]; source: 'mongo' | 'doc' }> {
  const db = mongo();
  if (db) {
    try {
      const rows = await db.collection<Step>('steps').find({ taskId, project: currentId() }, { projection: { _id: 0, project: 0 }, maxTimeMS: 2000 }).sort({ n: 1 }).toArray();
      return { steps: rows as Step[], source: 'mongo' };
    } catch (e) {
      logErr('history read')(e as Error);
    }
  }
  return { steps: steps().toArray().filter((s) => s.taskId === taskId), source: 'doc' };
}
