'use client';

// Static project info for the Overview page (goal and stack, from SPEC.md) plus the GitHub
// repo the person types in. Everything else on the Overview is derived from live state.

import { useSyncExternalStore } from 'react';
import { authHeaders, loadConfig } from './auth';
import { apiUrl } from './hive';

export const PROJECT = {
  name: 'url-shortener',
  goal: 'A tiny URL shortener API (create, redirect, stats) with tests, planned and built by people and AI agents in one live task graph, then shipped to GitHub.',
  deadline: 'Demo day · 90-second live run',
};

export const STACK: { group: string; items: { name: string; note: string }[] }[] = [
  { group: 'Frontend', items: [{ name: 'Next.js 16', note: 'client-only SPA' }, { name: 'React 19', note: 'UI' }, { name: 'React Flow 12', note: 'task + arch graphs' }] },
  { group: 'Realtime', items: [{ name: 'Yjs', note: 'one shared doc' }, { name: 'Hocuspocus 4', note: 'websocket sync' }] },
  { group: 'Backend', items: [{ name: 'Node + tsx', note: 'server/' }, { name: 'Express 5', note: '4 endpoints' }] },
  { group: 'Agents', items: [{ name: 'Claude', note: '@anthropic-ai/sdk' }, { name: 'Planner', note: 'chat → graph ops' }, { name: 'Builder', note: 'task → files' }] },
  { group: 'Ship', items: [{ name: 'git', note: 'branch per task' }, { name: 'node:test', note: 'acceptance checks' }, { name: 'GitHub', note: 'push on approve' }] },
];

export interface Commit { sha: string; message: string; author: string; branch: string; at: number /* ms */ }

// The push target (owner/repo), stored on the server: Approve pushes there. Shared by every tab.
let repo: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const sub = (l: () => void) => {
  if (!loaded) { loaded = true; loadConfig().then((c) => { repo = c.repo; emit(); }, () => { loaded = false; }); }
  listeners.add(l);
  return () => { listeners.delete(l); };
};
export const useRepo = () => useSyncExternalStore(sub, () => repo, () => repo);
export function connectRepo(r: string | null) {
  fetch(apiUrl('/api/repo'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ repo: r }) })
    .then((res) => res.json())
    .then((j: { repo?: string | null; error?: string }) => { if (!j.error) { repo = j.repo ?? null; emit(); } }, () => {});
}

export function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
