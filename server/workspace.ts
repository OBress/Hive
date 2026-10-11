import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { git, withRepoLock, HIVE, type Author } from './git.ts';
import { TEMPLATE } from './paths.ts';
import { workspaceDir, worktreesDir } from './projects.ts';

export const worktreeDir = (taskId: string) => join(worktreesDir(), taskId);

export async function ensureWorkspace() {
  const repo = workspaceDir();
  if (existsSync(join(repo, '.git'))) return;
  rmSync(repo, { recursive: true, force: true });
  cpSync(TEMPLATE, repo, { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'Start Hive workspace'], HIVE);
  console.log(`Created ${repo}`);
}

// Each task gets its own folder on branch task/<id>, cut from main.
export function ensureWorktree(taskId: string): Promise<string> {
  const dir = worktreeDir(taskId);
  const repo = workspaceDir();
  return withRepoLock(async () => {
    if (existsSync(join(dir, '.git'))) return dir;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(worktreesDir(), { recursive: true });
    await git(repo, ['worktree', 'prune']);
    const branch = `task/${taskId}`;
    const exists = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
    await git(repo, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', dir, '-b', branch, 'main']);
    return dir;
  });
}

// Agents may also read these, but never write them.
const READ_ONLY = ['package.json', 'README.md'];

// A relative path under src/ or test/ (or a READ_ONLY file when `read`), normalized with forward slashes; null if unsafe.
export function safePath(rel: unknown, read = false): string | null {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  const p = rel.trim().replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..')) return null;
  const n = posix.normalize(p);
  if (read && READ_ONLY.includes(n)) return n;
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
  const repo = workspaceDir();
  return withRepoLock(async () => {
    try {
      await git(repo, ['merge', '--no-ff', '-m', `Merge task/${taskId}`, `task/${taskId}`], HIVE);
      return { ok: true as const, commit: await head(repo) };
    } catch {
      const files = (await git(repo, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
      await git(repo, ['merge', '--abort']).catch(() => {});
      return { ok: false as const, files };
    }
  });
}
