'use client';

// LIVE BACKEND ADAPTER. Same exports and HiveState shape the components were built against, now
// backed by the shared Y.Doc (lib/hive.ts) and the server's REST API (see INTEGRATION.md).
// Reads come from the doc; the only doc writes are to `tasks`; every action is a REST call.
// (Kept at this path so components don't change; the old local fake is in git history.)

import { useSyncExternalStore } from 'react';
import {
  ARRAYS, MAPS,
  type ChatMessage as DocChat, type SessionView, type Step, type TaskSpec, type TaskState,
} from '@hive/shared/types';
import { authHeaders } from './auth';
import { apiUrl, getProvider } from './hive';
import { projectId } from './projects';
import { runSteps } from './steps';
import type { ChatMessage, Conflict, Decision, RunStatus, Task, TaskRun } from './types';

export interface HiveState {
  tasks: Record<string, Task>;
  runs: Record<string, TaskRun>;
  chat: ChatMessage[];
  conflicts: Record<string, Conflict>;     // the server has no conflict cards; merge conflicts show as blocked tasks
  decisions: Decision[];
  thinking: boolean;
  pushing: boolean;
  pushedUrl?: string;
  focus?: { id: string; at: number };
  toast?: { text: string; at: number };
  // Raw server state for the live session view.
  taskState: Record<string, TaskState>;
  sessions: Record<string, SessionView>;
  live: Record<string, string>;
  steps: Step[];
}

export const DEMO_REQUEST = 'Build a URL shortener API: create, redirect, stats, with tests.';

const EMPTY: HiveState = {
  tasks: {}, runs: {}, chat: [], conflicts: {}, decisions: [], thinking: false, pushing: false,
  taskState: {}, sessions: {}, live: {}, steps: [],
};
let state: HiveState = EMPTY;
let local: Pick<HiveState, 'thinking' | 'pushing' | 'pushedUrl' | 'focus' | 'toast'> = { thinking: false, pushing: false };
let thinkingFrom = -1;
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  attach();
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useHive(): HiveState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

function emit() { listeners.forEach((l) => l()); }
function setLocal(patch: Partial<typeof local>) {
  local = { ...local, ...patch };
  state = { ...state, ...local };
  emit();
}

// ---- doc -> HiveState --------------------------------------------------------

let attached = false;
let queued = false;
function attach() {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  const doc = getProvider().document;
  const rebuild = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; state = build(); emit(); }, 30);   // batches bursts; rAF would pause in background tabs
  };
  for (const k of Object.values(MAPS)) doc.getMap(k).observeDeep(rebuild);
  for (const k of Object.values(ARRAYS)) doc.getArray(k).observeDeep(rebuild);
  state = build();
}

const doc = () => getProvider().document;
const specMap = () => doc().getMap<TaskSpec>(MAPS.tasks);

// Acceptance checks live inside the spec text, so the agent reads them too.
const CHECKS = '\n\nAcceptance checks:\n';
function splitSpec(spec: string): { spec: string; acceptance: string[] } {
  const i = spec.indexOf(CHECKS);
  if (i < 0) return { spec, acceptance: [] };
  return { spec: spec.slice(0, i), acceptance: spec.slice(i + CHECKS.length).split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) };
}
const joinSpec = (spec: string, acc: string[]) => (acc.length ? `${spec.trim()}${CHECKS}${acc.map((a) => `- ${a}`).join('\n')}` : spec.trim());

const DECISION_KIND: Partial<Record<Step['kind'], Decision['kind']>> = {
  'spec-change': 'spec-change', steer: 'graph-change', takeover: 'graph-change', 'human-edit': 'graph-change',
  handback: 'graph-change', handoff: 'graph-change', finish: 'agent-result', merge: 'merge', error: 'conflict', approve: 'push',
  check: 'check', mode: 'mode',
};

