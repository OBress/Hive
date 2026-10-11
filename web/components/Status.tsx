'use client';

import type { RunStatus, Task, TaskRun } from '@/lib/types';

// The single source for how a status looks. Always color + text, never color alone.
export type DisplayStatus = RunStatus | 'human';

export const STATUS: Record<DisplayStatus, { label: string; short: string }> = {
  todo:    { label: 'To do',                short: 'To do' },
  ready:   { label: 'Ready',                short: 'Ready' },
  running: { label: 'Building…',            short: 'Building' },
  stale:   { label: 'Stale · rebuilding',   short: 'Stale' },
  done:    { label: 'Done ✓',               short: 'Done' },
  failed:  { label: 'Failed',               short: 'Failed' },
  blocked: { label: 'Blocked',              short: 'Blocked' },
  human:   { label: 'Human',                short: 'Human' },
};

export const ORDER: DisplayStatus[] = ['todo', 'ready', 'running', 'stale', 'done', 'blocked', 'failed', 'human'];

export function displayStatus(task: Task, run?: TaskRun): DisplayStatus {
  const st = run?.status ?? 'todo';
  if (task.assignee !== 'agent' && (st === 'todo' || st === 'ready')) return 'human';
  return st;
}

export function StatusSticker({ status, size = 'md', short = false }: { status: DisplayStatus; size?: 'sm' | 'md' | 'lg'; short?: boolean }) {
  return (
    <span className={`hv-sticker hv-status hv-s-${status} hv-status--${size}`}>
      <i className="hv-status__dot" />
      {short ? STATUS[status].short : STATUS[status].label}
    </span>
  );
}
