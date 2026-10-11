import { afterEach, expect, test, vi } from 'vitest';
import { createRepo, repoSlug } from './github.ts';

afterEach(() => { vi.unstubAllGlobals(); });
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

test('creates a private repo on the token owner\'s account', async () => {
  const fetch = reply(201, { full_name: 'ana/chores' });
  vi.stubGlobal('fetch', fetch);
  expect(await createRepo('tok', 'chores', 'Track chores', true)).toBe('ana/chores');
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.github.com/user/repos');
  expect(JSON.parse(String(init.body))).toMatchObject({ name: 'chores', private: true });
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
});

test('a taken name is a 409 that never mentions the token', async () => {
  vi.stubGlobal('fetch', reply(422, { message: 'Validation Failed', errors: [{ message: 'name already exists on this account' }] }));
  const e = await createRepo('secret-token', 'chores', '', true).catch((x) => x);
  expect(e.status).toBe(409);
  expect(e.message).toContain('already exists');
  expect(e.message).not.toContain('secret-token');
});

test('repo names are GitHub-safe', () => {
  expect(repoSlug('To-do app!')).toBe('To-do-app');
  expect(repoSlug('  ..weird//name  ')).toBe('weird-name');
});
