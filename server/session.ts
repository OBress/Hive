import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutonomyMode, Owner, TaskSpec, TaskState } from '@hive/shared/types';
import { AGENT_SYSTEM, SEARCH_HELP, buildMessages, contextText, isTestFile, parseAction, type Action } from './agent.ts';
import {
  addChat, addStep, HttpError, live, openTerminal, serverWrite, sessions, setSession, setTaskState, syncTaskStates, taskState, tasks,
  terminal, trim,
} from './doc.ts';
import { AGENT, personAuthor, type GitUser } from './git.ts';
import { autoStartable, readyTasks, waitingForOk } from './graph.ts';
import { generate, models, type Msg } from './llm.ts';
import { saveTranscript } from './mongo.ts';
import { openCodeOn, search } from './opencode.ts';
import { current, currentId, inProject, sessionsDir, workspaceDir } from './projects.ts';
import { summarize } from './planner.ts';
import { afterSchedule } from './verify.ts';
import { runCli, runTests } from './runner.ts';
import {
  commitAll, diff, ensureWorktree, head, listFiles, mergeToMain, readFile, safePath, takeMain, worktreeDir, writeFile,
} from './workspace.ts';

const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 2);
const MAX_STEPS = Number(process.env.MAX_STEPS || 20);
const AGENT_OWNER: Owner = { kind: 'agent', name: 'agent' };

// Server-side session state; the transcript never goes into the doc.
export interface SessionData {
  id: string; taskId: string;
  transcript: Msg[];
  pending: string[];          // tool results and notes for the next user message
  steers: string[];           // teammates' messages, picked up before the next model call
  stepCount: number;
  limit: number;              // pause when stepCount reaches this (MAX_STEPS per run)
  takeoverBase?: string;      // worktree HEAD when a person took over
  testOk: boolean;            // last test run passed with no writes since
  bad: number; errors: number;
  conflicts?: number;         // merge conflicts the agent has been asked to reconcile in this run
}

// Keyed by project/session id; everything below runs inside one project (see projects.ts).
const cache = new Map<string, SessionData>();
const active = new Map<string, AbortController>();   // sessions with a running loop
const rerun = new Set<string>();
// Per project/task, in memory: tasks already announced as waiting for an OK, and failed tasks already retried.
const announced = new Set<string>();
const retried = new Set<string>();
const queued = new Set<string>();     // Run ready in Manual: tasks that were ready then, started as slots free up
const key = (sid: string) => `${currentId()}/${sid}`;

function load(id: string | undefined): SessionData | null {
  if (!id) return null;
  if (cache.has(key(id))) return cache.get(key(id))!;
  const file = join(sessionsDir(), `${id}.json`);
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, 'utf8')) as SessionData;
  cache.set(key(id), s);
  return s;
}

// With MongoDB, a project's transcripts are loaded into the cache when it opens (a fresh container has no files).
export function preloadSessions(rows: { id: string; data: unknown }[]) {
  for (const r of rows) if (!cache.has(key(r.id))) cache.set(key(r.id), r.data as SessionData);
}

function save(s: SessionData) {
  cache.set(key(s.id), s);
  mkdirSync(sessionsDir(), { recursive: true });
  writeFileSync(join(sessionsDir(), `${s.id}.json`), JSON.stringify(s));
  saveTranscript(s);
}

// Deleting a project: stop its agent loops and forget its cached sessions.
export function stopProject() {
  const prefix = `${currentId()}/`;
  for (const [k, c] of active) if (k.startsWith(prefix)) c.abort();
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  for (const set of [announced, retried, queued]) for (const k of [...set]) if (k.startsWith(prefix)) set.delete(k);
}

export function getTask(id: string): TaskSpec {
  const t = tasks().get(id);
  if (!t) throw new HttpError(404, `Task "${id}" not found`);
  return t;
}
const stateOf = (id: string): TaskState => taskState().get(id) ?? setTaskState(id, {});
const isDone = (id: string) => taskState().get(id)?.status === 'done';
const ref = (s: SessionData, by = 'agent') => ({ taskId: s.taskId, sessionId: s.id, by });

async function ensureSession(taskId: string, by: string): Promise<SessionData> {
  const existing = load(stateOf(taskId).sessionId);
  if (existing) return existing;
  await ensureWorktree(taskId);
  const s: SessionData = {
    id: `s_${taskId}_${Date.now().toString(36)}`, taskId,
    transcript: [], pending: [], steers: [], stepCount: 0, limit: MAX_STEPS, testOk: false, bad: 0, errors: 0,
  };
  save(s);
  setSession(s.id, { taskId, state: 'paused', summary: '', stepCount: 0, startedBy: by });
  setTaskState(taskId, { sessionId: s.id, branch: `task/${taskId}` });
  return s;
}

