import type { Step } from '@hive/shared/types';
import { mirrors, steps } from './doc.ts';
import { currentId } from './projects.ts';
import { storageOn, saveSessionDb, saveHistoryDb, historyDb } from './store.ts';
const logErr = (what: string) => (e: Error) => console.error(`Supabase ${what} failed: ${e.message}`);
export function initMirror() {
  if (!storageOn()) return;
  mirrors.step = s => void saveHistoryDb('step', currentId(), s).catch(logErr('step save'));
  mirrors.chat = m => void saveHistoryDb('chat', currentId(), m).catch(logErr('chat save'));
}
export function saveTranscript(s: { id: string; taskId: string }) {
  if (storageOn()) void saveSessionDb(currentId(), s).catch(logErr('session save'));
}
export async function history(taskId: string): Promise<{ steps: Step[]; source: 'supabase' | 'doc' }> {
  if (storageOn()) {
    try { return { steps: await historyDb(currentId(), taskId), source: 'supabase' }; }
    catch (e) { logErr('history read')(e as Error); }
  }
  return { steps: steps().toArray().filter(s => s.taskId === taskId), source: 'doc' };
}
