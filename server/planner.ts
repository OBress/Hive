import { HttpError, sessions, setSession, taskState, tasks } from './doc.ts';
import { generate, models } from './llm.ts';
import { history } from './mongo.ts';

const SUMMARY_SYSTEM = `You summarize a coding agent's work on one task for a teammate who is picking it up.
Reply with exactly four short labeled lines and nothing else:
Done: ...
Left: ...
Tried and failed: ...
Open questions: ...`;

// Done / Left / Tried and failed / Open questions over the task's last 60 steps; saved on its session.
export async function summarize(taskId: string): Promise<{ summary: string; stepIds: string[] }> {
  const t = tasks().get(taskId);
  if (!t) throw new HttpError(404, `Task "${taskId}" not found`);
  const recent = (await history(taskId)).steps.slice(-60);
  const sid = taskState().get(taskId)?.sessionId;
  if (!recent.length) return { summary: sessions().get(sid ?? '')?.summary || 'Done: nothing yet.\nLeft: everything.\nTried and failed: nothing.\nOpen questions: none.', stepIds: [] };
  const log = recent.map((s) => `[${s.id}] ${s.kind} by ${s.by}: ${s.text}${s.path ? ` (${s.path})` : ''}`).join('\n');
  const text = await generate({
    model: models.planner, system: SUMMARY_SYSTEM, maxTokens: 600,
    messages: [{ role: 'user', content: `Task ${t.id} "${t.title}": ${t.spec}\n\nSteps:\n${log}` }],
  });
  const summary = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (sid && sessions().has(sid)) setSession(sid, { summary });
  return { summary, stepIds: recent.map((s) => s.id) };
}