function build(): HiveState {
  const d = doc();
  const specs = d.getMap<TaskSpec>(MAPS.tasks).toJSON() as Record<string, TaskSpec>;
  const taskState = d.getMap<TaskState>(MAPS.taskState).toJSON() as Record<string, TaskState>;
  const sessions = d.getMap<SessionView>(MAPS.sessions).toJSON() as Record<string, SessionView>;
  const live = d.getMap<string>(MAPS.live).toJSON() as Record<string, string>;
  const steps = d.getArray<Step>(ARRAYS.steps).toArray();
  const docChat = d.getArray<DocChat>(ARRAYS.chat).toArray();

  const byTask: Record<string, Step[]> = {};
  for (const s of steps) if (s.taskId) (byTask[s.taskId] ??= []).push(s);

  const tasks: Record<string, Task> = {};
  for (const sp of Object.values(specs)) {
    const st = taskState[sp.id];
    const files = [...new Set((byTask[sp.id] ?? []).filter((s) => s.path).map((s) => s.path!))].sort();
    tasks[sp.id] = {
      id: sp.id, title: sp.title, ...splitSpec(sp.spec), dependsOn: sp.deps, files,
      assignee: st?.owner.kind === 'human' ? st.owner.name : 'agent', x: sp.x, y: sp.y, lastWhy: sp.why, ask: sp.ask,
    };
  }

  const runs: Record<string, TaskRun> = {};
  for (const t of Object.values(tasks)) runs[t.id] = toRun(t, taskState, byTask[t.id] ?? []);

  const chat: ChatMessage[] = docChat.map((m) => ({
    id: m.id, at: m.at, from: m.from, text: m.text, cites: m.cites,
    ops: m.taskIds?.filter((id) => specs[id]).map((id) => ({ op: 'addTask' as const, task: { id, title: specs[id].title } })),
  }));
  if (local.thinking && docChat.slice(thinkingFrom).some((m) => m.from === 'planner')) local = { ...local, thinking: false };

  const decisions: Decision[] = steps.flatMap((s) => {
    const kind = DECISION_KIND[s.kind];
    if (!kind) return [];
    const title = s.taskId ? specs[s.taskId]?.title ?? s.taskId : '';
    const why = s.kind === 'spec-change' ? /changed the spec: (.+)$/.exec(s.text)?.[1] : undefined;
    return [{ id: s.id, at: s.at, who: s.by, taskId: s.taskId, kind, summary: title ? `${title}: ${s.text}` : s.text, why, commit: s.commit, image: s.image }];
  });

  return { ...EMPTY, ...local, tasks, runs, chat, decisions, taskState, sessions, live, steps };
}

function toRun(t: Task, all: Record<string, TaskState>, steps: Step[]): TaskRun {
  const st = all[t.id];
  const human = st?.owner.kind === 'human';
  const depsDone = t.dependsOn.every((d) => all[d]?.status === 'done');
  const status: RunStatus =
    st?.status === 'running' ? 'running'
      : st?.status === 'done' ? 'done'
        : st?.status === 'failed' ? 'failed'
          : st?.status === 'needs_review' ? 'blocked'
            : st?.status === 'paused' ? (human ? 'todo' : 'blocked')
              : depsDone && !human ? 'ready' : 'todo';
  const last = (f: (s: Step) => boolean) => [...steps].reverse().find(f);
  const plan = last((s) => s.kind === 'plan');
  const test = last((s) => s.kind === 'test');
  const edit = last((s) => (s.kind === 'edit' || s.kind === 'human-edit') && !!s.diff);
  const total = runSteps(t).length;
  return {
    taskId: t.id, status,
    builtFromVersion: steps.filter((s) => s.kind === 'spec-change').length,
    branch: st?.branch ?? `task/${t.id}`,
    commit: last((s) => !!s.commit)?.commit,
    diff: edit?.diff,
    testOutput: test?.test?.output,
    note: status === 'running' ? plan?.text ?? 'Agent is starting'
      : st?.note ?? (status === 'done' ? 'Tests pass · merged into main' : status === 'ready' && t.ask ? 'Marked "ask": in Semi-auto it waits for your OK. Press Start to approve it.' : ''),
    step: test ? Math.min(2 + Math.max(0, t.acceptance.length - 1), total - 2) : 1,
  };
}

// ---- helpers -------------------------------------------------------------------