// ---- Scheduler ----

export function startTask(taskId: string, by: string): Promise<string> {
  const t = getTask(taskId);
  const st = stateOf(taskId);
  if (st.status === 'running') throw new HttpError(409, 'Task is already running');
  if (st.status === 'done') throw new HttpError(409, 'Task is already done');
  const waiting = t.deps.filter((d) => !isDone(d));
  if (waiting.length) throw new HttpError(409, `Waiting on: ${waiting.join(', ')}`);
  setTaskState(taskId, { status: 'running', owner: AGENT_OWNER, note: undefined });   // claim it before any await
  return ensureSession(taskId, by).then((s) => {
    Object.assign(s, { limit: s.stepCount + MAX_STEPS, bad: 0, errors: 0 });
    save(s);
    setSession(s.id, { state: 'running' });
    resume(s.id);
    return s.id;
  }, (e) => {
    setTaskState(taskId, { status: 'failed', note: (e as Error).message });
    throw e;
  });
}

export const modeOf = (): AutonomyMode => current().mode ?? 'auto';

// Start ready tasks, at most MAX_PARALLEL running at once.
function startAll(ids: string[], by: string): string[] {
  let running = [...taskState().values()].filter((s) => s.status === 'running').length;
  const started: string[] = [];
  for (const id of ids) {
    if (running >= MAX_PARALLEL) break;
    running++;
    started.push(id);
    startTask(id, by).catch((e) => console.error(`Could not start ${id}:`, (e as Error).message));
  }
  return started;
}

// Run ready (a person, any mode): start everything ready now, MAX_PARALLEL at a time. In Manual the rest of
// this batch starts as slots free up, but tasks that become ready later wait for the next press. In Semi-auto
// and Automatic the mode keeps going anyway. Tasks waiting for an OK in Semi-auto need their own Start.
export function run(by = 'agent'): string[] {
  const all = tasks().toJSON() as Record<string, TaskSpec>;
  const states = taskState().toJSON() as Record<string, TaskState>;
  const waiting = new Set(waitingForOk(all, states, modeOf()));
  const ready = readyTasks(all, states).filter((id) => !waiting.has(id));
  for (const id of ready) queued.add(`${currentId()}/${id}`);
  return startQueued(by);
}

function startQueued(by: string): string[] {
  const all = tasks().toJSON() as Record<string, TaskSpec>;
  const ready = readyTasks(all, taskState().toJSON() as Record<string, TaskState>);
  const mine = (id: string) => queued.has(`${currentId()}/${id}`);
  for (const k of [...queued]) if (k.startsWith(`${currentId()}/`) && !ready.includes(k.slice(currentId().length + 1))) queued.delete(k);
  const started = startAll(ready.filter(mine), by);
  for (const id of started) queued.delete(`${currentId()}/${id}`);
  return started;
}

// Called whenever something changes. In Semi-auto and Automatic it keeps the graph moving: resumes tasks a
// restart paused, retries a failed task once, starts what the mode allows, says which tasks wait for an OK,
// and when every task is done runs the goal check (verify.ts).
export function schedule(): string[] {
  const mode = modeOf();
  if (mode === 'manual') return startQueued('agent');
  const k = (id: string) => `${currentId()}/${id}`;
  for (const st of taskState().values()) {
    if (st.owner.kind !== 'agent') continue;
    if (st.status === 'paused' && st.note === 'server restarted') setTaskState(st.taskId, { status: 'todo', note: undefined });
    else if (st.status === 'failed' && !retried.has(k(st.taskId))) {
      retried.add(k(st.taskId));
      addStep({ taskId: st.taskId, kind: 'error', by: 'planner', text: `Retrying once after: ${st.note ?? 'failure'}` });
      setTaskState(st.taskId, { status: 'todo', note: 'Retrying after a failure' });
    }
  }
  const all = tasks().toJSON() as Record<string, TaskSpec>;
  const states = taskState().toJSON() as Record<string, TaskState>;
  const started = startAll(autoStartable(all, states, mode), 'agent');
  for (const id of waitingForOk(all, states, mode)) {
    if (announced.has(k(id))) continue;
    announced.add(k(id));
    addChat({ from: 'planner', text: `${all[id].title} is ready and waiting for your OK. Open it and press Start.`, taskIds: [id] });
  }
  void afterSchedule();
  return started;
}

