'use client';

// PLACEHOLDER BACKEND. A local store that fakes the server (Planner, Builder, staleness,
// conflicts, push) so the UI can be built and demoed before server/ exists.
// When the server lands, replace useHive() with Y.Doc reads (lib/hive.ts) and the
// actions with Yjs writes to `tasks` + POSTs to the API. Components shouldn't change.

import { useSyncExternalStore } from 'react';
import type { ChatMessage, Conflict, Decision, Task, TaskRun } from './types';

export interface HiveState {
  tasks: Record<string, Task>;
  runs: Record<string, TaskRun>;
  chat: ChatMessage[];
  conflicts: Record<string, Conflict>;
  decisions: Decision[];
  thinking: boolean;
  pushing: boolean;
  pushedUrl?: string;
  focus?: { id: string; at: number };
  toast?: { text: string; at: number };
}

export const DEMO_REQUEST = 'Build a URL shortener API: create, redirect, stats, with tests.';

const PLAN: Task[] = [
  { id: 'create', title: 'Create short link', x: 40, y: 40, dependsOn: [], assignee: 'agent',
    spec: 'POST /links takes {url}, validates it and returns {code, short} with 201. Codes are 6 characters, base62.',
    acceptance: ['POST /links returns 201 and a 6-char code', 'Invalid URLs return 400'],
    files: ['src/app.js', 'src/store.js', 'test/create.test.js'] },
  { id: 'redirect', title: 'Redirect', x: 440, y: 40, dependsOn: [], assignee: 'agent',
    spec: 'GET /:code responds 302 to the stored URL and records the click.',
    acceptance: ['Known code redirects with 302', 'Unknown code returns 404'],
    files: ['src/app.js', 'test/redirect.test.js'] },
  { id: 'stats', title: 'Click stats', x: 40, y: 320, dependsOn: ['create', 'redirect'], assignee: 'agent',
    spec: 'GET /links/:code/stats returns total clicks and the time of the last click.',
    acceptance: ['Returns clicks for a known code', 'Returns 404 for an unknown code'],
    files: ['src/stats.js', 'test/stats.test.js'] },
  { id: 'readme', title: 'README', x: 440, y: 320, dependsOn: ['create', 'redirect'], assignee: 'agent',
    spec: 'Document the three endpoints with a curl example each.',
    acceptance: ['Lists every endpoint with an example'],
    files: ['README.md'] },
  { id: 'e2e', title: 'End-to-end test', x: 40, y: 600, dependsOn: ['stats'], assignee: 'agent',
    spec: 'One test that creates a link, follows it twice and checks the stats.',
    acceptance: ['create → redirect → stats flow passes'],
    files: ['test/e2e.test.js'] },
];

let state: HiveState = {
  tasks: {}, runs: {}, chat: [], conflicts: {}, decisions: [],
  thinking: false, pushing: false,
};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useHive(): HiveState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

function set(fn: (s: HiveState) => Partial<HiveState>) {
  state = { ...state, ...fn(state) };
  listeners.forEach((l) => l());
}

// ---- helpers ---------------------------------------------------------------

