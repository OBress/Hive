import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Project } from '@hive/shared/types';

let records: Record<string, any>[];
let projects: Record<string, any>[];
let fail = false;
let store: typeof import('./store.ts');
beforeEach(async () => {
  vi.resetModules(); records = []; projects = []; fail = false;
  vi.stubEnv('SUPABASE_URL', 'https://storage.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-test-key');
  vi.stubEnv('SUPABASE_ANON_KEY', 'public-test-key');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.endsWith('hive_projects') ? projects : records;
    if (fail) return new Response(JSON.stringify({ message: 'storage unavailable' }), { status: 500 });
    const method = init?.method ?? 'GET';
    const filters = [...url.searchParams].filter(([,v]) => v.startsWith('eq.'));
    const matches = (row: any) => filters.every(([k,v]) => String(k === 'payload->>taskId' ? row.payload.taskId : row[k]) === v.slice(3));
    if (method === 'POST') {
      const row = JSON.parse(String(init?.body));
      const at = table.findIndex(r => r.id === row.id && r.kind === row.kind);
      if (at >= 0) table[at] = row; else table.push(row);
      return new Response(null, { status: 201 });
    }
    if (method === 'DELETE') {
      for (let i = table.length - 1; i >= 0; i--) if (matches(table[i])) table.splice(i,1);
      return new Response(null, { status: 204 });
    }
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    return new Response(JSON.stringify(table.filter(matches).sort((a,b) => a.id.localeCompare(b.id)).slice(offset, offset + limit)), { headers: { 'Content-Type': 'application/json' } });
  }));
  store = await import('./store.ts');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test('requires server credentials and refuses unavailable storage', async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  await expect(store.connectStorage()).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-test-key');
  vi.stubEnv('SUPABASE_ANON_KEY', 'public-test-key');
  fail = true;
  await expect(store.connectStorage()).rejects.toThrow('storage unavailable');
  expect(store.storageOn()).toBe(false);
});

test('round trips binary docs, projects, epoch, and ordered transcript snapshots', async () => {
  await store.connectStorage();
  const p: Project = { id: 'p', name: 'Project', goal: '', repo: null, createdBy: 'ana', createdAt: '2026-01-01', sharedWith: [] };
  await store.saveProjectDb(p);
  expect(await store.loadProjectsDb()).toEqual([p]);
  const bytes = new Uint8Array([0, 255, 128, 1]);
  await store.saveDocDb('p', bytes);
  expect(new Uint8Array((await store.loadDocDb('p'))!)).toEqual(bytes);
  expect(await store.loadDocDb('missing')).toBeNull();
  await store.setEpochDb('epoch');
  expect(await store.epochDb()).toBe('epoch');
  const session = { id: 's', text: 'first' };
  const first = store.saveSessionDb('p', session);
  session.text = 'second';
  const second = store.saveSessionDb('p', session);
  await Promise.all([first, second, store.flushSessionsDb()]);
  expect(await store.loadSessionsDb('p')).toEqual([{ id: 's', data: session }]);
  expect(await store.loadSessionsDb('other')).toEqual([]);
  await store.deleteProjectDb('p');
  expect(await store.loadProjectsDb()).toEqual([]);
});

test('paginates beyond REST row limits and isolates history by project and task', async () => {
  await store.connectStorage();
  for (let n = 0; n < 2200; n++) records.push({ kind: 'step', id: `p/${String(n).padStart(4,'0')}`, project: 'p', payload: { id: `s${n}`, n, taskId: n % 2 ? 'a' : 'b' } });
  records.push({ kind: 'step', id: 'other/1', project: 'other', payload: { n: 9999, taskId: 'a' } });
  const steps = await store.historyDb('p', 'a');
  expect(steps).toHaveLength(1100);
  expect(steps[0].n).toBe(1);
  expect(steps.at(-1)?.n).toBe(2199);
});

test('a failed write does not interrupt draining other pending writes or project deletion', async () => {
  await store.connectStorage();
  const original = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.id === 'other/fail') return new Response(JSON.stringify({ message: 'write failed' }), { status: 400 });
    if (body?.id === 'p/delayed') await gate;
    return original(input, init);
  }));
  const failed = store.saveSessionDb('other', { id: 'fail' }).catch(() => {});
  const delayed = store.saveSessionDb('p', { id: 'delayed' });
  let drained = false;
  const flush = store.flushSessionsDb().then(() => { drained = true; });
  const deleted = store.deleteProjectDb('p');
  await failed;
  expect(drained).toBe(false);
  release();
  await Promise.all([flush, delayed]);
  await expect(deleted).resolves.toBeUndefined();
  expect(drained).toBe(true);
});

test('saved state reloads through a fresh storage client and write errors reach callers', async () => {
  await store.connectStorage();
  await store.saveDocDb('p', new Uint8Array([0, 42, 255]));
  await store.saveUserDb({ login: 'ANA', name: 'Ana', avatarUrl: '' });
  await store.setEpochDb('stable');
  vi.resetModules();
  const fresh = await import('./store.ts');
  await fresh.connectStorage();
  expect(new Uint8Array((await fresh.loadDocDb('p'))!)).toEqual(new Uint8Array([0,42,255]));
  expect(await fresh.loadUsersDb()).toEqual([{ login: 'ANA', name: 'Ana', avatarUrl: '' }]);
  expect(await fresh.epochDb()).toBe('stable');
  fail = true;
  await expect(fresh.saveDocDb('p', new Uint8Array([1]))).rejects.toThrow('storage unavailable');
});


test('history preserves repeated event IDs after an older doc checkpoint is restored', async () => {
  await store.connectStorage();
  const step = { id: 'st_1', n: 1, taskId: 't', kind: 'plan' as const, by: 'agent', text: 'before crash', at: '2026-10-11' };
  await store.saveHistoryDb('step', 'p', step);
  await store.saveHistoryDb('step', 'p', { ...step, text: 'after restart' });
  expect((await store.historyDb('p', 't')).map(s => s.text).sort()).toEqual(['after restart', 'before crash']);
});
