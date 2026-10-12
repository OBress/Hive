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
// Transcripts change every agent step and can be large, so Supabase gets at most one write per session every 5 s
// (the latest state); flushTranscripts() writes whatever is waiting (shutdown).
const waiting = new Map<string, { project: string; s: { id: string; taskId: string }; timer: NodeJS.Timeout }>();
export function saveTranscript(s: { id: string; taskId: string }) {
  if (!storageOn()) return;
  const project = currentId();
  const key = `${project}/${s.id}`;
  const w = waiting.get(key);
  if (w) { w.s = s; return; }
  waiting.set(key, { project, s, timer: setTimeout(() => write(key), 5000) });
}
function write(key: string) {
  const w = waiting.get(key);
  if (!w) return;
  waiting.delete(key);
  clearTimeout(w.timer);
  void saveSessionDb(w.project, w.s).catch(logErr('session save'));
}
export function flushTranscripts() { for (const k of [...waiting.keys()]) write(k); }
export async function history(taskId: string): Promise<{ steps: Step[]; source: 'supabase' | 'doc' }> {
  if (storageOn()) {
    try { return { steps: await historyDb(currentId(), taskId), source: 'supabase' }; }
    catch (e) { logErr('history read')(e as Error); }
  }
  return { steps: steps().toArray().filter(s => s.taskId === taskId), source: 'doc' };
}
