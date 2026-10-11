'use client';

import { useEffect, useRef } from 'react';
import { runSteps, stepPosition } from '@/lib/steps';
import type { Task, TaskRun } from '@/lib/types';
import { Icon } from './ui';

const CAPTION: Record<string, string> = {
  waiting: 'Waiting for dependencies', ready: 'Ready to start', active: 'In progress',
  blocked: 'Blocked: merge conflict', failed: 'Failed here', stale: 'Spec changed · starting over', done: 'All checkpoints complete',
};

// Checkpoint track for one task's run. Length follows the task (one test node per acceptance check);
// the current node pulses and the track scrolls itself to keep it in view as the run advances.
export default function RunSteps({ task, run }: { task: Task; run?: TaskRun }) {
  const steps = runSteps(task);
  const { current, state } = stepPosition(task, run);
  const trackRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const node = track?.children[Math.min(current, steps.length - 1)] as HTMLElement | undefined;
    if (!track || !node) return;
    track.scrollTo({ left: node.offsetLeft - track.clientWidth / 2 + node.clientWidth / 2, behavior: 'smooth' });
  }, [current, steps.length]);

  const shown = Math.min(current, steps.length - 1);
  const label = state === 'done' ? 'Merged into main' : steps[shown];

  return (
    <div className={`hv-steps is-${state}`}>
      <ol className="hv-steps__track" ref={trackRef} aria-label={`Checkpoint ${Math.min(current + 1, steps.length)} of ${steps.length}`}>
        {steps.map((s, i) => {
          const done = i < current;
          const here = i === current;
          return (
            <li key={`${i}-${s}`} className={`hv-step${done ? ' is-done' : ''}${here ? ' is-here' : ''}`} title={s}
              aria-current={here ? 'step' : undefined}>
              <span className="hv-step__dot">
                {done ? <Icon name="check" size={16} /> : <b>{i + 1}</b>}
              </span>
              <span className="hv-step__label">{s.replace(/^Test: /, '')}</span>
              {s.startsWith('Test: ') && <span className="hv-step__tag">test</span>}
            </li>
          );
        })}
      </ol>
      <div key={`${current}-${state}`} className="hv-steps__now">
        <span className="hv-steps__count">{state === 'done' ? `${steps.length}/${steps.length}` : `${shown + 1}/${steps.length}`}</span>
        <span className="hv-steps__label">{label}</span>
        <span className="hv-steps__state">{CAPTION[state]}</span>
      </div>
    </div>
  );
}
