'use client';

// PLACEHOLDER architecture map for the Architecture page: a ComfyUI-style node graph of the
// whole system. Sockets are typed; wires only connect matching types. Positions and edits live
// in module state for the session (move to the Y.Doc later if it should be shared).

import type { Edge, Node } from '@xyflow/react';

export type Wire = 'https' | 'static' | 'ws' | 'sql' | 'token' | 'egress' | 'git';
export type Health = 'live' | 'mock' | 'planned';
export type Zone = 'edge' | 'app' | 'data' | 'external';

export const WIRES: Record<Wire, { color: string; label: string }> = {
  https:  { color: '#2563eb', label: 'HTTPS / HTTP' },
  static: { color: '#ff5c1a', label: 'Static assets' },
  ws:     { color: '#a855f7', label: 'WebSocket' },
  sql:    { color: '#22c55e', label: 'Storage' },
  token:  { color: '#eab308', label: 'Auth token' },
  egress: { color: '#ec4899', label: 'Outbound (egress)' },
  git:    { color: '#f5efe4', label: 'Git' },
};

export const ZONES: Record<Zone, { label: string; color: string }> = {
  edge:     { label: 'Edge', color: '#2563eb' },
  app:      { label: 'App', color: '#ff5c1a' },
  data:     { label: 'Data', color: '#22c55e' },
  external: { label: 'External', color: '#a855f7' },
};

export interface Port { id: string; label: string; type: Wire }

export type ArchData = {
  title: string; kind: string; zone: Zone; glyph: string; health: Health;
  ins: Port[]; outs: Port[];
  widgets: [string, string][];
  about: string; files?: string[];
};

export type ZoneData = { label: string; color: string };

export type ArchNode = Node<ArchData, 'arch'>;
export type ZoneNode = Node<ZoneData, 'zone'>;
export type AnyNode = ArchNode | ZoneNode;

const n = (id: string, x: number, y: number, data: ArchData): ArchNode => ({ id, type: 'arch', position: { x, y }, data });
const p = (id: string, label: string, type: Wire): Port => ({ id, label, type });

const zone = (id: Zone, x: number, y: number, w: number, h: number): ZoneNode => ({
  id: `zone-${id}`, type: 'zone', position: { x, y }, data: ZONES[id],
  style: { width: w, height: h }, draggable: false, selectable: false, zIndex: -1,
});

export const TEMPLATES: ArchData[] = [
  { title: 'Cache', kind: 'Redis', zone: 'data', glyph: '⚡', health: 'planned', ins: [p('in', 'get / set', 'sql')], outs: [], widgets: [['ttl', '60 s'], ['eviction', 'LRU']], about: 'Hot reads (redirect lookups) without touching the main store.' },
  { title: 'Queue', kind: 'Job queue', zone: 'app', glyph: '☰', health: 'planned', ins: [p('in', 'enqueue', 'https')], outs: [p('out', 'jobs', 'https')], widgets: [['workers', '2'], ['retries', '1']], about: 'Moves Builder runs off the request path and caps concurrency.' },
  { title: 'Object storage', kind: 'S3-compatible', zone: 'data', glyph: '▤', health: 'planned', ins: [p('in', 'put / get', 'sql')], outs: [p('out', 'files', 'static')], widgets: [['bucket', 'hive-artifacts']], about: 'Published sites, build artifacts and doc snapshots.' },
  { title: 'Monitoring', kind: 'Logs + metrics', zone: 'external', glyph: '◎', health: 'planned', ins: [p('in', 'telemetry', 'egress')], outs: [], widgets: [['retention', '7 d']], about: 'Request logs, agent latency and token spend.' },
];

