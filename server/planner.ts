import type { AutonomyMode, Step, TaskSpec, TaskState } from '@hive/shared/types';
import { addChat, addStep, HttpError, serverWrite, sessions, setSession, setTaskState, steps, taskState, tasks } from './doc.ts';
import { applyOps, readyTasks } from './graph.ts';
import { generate, models, type Msg } from './llm.ts';
import { history } from './history.ts';
import { current, updateProject } from './projects.ts';
import { schedule, specChanged, startTask } from './session.ts';
import { resetRounds } from './verify.ts';

const SUMMARY_SYSTEM = `You summarize a coding agent's work on one task for a teammate who is picking it up.
Reply with exactly four short labeled lines and nothing else:
Done: ...
Left: ...
Tried and failed: ...
Open questions: ...

Facts come only from steps that record what happened: edit, human-edit, test (with its counts), read, merge, finish, error, steer, takeover, handback, handoff. "plan" steps are only the agent's intentions; never report a planned file, test or problem as real unless a later step shows it. If a plan says "my tests aren't running" but no step shows why, say what the steps show instead.`;

// Plan steps are what an agent meant to do, so label them for the models that read step logs.
const kind = (s: Step) => (s.kind === 'plan' ? 'plan (intention)' : s.kind);

// Done / Left / Tried and failed / Open questions over the task's last 60 steps; saved on its session.
export async function summarize(taskId: string): Promise<{ summary: string; stepIds: string[] }> {
  const t = tasks().get(taskId);
  if (!t) throw new HttpError(404, `Task "${taskId}" not found`);
  const recent = (await history(taskId)).steps.slice(-60);
  const sid = taskState().get(taskId)?.sessionId;
  if (!recent.length) return { summary: sessions().get(sid ?? '')?.summary || 'Done: nothing yet.\nLeft: everything.\nTried and failed: nothing.\nOpen questions: none.', stepIds: [] };
  const log = recent.map((s) => `[${s.id}] ${kind(s)} by ${s.by}: ${s.text}${s.path ? ` (${s.path})` : ''}`).join('\n');
  const text = await generate({
    model: models.planner, system: SUMMARY_SYSTEM, maxTokens: 2000, effort: 'low',
    messages: [{ role: 'user', content: `Task ${t.id} "${t.title}": ${t.spec}\n\nSteps:\n${log}` }],
  });
  const summary = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (sid && sessions().has(sid)) setSession(sid, { summary });
  return { summary, stepIds: recent.map((s) => s.id) };
}

const STACK_SYSTEM = `You are Hive's architect. Someone, possibly not technical, describes a project; write the stack and spec doc that Hive's planner and coding agents will follow.

Hive's coding agents build in a fixed workspace: Node.js ES modules ("type": "module"), Node built-ins only (no npm packages), code under src/, tests under test/ run with node --test. Choose everything within that: e.g. node:http for a web server or API, a JSON file or in-memory Map for storage, plain HTML/CSS/JS strings served by node:http for a UI, node:test and node:assert/strict for tests. Never suggest a database server, framework or package. If people open the result in a browser, it is served by src/server.js (listening on process.env.PORT) or is a static src/index.html: Hive previews it that way.

Reply in Markdown only, with these sections and nothing else:
# Stack and spec: <project name>
## In plain words
Two or three sentences a non-technical person understands: what gets built and how it works.
## Stack
Bullets: runtime, how it is served or used, storage, tests. Each with a one-line reason.
## Modules
One bullet per file under src/: \`src/<file>.js\`: what it does and what it exports.
## Data
The main records and their fields.
## Interface
The HTTP routes, CLI commands or functions people use, with inputs and outputs.
## Build order
A numbered list of small tasks, each naming its file, each testable on its own.
## Open questions
Up to three assumptions you made that the person may want to change.`;

