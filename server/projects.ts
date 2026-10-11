import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as Y from 'yjs';
import type { Project } from '@hive/shared/types';
import { DATA_DIR } from './paths.ts';

// Every project has its own Y.Doc (named by its id), git workspace, worktrees and session transcripts under
// data/projects/<id>/. Server code runs "inside" one project: requests under /api/projects/:project and each
// agent loop carry the project id in AsyncLocalStorage, so doc.ts and the path helpers below find the right one.

const FILE = join(DATA_DIR, 'projects.json');
const DIR = join(DATA_DIR, 'projects');
export const registryExists = () => existsSync(FILE);

let list: Project[] = [];
export function loadProjects(): Project[] {
  list = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Project[]) : [];
  return list;
}
const save = () => { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(list, null, 2)); };

export const listProjects = () => list;
export const getProject = (id: string) => list.find((p) => p.id === id);

// The id is a slug of the name plus a random suffix, so a deleted project's id (and stale tabs on it) never comes back.
export function createProject(name: string, goal: string, createdBy: string): Project {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'project';
  const p: Project = { id: `${slug}-${randomBytes(2).toString('hex')}`, name, goal, repo: null, createdBy, createdAt: new Date().toISOString() };
  list.push(p);
  save();
  mkdirSync(join(DIR, p.id), { recursive: true });
  return p;
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'goal' | 'repo'>>): Project {
  const i = list.findIndex((p) => p.id === id);
  list[i] = { ...list[i], ...patch };
  save();
  return list[i];
}

// index.ts opens a project's doc and workspace; routes call this after creating one.
let opener: (p: Project) => Promise<void> = async () => {};
export const setOpener = (fn: (p: Project) => Promise<void>) => { opener = fn; };
export const openProject = (p: Project) => opener(p);

// ---- the current project ----

const store = new AsyncLocalStorage<string>();
export const inProject = <T>(id: string, fn: () => T): T => store.run(id, fn);
export function currentId(): string {
  const id = store.getStore();
  if (!id) throw new Error('No project in context');
  return id;
}
export const current = () => getProject(currentId())!;

const docs = new Map<string, Y.Doc>();
export const setProjectDoc = (id: string, doc: Y.Doc) => docs.set(id, doc);
export const loadedDocs = () => docs;
export function projectDoc(): Y.Doc {
  const d = docs.get(currentId());
  if (!d) throw new Error('Doc not loaded yet');
  return d;
}

export const projectDir = (id = currentId()) => join(DIR, id);
export const docFile = (id = currentId()) => join(projectDir(id), 'doc.bin');
export const workspaceDir = () => join(projectDir(), 'workspace');
export const worktreesDir = () => join(projectDir(), 'worktrees');
export const sessionsDir = () => join(projectDir(), 'sessions');
