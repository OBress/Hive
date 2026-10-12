import * as Y from 'yjs';
import {
  ARRAYS, MAPS, type ChatMessage, type SessionView, type Step, type TaskSpec, type TaskState, type TerminalView,
} from '@hive/shared/types';
import { currentId, projectDoc } from './projects.ts';

// The current project's Hocuspocus-managed doc, kept loaded by the server's direct connection (see index.ts).
export const getDoc = (): Y.Doc => projectDoc();

export const tasks = () => getDoc().getMap<TaskSpec>(MAPS.tasks);
export const taskState = () => getDoc().getMap<TaskState>(MAPS.taskState);
export const sessions = () => getDoc().getMap<SessionView>(MAPS.sessions);
// Each value is a Y.Text the server appends to as the agent writes (browsers read it as a string via toJSON).
export const live = () => getDoc().getMap<Y.Text | string>(MAPS.live);
export const terminal = () => getDoc().getMap<TerminalView>(MAPS.terminal);
export const steps = () => getDoc().getArray<Step>(ARRAYS.steps);
export const chat = () => getDoc().getArray<ChatMessage>(ARRAYS.chat);

// Every server write goes through here; observers ignore origin 'server'.
export const serverWrite = (fn: () => void) => getDoc().transact(fn, 'server');

// Plain JSON only: drops undefined fields.
export const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(trimmed)` : s);
export const now = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function setTaskState(taskId: string, patch: Partial<TaskState>): TaskState {
  const prev = taskState().get(taskId) ?? { taskId, status: 'todo', owner: { kind: 'agent', name: 'agent' } };
  const next = clean({ ...prev, ...patch, taskId, updatedAt: now() } as TaskState);
  serverWrite(() => taskState().set(taskId, next));
  return next;
}

export function setSession(id: string, patch: Partial<SessionView>): SessionView {
  const prev = sessions().get(id) ?? { id, taskId: '', state: 'running', summary: '', stepCount: 0, startedBy: 'agent' };
  const next = clean({ ...prev, ...patch, id, updatedAt: now() } as SessionView);
  serverWrite(() => sessions().set(id, next));
  return next;
}

// Hooks for the optional Supabase mirror.
export const mirrors: { step?: (s: Step) => void; chat?: (m: ChatMessage) => void } = {};

export function addStep(s: Omit<Step, 'id' | 'n' | 'at'>): Step {
  const n = steps().length + 1;
  const step = clean({ ...s, id: `st_${n}`, n, at: now(), diff: s.diff ? trim(s.diff, 4000) : undefined, output: s.output?.slice(-2000) } as Step);
  serverWrite(() => steps().push([step]));
  mirrors.step?.(step);
  return step;
}

let chatN = 0;
export function addChat(m: Omit<ChatMessage, 'id' | 'at'>): ChatMessage {
  const msg = clean({ ...m, id: `c_${Date.now().toString(36)}_${++chatN}`, at: now() } as ChatMessage);
  serverWrite(() => chat().push([msg]));
  mirrors.chat?.(msg);
  return msg;
}

// Every task in `tasks` gets a TaskState.
export function syncTaskStates() {
  for (const id of tasks().keys()) if (!taskState().has(id)) setTaskState(id, {});
}

// Stream a command's output into terminal[taskId] every 200 ms, so everyone watches it run. A newer run in the
// same task takes the slot over; the older one stops writing.
const termRuns = new Map<string, number>();
let termN = 0;
export function openTerminal(taskId: string, by: string, cmd: string) {
  const doc = getDoc();
  const k = `${currentId()}/${taskId}`;
  const n = ++termN;
  termRuns.set(k, n);
  const view: TerminalView = { taskId, by, cmd, output: '', running: true, at: now() };
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    timer = undefined;
    if (termRuns.get(k) === n) doc.transact(() => doc.getMap<TerminalView>(MAPS.terminal).set(taskId, clean({ ...view })), 'server');
  };
  flush();
  return {
    write: (chunk: string) => { view.output = (view.output + chunk).slice(-8000); timer ??= setTimeout(flush, 200); },
    end: (exitCode: number) => {
      clearTimeout(timer);
      Object.assign(view, { running: false, exitCode, at: now() });
      flush();
      if (termRuns.get(k) === n) termRuns.delete(k);
    },
  };
}