// A first draft of a project's stack / spec doc. The person reviews and edits it before the project is created.
export async function stackDoc(name: string, goal: string, notes: string): Promise<string> {
  const text = await generate({
    model: models.planner, system: STACK_SYSTEM, maxTokens: 8000,
    messages: [{ role: 'user', content: `Project: ${name}\nGoal: ${goal || '(none given)'}${notes ? `\nWhat they want changed in the last draft: ${notes}` : ''}` }],
  });
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1').trim();
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
  Tasks run in parallel on separate branches, so give each task its own files and name them in its spec (its module
  under src/ and its test file test/<id>.test.js). When two tasks must change the same file (a shared index.html,
  a router, a main entry point), make the later one depend on the earlier so they never edit it at the same time.
  Add "ask": true to a task (in addTask's task or updateTask's fields) when it deploys, deletes data, spends money
  or touches accounts outside the workspace: in Semi-auto it then waits for a person's OK.
- Two more ops control running, only when the person asks for it:
  {"op":"start","ids":["a","b"]} or {"op":"start","ids":"all"}   start these tasks (or all) now; the rest follow as their dependencies finish
  {"op":"setMode","mode":"manual"}   (or "semi" / "auto") only when the person explicitly asks to change the mode
  Modes: Manual (nothing starts by itself), Semi-auto (ready tasks start by themselves except ones marked "ask"),
  Automatic (everything runs, then a goal check adds follow-up work). When the person asks you to start, run or
  "go through" the tasks, emit {"op":"start","ids":"all"}; never switch the mode for them. In Manual, tell them to switch it.
- "cites": for questions about what happened, the ids of the steps your answer is based on (like "st_12").

Answering "what happened":
- State only facts the steps show: files written (edit, human-edit), test runs and their counts (test), merges, finishes, errors, and what people did (steer, takeover, handback, handoff).
- Lines marked "plan" are the agent's intentions and guesses, not facts. Do not repeat a plan's claim (a missing file, a test not being picked up, a bug) as true unless another step confirms it; at most say "the agent thought ...".
- Cite the step ids behind each fact. If the steps do not show something, say you do not know.`;

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

const line = (s: Step) => `[${s.id}] ${s.taskId ?? '-'} ${kind(s)} by ${s.by}: ${s.text}${s.path ? ` (${s.path})` : ''}${s.test ? ` [${s.test.passed} passed, ${s.test.failed} failed]` : ''}`;

// Apply graph edits from the planner (chat or goal check) to the doc; returns the tasks it added or changed.
export function applyGraphOps(ops: unknown[], why: string, extra: Partial<TaskSpec> = {}): { taskIds: string[]; rejected: string[] } {
  const all = tasks().toJSON() as Record<string, TaskSpec>;
  const states = taskState().toJSON() as Record<string, TaskState>;
  const res = applyOps(all, states, ops, 'planner');
  for (const id of res.changedIds) if (!all[id]) Object.assign(res.tasks[id], extra);   // e.g. ask: true on new tasks
  serverWrite(() => {
    for (const id of res.removed) { tasks().delete(id); taskState().delete(id); }
    for (const id of new Set([...res.changedIds, ...res.moved])) tasks().set(id, res.tasks[id]);
    for (const t of Object.values(res.tasks)) if (all[t.id] && all[t.id].deps.join() !== t.deps.join()) tasks().set(t.id, t);
  });
  for (const id of res.changedIds) {
    if (!taskState().has(id)) setTaskState(id, {});
    else if (all[id] && all[id].spec !== res.tasks[id].spec) specChanged(id, 'planner', res.tasks[id].spec, why);
  }
  return { taskIds: res.changedIds, rejected: res.rejected };
}

// Chat control: start tasks (a person asking counts as their OK) or change the mode. The project's mode is the
// ceiling: in Manual nothing starts from chat, and the mode changes only when a person explicitly asks.
async function runControl(o: { op?: string; ids?: unknown; mode?: unknown }, from: string): Promise<string> {
  const p = current();
  const mode = p.mode ?? 'auto';
  if (o.op === 'setMode') {
    if (o.mode === 'manual' || o.mode === 'semi' || o.mode === 'auto') await setMode(o.mode, from);
    return '';
  }
  if (mode === 'manual') {
    return `\n\nThis project is in Manual mode${p.modeSetBy ? ` (set by ${p.modeSetBy})` : ''}, so I can't start tasks. Switch the mode to Semi-auto or Automatic, or press Start on a task.`;
  }
  const all = tasks().toJSON() as Record<string, TaskSpec>;
  const ready = readyTasks(all, taskState().toJSON() as Record<string, TaskState>);
  const asked = o.ids === 'all' ? Object.keys(all) : Array.isArray(o.ids) ? o.ids.filter((id): id is string => typeof id === 'string') : [];
  const started: string[] = [];
  for (const id of asked.filter((x) => ready.includes(x))) {
    try { await startTask(id, from); started.push(all[id].title); } catch { /* the scheduler started it first */ }
  }
  const later = asked.filter((id) => all[id] && !ready.includes(id) && !['done', 'running'].includes(taskState().get(id)?.status ?? ''));
  return (started.length ? `\n\nStarted: ${started.join(', ')}.` : '')
    + (later.length && mode === 'auto' ? ` The other ${later.length} start as their dependencies finish.` : '')
    + (later.length && mode === 'semi' ? ` The other ${later.length} start as their dependencies finish, except tasks marked "ask", which wait for an OK.` : '');
}

