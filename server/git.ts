import { execFile } from 'node:child_process';

export interface Author { name: string; email: string }

export const HIVE: Author = { name: 'Hive', email: 'hive@hive.local' };
export const AGENT: Author = { name: 'Hive Agent', email: 'agent@hive.local' };

// Run git without a shell. With an author, it is passed per command so no global git config is needed.
export function git(cwd: string, args: string[], author?: Author): Promise<string> {
  const pre = author ? ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`] : [];
  return new Promise((resolve, reject) => {
    execFile('git', [...pre, ...args], { cwd, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error(`git ${args[0]} failed: ${(stderr || err.message).trim()}`), { stdout, code: err.code }));
        else resolve(stdout);
      });
  });
}

// One operation at a time on the main workspace repo (worktree add/prune, merges, approve).
let chain: Promise<unknown> = Promise.resolve();
export function withRepoLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
