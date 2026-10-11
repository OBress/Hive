import type { AutonomyMode, TaskSpec, TaskState } from '@hive/shared/types';
import { layoutGraph } from '@hive/shared/layout';

type Deps = Record<string, { deps: string[] }>;

// Kahn's algorithm; tasks in a cycle are left out.
export function topoOrder(tasks: Deps): string[] {
  const ids = Object.keys(tasks).sort();
  const indeg = new Map(ids.map((id) => [id, tasks[id].deps.filter((d) => d in tasks).length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const other of ids) {
      if (!tasks[other].deps.includes(id)) continue;
      indeg.set(other, indeg.get(other)! - 1);
      if (indeg.get(other) === 0) queue.push(other);
    }
  }
  return out;
}

export const hasCycle = (tasks: Deps) => topoOrder(tasks).length < Object.keys(tasks).length;

export function readyTasks(tasks: Record<string, TaskSpec>, states: Record<string, TaskState>): string[] {
  return topoOrder(tasks).filter((id) => {
    const s = states[id];
    return s?.status === 'todo' && s.owner.kind === 'agent' && tasks[id].deps.every((d) => states[d]?.status === 'done');
  });
}

// Which ready tasks an agent may start by itself in this mode, and which are waiting for a person's OK.
// Manual: none (people press Start or Run ready). Semi-auto: all but tasks marked `ask`. Automatic: all.
export function autoStartable(tasks: Record<string, TaskSpec>, states: Record<string, TaskState>, mode: AutonomyMode): string[] {
  if (mode === 'manual') return [];
  return readyTasks(tasks, states).filter((id) => mode === 'auto' || !tasks[id].ask);
}
export const waitingForOk = (tasks: Record<string, TaskSpec>, states: Record<string, TaskState>, mode: AutonomyMode): string[] =>
  mode === 'semi' ? readyTasks(tasks, states).filter((id) => tasks[id].ask) : [];

// Lay the whole graph out top to bottom (see shared/layout.ts); returns the ids whose position changed.
export function relayout(tasks: Record<string, TaskSpec>): string[] {
  const pos = layoutGraph(Object.values(tasks));
  const moved = Object.values(tasks).filter((t) => t.x !== pos[t.id].x || t.y !== pos[t.id].y);
  for (const t of moved) Object.assign(t, pos[t.id]);
  return moved.map((t) => t.id);
}

export type GraphOp =
  | { op: 'addTask'; task: { id: string; title: string; spec: string; deps?: string[]; ask?: boolean } }
  | { op: 'updateTask'; id: string; fields: { title?: string; spec?: string; deps?: string[]; ask?: boolean } }
  | { op: 'removeTask'; id: string }
  | { op: 'addDep'; from: string; to: string }      // `to` depends on `from`
  | { op: 'removeDep'; from: string; to: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';

// Validate and apply ops on a copy. Invalid ops are skipped with a reason.
export function applyOps(current: Record<string, TaskSpec>, states: Record<string, TaskState>, ops: unknown[], by = 'planner') {
  const tasks: Record<string, TaskSpec> = structuredClone(current);
  const rejected: string[] = [];
  const changed = new Set<string>();
  const removed = new Set<string>();
  const known = (id: unknown): id is string => typeof id === 'string' && id in tasks;
  const reject = (op: unknown, why: string) => rejected.push(`${JSON.stringify(op)}: ${why}`);
  let shaped = false;   // tasks or edges added or removed: lay the graph out again

  for (const raw of ops) {
    const op = raw as GraphOp;
    const before = structuredClone(tasks);
    if (op?.op === 'addTask') {
      const t = op.task;
      if (!t || typeof t.title !== 'string' || typeof t.spec !== 'string') { reject(op, 'needs title and spec'); continue; }
      const deps = Array.isArray(t.deps) ? t.deps : [];
      if (!deps.every(known)) { reject(op, 'unknown dependency'); continue; }
      let id = slug(t.id || t.title);
      for (let i = 2; id in tasks; i++) id = `${slug(t.id || t.title)}-${i}`;
      tasks[id] = { id, title: t.title, spec: t.spec, deps, x: 0, y: 0, ...(t.ask ? { ask: true } : {}), createdBy: by };
      changed.add(id);
      shaped = true;
    } else if (op?.op === 'updateTask') {
      if (!known(op.id)) { reject(op, 'unknown task'); continue; }
      const f = op.fields ?? {};
      if (f.deps && !(Array.isArray(f.deps) && f.deps.every(known))) { reject(op, 'unknown dependency'); continue; }
      const t = tasks[op.id];
      if (typeof f.title === 'string') t.title = f.title;
      if (typeof f.spec === 'string') { t.spec = f.spec; t.editedBy = by; }
      if (typeof f.ask === 'boolean') { if (f.ask) t.ask = true; else delete t.ask; }
      if (f.deps) { t.deps = f.deps.filter((d) => d !== op.id); shaped = true; }
      changed.add(op.id);
    } else if (op?.op === 'removeTask') {
      if (!known(op.id)) { reject(op, 'unknown task'); continue; }
      if (states[op.id]?.status === 'running') { reject(op, 'task is running'); continue; }
      delete tasks[op.id];
      for (const t of Object.values(tasks)) t.deps = t.deps.filter((d) => d !== op.id);
      removed.add(op.id);
      shaped = true;
    } else if (op?.op === 'addDep' || op?.op === 'removeDep') {
      if (!known(op.from) || !known(op.to)) { reject(op, 'unknown task'); continue; }
      const t = tasks[op.to];
      t.deps = op.op === 'addDep' ? [...new Set([...t.deps, op.from])] : t.deps.filter((d) => d !== op.from);
      changed.add(op.to);
      shaped = true;
    } else {
      reject(op, 'unknown op');
      continue;
    }
    if (hasCycle(tasks)) {
      Object.keys(tasks).forEach((k) => delete tasks[k]);
      Object.assign(tasks, before);
      reject(op, 'would create a cycle');
    }
  }
  const moved = shaped ? relayout(tasks) : [];   // positions only: written, but not reported as changes
  const changedIds = [...changed].filter((id) => id in tasks);
  return { tasks, changedIds, moved, removed: [...removed], rejected };
}
