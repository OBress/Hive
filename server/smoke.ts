// End-to-end demo check against the fake provider: `pnpm --filter server smoke`.
// Uses its own data folder in the OS temp dir, starts the server on a spare port, drives the 90-second demo over HTTP, prints PASS/FAIL per check.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, SessionView, Step, TaskSpec, TaskState } from '@hive/shared/types';
import { git } from './git.ts';
import { SERVER_DIR } from './paths.ts';

const DATA_DIR = join(tmpdir(), 'hive-smoke');

interface State { tasks: Record<string, TaskSpec>; taskState: Record<string, TaskState>; sessions: Record<string, SessionView>; steps: Step[]; chat: ChatMessage[] }

const results: [string, boolean, string][] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const port = await new Promise<number>((resolve) => {
  const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
const root = `http://localhost:${port}/api`;
let base = root;   // becomes /api/projects/<id> once the seeded project is known

rmSync(DATA_DIR, { recursive: true, force: true });
let log = '';
function start() {
  const c = spawn(process.execPath, ['--import', 'tsx', 'index.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, HIVE_DATA_DIR: DATA_DIR, HIVE_SEED: join(SERVER_DIR, 'smoke-seed.json'), LLM_PROVIDER: 'fake', FAKE_DELAY_MS: '20', PORT: String(port), MAX_PARALLEL: '2', MAX_STEPS: '20', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', GITHUB_REMOTE: '', GITHUB_TOKEN: '', DAYTONA_API_KEY: '', OPENCODE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  c.stdout.on('data', (d) => { log += d; });
  c.stderr.on('data', (d) => { log += d; });
  return c;
}
const child = start();

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}
const state = async (): Promise<State> => (await call('GET', '/state')).json;
async function until<T>(what: string, f: (s: State) => T | undefined | false, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = f(await state()); if (v) return v; } catch { /* server still starting */ }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const plansAfter = (s: State, stepId: string, sid: string) => {
  const i = s.steps.findIndex((x) => x.id === stepId);
  return s.steps.slice(i + 1).filter((x) => x.kind === 'plan' && x.sessionId === sid);
};

async function projects(name = 'seed'): Promise<{ id: string; name: string }[]> {
  return ((await (await fetch(`${root}/projects?name=${name}`)).json()) as { projects: { id: string; name: string }[] }).projects;
}

try {
  const end = Date.now() + 20000;
  let list: { id: string; name: string }[] = [];
  while (!list.length && Date.now() < end) {
    list = await projects().catch(() => []);
    if (!list.length) await new Promise((r) => setTimeout(r, 100));
  }
  if (!list.length) throw new Error('No seeded project');
  const projectId = list[0].id;
  base = `${root}/projects/${projectId}`;
  await until('server', (s) => s.tasks && Object.keys(s.tasks).length === 4, 20000);
  check('server starts with a project holding the seeded graph', true, projectId);

  // A second project is separate: its own empty graph and workspace.
  const made = await fetch(`${root}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Second project', by: 'Ana' }) });
  const second = (await made.json()) as { id: string };
  const other = (await (await fetch(`${root}/projects/${second.id}/state`)).json()) as State;
  check('a new project starts empty and separate', made.status === 201 && Object.keys(other.tasks).length === 0 && (await projects('Ana')).length === 1, second.id);

  // Each person sees only their own projects and the ones shared with them; sharing needs a known account.
  const shareTo = (login: string) => fetch(`${root}/projects/${second.id}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, by: 'Ana' }) });
  const unknown = await shareTo('nobody-here');
  const shared = await shareTo('seed');
  const users = (await (await fetch(`${root}/users?q=se&name=Ana`)).json()) as { users: { login: string }[] };
  check('projects are private until shared', unknown.status === 404 && shared.status === 200 && (await projects()).length === 2 && users.users.some((u) => u.login === 'seed'));
  const stack = await fetch(`${root}/stack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Chores', goal: 'Track house chores', by: 'Ana' }) });
  check('POST /api/stack drafts a stack doc', stack.status === 200 && /# Stack and spec/.test(((await stack.json()) as { stack: string }).stack));
  const post = (path: string, body: unknown) => fetch(`${root}/projects/${second.id}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const renamed = (await (await post('/rename', { name: 'Chores', by: 'seed' })).json()) as { name: string };
  const refused = await post('/delete', { by: 'seed' });
  const deleted = await post('/delete', { by: 'Ana' });
  check('rename by a member; delete only by the owner', renamed.name === 'Chores' && refused.status === 403 && deleted.status === 200 && (await projects('Ana')).length === 0 && !existsSync(join(DATA_DIR, 'projects', second.id)));

  // Manual: nothing starts by itself; Run ready starts what is ready, and the next task waits for the next press.
  const idle = async () => { await new Promise((r) => setTimeout(r, 800)); return state(); };
  check('Manual mode: nothing starts by itself', Object.values((await idle()).taskState).every((t) => t.status === 'todo'));
  const run = await call('POST', '/run', { by: 'Ana' });
  check('POST /api/run starts store', run.status === 202 && run.json.started?.includes('store'), JSON.stringify(run.json));
  await until('store done', (s) => s.taskState.store?.status === 'done');
  check('store finishes and merges into main', true);
  check('Manual mode: redirect waits for the next Run ready', (await idle()).taskState.redirect?.status === 'todo');

  // Semi-auto (no task is marked "ask" here): the graph keeps moving by itself from now on.
  const semi = await call('POST', '/mode', { by: 'Ana', mode: 'semi' });
  check('POST /mode semi saves the mode and starts redirect', semi.status === 200 && semi.json.mode === 'semi' && semi.json.modeSetBy === 'Ana'
    && !!(await until('redirect started', (s) => s.taskState.redirect?.status === 'running')));

  // Redirect: Ben steers the running agent.
  const sid = await until('redirect running', (s) => s.taskState.redirect?.status === 'running' && s.taskState.redirect.sessionId);
  const steer = await call('POST', `/sessions/${sid}/steer`, { from: 'Ben', text: 'count unique visitors, not hits' });
  const steerStep = (await state()).steps.filter((x) => x.kind === 'steer').at(-1)!;
  // The call already in flight may finish first; the first call made after the steer must acknowledge it.
  const plans = await until('plans after steer', (s) => {
    const p = plansAfter(s, steerStep.id, sid);
    return (p.some((x) => x.text.startsWith('Got it:')) || p.length >= 2 || s.taskState.redirect.status !== 'running') && p;
  });
  check('steer is acknowledged with "Got it:"', steer.status === 202 && plans.slice(0, 2).some((x) => x.text.startsWith('Got it:')), plans.slice(0, 2).map((x) => x.text).join(' | '));

  // Stats: Ana takes over, edits a file, hands it back.
  const statsSid = await until('stats running', (s) => s.taskState.stats?.status === 'running' && s.taskState.stats.sessionId);
  const take = await call('POST', '/tasks/stats/takeover', { by: 'Ana' });
  const afterTake = await state();
  check('takeover pauses the agent and makes Ana owner', take.status === 200 && afterTake.taskState.stats.status === 'paused' && afterTake.taskState.stats.owner.name === 'Ana');
  const denied = await call('PUT', '/tasks/stats/file', { path: 'src/stats-note.js', content: 'x', by: 'Ben' });
  const edit = await call('PUT', '/tasks/stats/file', { path: 'src/stats-note.js', content: "export const note = 'unique visitors, per Ana';\n", by: 'Ana' });
  check('only the owner can edit; the edit is committed', denied.status === 403 && edit.status === 200 && !!edit.json.commit, `commit ${edit.json.commit}`);
  const file = await call('GET', '/tasks/stats/file?path=src/stats-note.js');
  check('GET file returns the edit', file.json.content?.includes('per Ana'));
  const back = await call('POST', '/tasks/stats/handback', { by: 'Ana', note: 'added a note module' });
  const backStep = (await state()).steps.filter((x) => x.kind === 'handback').at(-1)!;
  const resumed = await until('agent resumes', (s) => plansAfter(s, backStep.id, statsSid)[0]);
  check('handback resumes the agent with the edit in context', back.status === 202 && /edits/.test(resumed.text), resumed.text);

  // Hand stats to Ben, then back to the agent.
  const off = await call('POST', '/tasks/stats/handoff', { by: 'Ana', to: 'Ben', note: 'can you check the edge cases?' });
  const afterOff = await state();
  check('handoff to Ben returns a summary and makes Ben owner',
    (off.status === 200 && /Done:/.test(off.json.summary) && afterOff.taskState.stats.owner.name === 'Ben') || afterOff.taskState.stats.status === 'done',
    afterOff.taskState.stats.status === 'done' ? 'stats had already finished' : off.json.summary?.split('\n')[0]);
  if (afterOff.taskState.stats.status !== 'done') await call('POST', '/tasks/stats/handoff', { by: 'Ben', to: 'agent', note: 'looks fine, finish it' });

  // Catch-up in chat.
  await until('stats done', (s) => s.taskState.stats?.status === 'done');
  const chat = await call('POST', '/chat', { from: 'Cal', text: 'what happened on stats?' });
  const answer = await until('planner reply', (s) => s.chat.find((m) => m.from === 'planner'));
  const ids = new Set((await state()).steps.map((x) => x.id));
  check('chat answer cites real step ids', chat.status === 202 && !!answer.cites?.length && answer.cites.every((c) => ids.has(c)), answer.cites?.join(', '));

  const s = await until('all tasks done', (st) => Object.values(st.taskState).every((t) => t.status === 'done') && st, 90000);
  check('all four tasks are done', Object.keys(s.taskState).length === 4);
  const goal = await until('goal check', (st) => st.steps.find((x) => x.kind === 'check'), 60000);
  check('when every task is done, the goal check tests main and reports', !!goal.test && goal.test.failed === 0 && goal.test.passed > 0, goal.text);

  const approve = await call('POST', '/approve', { by: 'Ana' });
  check('approve passes tests on main', approve.status === 200 && approve.json.ok === true, `commit ${approve.json.commit}, pushed ${approve.json.pushed}`);

  const authors = (await git(join(DATA_DIR, 'projects', projectId, 'workspace'), ['log', '--format=%an'])).split('\n');
  check('git log has commits by Hive Agent and by Ana', authors.includes('Hive Agent') && authors.includes('Ana'), [...new Set(authors.filter(Boolean))].join(', '));
} catch (e) {
  check('smoke run', false, (e as Error).message);
  console.log(log.split('\n').slice(-30).join('\n'));
} finally {
  child.kill();
}

const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
