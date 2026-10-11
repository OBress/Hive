'use client';

import { useEffect, useState } from 'react';
import { resolveConflict, useHive } from '@/lib/mock';
import type { Conflict } from '@/lib/types';
import { Icon } from './ui';

// Split git conflict markers into the two sides; context lines go to both.
function sides(hunks: string) {
  const ours: string[] = [], theirs: string[] = [];
  let mode: 'both' | 'ours' | 'theirs' = 'both';
  let oursLabel = 'ours', theirsLabel = 'theirs';
  for (const l of hunks.split('\n')) {
    if (l.startsWith('<<<<<<<')) { mode = 'ours'; oursLabel = l.slice(8) || oursLabel; }
    else if (l.startsWith('=======')) mode = 'theirs';
    else if (l.startsWith('>>>>>>>')) { mode = 'both'; theirsLabel = l.slice(8) || theirsLabel; }
    else {
      if (mode !== 'theirs') ours.push((mode === 'ours' ? '+ ' : '  ') + l);
      if (mode !== 'ours') theirs.push((mode === 'theirs' ? '+ ' : '  ') + l);
    }
  }
  return { ours, theirs, oursLabel, theirsLabel };
}

export default function ConflictCards({ me, onFocusTask }: { me: string; onFocusTask: (id: string) => void }) {
  const s = useHive();
  const [hidden, setHidden] = useState<string[]>([]);
  const list = Object.values(s.conflicts).filter((c) => !hidden.includes(c.id));
  if (!list.length) return null;
  return (
    <div className="hv-conflicts">
      {list.map((c) => (
        <Card key={c.id} c={c} me={me} titles={[s.tasks[c.taskA]?.title ?? c.taskA, s.tasks[c.taskB]?.title ?? c.taskB]}
          onFocusTask={onFocusTask} onDismiss={() => setHidden((h) => [...h, c.id])} />
      ))}
    </div>
  );
}

function Card({ c, me, titles, onFocusTask, onDismiss }: {
  c: Conflict; me: string; titles: [string, string]; onFocusTask: (id: string) => void; onDismiss: () => void;
}) {
  const { ours, theirs, oursLabel, theirsLabel } = sides(c.hunks);
  const open = c.status === 'open';
  const [collapsed, setCollapsed] = useState(false);

  // Once settled, fold into a pill after a beat so the graph is visible again.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setCollapsed(true), 5000);
    return () => clearTimeout(t);
  }, [open]);

  if (collapsed) {
    return (
      <button className="hv-conflict-pill" onClick={() => setCollapsed(false)}>
        <Icon name="check" size={16} /> {titles[0]} × {titles[1]} · {c.rule ?? 'resolved'}
      </button>
    );
  }

  return (
    <section className={`hv-conflict${open ? '' : ' is-settled'}`} aria-live="polite">
      <header className="hv-conflict__head">
        <span className="hv-sticker hv-sticker--hot hv-conflict__badge">Merge conflict</span>
        <h3>
          <button onClick={() => onFocusTask(c.taskA)}>{titles[0]}</button>
          <span> × </span>
          <button onClick={() => onFocusTask(c.taskB)}>{titles[1]}</button>
        </h3>
        <div className="hv-chips">{c.files.map((f) => <span key={f} className="hv-sticker hv-sticker--file">{f}</span>)}</div>
        {!open && <button className="hv-iconbtn hv-iconbtn--sm" onClick={onDismiss} aria-label="Dismiss"><Icon name="close" size={14} /></button>}
      </header>

      <div className="hv-conflict__sides">
        <div><span className="hv-label">{oursLabel}</span><pre>{ours.join('\n')}</pre></div>
        <div><span className="hv-label">{theirsLabel}</span><pre>{theirs.join('\n')}</pre></div>
      </div>

      {c.proposal && (
        <div className="hv-conflict__proposal">
          <span className="hv-label">Agent’s proposed merge</span>
          <pre>{c.proposal}</pre>
        </div>
      )}

      <footer className="hv-conflict__foot">
        {c.status === 'auto-resolved' && (
          <span className="hv-sticker hv-s-done hv-status hv-status--lg hv-pop"><Icon name="check" size={16} /> Tests pass, applied</span>
        )}
        {c.status === 'resolved' && <span className="hv-sticker hv-s-done hv-status hv-status--lg hv-pop"><Icon name="check" size={16} /> Resolved</span>}
        {open && <span className="hv-conflict__checking"><i className="hv-spinner" /> Running the full suite on the proposal…</span>}
        {c.rule && <span className="hv-conflict__rule">{c.rule}</span>}
        {open && (
          <div className="hv-conflict__btns">
            <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={() => resolveConflict(c.id, 'ours', me)}>Ours</button>
            <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={() => resolveConflict(c.id, 'theirs', me)}>Theirs</button>
            <button className="hv-btn hv-btn--blue hv-btn--sm" onClick={() => resolveConflict(c.id, 'proposal', me)}>Proposal</button>
          </div>
        )}
      </footer>
    </section>
  );
}