// ---- The loop ----

function resume(sid: string) {
  const c = active.get(key(sid));
  if (c && !c.signal.aborted) return;
  if (c) rerun.add(key(sid));     // the old loop is winding down; start again when it exits
  else void loop(sid);
}

async function loop(sid: string) {
  const ctrl = new AbortController();
  active.set(key(sid), ctrl);
  try {
    while (await turn(sid, ctrl));
  } catch (e) {
    console.error(`Session ${sid} crashed:`, e);
    const s = load(sid);
    if (s) fail(s, `Internal error: ${(e as Error).message}`);
  } finally {
    active.delete(key(sid));
    serverWrite(() => live().delete(sid));
    if (rerun.delete(key(sid))) resume(sid);
  }
}

const mine = (s: SessionData, ctrl: AbortController) => {
  const st = taskState().get(s.taskId);
  return !ctrl.signal.aborted && st?.status === 'running' && st.owner.kind === 'agent' && st.sessionId === s.id;
};

async function turn(sid: string, ctrl: AbortController): Promise<boolean> {
  const s = load(sid);
  const t = s && tasks().get(s.taskId);
  if (!s || !t || !mine(s, ctrl)) return false;
  if (s.stepCount >= s.limit) { pause(s, `Paused after ${MAX_STEPS} steps; start it again to continue`); return false; }

  s.pending.push(...s.steers.splice(0));
  const userMsg = s.pending.splice(0).join('\n\n') || 'Continue.';
  s.transcript.push({ role: 'user', content: userMsg });
  const putBack = () => { s.transcript.pop(); s.pending.unshift(userMsg); save(s); };

  const dir = worktreeDir(t.id);
  const messages = buildMessages(contextText(contextFor(t, s, dir)), s.transcript);
  let text = '';
  let last = 0;
  let timer: NodeJS.Timeout | undefined;
  const flush = () => { last = Date.now(); timer = undefined; serverWrite(() => live().set(sid, text)); };
  let reply: string;
  try {
    reply = await generate({
      model: models.agent, system: AGENT_SYSTEM + (openCodeOn() ? SEARCH_HELP : ''), messages, signal: ctrl.signal,
      onToken: (d) => {
        text += d;
        if (Date.now() - last >= 150) flush();
        else timer ??= setTimeout(flush, 150 - (Date.now() - last));
      },
    });
  } catch (e) {
    putBack();
    if (ctrl.signal.aborted) return false;
    console.error(`Model error in ${sid}:`, (e as Error).message);
    if (++s.errors >= 2) { fail(s, `Model error: ${(e as Error).message}`); return false; }
    return true;
  } finally {
    clearTimeout(timer);
    serverWrite(() => live().delete(sid));
  }
  if (!mine(s, ctrl)) { putBack(); return false; }   // paused or reassigned while generating

  s.errors = 0;
  s.transcript.push({ role: 'assistant', content: reply });
  s.stepCount++;
  setSession(sid, { stepCount: s.stepCount });
  const { plan, action, error } = parseAction(reply);
  if (plan) addStep({ ...ref(s), kind: 'plan', text: plan });
  if (!action) {
    if (++s.bad >= 2) { save(s); fail(s, `Two replies without a valid action (${error})`); return false; }
    s.pending.push(`Your last reply had no valid action (${error}). Reply with one PLAN: line and exactly one action.`);
    save(s);
    return true;
  }
  s.bad = 0;
  await act(s, t, dir, action);
  save(s);
  if (s.stepCount % 8 === 0) void summarize(s.taskId).catch(() => {});   // rolling summary covers older turns
  return true;
}

function contextFor(t: TaskSpec, s: SessionData, dir: string) {
  const deps = t.deps.map((id) => tasks().get(id)).filter((d): d is TaskSpec => !!d && isDone(d.id))
    .map((d) => ({ title: d.title, spec: d.spec, summary: sessions().get(taskState().get(d.id)?.sessionId ?? '')?.summary ?? '' }));
  return {
    task: t, deps, files: listFiles(dir),
    lastTest: taskState().get(t.id)?.lastTest,
    summary: sessions().get(s.id)?.summary ?? '',
    stack: current().stack,
  };
}