let seq = 0;
const nid = (p: string) => `${p}${++seq}`;
const now = () => new Date().toISOString();
const sha = () => Array.from({ length: 7 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const cooling = new Set<string>();
const versions: Record<string, number> = {};
const restarts: Record<string, number> = {};
let autoRun = false;
let conflictShown = false;

const putTask = (t: Task) => set((s) => ({ tasks: { ...s.tasks, [t.id]: t } }));
const blankRun = (id: string): TaskRun => ({ taskId: id, status: 'todo', builtFromVersion: 0, branch: `task/${id}`, note: '' });
const putRun = (id: string, f: Partial<TaskRun>) => set((s) => ({
  runs: { ...s.runs, [id]: { ...(s.runs[id] ?? blankRun(id)), ...f } },
}));
const say = (from: string, text: string, extra: Partial<ChatMessage> = {}) =>
  set((s) => ({ chat: [...s.chat, { id: nid('m'), at: now(), from, text, ...extra }] }));
function log(d: Omit<Decision, 'id' | 'at'>): string {
  const id = `d${state.decisions.length + 1}`;
  set((s) => ({ decisions: [...s.decisions, { id, at: now(), ...d }] }));
  return id;
}
export const toast = (text: string) => set(() => ({ toast: { text, at: Date.now() } }));
const title = (id: string) => state.tasks[id]?.title ?? id;
const isDone = (id: string) => state.runs[id]?.status === 'done';

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

// ---- scheduler -------------------------------------------------------------

function refreshReady() {
  for (const t of Object.values(state.tasks)) {
    const st = state.runs[t.id]?.status ?? 'todo';
    const depsDone = t.dependsOn.every(isDone);
    if (t.assignee !== 'agent') continue;
    if (st === 'todo' && depsDone) putRun(t.id, { status: 'ready', note: 'Dependencies done' });
    if (st === 'ready' && !depsDone) putRun(t.id, { status: 'todo', note: '' });
  }
}

function schedule() {
  refreshReady();
  if (!autoRun) return;
  let running = Object.values(state.runs).filter((r) => r.status === 'running').length;
  const candidates = Object.values(state.tasks)
    .filter((t) => {
      const st = state.runs[t.id]?.status;
      return t.assignee === 'agent' && !cooling.has(t.id) && (st === 'ready' || st === 'stale') && t.dependsOn.every(isDone);
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of candidates) {
    if (running >= 2) break;   // at most two Builder runs at once
    startRun(t.id);
    running++;
  }
}

function startRun(id: string) {
  putRun(id, {
    status: 'running', builtFromVersion: versions[id] ?? 0,
    note: restarts[id] ? `Rebuilding with the new spec (restart ${restarts[id]}/3)` : 'Builder is writing code',
    commit: undefined, diff: undefined, testOutput: undefined,
  });
  const ms = id === 'stats' ? 9000 : 3500 + Math.random() * 2000;
  timers.set(id, setTimeout(() => finishRun(id), ms));
}

function finishRun(id: string) {
  timers.delete(id);
  const t = state.tasks[id];
  if (!t) return;
  const commit = sha();
  const diff = fakeDiff(t);
  const testOutput = fakeTests(t);
  const rival = Object.values(state.tasks).find((o) =>
    o.id !== id && isDone(o.id) && o.files.includes('src/app.js') && t.files.includes('src/app.js'));

  if (rival && !conflictShown) {
    conflictShown = true;
    putRun(id, { status: 'blocked', commit, diff, testOutput, note: 'Merge conflict in src/app.js' });
    const cid = nid('c');
    set((s) => ({ conflicts: { ...s.conflicts, [cid]: {
      id: cid, taskA: rival.id, taskB: id, files: ['src/app.js'], status: 'open',
      hunks: [
        "app.get('/health', (req, res) => res.json({ ok: true }));",
        `<<<<<<< task/${rival.id}`,
        "app.post('/links', createLink);",
        '=======',
        "app.get('/:code', redirect);",
        `>>>>>>> task/${id}`,
        'module.exports = app;',
      ].join('\n'),
      proposal: [
        "app.get('/health', (req, res) => res.json({ ok: true }));",
        "app.post('/links', createLink);",
        "app.get('/:code', redirect);",
        'module.exports = app;',
      ].join('\n'),
    } } }));
    log({ who: 'builder', taskId: id, kind: 'conflict', summary: `${title(rival.id)} and ${title(id)} both changed src/app.js` });
    say('builder', `Merging task/${id} conflicted with task/${rival.id} in src/app.js. Proposing a merge and running the full suite…`);
    setTimeout(() => {
      if (state.conflicts[cid]?.status !== 'open') return;
      set((s) => ({ conflicts: { ...s.conflicts, [cid]: {
        ...s.conflicts[cid], status: 'auto-resolved', proposalPassesTests: true, rule: 'Full test suite passes (6/6)' } } }));
      completeMerge(id, commit, 'proposal applied, tests pass');
    }, 4000);
    return;
  }

  putRun(id, { status: 'done', commit, diff, testOutput, note: 'Tests pass · merged into main' });
  log({ who: 'builder', taskId: id, kind: 'agent-result', summary: `${t.title}: tests pass, merged into main`, commit });
  say('builder', `${t.title} is green and merged into main (${commit}).`);
  schedule();
}

function completeMerge(id: string, commit: string, how: string) {
  putRun(id, { status: 'done', commit, note: `Merged into main · ${how}` });
  log({ who: 'builder', taskId: id, kind: 'merge', summary: `${title(id)} merged into main: ${how}`, commit });
  say('builder', `${title(id)} merged into main (${commit}): ${how}.`);
  schedule();
}

// ---- actions (the UI calls only these) -------------------------------------

export function moveTask(id: string, x: number, y: number) {
  const t = state.tasks[id];
  if (t) putTask({ ...t, x, y });
}

export function updateTask(id: string, fields: Partial<Task>, by: string) {
  const prev = state.tasks[id];
  if (!prev) return;
  putTask({ ...prev, ...fields });
  const specChanged = (fields.spec !== undefined && fields.spec !== prev.spec)
    || (fields.acceptance !== undefined && JSON.stringify(fields.acceptance) !== JSON.stringify(prev.acceptance));

  if (fields.assignee !== undefined && fields.assignee !== prev.assignee) {
    log({ who: by, taskId: id, kind: 'graph-change', summary: `${prev.title} assigned to ${fields.assignee}` });
    if (fields.assignee !== 'agent' && state.runs[id]?.status === 'ready') putRun(id, { status: 'todo', note: '' });
    schedule();
  }
  if (!specChanged) return;

  versions[id] = (versions[id] ?? 0) + 1;
  log({ who: by, taskId: id, kind: 'spec-change', summary: `${prev.title}: spec changed`, why: fields.lastWhy });
  for (const t of [id, ...downstreamOf(id)]) {
    const r = state.runs[t];
    if (!r || r.status === 'todo' || r.status === 'ready') continue;
    const timer = timers.get(t);
    if (timer) { clearTimeout(timer); timers.delete(t); }
    putRun(t, { status: 'stale', note: t === id ? 'Spec changed · rebuilding in 1.5 s' : `Spec changed upstream (${title(id)})` });
  }
  if (state.runs[id]?.status !== 'stale') return;
  cooling.add(id);
  setTimeout(() => {
    cooling.delete(id);
    restarts[id] = (restarts[id] ?? 0) + 1;
    if (restarts[id] > 3) { putRun(id, { note: 'Restarted 3 times · waiting for a person' }); return; }
    autoRun = true;
    schedule();
  }, 1500);
}

export function addEdge(from: string, to: string, by: string) {
  const t = state.tasks[to];
  if (!t || from === to || t.dependsOn.includes(from)) return;
  if (downstreamOf(to).includes(from)) {
    toast(`That edge would make a cycle: ${title(to)} already leads to ${title(from)}.`);
    return;
  }
  putTask({ ...t, dependsOn: [...t.dependsOn, from] });
  log({ who: by, taskId: to, kind: 'graph-change', summary: `${title(to)} now depends on ${title(from)}` });
  schedule();
}

export function removeEdge(from: string, to: string, by: string) {
  const t = state.tasks[to];
  if (!t) return;
  putTask({ ...t, dependsOn: t.dependsOn.filter((d) => d !== from) });
  log({ who: by, taskId: to, kind: 'graph-change', summary: `${title(to)} no longer depends on ${title(from)}` });
  schedule();
}

export function runReady(taskId?: string) {
  autoRun = true;
  if (taskId) {
    const t = state.tasks[taskId];
    const st = state.runs[taskId]?.status;
    if (!t) return;
    if (st === 'running') return toast(`${t.title} is already building.`);
    if (!t.dependsOn.every(isDone)) return toast(`${t.title} is waiting on its dependencies.`);
    startRun(taskId);
    return;
  }
  const before = Object.values(state.runs).filter((r) => r.status === 'running').length;
  schedule();
  const after = Object.values(state.runs).filter((r) => r.status === 'running').length;
  if (after === before && after === 0) toast('No tasks are ready yet.');
}

export function resolveConflict(id: string, choice: 'ours' | 'theirs' | 'proposal', by: string) {
  const c = state.conflicts[id];
  if (!c || c.status !== 'open') return;
  set((s) => ({ conflicts: { ...s.conflicts, [id]: { ...c, status: 'resolved', rule: `${by} picked ${choice}` } } }));
  completeMerge(c.taskB, state.runs[c.taskB]?.commit ?? sha(), `${by} picked ${choice}`);
}

export function push(by: string, repo: string | null) {
  if (!repo) return toast('Connect a GitHub repo on the Overview page first.');
  set(() => ({ pushing: true }));
  setTimeout(() => {
    const c = sha();
    set(() => ({ pushing: false, pushedUrl: `https://github.com/${repo}/commit/${c}` }));
    log({ who: by, kind: 'push', summary: 'Tests pass on main · pushed to GitHub', commit: c });
    say('builder', `Full suite passes on main. Pushed ${c} to GitHub.`);
  }, 2000);
}

export function focusTask(id: string) {
  set(() => ({ focus: { id, at: Date.now() } }));
}

export function sendChat(text: string, by: string) {
  say(by, text);
  set(() => ({ thinking: true }));
  setTimeout(() => { set(() => ({ thinking: false })); planner(text, by); },
    Object.keys(state.tasks).length ? 1400 : 2200);
}

function planner(text: string, by: string) {
  const isQuestion = /\bwhy\b|\?\s*$/i.test(text);
  if (isQuestion && state.decisions.length) return answer(text);
  if (!Object.keys(state.tasks).length) return createPlan(by);

  const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || nid('t');
  const lowest = Math.max(...Object.values(state.tasks).map((t) => t.y));
  putTask({ id, title: text.slice(0, 40), spec: text, acceptance: [], dependsOn: [], files: [], assignee: 'agent', x: 440, y: lowest + 280 });
  log({ who: 'planner', taskId: id, kind: 'graph-change', summary: `Added task ${id} from ${by}'s message` });
  say('planner', `Added “${text.slice(0, 40)}” as a new task. Drag from another node to give it a dependency.`,
    { ops: [{ op: 'addTask', task: { id, title: text.slice(0, 40) } }] });
  schedule();
}

function createPlan(by: string) {
  PLAN.forEach((t, i) => setTimeout(() => { putTask({ ...t }); refreshReady(); }, i * 180));
  setTimeout(() => {
    const did = log({ who: 'planner', kind: 'graph-change', summary: `Planned 5 tasks from ${by}'s request` });
    say('planner', 'Here’s the plan: five tasks. Create and Redirect can start right away; Stats and the README wait for both, and the end-to-end test waits for Stats.', {
      ops: [
        ...PLAN.map((t) => ({ op: 'addTask' as const, task: { id: t.id, title: t.title } })),
        ...PLAN.flatMap((t) => t.dependsOn.map((d) => ({ op: 'addEdge' as const, from: d, to: t.id }))),
      ],
      cites: [did],
    });
  }, PLAN.length * 180 + 100);
}

function answer(q: string) {
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const hits = state.decisions.filter((d) =>
    words.some((w) => `${d.summary} ${d.why ?? ''} ${d.taskId ?? ''}`.toLowerCase().includes(w))).slice(-3);
  const why = [...hits].reverse().find((d) => d.why);
  const result = why && [...state.decisions].reverse().find((d) =>
    d.taskId === why.taskId && (d.kind === 'agent-result' || d.kind === 'merge') && d.at > why.at);
  const cites = [why?.id, result?.id, ...hits.map((h) => h.id)].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).slice(0, 3);
  const text = why
    ? `${why.who} changed ${title(why.taskId ?? '')} at ${new Date(why.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: “${why.why}”.`
      + (result ? ` The rebuild passed its tests in ${result.commit}.` : ' The rebuild is still running.')
    : hits.length
      ? `Here’s what the log says: ${hits.map((h) => h.summary).join('; ')}.`
      : 'Nothing in the decision log covers that yet.';
  say('planner', text, { cites });
}

// ---- fake build output -----------------------------------------------------

function fakeDiff(t: Task): string {
  const file = t.files.find((f) => f.startsWith('src/')) ?? t.files[0] ?? 'src/app.js';
  const test = t.files.find((f) => f.startsWith('test/')) ?? `test/${t.id}.test.js`;
  return [
    `diff --git a/${file} b/${file}`,
    `@@ -1,4 +1,${8 + t.acceptance.length} @@`,
    " const { store } = require('./store');",
    `-// TODO: ${t.id}`,
    `+// ${t.title}`,
    `+function ${t.id.replace(/\W/g, '')}(req, res) {`,
    ...t.spec.split('. ').slice(0, 2).map((s) => `+  // ${s.replace(/\.$/, '')}`),
    '+  res.statusCode = 200;',
    '+}',
    `diff --git a/${test} b/${test}`,
    ...t.acceptance.map((a) => `+test('${a}', async () => { /* … */ });`),
  ].join('\n');
}

function fakeTests(t: Task): string {
  const lines = t.acceptance.map((a, i) => `✔ ${a} (${12 + i * 7}ms)`);
  return [`▶ ${t.title}`, ...lines.map((l) => `  ${l}`), `ℹ tests ${lines.length} · pass ${lines.length} · fail 0`].join('\n');
}
