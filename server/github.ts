import { git } from './git.ts';

// GitHub over plain fetch and git: create a repo for a new project, and push a workspace's main to it.
// Tokens are never logged or returned; they are scrubbed from git errors.
const api = () => (process.env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, '');
export const remoteFor = (repo: string) => `https://github.com/${repo}.git`;

// A private repo under the token's account; if `name` is taken, `fallback` is tried. Returns "owner/name".
export async function createRepo(token: string, name: string, fallback: string, description: string): Promise<string> {
  for (const n of [name, fallback]) {
    const res = await fetch(`${api()}/user/repos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'hive' },
      body: JSON.stringify({ name: n, description: description.slice(0, 340), private: true }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => ({}))) as { full_name?: string; message?: string; errors?: { message?: string }[] };
    if (res.ok && body.full_name) return body.full_name;
    const taken = res.status === 422 && /already exists/i.test(JSON.stringify(body.errors ?? []));
    if (!taken || n === fallback) throw new Error(`GitHub could not create the repo: ${body.errors?.[0]?.message ?? body.message ?? `HTTP ${res.status}`}`);
  }
  throw new Error('GitHub could not create the repo');
}

// Run a git push or fetch against `remote` (an https GitHub URL) with `token`, keeping the token out of errors.
async function withRemote(dir: string, remote: string, token: string, args: (url: string) => string[]): Promise<string> {
  const authed = remote.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`);
  try {
    return await git(dir, ['-c', 'credential.helper=', ...args(authed)]);
  } catch (e) {
    throw new Error((e as Error).message.split(authed).join(remote).split(token).join('***').split(encodeURIComponent(token)).join('***'));
  }
}

export const pushMain = (dir: string, remote: string, token: string) => pushRef(dir, remote, token, 'main:main');
export const pushRef = (dir: string, remote: string, token: string, ...refspecs: string[]) =>
  withRemote(dir, remote, token, (url) => ['push', url, ...refspecs]).then(() => {});
// Fetch `refspec` (e.g. "refs/heads/task/a:refs/heads/task/a"); false if the remote does not have it.
export const fetchRef = (dir: string, remote: string, token: string, refspec: string) =>
  withRemote(dir, remote, token, (url) => ['fetch', '--update-head-ok', url, refspec]).then(() => true, (e: Error) => {
    if (/couldn't find remote ref|not our ref/i.test(e.message)) return false;
    throw e;
  });
