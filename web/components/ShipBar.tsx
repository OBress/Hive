'use client';

import { push, runReady, useHive } from '@/lib/mock';
import { Icon } from './ui';

export default function ShipBar({ me }: { me: string }) {
  const s = useHive();
  const anyDone = Object.values(s.runs).some((r) => r.status === 'done');
  return (
    <>
      <button className="hv-btn hv-btn--blue" onClick={() => runReady()} disabled={!Object.keys(s.tasks).length}>
        <Icon name="play" size={16} /> Run ready
      </button>
      {s.pushedUrl ? (
        <a className="hv-btn hv-btn--ink" href={s.pushedUrl} target="_blank" rel="noreferrer">
          <Icon name="link" size={16} /> {s.pushedUrl.slice(-7)} on GitHub
        </a>
      ) : (
        <button className="hv-btn hv-btn--hot" onClick={() => push(me)} disabled={!anyDone || s.pushing}>
          {s.pushing ? <><i className="hv-spinner" /> Pushing…</> : <><Icon name="push" size={16} /> Approve &amp; push</>}
        </button>
      )}
    </>
  );
}
