'use client';

// PLACEHOLDER project metadata for the Overview page. Goal, stack and people are static
// for the demo; the repo connection and commit history move to the server later
// (GET /api/project, POST /api/repo). Live numbers come from the task store (lib/mock.ts).

import { useSyncExternalStore } from 'react';

export const PROJECT = {
  name: 'url-shortener',
  goal: 'A tiny URL shortener API (create, redirect, stats) with tests, planned and built by three people and two AI agents in one live task graph, then shipped to GitHub.',
  started: 34, // days ago
  deadline: 'Demo day · 90-second live run',
};

export const STACK: { group: string; items: { name: string; note: string }[] }[] = [
  { group: 'Frontend', items: [{ name: 'Next.js 16', note: 'client-only SPA' }, { name: 'React 19', note: 'UI' }, { name: 'React Flow 12', note: 'task + arch graphs' }] },
  { group: 'Realtime', items: [{ name: 'Yjs', note: 'one shared doc' }, { name: 'Hocuspocus 4', note: 'websocket sync' }] },
  { group: 'Backend', items: [{ name: 'Node + tsx', note: 'server/' }, { name: 'Express 5', note: '4 endpoints' }] },
  { group: 'Agents', items: [{ name: 'Claude', note: '@anthropic-ai/sdk' }, { name: 'Planner', note: 'chat → graph ops' }, { name: 'Builder', note: 'task → files' }] },
  { group: 'Ship', items: [{ name: 'git', note: 'branch per task' }, { name: 'node:test', note: 'acceptance checks' }, { name: 'GitHub', note: 'push on approve' }] },
];

export interface Person { name: string; role: string; commits: number; lastActive: string; online: boolean }

export const PEOPLE_INFO: Person[] = [
  { name: 'Ana', role: 'Frontend · Person A', commits: 23, lastActive: 'now', online: true },
  { name: 'Ben', role: 'Backend · Person B', commits: 31, lastActive: 'now', online: true },
  { name: 'Cal', role: 'Reviewer', commits: 4, lastActive: '12 min ago', online: true },
];

export const PAST_PEOPLE: Person[] = [
  { name: 'Dee', role: 'Prototype design', commits: 9, lastActive: '3 weeks ago', online: false },
  { name: 'Eli', role: 'Spec review', commits: 2, lastActive: '2 weeks ago', online: false },
];

export interface Commit { sha: string; message: string; author: string; branch: string; at: number /* ms */ }

const H = 3_600_000, D = 24 * H;
// Fixed reference time so server and client render the same seed history.
const BASE = Date.UTC(2026, 9, 11, 9, 0, 0);
export const SEED_COMMITS: Commit[] = [
  { sha: 'a9e32ff', message: 'Add .gitattributes to normalize line endings to LF', author: 'Ana', branch: 'main', at: BASE - 2 * H },
  { sha: '8b3a122', message: 'Scaffold Hive monorepo: Next.js web, Node server, shared contract', author: 'Ana', branch: 'main', at: BASE - 5 * H },
  { sha: '41c0d9e', message: 'workspace: tiny Node HTTP API with one routes block', author: 'Ben', branch: 'main', at: BASE - 1 * D },
  { sha: '7f2a810', message: 'workspace: node:test harness and npm test script', author: 'Ben', branch: 'main', at: BASE - 1 * D - 3 * H },
  { sha: 'c33b5e1', message: 'Spec: task graph, Planner and Builder agents', author: 'Cal', branch: 'main', at: BASE - 3 * D },
  { sha: '0d9e7aa', message: 'Prototype: landing-page co-editing demo', author: 'Dee', branch: 'proto', at: BASE - 19 * D },
];

// Seeded activity per day for the calendar (deterministic, so SSR and client match).
export function activityOn(dayKey: string, daysAgo: number): number {
  if (daysAgo > PROJECT.started) return 0;
  const h = [...dayKey].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
  const v = h % 11;
  return v < 4 ? 0 : v < 6 ? 1 : v < 8 ? 2 : v < 10 ? 3 : 4;
}

// ---- repo connection (placeholder) -----------------------------------------

let repo: string | null = null;
const listeners = new Set<() => void>();
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useRepo = () => useSyncExternalStore(sub, () => repo, () => repo);
export function connectRepo(r: string | null) { repo = r; listeners.forEach((l) => l()); }

export function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
