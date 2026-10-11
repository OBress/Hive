import type { Step } from '@hive/shared/types';
import { steps } from './doc.ts';

// Filled in by the MongoDB mirror step; until then history comes from the doc.
export function saveTranscript(_s: { id: string }) {}

export async function history(taskId: string): Promise<{ steps: Step[]; source: 'mongo' | 'doc' }> {
  return { steps: steps().toArray().filter((s) => s.taskId === taskId), source: 'doc' };
}
