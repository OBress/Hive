// TEMPORARY: mirrors the task-graph contract in SPEC.md until shared/types.ts is updated.
// When it lands, delete this file and import from '@hive/shared/types' instead.

export type RunStatus = 'todo' | 'ready' | 'running' | 'stale' | 'done' | 'failed' | 'blocked';

export interface Task {
  id: string; title: string;
  spec: string;
  acceptance: string[];
  dependsOn: string[];
  files: string[];
  assignee: string;           // 'agent' or a person's name
  x: number; y: number;
  lastWhy?: string;
}

export interface TaskRun {
  taskId: string; status: RunStatus;
  builtFromVersion: number;
  branch: string;
  commit?: string; diff?: string; testOutput?: string; note: string;
}

export type GraphOp =
  | { op: 'addTask'; task: Partial<Task> }
  | { op: 'updateTask'; id: string; fields: Partial<Task> }
  | { op: 'removeTask'; id: string }
  | { op: 'addEdge' | 'removeEdge'; from: string; to: string };

export interface ChatMessage {
  id: string; at: string; from: string;   // a name, 'planner' or 'builder'
  text: string;
  ops?: GraphOp[];
  cites?: string[];
}

export interface Conflict {
  id: string; taskA: string; taskB: string; files: string[];
  hunks: string;
  proposal?: string; proposalPassesTests?: boolean;
  status: 'open' | 'auto-resolved' | 'resolved'; rule?: string;
}

export interface Decision {
  id: string; at: string; who: string; taskId?: string;
  kind: 'spec-change' | 'graph-change' | 'agent-result' | 'conflict' | 'merge' | 'push';
  summary: string; why?: string; commit?: string;
}