// Ground truth after each action, so the agent never relies on files it only planned to write.
const filesNow = (dir: string) => `Files in the workspace now: ${listFiles(dir).join(', ') || 'none'}.`;

async function act(s: SessionData, t: TaskSpec, dir: string, a: Action) {
  if (a.type === 'read') {
    const content = readFile(dir, a.path);
    s.pending.push(content === null ? `${a.path} does not exist. ${filesNow(dir)}` : `Contents of ${a.path}:\n${trim(content, 12000)}`);
    addStep({ ...ref(s), kind: 'read', text: `Read ${a.path}`, path: a.path });
  } else if (a.type === 'search') {
    const found = openCodeOn() ? await search(dir, a.pattern).catch(() => null) : null;
    s.pending.push(found === null ? 'Search is not available; use <read/> instead.'
      : `Search for "${a.pattern}": ${found.map((m) => `\n${m.path}:${m.line}: ${m.text}`).join('') || 'no matches.'}`);
    addStep({ ...ref(s), kind: 'read', text: `Searched for "${a.pattern}"${found ? `: ${found.length} match${found.length === 1 ? '' : 'es'}` : ' (search unavailable)'}` });
  } else if (a.type === 'write') {
    writeFile(dir, a.path, a.content);
    const commit = await commitAll(dir, AGENT, `${t.title}: write ${a.path}`);
    const d = commit ? await diff(dir, 'HEAD~1', 'HEAD', a.path) : '';
    addStep({ ...ref(s), kind: 'edit', text: `Wrote ${a.path}`, path: a.path, diff: d, commit: commit ?? undefined });
    s.testOk = false;
    s.pending.push(`${commit ? `Wrote ${a.path} (commit ${commit}).` : `${a.path} is unchanged.`} ${filesNow(dir)}`);
  } else if (a.type === 'test') {
    const term = openTerminal(t.id, 'agent', 'node --test');
    const { sandbox, ...r } = await runTests(dir, term.write);
    term.end(r.failed ? 1 : 0);
    addStep({ ...ref(s), kind: 'test', text: `Tests: ${r.passed} passed, ${r.failed} failed${sandbox ? ' (in sandbox)' : ''}`, test: r });
    setTaskState(t.id, { lastTest: { passed: r.passed, failed: r.failed } });
    s.testOk = r.failed === 0 && r.passed > 0;
    const ran = listFiles(dir).filter(isTestFile);
    s.pending.push(`Test results: ${r.passed} passed, ${r.failed} failed. Test files that ran: ${ran.join(', ') || 'none'}.\n${r.output.slice(-2000)}`);
  } else if (a.type === 'run') {
    const r = readFile(dir, 'src/cli.js') === null ? null : await runCliIn(t.id, dir, 'agent', a.args);
    s.pending.push(r ? `${r.cmd} exited with ${r.exitCode}${r.exitCode === 124 ? ' (stopped after 15 s)' : ''}. Output:\n${r.output.slice(-2000) || '(nothing)'}`
      : `src/cli.js does not exist, so there is nothing to run. ${filesNow(dir)}`);
  } else if (!s.testOk) {
    s.pending.push('Run <test/> and make all tests pass before finishing.');
  } else {
    await finish(s, t, a.summary);
  }
}

async function finish(s: SessionData, t: TaskSpec, summary: string) {
  addStep({ ...ref(s), kind: 'finish', text: summary });
  const m = await mergeToMain(t.id);
  if (m.ok) {
    addStep({ ...ref(s), kind: 'merge', text: `Merged task/${t.id} into main`, commit: m.commit });
    setTaskState(t.id, { status: 'done', note: undefined });
    setSession(s.id, { state: 'done', summary });
  } else if ((s.conflicts ?? 0) < 4 && await takeMain(t.id)) {
    // Teammates' tasks changed the same lines: take main's version and let the agent put its own change back.
    const files = m.files.join(', ') || 'some files';
    s.conflicts = (s.conflicts ?? 0) + 1;
    s.testOk = false;
    addStep({ ...ref(s), kind: 'merge', text: `Merge conflict in ${files}: took main's version, the agent is re-applying its change` });
    s.pending.push(`Your branch conflicted with main in ${files}: other tasks changed the same lines and were merged first. Main's version of those lines is now in your workspace, so parts of your work in ${files} are gone. Read each of those files, add back what this task needs while keeping the other tasks' code, run <test/>, then finish.`);
    return;
  } else {
    const note = `Merge conflict in ${m.files.join(', ') || 'unknown files'}`;
    setTaskState(t.id, { status: 'needs_review', note });
    setSession(s.id, { state: 'paused' });
    addStep({ ...ref(s), kind: 'error', text: `${note}; take over to resolve it` });
  }
  schedule();
}

