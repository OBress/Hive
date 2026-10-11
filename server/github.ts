import { HttpError } from './doc.ts';

// Create an empty repo on the person's own GitHub account with their OAuth token (sign-in asks for the `repo` scope).
// Approve later pushes main into it. The token is only sent to api.github.com and never appears in errors.
export async function createRepo(token: string, name: string, description: string, isPrivate: boolean): Promise<string> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'hive',
    },
    body: JSON.stringify({ name, description: description.slice(0, 350), private: isPrivate, auto_init: false }),
  });
  const json = (await res.json().catch(() => ({}))) as { full_name?: string; message?: string; errors?: { message?: string }[] };
  if (res.ok && json.full_name) return json.full_name;
  if (res.status === 422) throw new HttpError(409, json.errors?.[0]?.message ?? `A repo named "${name}" already exists on your account`);
  if (res.status === 401) throw new HttpError(401, 'GitHub sign-in expired; reconnect GitHub and try again');
  if (res.status === 403 || res.status === 404) throw new HttpError(403, 'GitHub refused: sign in again and allow repo access');
  throw new HttpError(502, `GitHub could not create the repo (${res.status})`);
}

// A valid repo name from a project name: letters, digits, '.', '-', '_'.
export const repoSlug = (s: string) => s.trim().replace(/[^\w.-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 100);