export const toast = (text: string) => setLocal({ toast: { text, at: Date.now() } });
const fail = (e: unknown) => toast((e as Error).message);
const title = (id: string) => state.tasks[id]?.title ?? id;

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(`/api/projects/${projectId()}${path}`), {
    method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

function writeSpec(id: string, patch: Partial<TaskSpec>) {
  const cur = specMap().get(id);
  if (!cur) return;
  specMap().set(id, JSON.parse(JSON.stringify({ ...cur, ...patch })));
}

export function downstreamOf(id: string): string[] {
  const out: string[] = [];
  const walk = (cur: string) => {
    for (const t of Object.values(state.tasks)) {
      if (t.dependsOn.includes(cur) && !out.includes(t.id)) { out.push(t.id); walk(t.id); }
    }
  };
  walk(id);
  return out;
}

export function nextTaskId(): string {
  const n = Math.max(0, ...Object.keys(state.tasks).map((k) => Number(k.replace(/^T/, '')) || 0));
  return `T${n + 1}`;
}

const myName = () => new URLSearchParams(window.location.search).get('name') ?? 'Guest';   // the server replaces it when sign-in is on

// ---- actions (the UI calls only these) ------------------------------------------

// Many positions in one transaction (the layout fix), so other windows see one change.
export function moveTasks(pos: Record<string, { x: number; y: number }>) {
  doc().transact(() => { for (const [id, p] of Object.entries(pos)) moveTask(id, p.x, p.y); });
}

export const setMode = (mode: string) => api('POST', '/mode', { by: myName(), mode }).catch((e) => { fail(e); throw e; });

export function setAsk(id: string, ask: boolean, by: string) {
  writeSpec(id, { ask: ask || undefined, editedBy: by });
}

export function moveTask(id: string, x: number, y: number) {
  const cur = specMap().get(id);
  if (cur && (cur.x !== x || cur.y !== y)) writeSpec(id, { x, y });
}

export function updateTask(id: string, fields: Partial<Task>, by: string) {
  const cur = specMap().get(id);
  if (!cur) return;
  if (fields.title !== undefined || fields.spec !== undefined || fields.acceptance !== undefined) {
    const prev = splitSpec(cur.spec);
    const spec = joinSpec(fields.spec ?? prev.spec, fields.acceptance ?? prev.acceptance);
    writeSpec(id, spec !== cur.spec
      ? { title: fields.title ?? cur.title, spec, editedBy: by, why: fields.lastWhy ?? '' }
      : { title: fields.title ?? cur.title });
  }
  if (fields.files !== undefined) toast('Files come from the commits in the task\'s worktree.');
  if (fields.assignee !== undefined && fields.assignee !== state.tasks[id]?.assignee) void assign(id, fields.assignee, by);
}

// Assignee picker -> takeover (me), handback (agent, from a person) or handoff (anyone else).
async function assign(id: string, to: string, by: string) {
  try {
    const human = state.taskState[id]?.owner.kind === 'human';
    if (to === 'agent') {
      if (human) await api('POST', `/tasks/${id}/handback`, { by, note: '' });
    } else if (to === by) {
      await api('POST', `/tasks/${id}/takeover`, { by });
    } else {
      await api('POST', `/tasks/${id}/handoff`, { by, to, note: '' });
      toast(`${title(id)} handed to ${to} with a summary.`);
    }
  } catch (e) { fail(e); }
}

export function addEdge(from: string, to: string, by: string) {
  const t = specMap().get(to);
  if (!t || from === to || t.deps.includes(from)) return;
  if (downstreamOf(to).includes(from)) {
    toast(`That edge would make a cycle: ${title(to)} already leads to ${title(from)}.`);
    return;
  }
  writeSpec(to, { deps: [...t.deps, from], editedBy: by });
}

export function removeEdge(from: string, to: string, by: string) {
  const t = specMap().get(to);
  if (t) writeSpec(to, { deps: t.deps.filter((d) => d !== from), editedBy: by });
}

export function runReady(taskId?: string) {
  const by = myName();
  if (taskId) {
    api('POST', `/tasks/${taskId}/start`, { by }).catch(fail);
    return;
  }
  api<{ started: string[] }>('POST', '/run', { by })
    .then((r) => { if (!r.started.length && !Object.values(state.runs).some((x) => x.status === 'running')) toast('No tasks are ready yet.'); })
    .catch(fail);
}

export function resolveConflict(_id: string, _choice: 'ours' | 'theirs' | 'proposal', _by: string) {
  toast('Merge conflicts are resolved by taking over the task.');
}

// Approve: the server runs the tests on main and pushes to the project's repo from Overview (else GITHUB_REMOTE).
export async function push(by: string, _repo: string | null) {
  setLocal({ pushing: true });
  try {
    const r = await api<{ ok: boolean; commit: string; pushed: boolean; url: string; pushError?: string }>('POST', '/approve', { by });
    if (r.pushed && r.url) setLocal({ pushedUrl: `${r.url}/commit/${r.commit}` });
    else toast(`Tests pass on main (${r.commit}). ${r.pushError ? `Push failed: ${r.pushError}` : 'Not pushed: connect a repo on Overview and sign in with GitHub (or set GITHUB_TOKEN).'}`);
  } catch (e) {
    fail(e);
  } finally {
    setLocal({ pushing: false });
  }
}

export function focusTask(id: string) {
  setLocal({ focus: { id, at: Date.now() } });
}

export function sendChat(text: string, by: string) {
  thinkingFrom = doc().getArray(ARRAYS.chat).length;
  setLocal({ thinking: true });
  setTimeout(() => { if (local.thinking) setLocal({ thinking: false }); }, 60000);
  api('POST', '/chat', { from: by, text }).catch((e) => { setLocal({ thinking: false }); fail(e); });
}

// ---- live session actions (watch, steer, take over, edit, hand back) --------------

export const steer = (sessionId: string, text: string, by: string) =>
  api('POST', `/sessions/${sessionId}/steer`, { from: by, text }).catch(fail);
export const takeover = (id: string, by: string) => api('POST', `/tasks/${id}/takeover`, { by }).catch(fail);
export const handback = (id: string, by: string, note: string) => api('POST', `/tasks/${id}/handback`, { by, note }).catch(fail);
export const listFiles = (id: string) => api<{ files: string[] }>('GET', `/tasks/${id}/files`).then((r) => r.files);
export const readFile = (id: string, path: string) =>
  api<{ content: string }>('GET', `/tasks/${id}/file?path=${encodeURIComponent(path)}`).then((r) => r.content);
export const saveFile = (id: string, path: string, content: string, by: string) =>
  api<{ commit: string | null }>('PUT', `/tasks/${id}/file`, { path, content, by });
