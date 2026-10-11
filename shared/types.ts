// The only contract between web/ and server/. Frozen after setup: change only if both people agree.

export type TaskStatus = 'todo' | 'running' | 'paused' | 'needs_review' | 'done' | 'failed';

export interface TaskSpec {          // ydoc.getMap('tasks'): written by browsers and by the server's Planner
  id: string;
  title: string;
  spec: string;                      // what to build, in words
  deps: string[];                    // ids of tasks that must be done first
  x: number; y: number;              // position on the graph
  editedBy?: string;                 // who made the last edit (browsers set it)
  why?: string;                      // reason typed with the last spec change
  createdBy: string;
}

export interface Project {           // GET /api/projects; the registry lives on the server (data/projects.json)
  id: string;                        // also the Y.Doc name and the folder under data/projects/
  name: string;
  goal: string;                      // one or two sentences, shown on Overview
  repo: string | null;               // GitHub owner/repo that Approve pushes to
  createdBy: string;
  createdAt: string;
}

export interface Owner { kind: 'agent' | 'human'; name: string }   // agent: name 'agent'

export interface TaskState {         // ydoc.getMap('taskState'): server only
  taskId: string;
  status: TaskStatus;
  owner: Owner;
  sessionId?: string;
  branch?: string;                   // task/<id>
  lastTest?: { passed: number; failed: number };
  note?: string;                     // short reason for paused / failed / needs_review
  updatedAt: string;
}

export interface SessionView {       // ydoc.getMap('sessions'): server only; the transcript stays on the server
  id: string; taskId: string;
  state: 'running' | 'paused' | 'done' | 'failed';
  summary: string;                   // Done / Left / Tried / Open, shown on hand-off and catch-up
  stepCount: number;
  startedBy: string;
  updatedAt: string;
}

export type StepKind =
  | 'plan' | 'read' | 'edit' | 'test' | 'finish'
  | 'steer' | 'spec-change' | 'takeover' | 'human-edit' | 'handback' | 'handoff'
  | 'merge' | 'error' | 'approve';

export interface Step {              // ydoc.getArray('steps'): server only, append-only
  id: string; n: number;             // n: global order
  taskId?: string; sessionId?: string;
  kind: StepKind;
  by: string;                        // 'agent' or a person's name
  text: string;                      // one line for the feed
  path?: string;                     // file touched
  diff?: string;                     // unified diff, trimmed to 4,000 chars
  test?: { passed: number; failed: number; output: string };
  commit?: string;                   // short hash
  at: string;
}

export interface ChatMessage {       // ydoc.getArray('chat'): server only (browsers post via REST)
  id: string; from: string; text: string;
  cites?: string[];                  // step ids an answer is based on
  taskIds?: string[];                // tasks the Planner created or changed
  at: string;
}

// Y.Doc layout: one doc per project, named by the project id
export const MAPS = {
  tasks: 'tasks',                    // TaskSpec, browsers + server
  taskState: 'taskState',            // TaskState, server only
  sessions: 'sessions',              // SessionView, server only
  live: 'live',                      // sessionId -> text the agent is writing right now, server only
} as const;
export const ARRAYS = { steps: 'steps', chat: 'chat' } as const;

export const SERVER_PORT = 4000;
export const WEB_PORT = 5173;
