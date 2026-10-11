import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Owner, TaskSpec, TaskState } from '@hive/shared/types';
import { AGENT_SYSTEM, SEARCH_HELP, buildMessages, contextText, isTestFile, parseAction, type Action } from './agent.ts';
import {
  addStep, HttpError, live, serverWrite, sessions, setSession, setTaskState, syncTaskStates, taskState, tasks, trim,
} from './doc.ts';
import { AGENT, personAuthor, type GitUser } from './git.ts';
import { readyTasks } from './graph.ts';
import { generate, models, type Msg } from './llm.ts';
import { saveTranscript } from './mongo.ts';
import { openCodeOn, search } from './opencode.ts';
import { SESSIONS_DIR } from './paths.ts';
import { summarize } from './planner.ts';
import { runTests } from './runner.ts';
import {
  commitAll, diff, ensureWorktree, head, listFiles, mergeToMain, readFile, safePath, worktreeDir, writeFile,
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
}

const cache = new Map<string, SessionData>();
const active = new Map<string, AbortController>();   // sessions with a running loop
const rerun = new Set<string>();
let autoRun = false;

function load(id: string | undefined): SessionData | null {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id)!;
  const file = join(SESSIONS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, 'utf8')) as SessionData;
  cache.set(id, s);
  return s;
}

function save(s: SessionData) {
  cache.set(s.id, s);
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(join(SESSIONS_DIR, `${s.id}.json`), JSON.stringify(s));
  saveTranscript(s);
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

export function run(): string[] {
  autoRun = true;
  return schedule();
}

export function schedule(): string[] {
  if (!autoRun) return [];
  const states = taskState().toJSON() as Record<string, TaskState>;
  let running = Object.values(states).filter((s) => s.status === 'running').length;
  const started: string[] = [];
  for (const id of readyTasks(tasks().toJSON() as Record<string, TaskSpec>, states)) {
    if (running >= MAX_PARALLEL) break;
    running++;
    started.push(id);
    startTask(id, 'agent').catch((e) => console.error(`Could not start ${id}:`, (e as Error).message));
  }
  return started;
}

// ---- The loop ----

function resume(sid: string) {
  const c = active.get(sid);
  if (c && !c.signal.aborted) return;
  if (c) rerun.add(sid);     // the old loop is winding down; start again when it exits
  else void loop(sid);
}

async function loop(sid: string) {
  const ctrl = new AbortController();
  active.set(sid, ctrl);
  try {
    while (await turn(sid, ctrl));
  } catch (e) {
    console.error(`Session ${sid} crashed:`, e);
    const s = load(sid);
    if (s) fail(s, `Internal error: ${(e as Error).message}`);
  } finally {
    active.delete(sid);
    serverWrite(() => live().delete(sid));
    if (rerun.delete(sid)) resume(sid);
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
    const { sandbox, ...r } = await runTests(dir);
    addStep({ ...ref(s), kind: 'test', text: `Tests: ${r.passed} passed, ${r.failed} failed${sandbox ? ' (in sandbox)' : ''}`, test: r });
    setTaskState(t.id, { lastTest: { passed: r.passed, failed: r.failed } });
    s.testOk = r.failed === 0 && r.passed > 0;
    const ran = listFiles(dir).filter(isTestFile);
    s.pending.push(`Test results: ${r.passed} passed, ${r.failed} failed. Test files that ran: ${ran.join(', ') || 'none'}.\n${r.output.slice(-2000)}`);
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
  } else {
    const note = `Merge conflict in ${m.files.join(', ') || 'unknown files'}`;
    setTaskState(t.id, { status: 'needs_review', note });
    setSession(s.id, { state: 'paused' });
    addStep({ ...ref(s), kind: 'error', text: `${note}; take over to resolve it` });
  }
  schedule();
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
    active.get(sid)?.abort();
    if (sessions().has(sid)) setSession(sid, { state: 'failed' });
  }
  serverWrite(() => taskState().delete(taskId));
}

// React to browsers editing the graph.
export function watchTasks() {
  tasks().observe((ev, tr) => {
    if (tr.origin === 'server') return;
    const changes = [...ev.changes.keys].map(([key, c]) => ({ key, action: c.action, old: c.oldValue as TaskSpec | undefined }));
    setTimeout(() => {
      for (const { key, action, old } of changes) {
        const cur = tasks().get(key);
        if (action === 'delete') removeTaskState(key);
        else if (action === 'add' && !taskState().has(key)) setTaskState(key, {});
        else if (action === 'update' && cur && old && old.spec !== cur.spec) specChanged(key, cur.editedBy || 'someone', cur.spec, cur.why);
      }
      schedule();
    });
  });
}

async function holdFor(s: SessionData, name: string) {
  active.get(s.id)?.abort();
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
  Object.assign(s, { testOk: false, takeoverBase: undefined, limit: s.stepCount + MAX_STEPS, bad: 0, errors: 0 });
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
  serverWrite(() => { for (const k of [...live().keys()]) live().delete(k); });
}
