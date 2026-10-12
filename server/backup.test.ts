import { afterAll, expect, test, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// A bare repo on disk stands in for the project's GitHub repo (the token is only used for https remotes).
const root = mkdtempSync(join(tmpdir(), 'hive-backup-'));
const bare = join(root, 'remote.git');
execFileSync('git', ['init', '--bare', '-b', 'main', bare]);
vi.stubEnv('HIVE_DATA_DIR', join(root, 'data'));
vi.stubEnv('GITHUB_REMOTE', bare);
vi.stubEnv('GITHUB_TOKEN', 'test');
const { inProject } = await import('./projects.ts');
const { AGENT } = await import('./git.ts');
const ws = await import('./workspace.ts');
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('a task branch backed up to GitHub is restored on a new machine', () => inProject('p', async () => {
  await ws.ensureWorkspace();
  const dir = await ws.ensureWorktree('a');
  ws.writeFile(dir, 'src/a.js', 'export const a = 1;\n');
  expect(await ws.commitAll(dir, AGENT, 'add a')).toBeTruthy();
  await ws.backupNow('a');

  rmSync(join(root, 'data'), { recursive: true, force: true });   // the machine went away
  await ws.ensureWorkspace();
  await ws.ensureWorktree('a');
  expect(readFileSync(join(ws.worktreeDir('a'), 'src/a.js'), 'utf8').replace(/\r\n/g, '\n')).toBe('export const a = 1;\n');   // CRLF on Windows checkouts
}));

test('a worktree that lost its git link is rebuilt with its files kept', () => inProject('p', async () => {
  const dir = await ws.ensureWorktree('b');
  rmSync(join(dir, '.git'));
  ws.writeFile(dir, 'src/b.js', 'export const b = 2;\n');   // written after the link was lost
  await ws.ensureWorktree('b');
  expect(existsSync(join(dir, '.git'))).toBe(true);
  expect(readFileSync(join(dir, 'src/b.js'), 'utf8')).toBe('export const b = 2;\n');
  expect(await ws.commitAll(dir, AGENT, 'add b')).toBeTruthy();
}));
