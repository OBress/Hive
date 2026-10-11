'use client';

// The project list and the current project. Each project is its own doc, workspace and push repo on the
// server; a page works on one project, named by ?project=<id> in the URL (so a shared link opens the same
// one). Switching projects is a full page load, because the doc provider is one per tab.

import { useSyncExternalStore } from 'react';
import type { Project } from '@hive/shared/types';
import { authHeaders, serverUrl } from './auth';

const LAST = 'hive.project';

export function projectId(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('project') ?? '';
}

// The last project this browser opened, so a bare /tasks link can pick up where it left off.
export function lastProject(): string {
  try { return localStorage.getItem(LAST) ?? ''; } catch { return ''; }
}
export function rememberProject(id: string) {
  try { localStorage.setItem(LAST, id); } catch { /* private mode */ }
}

// Query string for links inside the app: the current project plus ?name= in demo mode.
export function appQuery(me: string, project = projectId()): string {
  const q = new URLSearchParams();
  if (project) q.set('project', project);
  if (me && me !== 'Guest') q.set('name', me);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---- the list (shared by every component on the page) ----

let projects: Project[] | null = null;
let error = '';
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function reloadProjects(): Promise<void> {
  loading = fetch(`${serverUrl()}/api/projects`)
    .then((r) => r.json() as Promise<{ projects: Project[] }>)
    .then((j) => { projects = j.projects; error = ''; }, () => { error = 'Could not reach the Hive server'; })
    .finally(() => { loading = null; emit(); });
  return loading;
}

function subscribe(l: () => void) {
  if (!projects && !loading) void reloadProjects();
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useProjects(): { projects: Project[] | null; error: string } {
  const list = useSyncExternalStore(subscribe, () => projects, () => null);
  return { projects: list, error };
}

export function useProject(): Project | null {
  const { projects: list } = useProjects();
  const id = useSyncExternalStore(() => () => {}, projectId, () => '');
  return list?.find((p) => p.id === id) ?? null;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${serverUrl()}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

// With createRepo, the server also makes a private GitHub repo for it; repoError says why if it could not.
export async function createProject(name: string, goal: string, by: string, createRepo: boolean): Promise<Project & { repoError?: string }> {
  const p = await send<Project & { repoError?: string }>('POST', '/projects', { name, goal, by, createRepo });
  await reloadProjects();
  return p;
}

// Approve pushes the current project to this owner/repo (null disconnects).
export async function setProjectRepo(repo: string | null): Promise<void> {
  await send('POST', `/projects/${projectId()}/repo`, { repo });
  await reloadProjects();
}
