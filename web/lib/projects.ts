'use client';

// The project list and the current project. Each project is its own doc, workspace and push repo on the
// server; a page works on one project, named by ?project=<id> in the URL (so a shared link opens the same
// one). Switching projects is a full page load, because the doc provider is one per tab.

import { useSyncExternalStore } from 'react';
import type { Project, UserSummary } from '@hive/shared/types';
import { authHeaders, initAuth, serverUrl } from './auth';

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

// The demo name (?name=) when sign-in is off; with sign-in on the server uses the verified login instead.
export const demoName = () =>
  (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('name')) || 'Guest';

// Only this person's projects and the ones shared with them, so wait for sign-in before asking.
export function reloadProjects(): Promise<void> {
  loading = initAuth()
    .then(() => fetch(`${serverUrl()}/api/projects?name=${encodeURIComponent(demoName())}`, { headers: authHeaders() }))
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

async function send<T>(method: string, path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${serverUrl()}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ by: demoName(), ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export interface NewProject { name: string; goal: string; by: string; createRepo: boolean; stack?: string }

// With createRepo, the server also makes a private GitHub repo for it; repoError says why if it could not.
export async function createProject(p: NewProject): Promise<Project & { repoError?: string }> {
  const made = await send<Project & { repoError?: string }>('POST', '/projects', { ...p });
  await reloadProjects();
  return made;
}

// A draft stack / spec doc for a project not created yet; `notes` asks for changes to the last draft.
export async function draftStack(name: string, goal: string, notes = ''): Promise<string> {
  return (await send<{ stack: string }>('POST', '/stack', { name, goal, notes })).stack;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await send('POST', `/projects/${id}/rename`, { name });
  await reloadProjects();
}

// Deletes the project's graph, agents and workspace on the server; its GitHub repo stays.
export async function deleteProject(id: string): Promise<void> {
  await send('POST', `/projects/${id}/delete`);
  await reloadProjects();
}

export async function setShared(id: string, login: string, on: boolean): Promise<void> {
  await send('POST', `/projects/${id}/${on ? 'share' : 'unshare'}`, { login });
  await reloadProjects();
}

// People who have signed in to this Hive, matched by GitHub username (an empty query lists everyone).
export async function searchUsers(q: string): Promise<UserSummary[]> {
  await initAuth();
  const res = await fetch(`${serverUrl()}/api/users?q=${encodeURIComponent(q)}&name=${encodeURIComponent(demoName())}`, { headers: authHeaders() });
  return res.ok ? ((await res.json()) as { users: UserSummary[] }).users : [];
}

// Whether the server holds this person's GitHub token (needed to create the repo).
export async function githubStatus(): Promise<{ signedIn: boolean; githubConnected: boolean }> {
  await initAuth();
  const res = await fetch(`${serverUrl()}/api/me`, { headers: authHeaders() });
  const j = (await res.json().catch(() => ({}))) as { user?: unknown; githubConnected?: boolean };
  return { signedIn: !!j.user, githubConnected: !!j.githubConnected };
}

export const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Approve pushes the current project to this owner/repo (null disconnects).
export async function setProjectRepo(repo: string | null): Promise<void> {
  await send('POST', `/projects/${projectId()}/repo`, { repo });
  await reloadProjects();
}
