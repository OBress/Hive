'use client';

import type { CSSProperties } from 'react';

const PATHS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  play: 'M8 5.5v13l11-6.5z',
  push: 'M12 19V6M6 11l6-6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  send: 'M5 12h13M12 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  bot: 'M6 9h12v10H6zM12 5v4M9.5 13.5v1M14.5 13.5v1M3 13v3M21 13v3',
  branch: 'M7 4v12M7 16a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM17 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM17 9c0 5-10 3-10 7',
  plus: 'M12 5v14M5 12h14',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.5 15.5L20 20',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  chevron: 'M6 9l6 6 6-6',
  trash: 'M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10.5 11v5M13.5 11v5',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.5M18 14a6 6 0 013.5 6',
  sparkle: 'M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  github: 'M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.7 4.7 0 00-1.3-3.2 4.4 4.4 0 00-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 00-6.2 0C6.6 2.8 5.6 3.1 5.6 3.1a4.4 4.4 0 00-.1 3.2A4.7 4.7 0 004.2 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const filled = name === 'play' || name === 'bolt';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={filled ? 2 : 2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

const FIXED: Record<string, string> = { Ana: '#ff5c1a', Ben: '#2563eb', Cal: '#a855f7' };
const PALETTE = ['#ff5c1a', '#2563eb', '#a855f7', '#22c55e', '#eab308', '#ec4899'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export const nameColor = (name: string) => FIXED[name] ?? PALETTE[hash(name) % PALETTE.length];

// Small stable tilt for decorative stickers and cards, in degrees.
export const tilt = (id: string, max = 3): CSSProperties =>
  ({ '--tilt': `${((hash(id) % 1000) / 1000) * 2 * max - max}deg` }) as CSSProperties;

export function Avatar({ name, size = 36, agent = false, busy = false }: { name: string; size?: number; agent?: boolean; busy?: boolean }) {
  const bg = agent ? (name === 'planner' ? 'var(--blue)' : 'var(--ink)') : nameColor(name);
  return (
    <span className={`hv-avatar${busy ? ' is-busy' : ''}`} title={agent ? `${name} agent` : name}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}>
      {agent ? <Icon name="bot" size={size * 0.58} /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const isAgent = (from: string) => from === 'planner' || from === 'builder';

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
