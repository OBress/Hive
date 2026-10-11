import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UserSummary } from '@hive/shared/types';
import { DATA_DIR } from './paths.ts';

// Everyone who has signed in to this server (or, with auth off, used a name), so a project can be shared
// with them by login. Kept in data/users.json; no tokens or emails, only what's shown on an avatar.

const FILE = join(DATA_DIR, 'users.json');
let users: UserSummary[] | null = null;
const all = () => (users ??= existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as UserSummary[]) : []);
const key = (login: string) => login.toLowerCase();

export const findUser = (login: string) => all().find((u) => key(u.login) === key(login));

export function rememberUser(u: UserSummary) {
  if (!u.login || u.login === 'Guest') return;
  const old = findUser(u.login);
  if (old && old.name === u.name && old.avatarUrl === u.avatarUrl) return;
  users = [...all().filter((x) => x !== old), { login: u.login, name: u.name || u.login, avatarUrl: u.avatarUrl ?? '' }];
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(users, null, 2));
}

// Logins starting with q first, then logins or names containing it.
export function searchUsers(q: string, except = '', limit = 8): UserSummary[] {
  const s = q.trim().toLowerCase();
  const rank = (u: UserSummary) => {
    const l = key(u.login);
    return l.startsWith(s) ? 0 : l.includes(s) || u.name.toLowerCase().includes(s) ? 1 : 2;
  };
  return all()
    .filter((u) => key(u.login) !== key(except) && rank(u) < 2)
    .sort((a, b) => rank(a) - rank(b) || a.login.localeCompare(b.login))
    .slice(0, limit);
}
