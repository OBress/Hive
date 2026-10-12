import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

// A throwaway data/ for this file, set before the server modules read HIVE_DATA_DIR.
const DATA = mkdtempSync(join(tmpdir(), 'hive-merge-'));
process.env.HIVE_DATA_DIR = DATA;
const { git, AGENT } = await import('./git.ts');
const { createProject, inProject } = await import('./projects.ts');
const ws = await import('./workspace.ts');
afterAll(() => rmSync(DATA, { recursive: true, force: true, maxRetries: 3 }));

test('package.json from two tasks keeps both sides\' dependencies', () => {
  const ours = JSON.stringify({ name: 'w', type: 'module', dependencies: { howler: '^2.2.4', three: '^0.170.0' } });
  const theirs = JSON.stringify({ name: 'w', type: 'module', dependencies: { 'happy-dom': '^21.0.1', three: '^0.171.0' } });
  expect(JSON.parse(ws.mergePackageJson(ours, theirs)!)).toEqual({
    name: 'w', type: 'module', dependencies: { 'happy-dom': '^21.0.1', howler: '^2.2.4', three: '^0.171.0' },
  });
  expect(ws.mergePackageJson('{oops', theirs)).toBeNull();
});

test('a project without its own repo has no push or restore target', async () => {
  const { pushRemote } = await import('./settings.ts');
  process.env.GITHUB_REMOTE = 'https://github.com/OBress/Hive.git';   // a leftover server-wide setting is ignored
  const p = await createProject('No repo', '', 'ana');
  expect(inProject(p.id, () => pushRemote())).toBe('');
  delete process.env.GITHUB_REMOTE;
});

test('git never reaches a repo above data/', async () => {
  const plain = join(DATA, 'not-a-repo');
  mkdirSync(plain, { recursive: true });
  await expect(git(plain, ['rev-parse', '--show-toplevel'])).rejects.toThrow(/not a git repository/i);
});

test('a dependency conflict between two tasks is resolved without the agent; a code conflict is not', async () => {
  const p = await createProject('Merge test', '', 'ana');
  await inProject(p.id, async () => {
    await ws.ensureWorkspace();
    expect(readFileSync(join(ws.worktreeDir('x').replace(/worktrees.x$/, 'workspace'), 'package.json'), 'utf8')).toContain('hive-workspace');
    const a = await ws.ensureWorktree('a');
    const b = await ws.ensureWorktree('b');
    const pkg = (deps: Record<string, string>) => `${JSON.stringify({ name: 'hive-workspace', private: true, type: 'module', dependencies: deps }, null, 2)}\n`;
    writeFileSync(join(a, 'package.json'), pkg({ 'happy-dom': '^21.0.1' }));
    writeFileSync(join(a, 'src', 'shared.js'), 'export const who = "a";\n');
    await ws.commitAll(a, AGENT, 'a');
    writeFileSync(join(b, 'package.json'), pkg({ howler: '^2.2.4' }));
    writeFileSync(join(b, 'src', 'shared.js'), 'export const who = "b";\n');
    await ws.commitAll(b, AGENT, 'b');
    expect((await ws.mergeToMain('a')).ok).toBe(true);

    const sync = await ws.syncMain('b');
    expect(sync).toEqual({ changed: true, conflicts: ['src/shared.js'] });
    expect(JSON.parse(readFileSync(join(b, 'package.json'), 'utf8')).dependencies).toEqual({ 'happy-dom': '^21.0.1', howler: '^2.2.4' });
    expect(ws.hasMarkers(readFileSync(join(b, 'package.json'), 'utf8'))).toBe(false);
    expect(ws.hasMarkers(readFileSync(join(b, 'src', 'shared.js'), 'utf8'))).toBe(true);
  });
}, 60000);
