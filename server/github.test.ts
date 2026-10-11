import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { git } from './git.ts';
import { createRepo, pushMain } from './github.ts';

// A fake GitHub API: "taken" already exists, "forbidden" is refused, anything else is created under "maya".
const seen: { name: string; private: boolean; auth: string }[] = [];
const api = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const b = JSON.parse(body) as { name: string; private: boolean };
    seen.push({ ...b, auth: req.headers.authorization ?? '' });
    res.setHeader('Content-Type', 'application/json');
    if (b.name === 'taken') return void res.writeHead(422).end(JSON.stringify({ message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] }));
    if (b.name === 'forbidden') return void res.writeHead(403).end(JSON.stringify({ message: 'Resource not accessible by integration' }));
    res.writeHead(201).end(JSON.stringify({ full_name: `maya/${b.name}` }));
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  process.env.GITHUB_API_URL = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});
afterAll(() => { api.close(); delete process.env.GITHUB_API_URL; });

test('createRepo makes a private repo with the token, falling back when the name is taken', async () => {
  expect(await createRepo('tok', 'todo-app', 'todo-app-1a2b', 'A to-do app')).toBe('maya/todo-app');
  expect(seen[0]).toEqual({ name: 'todo-app', description: 'A to-do app', private: true, auth: 'Bearer tok' });
  expect(await createRepo('tok', 'taken', 'taken-9f9f', '')).toBe('maya/taken-9f9f');
  await expect(createRepo('tok', 'forbidden', 'forbidden-1', '')).rejects.toThrow(/Resource not accessible/);
});

test('pushMain pushes main, and never leaks the token in errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-gh-'));
  const bare = join(dir, 'remote.git');
  const work = join(dir, 'work');
  await git(dir, ['init', '--bare', '-b', 'main', bare]);
  await git(dir, ['init', '-b', 'main', work]);
  writeFileSync(join(work, 'README.md'), 'hi\n');
  await git(work, ['add', '-A']);
  await git(work, ['commit', '-m', 'start'], { name: 'T', email: 't@t' });
  await pushMain(work, bare, 'tok');
  expect((await git(bare, ['log', '--format=%s', 'main'])).trim()).toBe('start');
  const err = await pushMain(work, 'https://127.0.0.1:1/maya/x.git', 's3cret-token').catch((e: Error) => e.message);
  expect(err).toMatch(/push failed/);
  expect(err).not.toContain('s3cret-token');
});