// Run the project's CLI in a task's folder (or main's): output streams to terminal[taskId] and ends up in a run step.
export async function runCliIn(taskId: string, dir: string, by: string, args: string[]) {
  const cmd = ['node src/cli.js', ...args.map((a) => (/^[\w./:=@%+,-]+$/.test(a) ? a : JSON.stringify(a)))].join(' ');
  const term = openTerminal(taskId, by, cmd);
  const r = await runCli(dir, args, term.write);
  term.end(r.exitCode);
  addStep({
    taskId, sessionId: taskState().get(taskId)?.sessionId, kind: 'run', by,
    text: `${by === 'agent' ? 'Ran' : `${by} ran`} ${cmd}: exit ${r.exitCode}${r.sandbox ? ' (in sandbox)' : ''}`, output: r.output,
  });
  return { cmd, ...r };
}

export function startCli(taskId: string, by: string, args: string[]) {
  const dir = filesDir(taskId) ?? workspaceDir();
  if (readFile(dir, 'src/cli.js') === null) throw new HttpError(409, 'This project has no src/cli.js to run');
  void runCliIn(taskId, dir, by, args).catch((e) => console.error(`CLI run in ${taskId} failed:`, (e as Error).message));
}

function fail(s: SessionData, note: string) {
  setTaskState(s.taskId, { status: 'failed', note });
  setSession(s.id, { state: 'failed' });
  addStep({ ...ref(s), kind: 'error', text: note });
}

function pause(s: SessionData, note: string) {
  setTaskState(s.taskId, { status: 'paused', note });
  setSession(s.id, { state: 'paused' });
}

// ---- Redirect, takeover and hand-offs ----

export function steer(sid: string, from: string, text: string) {
  const s = load(sid);
  if (!s || !sessions().has(sid)) throw new HttpError(404, `Session "${sid}" not found`);
  s.steers.push(`${from} says: ${text}`);
  save(s);
  addStep({ ...ref(s, from), kind: 'steer', text: `${from}: ${text}` });
}

export function specChanged(taskId: string, by: string, spec: string, why?: string) {
  const sid = taskState().get(taskId)?.sessionId;
  addStep({ taskId, sessionId: sid, kind: 'spec-change', by, text: `${by} changed the spec${why ? `: ${why}` : ''}` });
  const s = load(sid);
  if (s && taskState().get(taskId)?.status === 'running') {
    s.steers.push(`${by} changed the spec to: ${spec}. Reason: ${why || 'none given'}`);
    save(s);
  }
}

function removeTaskState(taskId: string) {
  const sid = taskState().get(taskId)?.sessionId;
  if (sid) {
    active.get(key(sid))?.abort();
    if (sessions().has(sid)) setSession(sid, { state: 'failed' });
  }
  serverWrite(() => { taskState().delete(taskId); terminal().delete(taskId); });
}

// React to browsers editing the graph.
export function watchTasks() {
  const project = currentId();   // websocket updates arrive outside any project context
  tasks().observe((ev, tr) => {
    if (tr.origin === 'server') return;
    const changes = [...ev.changes.keys].map(([id, c]) => ({ id, action: c.action, old: c.oldValue as TaskSpec | undefined }));
    setTimeout(() => inProject(project, () => {
      for (const { id, action, old } of changes) {
        const cur = tasks().get(id);
        if (action === 'delete') removeTaskState(id);
        else if (action === 'add' && !taskState().has(id)) setTaskState(id, {});
        else if (action === 'update' && cur && old && old.spec !== cur.spec) specChanged(id, cur.editedBy || 'someone', cur.spec, cur.why);
      }
      schedule();
    }));
  });
}

async function holdFor(s: SessionData, name: string) {
  active.get(key(s.id))?.abort();
  setSession(s.id, { state: 'paused' });
  setTaskState(s.taskId, { status: 'paused', owner: { kind: 'human', name }, note: `${name} is working on it` });
  s.takeoverBase = await head(worktreeDir(s.taskId));
  save(s);
}

export async function takeover(taskId: string, by: string): Promise<string> {
  getTask(taskId);
  if (stateOf(taskId).status === 'done') throw new HttpError(409, 'Task is already done');
  const s = await ensureSession(taskId, by);
  await holdFor(s, by);
  addStep({ ...ref(s, by), kind: 'takeover', text: `${by} took over` });
  void summarize(taskId).catch(() => {});
  return s.id;
}

