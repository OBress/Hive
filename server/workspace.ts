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

// Built-in regex search over src/ and test/ (used when no OpenCode server is connected): up to 50 matching lines,
// or why the pattern is invalid.
export function searchFiles(dir: string, pattern: string): { path: string; line: number; text: string }[] | string {
  let re: RegExp;
  try { re = new RegExp(pattern); } catch (e) { return `invalid regular expression: ${(e as Error).message}`; }
  const out: { path: string; line: number; text: string }[] = [];
  for (const f of listFiles(dir)) {
    const lines = (readFile(dir, f) ?? '').split('\n');
    for (const [i, l] of lines.entries()) {
      if (re.test(l)) out.push({ path: f, line: i + 1, text: l.trim().slice(0, 200) });
      if (out.length >= 50) return out;
    }
  }
  return out;
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
  // `git commit` prints "[branch abc1234] message"; with nothing staged it exits 1 saying so.
  const out = await git(dir, ['commit', '-m', message], author).catch((e: { stdout?: string }) => {
    if (/nothing to commit|nothing added to commit|no changes added/.test(e.stdout ?? '')) return null;
    throw e;
  });
  if (out === null) return null;
  return /^\[[^\]]* ([0-9a-f]{7,40})\]/m.exec(out)?.[1] ?? head(dir);
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

// Bring main into the task's branch before it merges, so the merge into main is clean and the agent sees other
// tasks' work. Where both changed the same lines, the conflict markers are committed for the agent to resolve.
export function syncMain(taskId: string): Promise<{ changed: boolean; conflicts: string[] }> {
  const dir = worktreeDir(taskId);
  return withRepoLock(async () => {
    const before = await head(dir);
    try {
      await git(dir, ['merge', '--no-edit', '-m', `Merge main into task/${taskId}`, 'main'], HIVE);
    } catch (e) {
      const conflicts = (await git(dir, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
      if (!conflicts.length) { await git(dir, ['merge', '--abort']).catch(() => {}); throw e; }
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '--no-edit', '-m', `Merge main into task/${taskId} (conflicts to resolve)`], HIVE);
      return { changed: true, conflicts };
    }
    return { changed: (await head(dir)) !== before, conflicts: [] };
  });
}

export const hasMarkers = (text: string) => /^<{7}( |$)/m.test(text) && /^>{7}( |$)/m.test(text);

// Each conflict region with a little context, for the agent: "path:line" then the lines.
export function conflictHunks(dir: string, files: string[], max = 8000): string {
  const out: string[] = [];
  for (const f of files) {
    const lines = (readFile(dir, f) ?? '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^<{7}/.test(lines[i])) continue;
      let j = i;
      while (j < lines.length && !/^>{7}/.test(lines[j])) j++;
      const from = Math.max(0, i - 2);
      const to = Math.min(lines.length, j + 3);
      out.push(`${f}:${i + 1}\n${lines.slice(from, to).join('\n')}`);
      i = j;
    }
  }
  const text = out.join('\n\n');
  return text.length > max ? `${text.slice(0, max)}\n…(more conflicts trimmed; read the files)` : text;
}
