import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { git, withRepoLock, HIVE, type Author } from './git.ts';
import { TEMPLATE, WORKSPACE, WORKTREES } from './paths.ts';

export const worktreeDir = (taskId: string) => join(WORKTREES, taskId);

export async function ensureWorkspace() {
  if (existsSync(join(WORKSPACE, '.git'))) return;
  rmSync(WORKSPACE, { recursive: true, force: true });
  cpSync(TEMPLATE, WORKSPACE, { recursive: true });
  await git(WORKSPACE, ['init', '-b', 'main']);
  await git(WORKSPACE, ['add', '-A']);
  await git(WORKSPACE, ['commit', '-m', 'Start Hive workspace'], HIVE);
  console.log('Created data/workspace');
}

// Each task gets its own folder on branch task/<id>, cut from main.
export function ensureWorktree(taskId: string): Promise<string> {
  const dir = worktreeDir(taskId);
  return withRepoLock(async () => {
    if (existsSync(join(dir, '.git'))) return dir;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(WORKTREES, { recursive: true });
    await git(WORKSPACE, ['worktree', 'prune']);
    const branch = `task/${taskId}`;
    const exists = await git(WORKSPACE, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
    await git(WORKSPACE, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', dir, '-b', branch, 'main']);
    return dir;
  });
}

// A relative path under src/ or test/, normalized with forward slashes; null if unsafe.
export function safePath(rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  const p = rel.trim().replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..')) return null;
  const n = posix.normalize(p);
  if (!/^(src|test)\/[^/]/.test(n) || n.endsWith('/')) return null;
  return n;
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.name !== '.gitkeep') out.push(r);
    }
  };
  walk('src');
  walk('test');
  return out.sort();
}

export function readFile(dir: string, rel: string): string | null {
  const abs = join(dir, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

export function writeFile(dir: string, rel: string, content: string) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// Stage everything and commit as `author`; returns the short hash, or null if nothing changed.
export async function commitAll(dir: string, author: Author, message: string): Promise<string | null> {
  await git(dir, ['add', '-A']);
  const changed = await git(dir, ['diff', '--cached', '--quiet']).then(() => false, () => true);
  if (!changed) return null;
  await git(dir, ['commit', '-m', message], author);
  return head(dir);
}

export const head = async (dir: string) => (await git(dir, ['rev-parse', '--short', 'HEAD'])).trim();

export const diff = (dir: string, from: string, to: string, path?: string) =>
  git(dir, ['diff', `${from}..${to}`, ...(path ? ['--', path] : [])]);

export function mergeToMain(taskId: string): Promise<{ ok: true; commit: string } | { ok: false; files: string[] }> {
  return withRepoLock(async () => {
    try {
      await git(WORKSPACE, ['merge', '--no-ff', '-m', `Merge task/${taskId}`, `task/${taskId}`], HIVE);
      return { ok: true as const, commit: await head(WORKSPACE) };
    } catch {
      const files = (await git(WORKSPACE, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
      await git(WORKSPACE, ['merge', '--abort']).catch(() => {});
      return { ok: false as const, files };
    }
  });
}