export const INITIAL_NODES: AnyNode[] = [
  zone('edge', -40, -70, 650, 720),
  zone('app', 650, -70, 640, 900),
  zone('data', 1330, -70, 330, 900),
  zone('external', 1700, -70, 620, 720),

  n('users', 0, 210, { title: 'Users', kind: 'Browsers', zone: 'edge', glyph: '☺', health: 'live',
    ins: [], outs: [p('req', 'requests', 'https')],
    widgets: [['who', 'Ana · Ben · Cal'], ['identity', '?name=']],
    about: 'People in separate browser windows. Each window is one Hocuspocus client and one presence avatar.' }),
  n('cdn', 300, 20, { title: 'CDN', kind: 'Edge cache', zone: 'edge', glyph: '◈', health: 'planned',
    ins: [p('in', 'requests', 'https')], outs: [p('assets', 'assets', 'static'), p('origin', 'origin', 'https')],
    widgets: [['cache', 'JS / CSS / fonts'], ['ttl', '1 h']],
    about: 'Serves the built web bundle and caches published sites. On the demo laptop this is skipped: Next serves directly.' }),
  n('proxy', 300, 360, { title: 'Reverse proxy', kind: 'TLS + routing', zone: 'edge', glyph: '⇆', health: 'planned',
    ins: [p('in', 'origin', 'https')], outs: [p('api', '/api', 'https'), p('ws', '/ws', 'ws'), p('login', '/auth', 'https')],
    widgets: [['tls', 'on'], ['routes', '/api · /ws · /site']],
    about: 'Terminates TLS and routes /api to Express and websocket upgrades to Hocuspocus. Today the browser talks to :4000 directly.' }),

  n('web', 700, 0, { title: 'Frontend', kind: 'Next.js 16 SPA', zone: 'app', glyph: '▣', health: 'live',
    ins: [p('assets', 'bundle', 'static')], outs: [],
    widgets: [['port', '5173'], ['pages', 'overview · tasks · arch']],
    about: 'Client-only React app: task graph, task panel, chat, overview and this page. Reads everything from the shared Y.Doc.',
    files: ['web/app/page.tsx', 'web/components/Graph.tsx', 'web/lib/hive.ts'] }),
  n('auth', 700, 380, { title: 'Auth', kind: 'Identity', zone: 'app', glyph: '⚿', health: 'mock',
    ins: [p('login', 'login', 'https')], outs: [p('token', 'session', 'token')],
    widgets: [['demo', '?name= in URL'], ['later', 'OAuth + roles']],
    about: 'For the demo, identity is just ?name=. A real deployment adds OAuth sign-in and per-project roles.' }),
  n('api', 1010, 160, { title: 'Backend API', kind: 'Express 5', zone: 'app', glyph: '⌘', health: 'live',
    ins: [p('http', '/api', 'https'), p('token', 'session', 'token')],
    outs: [p('store', 'doc', 'sql'), p('git', 'repo', 'git'), p('llm', 'LLM calls', 'egress')],
    widgets: [['port', '4000'], ['routes', 'chat · run · resolve · push'], ['agents', 'Planner · Builder']],
    about: 'Starts work and returns 202: runs the Planner on chat, schedules Builder runs (max 2), merges branches, resolves conflicts and pushes.',
    files: ['server/index.ts', 'server/planner.ts', 'server/builder.ts', 'server/graph.ts'] }),
  n('rt', 1010, 560, { title: 'Realtime sync', kind: 'Hocuspocus + Yjs', zone: 'app', glyph: '⟳', health: 'live',
    ins: [p('ws', '/ws', 'ws'), p('token', 'session', 'token')], outs: [p('store', 'persist', 'sql')],
    widgets: [['doc', '"hive"'], ['save', 'every 2 s']],
    about: 'One Y.Doc holds tasks, runs, chat, conflicts and decisions. Browsers write tasks; the server writes the rest.' }),

  n('db', 1370, 430, { title: 'Database', kind: 'doc.bin → Postgres', zone: 'data', glyph: '⛁', health: 'mock',
    ins: [p('in', 'reads / writes', 'sql')], outs: [],
    widgets: [['now', 'data/doc.bin'], ['later', 'Postgres + snapshots']],
    about: 'The demo saves the encoded Y.Doc to a file. A hosted version stores per-project docs and history in Postgres.' }),
  n('repo', 1370, 60, { title: 'Git workspace', kind: 'Local repo', zone: 'data', glyph: '⑂', health: 'live',
    ins: [p('in', 'commits', 'git')], outs: [p('test', 'checkout', 'git'), p('push', 'push', 'egress')],
    widgets: [['path', 'workspace/'], ['branches', 'task/<id>']],
    about: 'A real git repo. One branch per task, merged into main in dependency order; conflicts open a card.' }),
  n('tests', 1370, 700, { title: 'Test runner', kind: 'Sandboxed npm test', zone: 'data', glyph: '✓', health: 'live',
    ins: [p('in', 'checkout', 'git')], outs: [],
    widgets: [['env', 'PATH + HOME only'], ['timeout', '60 s']],
    about: 'Runs node:test as a separate process with a stripped environment. Tests decide whether a merge proposal is applied.' }),

  n('egress', 1760, 200, { title: 'Forward proxy', kind: 'Egress gateway', zone: 'external', glyph: '➜', health: 'planned',
    ins: [p('in', 'outbound', 'egress')], outs: [p('llm', 'api.anthropic.com', 'egress'), p('gh', 'github.com', 'egress')],
    widgets: [['allowlist', '2 hosts'], ['keys', 'injected here']],
    about: 'All outbound traffic leaves through one allowlisted gateway, so generated code and agents can only reach the LLM and GitHub, and API keys never sit in app processes.' }),
  n('claude', 2050, 40, { title: 'Claude API', kind: 'LLM', zone: 'external', glyph: '✦', health: 'live',
    ins: [p('in', 'messages', 'egress')], outs: [],
    widgets: [['planner', 'fast model'], ['builder', 'strong model']],
    about: 'One call per chat message (Planner) and one per task (Builder), strict JSON, validated with one retry.' }),
  n('github', 2050, 360, { title: 'GitHub', kind: 'Remote', zone: 'external', glyph: '⌥', health: 'mock',
    ins: [p('in', 'push', 'egress')], outs: [],
    widgets: [['when', 'Approve & push'], ['token', 'server .env']],
    about: 'main is pushed only after a person approves and the full suite passes on main.' }),
];

