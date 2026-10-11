import type { Step, TaskSpec, TaskState } from '@hive/shared/types';
import { addChat, HttpError, serverWrite, sessions, setSession, setTaskState, steps, taskState, tasks } from './doc.ts';
import { applyOps } from './graph.ts';
import { generate, models, type Msg } from './llm.ts';
import { history } from './mongo.ts';
import { schedule, specChanged } from './session.ts';

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

const PLANNER_SYSTEM = `You are Hive's planner. A team of people and coding agents shares one task graph; you see the tasks and the recent steps of every agent session.
Reply with strict JSON only, no prose around it:
{"reply": "...", "ops": [], "cites": []}

- "reply": a short answer for the team chat.
- "ops": graph edits, only when the person asks to plan, add, change or remove work:
  {"op":"addTask","task":{"id":"short-id","title":"...","spec":"what to build, naming the file under src/","deps":["ids"]}}
  {"op":"updateTask","id":"...","fields":{"title":"...","spec":"...","deps":["..."]}}
  {"op":"removeTask","id":"..."}
  {"op":"addDep","from":"a","to":"b"}   (b depends on a)
  {"op":"removeDep","from":"a","to":"b"}
- "cites": for questions about what happened, the ids of the steps your answer is based on (like "st_12"). Answer only from the steps shown.`;

// Pull the JSON object out of a model reply: drop <think> blocks and code fences, take the first { to the last }.
export function extractJson(text: string): { reply?: unknown; ops?: unknown; cites?: unknown } | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(t.slice(a, b + 1));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const line = (s: Step) => `[${s.id}] ${s.taskId ?? '-'} ${s.kind} by ${s.by}: ${s.text}${s.path ? ` (${s.path})` : ''}${s.test ? ` [${s.test.passed} passed, ${s.test.failed} failed]` : ''}`;

export async function chat(from: string, text: string) {
  try {
    const all = tasks().toJSON() as Record<string, TaskSpec>;
    const states = taskState().toJSON() as Record<string, TaskState>;
    const lower = text.toLowerCase();
    const mentioned = Object.values(all).filter((t) => lower.includes(t.id.toLowerCase()) || lower.includes(t.title.toLowerCase()));
    // Recent steps everywhere, plus the full recent history of any task the message names.
    const shown = new Map<string, Step>(steps().toArray().slice(-60).map((s) => [s.id, s]));
    for (const t of mentioned) for (const s of (await history(t.id)).steps.slice(-60)) shown.set(s.id, s);
    const ordered = [...shown.values()].sort((a, b) => a.n - b.n);
    const graph = Object.values(all).map((t) => {
      const st = states[t.id];
      return `- ${t.id} "${t.title}" deps=[${t.deps.join(', ')}] status=${st?.status ?? 'todo'} owner=${st?.owner.name ?? 'agent'}: ${t.spec}`;
    }).join('\n');
    const messages: Msg[] = [{ role: 'user', content: `Tasks:\n${graph || '(none)'}\n\nRecent steps:\n${ordered.map(line).join('\n') || '(none)'}\n\n${from} asks: ${text}` }];

    let out = extractJson(await generate({ model: models.planner, system: PLANNER_SYSTEM, messages, maxTokens: 2000 }));
    if (!out) {
      messages.push({ role: 'assistant', content: '(invalid)' }, { role: 'user', content: 'That was not valid JSON. Reply with only {"reply": "...", "ops": [], "cites": []}.' });
      out = extractJson(await generate({ model: models.planner, system: PLANNER_SYSTEM, messages, maxTokens: 2000 }));
    }
    if (!out) throw new Error('the planner did not return valid JSON');

    let reply = typeof out.reply === 'string' ? out.reply : '';
    const rawCites = Array.isArray(out.cites) ? out.cites.filter((c): c is string => typeof c === 'string') : [];
    const known = new Set(steps().toArray().map((s) => s.id));
    let cites = rawCites.filter((c) => known.has(c));
    if (rawCites.length && !cites.length && mentioned[0]) {
      const sum = await summarize(mentioned[0].id);
      reply = `Here is where ${mentioned[0].title} stands:\n${sum.summary}`;
      cites = sum.stepIds.slice(-5);
    }

    const ops = Array.isArray(out.ops) ? out.ops : [];
    let taskIds: string[] = [];
    if (ops.length) {
      const res = applyOps(all, states, ops, 'planner');
      taskIds = res.changedIds;
      serverWrite(() => {
        for (const id of res.removed) { tasks().delete(id); taskState().delete(id); }
        for (const id of res.changedIds) tasks().set(id, res.tasks[id]);
        for (const t of Object.values(res.tasks)) if (all[t.id] && all[t.id].deps.join() !== t.deps.join()) tasks().set(t.id, t);
      });
      for (const id of res.changedIds) {
        if (!taskState().has(id)) setTaskState(id, {});
        else if (all[id] && all[id].spec !== res.tasks[id].spec) specChanged(id, 'planner', res.tasks[id].spec, `asked by ${from}`);
      }
      if (res.rejected.length) reply += `\n\nI could not apply: ${res.rejected.join('; ')}`;
      schedule();
    }
    addChat({ from: 'planner', text: reply || 'Done.', cites: cites.length ? cites : undefined, taskIds: taskIds.length ? taskIds : undefined });
  } catch (e) {
    console.error('Planner failed:', (e as Error).message);
    addChat({ from: 'planner', text: `Sorry, I could not answer that: ${(e as Error).message}` });
  }
}
