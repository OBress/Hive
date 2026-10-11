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
  ask?: boolean;                     // Semi-auto: wait for a person's OK (Start) before an agent starts it
  createdBy: string;
}

// How much agents do on their own (Project.mode; unset means 'auto').
//   manual  nothing starts unless a person starts it; no goal checks
//   semi    ready tasks start by themselves, except tasks marked `ask`; goal-check follow-ups need an OK
//   auto    every ready task starts; when all are done the planner checks the goal (tests, a screenshot)
//           and adds follow-up tasks, a few rounds at most
export type AutonomyMode = 'manual' | 'semi' | 'auto';

export interface Project {           // GET /api/projects; the registry lives on the server (data/projects.json)
  id: string;                        // also the Y.Doc name and the folder under data/projects/
  name: string;
  goal: string;                      // one or two sentences, shown on Overview
  repo: string | null;               // GitHub owner/repo that Approve pushes to
  createdBy: string;
  createdAt: string;
  sharedWith: string[];              // logins (GitHub when signed in) who can see and work on it besides createdBy
  stack?: string;                    // approved stack / spec doc (Markdown); the planner and agents read it
  mode?: AutonomyMode;               // unset = 'auto'
  modeSetBy?: string;                // who chose the mode (unset: the default)
}

export interface UserSummary {       // GET /api/users: people who have signed in to this Hive server
  login: string;
  name: string;
  avatarUrl: string;
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
  | 'merge' | 'error' | 'approve'
  | 'mode' | 'check'                 // mode change; goal check (tests on main, a screenshot, the planner's verdict)
  | 'run';                           // ran the project's CLI (node src/cli.js ...); `output` holds what it printed

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
  image?: string;                    // goal-check screenshot: GET /api/projects/<id>/<image>
  output?: string;                   // run steps: the command's output, last 2,000 chars
  at: string;
}

export interface TerminalView {      // ydoc.getMap('terminal'): server only; the latest command run in a task's folder
  taskId: string;
  cmd: string;                       // e.g. "node --test" or "node src/cli.js add milk"
  by: string;                        // 'agent' or a person's name
  output: string;                    // stdout and stderr as they arrive (updates every 200 ms), last 8,000 chars
  running: boolean;
  exitCode?: number;                 // set when it ends; 124 = timed out
  at: string;
}

// GET /api/projects/<id>/preview (main) or .../tasks/<id>/preview: how to show what the code builds.
//   web  open `url` in an iframe (sandbox="allow-scripts allow-forms"); ask again after an edit step to refresh.
//        how: 'static' src/index.html served by Hive, 'server' src/server.js running on this machine,
//        'sandbox' src/server.js running in the Daytona sandbox (a signed URL, valid for an hour)
//   cli  show `terminal[taskId]`; POST .../tasks/<id>/cli {by, args} runs it
//   none nothing to show yet, or it failed to start: `why`
export type Preview =
  | { kind: 'web'; how: 'static' | 'server' | 'sandbox'; url: string }
  | { kind: 'cli' }
  | { kind: 'none'; why: string };

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
  terminal: 'terminal',              // TerminalView by task id, server only
} as const;
export const ARRAYS = { steps: 'steps', chat: 'chat' } as const;

export const SERVER_PORT = 4000;
export const WEB_PORT = 5173;
