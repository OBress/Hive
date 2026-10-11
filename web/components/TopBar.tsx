'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAnnounce, usePeers, useStatus } from '@/lib/hive';
import { useHive } from '@/lib/mock';
import { Avatar } from './ui';

const TABS = [
  { href: '/overview', label: 'Overview' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/architecture', label: 'Architecture' },
  { href: '/environment', label: 'Environment' },
];

// Shared header for every page: logo, page tabs, presence, and page-specific actions on the right.
export default function TopBar({ me, openTaskId, children }: { me: string; openTaskId?: string | null; children?: ReactNode }) {
  const s = useHive();
  const path = usePathname();
  const building = Object.values(s.runs).some((r) => r.status === 'running');
  const peers = usePeers().filter((p) => p.name !== me);
  const connected = useStatus() === 'connected';
  useAnnounce(me, openTaskId);
  const q = me && me !== 'Guest' ? `?name=${encodeURIComponent(me)}` : '';
  const active = Math.max(0, TABS.findIndex((t) => t.href === path));

  return (
    <header className="hv-top">
      <Link href={`/overview${q}`} className="hv-logo" aria-label="Hive overview">
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
          <path d="M17 2.5l12.5 7.2v14.6L17 31.5 4.5 24.3V9.7z" fill="#ff5c1a" stroke="#14121a" strokeWidth="3" strokeLinejoin="round" />
          <path d="M17 11l6 3.5v7L17 25l-6-3.5v-7z" fill="#fffdf8" stroke="#14121a" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
        <span>Hive</span>
      </Link>
      <span className="hv-wordbox">url-shortener</span>

      <nav className="hv-tabs" style={{ '--i': active, '--n': TABS.length } as React.CSSProperties} aria-label="Pages">
        <span className="hv-tabs__pill" />
        {TABS.map((t, i) => (
          <Link key={t.href} href={`${t.href}${q}`} className={i === active ? 'is-on' : ''} aria-current={i === active ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <span className={`hv-live${connected ? '' : ' is-off'}`}><i /> {connected ? 'Live' : 'Offline'}</span>

      <div className="hv-top__spacer" />

      <div className="hv-presence" aria-label="Who's here">
        <Avatar name="planner" agent busy={s.thinking} size={36} />
        <Avatar name="builder" agent busy={building} size={36} />
        <span className="hv-presence__gap" />
        {peers.map((p) => <Avatar key={p.name} name={p.name} size={36} />)}
        <span className="hv-presence__me"><Avatar name={me} size={36} /><em>you</em></span>
      </div>

      {children && <div className="hv-ship">{children}</div>}
    </header>
  );
}
