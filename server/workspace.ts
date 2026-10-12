import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { git, withRepoLock, HIVE, type Author } from './git.ts';
import { TEMPLATE } from './paths.ts';
import { fetchRef, pushRef } from './github.ts';
import { currentId, inProject, workspaceDir, worktreesDir } from './projects.ts';
import { projectToken, pushRemote } from './settings.ts';

export const worktreeDir = (taskId: string) => join(worktreesDir(), taskId);

// The project's GitHub repo and a token for it, or null: backups and restores are skipped without one.
function remote(): { url: string; token: string } | null {
  const url = pushRemote();
  const token = projectToken();
  return url && token ? { url, token } : null;
}

// A missing workspace (new machine, wiped data/) is restored from GitHub when it can be: the last merged main
// (backed up to hive/main), else the approved main; otherwise it starts from the template.
export async function ensureWorkspace() {
  const repo = workspaceDir();
  if (existsSync(join(repo, '.git'))) return;
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  const r = remote();
  for (const from of r ? ['hive/main', 'main'] : []) {
    const got = await fetchRef(repo, r!.url, r!.token, `refs/heads/${from}:refs/heads/main`).catch((e: Error) => {
      console.error(`Could not restore ${repo} from GitHub: ${e.message.slice(0, 200)}`);
      return false;
    });
    if (got) {
      await git(repo, ['reset', '--hard', 'main']);
      console.log(`Restored ${repo} from ${r!.url} (${from})`);
      return;
    }
  }
  cpSync(TEMPLATE, repo, { recursive: true });
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'Start Hive workspace'], HIVE);
  console.log(`Created ${repo}`);
}

// Push a task's branch (and the merged main, to hive/main) to the project's GitHub repo, at most every 15 s per
// task, so work survives the machine going away. Never blocks or fails the caller.
const pending = new Map<string, NodeJS.Timeout>();
export function backup(taskId: string) {
  const r = remote();
  if (!r) return;
  const project = currentId();
  const k = `${project}/${taskId}`;
  if (pending.has(k)) return;
  pending.set(k, setTimeout(() => inProject(project, () => {
    pending.delete(k);
    return backupNow(taskId).catch((e: Error) => console.error(`Backup of task/${taskId} failed: ${e.message.slice(0, 200)}`));
  }), 15000));
}
export async function backupNow(taskId: string) {
  const r = remote();
  if (!r) return;
  const refs = [`+refs/heads/task/${taskId}:refs/heads/task/${taskId}`, '+refs/heads/main:refs/heads/hive/main'];
  await pushRef(workspaceDir(), r.url, r.token, ...refs);
}

// Each task gets its own folder on branch task/<id>, cut from main. A folder that lost its git link (data/ wiped
// or the workspace recreated while the session lived on) is rebuilt, keeping the src/ and test/ files it had.
export function ensureWorktree(taskId: string): Promise<string> {
  const dir = worktreeDir(taskId);
  const repo = workspaceDir();
  return withRepoLock(async () => {
    if (await git(dir, ['rev-parse', '--git-dir']).then(() => existsSync(join(dir, '.git')), () => false)) return dir;
    const kept = existsSync(dir) ? listFiles(dir).map((f) => [f, readFile(dir, f)!] as const) : [];
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(worktreesDir(), { recursive: true });
    await git(repo, ['worktree', 'prune']);
    const branch = `task/${taskId}`;
    const local = () => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
    let exists = await local();
    const r = remote();
    if (!exists && r) {   // a new machine: the branch may be backed up on GitHub
      exists = await fetchRef(repo, r.url, r.token, `refs/heads/${branch}:refs/heads/${branch}`)
        .catch((e: Error) => { console.error(`Could not restore ${branch} from GitHub: ${e.message.slice(0, 200)}`); return false; });
    }
    await git(repo, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', dir, '-b', branch, 'main']);
    for (const [f, content] of kept) writeFile(dir, f, content);
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
      const unmerged = (await git(dir, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
      if (!unmerged.length) { await git(dir, ['merge', '--abort']).catch(() => {}); throw e; }
      // Files the agent can't edit are resolved here, on the spot; only code conflicts go back to the agent.
      const conflicts: string[] = [];
      for (const f of unmerged) if (!await resolveForAgent(dir, f)) conflicts.push(f);
      await git(dir, ['add', '-A']);
      const note = conflicts.length ? ' (conflicts to resolve)' : ' (dependencies combined)';
      await git(dir, ['commit', '--no-edit', '-m', `Merge main into task/${taskId}${note}`], HIVE);
      return { changed: true, conflicts };
    }
    return { changed: (await head(dir)) !== before, conflicts: [] };
  });
}

// Resolve a conflicted file that isn't code: package.json keeps main's version plus both sides' dependencies,
// package-lock.json takes main's (npm then regenerates it from the combined package.json), .gitignore keeps
// every line from both. Returns false for files the agent must resolve (src/ and test/).
async function resolveForAgent(dir: string, file: string): Promise<boolean> {
  const side = (n: 2 | 3) => git(dir, ['show', `:${n}:${file}`]).catch(() => '');
  if (file === 'package.json') {
    const [ours, theirs] = await Promise.all([side(2), side(3)]);
    const text = mergePackageJson(ours, theirs);
    if (text === null) return false;
    writeFileSync(join(dir, file), text);
    return true;
  }
  if (file === 'package-lock.json') {
    await git(dir, ['checkout', '--theirs', '--', file]);
    return true;
  }
  if (file === '.gitignore') {
    const [ours, theirs] = await Promise.all([side(2), side(3)]);
    const lines = [...new Set([...theirs.split('\n'), ...ours.split('\n')].map((l) => l.trimEnd()).filter(Boolean))];
    writeFileSync(join(dir, file), `${lines.join('\n')}\n`);
    return true;
  }
  return false;
}

// main's package.json ("theirs") with the task's added dependencies on top; null if either side isn't JSON.
export function mergePackageJson(ours: string, theirs: string): string | null {
  try {
    const a = JSON.parse(ours) as Record<string, unknown>;
    const b = JSON.parse(theirs) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...a, ...b };
    for (const k of ['dependencies', 'devDependencies']) {
      const merged = { ...(a[k] as object | undefined), ...(b[k] as object | undefined) };
      if (Object.keys(merged).length) out[k] = Object.fromEntries(Object.entries(merged).sort(([x], [y]) => x.localeCompare(y)));
    }
    return `${JSON.stringify(out, null, 2)}\n`;
  } catch {
    return null;
  }
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