export const filesDir = (taskId: string) => {
  getTask(taskId);
  const dir = worktreeDir(taskId);
  return existsSync(dir) ? dir : null;
};

export async function humanEdit(taskId: string, path: unknown, content: string, by: string, user?: GitUser) {
  const t = getTask(taskId);
  const st = stateOf(taskId);
  if (st.owner.kind !== 'human' || st.owner.name.toLowerCase() !== by.toLowerCase()) {
    throw new HttpError(403, st.owner.kind === 'human' ? `Only ${st.owner.name} can edit this task now` : 'Take over the task before editing');
  }
  const p = safePath(path);
  if (!p) throw new HttpError(400, 'path must be a file under src/ or test/');
  const dir = filesDir(taskId);
  if (!dir) throw new HttpError(409, 'Task has no worktree yet');
  writeFile(dir, p, content);
  const commit = await commitAll(dir, personAuthor(by, user), `${t.title}: ${by} edited ${p}`);
  const d = commit ? await diff(dir, 'HEAD~1', 'HEAD', p) : '';
  const sid = st.sessionId;
  addStep({ taskId, sessionId: sid, kind: 'human-edit', by, text: `${by} edited ${p}`, path: p, diff: d, commit: commit ?? undefined });
  return { commit };
}

// Give the task back to the agent, telling it what the person changed.
async function giveToAgent(taskId: string, by: string, note: string, kind: 'handback' | 'handoff') {
  const t = getTask(taskId);
  const s = await ensureSession(taskId, by);
  if (s.takeoverBase) {
    const d = await diff(worktreeDir(taskId), s.takeoverBase, 'HEAD');
    s.pending.push(`${by} edited the code while you were paused. Their note: ${note || 'none'}. Diff of their changes:\n${trim(d, 8000) || '(no changes)'}\nContinue from here and keep their changes.`);
  } else if (note) {
    s.pending.push(`${by} handed this task to you. Their note: ${note}`);
  }
  Object.assign(s, { testOk: false, takeoverBase: undefined, limit: s.stepCount + MAX_STEPS, bad: 0, errors: 0, conflicts: 0 });
  save(s);
  if (kind === 'handback') addStep({ ...ref(s, by), kind: 'handback', text: `${by} handed back to the agent${note ? `: ${note}` : ''}` });
  if (!t.deps.every(isDone)) {
    setTaskState(taskId, { status: 'todo', owner: AGENT_OWNER, note: undefined });
    schedule();
    return;
  }
  setTaskState(taskId, { status: 'running', owner: AGENT_OWNER, note: undefined });
  setSession(s.id, { state: 'running' });
  resume(s.id);
}

export async function handback(taskId: string, by: string, note: string) {
  getTask(taskId);
  if (stateOf(taskId).owner.kind !== 'human') throw new HttpError(409, 'The agent already owns this task');
  await giveToAgent(taskId, by, note, 'handback');
}

export async function handoff(taskId: string, by: string, to: string, note: string) {
  getTask(taskId);
  const st = stateOf(taskId);
  if (st.status === 'done') throw new HttpError(409, 'Task is already done');
  const { summary } = await summarize(taskId);
  const sid = st.sessionId;
  addStep({ taskId, sessionId: sid, kind: 'handoff', by, text: `${by} handed this to ${to}${note ? `: ${note}` : ''}` });
  if (to.toLowerCase() === 'agent') {
    if (!(st.owner.kind === 'agent' && st.status === 'running')) await giveToAgent(taskId, by, note, 'handoff');
  } else {
    await holdFor(await ensureSession(taskId, by), to);
  }
  return { summary };
}

// ---- Startup ----

export function recover() {
  syncTaskStates();
  for (const st of taskState().values()) {
    if (st.status === 'running') setTaskState(st.taskId, { status: 'paused', note: 'server restarted' });
  }
  for (const sv of sessions().values()) if (sv.state === 'running') setSession(sv.id, { state: 'paused' });
  serverWrite(() => {
    for (const k of [...live().keys()]) live().delete(k);
    for (const v of [...terminal().values()]) if (v.running) terminal().set(v.taskId, { ...v, running: false, output: `${v.output}\n(server restarted)` });
  });
  schedule();   // Semi-auto and Automatic pick up where they left off
}