const e = (source: string, sh: string, target: string, th: string): Edge => ({
  id: `${source}.${sh}->${target}.${th}`, source, target, sourceHandle: sh, targetHandle: th,
});

export const INITIAL_EDGES: Edge[] = [
  e('users', 'req', 'cdn', 'in'),
  e('cdn', 'assets', 'web', 'assets'),
  e('cdn', 'origin', 'proxy', 'in'),
  e('proxy', 'api', 'api', 'http'),
  e('proxy', 'ws', 'rt', 'ws'),
  e('proxy', 'login', 'auth', 'login'),
  e('auth', 'token', 'api', 'token'),
  e('auth', 'token', 'rt', 'token'),
  e('api', 'store', 'db', 'in'),
  e('rt', 'store', 'db', 'in'),
  e('api', 'git', 'repo', 'in'),
  e('repo', 'test', 'tests', 'in'),
  e('api', 'llm', 'egress', 'in'),
  e('repo', 'push', 'egress', 'in'),
  e('egress', 'llm', 'claude', 'in'),
  e('egress', 'gh', 'github', 'in'),
];

// Session memory so switching pages keeps the layout.
export const saved: { nodes: AnyNode[] | null; edges: Edge[] | null } = { nodes: null, edges: null };

export function portType(node: AnyNode | undefined, handle: string | null | undefined, side: 'ins' | 'outs'): Wire | undefined {
  if (!node || node.type !== 'arch' || !handle) return undefined;
  return (node.data as ArchData)[side].find((x) => x.id === handle)?.type;
}