export const MODE_NAMES: Record<AutonomyMode, string> = { manual: 'Manual', semi: 'Semi-auto', auto: 'Automatic' };

export async function setMode(mode: AutonomyMode, by: string) {
  const p = current();
  if ((p.mode ?? 'auto') === mode && p.modeSetBy) return;
  await updateProject(p.id, { mode, modeSetBy: by });
  addStep({ kind: 'mode', by, text: `${by} set the mode to ${MODE_NAMES[mode]}` });
  resetRounds();
  schedule();
}

export async function chat(from: string, text: string) {
  resetRounds();   // a person spoke: the goal check may run again
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
    const project = current();
    const mode = project.mode ?? 'auto';
    const modeLine = `Mode: ${MODE_NAMES[mode]}${project.modeSetBy ? ` (set by ${project.modeSetBy})` : ' (the default)'}`;
    const messages: Msg[] = [{ role: 'user', content: `Project: ${project.name}${project.goal ? ` (goal: ${project.goal})` : ''}\n${modeLine}${project.stack ? `\n\nApproved stack and spec (plan tasks that follow it):\n${project.stack}` : ''}\n\nTasks:\n${graph || '(none)'}\n\nRecent steps:\n${ordered.map(line).join('\n') || '(none)'}\n\n${from} asks: ${text}` }];

    let out = extractJson(await generate({ model: models.planner, system: PLANNER_SYSTEM, messages, maxTokens: 8000, json: true }));
    if (!out) {
      messages.push({ role: 'assistant', content: '(invalid)' }, { role: 'user', content: 'That was not valid JSON. Reply with only {"reply": "...", "ops": [], "cites": []}.' });
      out = extractJson(await generate({ model: models.planner, system: PLANNER_SYSTEM, messages, maxTokens: 8000, json: true }));
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

    const raw = Array.isArray(out.ops) ? (out.ops as { op?: string }[]) : [];
    const control = raw.filter((o) => o?.op === 'start' || o?.op === 'setMode');
    const ops = raw.filter((o) => !control.includes(o));
    let taskIds: string[] = [];
    if (ops.length) {
      const res = applyGraphOps(ops, `asked by ${from}`);
      taskIds = res.taskIds;
      if (res.rejected.length) reply += `\n\nI could not apply: ${res.rejected.join('; ')}`;
    }
    for (const o of control) reply += await runControl(o, from);
    schedule();
    addChat({ from: 'planner', text: reply || 'Done.', cites: cites.length ? cites : undefined, taskIds: taskIds.length ? taskIds : undefined });
  } catch (e) {
    console.error('Planner failed:', (e as Error).message);
    addChat({ from: 'planner', text: `Sorry, I could not answer that: ${(e as Error).message}` });
  }
}
