'use client';

import { useEffect, useState } from 'react';
import { DEMO_REQUEST, sendChat, useHive } from '@/lib/mock';
import { ORDER, StatusSticker } from './Status';
import { Icon, tilt } from './ui';

export function EmptyState({ me }: { me: string }) {
  const s = useHive();
  if (Object.keys(s.tasks).length) return null;
  return (
    <div className="hv-empty">
      <span className="hv-float hv-sticker hv-sticker--blue" style={{ ...tilt('a', 6), left: '8%', top: '14%' }}>Planner agent</span>
      <span className="hv-float hv-sticker hv-sticker--hot" style={{ ...tilt('b', 6), right: '10%', top: '20%', animationDelay: '-2s' }}>2 builds at once</span>
      <span className="hv-float hv-sticker hv-sticker--ink" style={{ ...tilt('c', 6), left: '14%', bottom: '18%', animationDelay: '-4s' }}>Real git commits</span>
      <span className="hv-float hv-sticker" style={{ ...tilt('d', 6), right: '14%', bottom: '14%', animationDelay: '-1s' }}>Tests decide</span>

      <div className="hv-empty__card">
        <h1>Plan it <span className="hv-wordbox hv-wordbox--xl">together</span></h1>
        <p>Describe what to build in chat. The Planner draws the task graph, and Builder agents pick up every task whose dependencies are done.</p>
        <button className="hv-btn hv-btn--hot hv-btn--lg" onClick={() => sendChat(DEMO_REQUEST, me)} disabled={s.thinking}>
          {s.thinking ? <><i className="hv-spinner" /> Planning…</> : <>Send the demo request <Icon name="arrow" /></>}
        </button>
      </div>
    </div>
  );
}

export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hv-legend${open ? '' : ' is-closed'}`}>
      <button className="hv-legend__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        Status {open ? '–' : '+'}
      </button>
      {open && <div className="hv-legend__items">{ORDER.map((st) => <StatusSticker key={st} status={st} size="sm" short />)}</div>}
    </div>
  );
}

export function Toast() {
  const s = useHive();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!s.toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [s.toast]);
  if (!s.toast || !visible) return null;
  return <div key={s.toast.at} className="hv-toast" role="status">{s.toast.text}</div>;
}
