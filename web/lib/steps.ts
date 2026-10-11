import type { Task, TaskRun } from './types';

// A run's checkpoints: Start → Write code → one test per acceptance check → Commit → Merge.
// Variable length on purpose: more acceptance checks, more nodes.
export function runSteps(task: Task): string[] {
  const tests = task.acceptance.length ? task.acceptance.map((a) => `Test: ${a}`) : ['Run tests'];
  return ['Start', 'Write code', ...tests, 'Commit', 'Merge into main'];
}

export type StepState = 'waiting' | 'ready' | 'active' | 'blocked' | 'failed' | 'stale' | 'done';

// Which node is current and what state it's in. Nodes before `current` are complete.
export function stepPosition(task: Task, run?: TaskRun): { current: number; state: StepState } {
  const total = runSteps(task).length;
  switch (run?.status) {
    case 'ready':   return { current: 0, state: 'ready' };
    case 'running': return { current: Math.min(run.step ?? 1, total - 2), state: 'active' };
    case 'blocked': return { current: total - 1, state: 'blocked' };
    case 'failed':  return { current: run.step ?? 1, state: 'failed' };
    case 'stale':   return { current: 0, state: 'stale' };
    case 'done':    return { current: total, state: 'done' };
    default:        return { current: 0, state: 'waiting' };
  }
}
