'use client';

// The Architecture page: Hive as it is built, one node per real part of the repo (server/ modules and the
// services they call). The wiring is fixed; each node's status and numbers come live from the running server
// (GET /api/health, GET /api/env) and this tab's websocket, so the map shows what is on, off or down right now.

import type { Edge, Node } from '@xyflow/react';
import { isSet, type EnvStatus, type ServerHealth } from './system';

export type Wire = 'http' | 'ws' | 'auth' | 'call' | 'store' | 'git' | 'llm' | 'proc';
export type Health = 'live' | 'mock' | 'off' | 'down' | 'wait';
export type Zone = 'client' | 'server' | 'data' | 'external';

export const WIRES: Record<Wire, { color: string; label: string }> = {
  http:  { color: '#2563eb', label: 'HTTP' },
  ws:    { color: '#a855f7', label: 'WebSocket (Yjs)' },
  auth:  { color: '#eab308', label: 'Sign-in / token' },
  call:  { color: '#38bdf8', label: 'In-process call' },
  store: { color: '#22c55e', label: 'Storage' },
  git:   { color: '#f5efe4', label: 'Git' },
  llm:   { color: '#ec4899', label: 'LLM request' },
  proc:  { color: '#ff5c1a', label: 'Child process' },
};

export const ZONES: Record<Zone, { label: string; color: string }> = {
  client:   { label: 'Browser', color: '#2563eb' },
  server:   { label: 'server/ · Node on :4000', color: '#ff5c1a' },
  data:     { label: 'Disk · data/', color: '#22c55e' },
  external: { label: 'External services', color: '#a855f7' },
};

export interface Port { id: string; label: string; type: Wire }

// What never changes about a node (from the code), and what the server tells us (Live).
export type ArchDef = {
  title: string; kind: string; zone: Zone; glyph: string;
  ins: Port[]; outs: Port[];
  about: string; files: string[]; env: string[];
};
export type Live = { health: Health; kind?: string; widgets: [string, string][] };
export type ArchData = ArchDef & Live;
export type ZoneData = { label: string; color: string };

export type ArchNode = Node<ArchData, 'arch'>;
export type ZoneNode = Node<ZoneData, 'zone'>;
export type AnyNode = ArchNode | ZoneNode;

const p = (id: string, label: string, type: Wire): Port => ({ id, label, type });

export const DEFS: Record<string, ArchDef & { x: number; y: number }> = {
  web: { x: 0, y: 330, title: 'Web app', kind: 'Next.js 16 · client-only SPA', zone: 'client', glyph: '▣',
    ins: [], outs: [p('rest', 'REST /api', 'http'), p('sync', 'Y.Doc sync', 'ws'), p('login', 'GitHub sign-in', 'auth')],
    about: 'Every page (projects, overview, tasks, architecture, environment) runs in the browser. It writes only the tasks map of the Y.Doc; everything else goes through REST and comes back through the doc.',
    files: ['web/lib/hive.ts', 'web/lib/auth.ts', 'web/lib/projects.ts', 'web/components/Graph.tsx'], env: [] },

  api: { x: 400, y: 0, title: 'REST API', kind: 'Express 5', zone: 'server', glyph: '⌘',
    ins: [p('rest', '/api/*', 'http')],
    outs: [p('verify', 'check token', 'auth'), p('start', 'start · steer · takeover', 'call'), p('chat', 'chat', 'call'),
      p('store', 'projects · users', 'store'), p('git', 'files · approve', 'git'), p('repo', 'create repo', 'http')],
    about: 'Every endpoint that starts work returns 202 and the result arrives through the Y.Doc. Runs each request inside its project (inProject) and verifies the Supabase token on writes.',
    files: ['server/routes.ts', 'server/auth.ts', 'server/projects.ts', 'server/settings.ts', 'server/github.ts'], env: ['PORT', 'GITHUB_TOKEN', 'GITHUB_REMOTE'] },
  rt: { x: 400, y: 560, title: 'Realtime sync', kind: 'Hocuspocus + Yjs', zone: 'server', glyph: '⟳',
    ins: [p('sync', 'websocket', 'ws'), p('write', 'serverWrite()', 'call')], outs: [p('store', 'doc every 2 s', 'store')],
    about: 'One Y.Doc per project (tasks, taskState, sessions, live, terminal, steps, chat). Browsers write tasks; the server writes the rest inside serverWrite().',
    files: ['server/index.ts', 'server/doc.ts'], env: [] },

  session: { x: 760, y: 0, title: 'Agent sessions', kind: 'Scheduler + step loop', zone: 'server', glyph: '⚙',
    ins: [p('start', 'start · steer', 'call')],
    outs: [p('llm', 'next step', 'llm'), p('doc', 'steps · state', 'call'), p('git', 'commit each write', 'git'),
      p('tests', 'run tests', 'proc'), p('search', 'search files', 'http'), p('store', 'transcripts', 'store')],
    about: 'Starts ready tasks (MAX_PARALLEL at a time), runs one agent step at a time, applies steering at the next step, pauses for takeover and resumes on handback.',
    files: ['server/session.ts', 'server/agent.ts', 'server/graph.ts'], env: ['MAX_PARALLEL', 'MAX_STEPS', 'AGENT_MODEL'] },
  planner: { x: 760, y: 560, title: 'Planner + goal check', kind: 'Chat, summaries, follow-ups', zone: 'server', glyph: '✎',
    ins: [p('chat', 'chat', 'call')],
    outs: [p('llm', 'reply / judge', 'llm'), p('doc', 'graph ops · replies', 'call'), p('shot', 'screenshot', 'proc'), p('tests', 'test main', 'proc')],
    about: 'Turns chat into graph edits or cited answers and writes hand-off summaries. When every task is done (Semi-auto / Auto) it tests main, screenshots the app and may add follow-up tasks.',
    files: ['server/planner.ts', 'server/verify.ts', 'shared/layout.ts'], env: ['PLANNER_MODEL', 'VISION_MODEL'] },

  runner: { x: 1120, y: 130, title: 'Test runner', kind: 'node --test (TAP)', zone: 'server', glyph: '✓',
    ins: [p('run', 'run', 'proc')], outs: [p('box', 'remote exec', 'http')],
    about: 'Runs agent-written tests and CLI commands with a stripped environment (PATH and HOME, no keys). With Daytona on, they run in the sandbox instead.',
    files: ['server/runner.ts'], env: [] },
  preview: { x: 1120, y: 600, title: 'Preview', kind: 'Headless Chrome / Edge', zone: 'server', glyph: '◉',
    ins: [p('shot', 'screenshot', 'proc')], outs: [p('box', 'serve in sandbox', 'http')],
    about: 'Starts src/server.js (or opens src/index.html) from main and screenshots it with the browser already on this machine, for the goal check and live task previews.',
    files: ['server/preview.ts'], env: ['CHROME_PATH'] },

  git: { x: 1500, y: 40, title: 'Git workspace', kind: 'workspace/ + worktrees/', zone: 'data', glyph: '⑂',
    ins: [p('git', 'commits · merge', 'git')], outs: [p('push', 'push main', 'git')],
    about: 'Each project has a real repo. Every task works in its own worktree on task/<id>; finished tasks merge into main under a repo lock. Agents commit as "Hive Agent", people under their own name.',
    files: ['server/workspace.ts', 'server/git.ts', 'server/workspace-template/'], env: [] },
  storage: { x: 1500, y: 560, title: 'Storage', kind: 'files', zone: 'data', glyph: '⛁',
    ins: [p('store', 'read / write', 'store')], outs: [],
    about: 'Project list, each Y.Doc, agent transcripts, users and the doc epoch. Files under data/ by default; MongoDB when MONGODB_URI is set (the git folders stay on disk either way).',
    files: ['server/store.ts', 'server/mongo.ts', 'server/paths.ts', 'server/users.ts'], env: ['MONGODB_URI', 'MONGODB_DB'] },

  llm: { x: 1880, y: 0, title: 'LLM provider', kind: '…', zone: 'external', glyph: '✦',
    ins: [p('in', 'messages', 'llm')], outs: [],
    about: 'generate() streams from an OpenAI-compatible API (Luminal), Anthropic, or the scripted fake provider. Keys stay on the server.',
    files: ['server/llm.ts'], env: ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_BASE_URL', 'ANTHROPIC_API_KEY'] },
  opencode: { x: 1880, y: 250, title: 'OpenCode', kind: 'File search server', zone: 'external', glyph: '⌕',
    ins: [p('in', 'find', 'http')], outs: [],
    about: 'The agent searches a worktree with OpenCode\'s /find endpoint (no model). Runs inside the Daytona sandbox, or locally at OPENCODE_URL.',
    files: ['server/opencode.ts'], env: ['OPENCODE_URL'] },
  daytona: { x: 1880, y: 470, title: 'Daytona sandbox', kind: 'Remote code execution', zone: 'external', glyph: '▢',
    ins: [p('in', 'exec · serve', 'http')], outs: [],
    about: 'When set, agent code, tests and previews run in a Daytona sandbox; worktree files are mirrored in before each run. Off: they run on this machine.',
    files: ['server/sandbox.ts'], env: ['DAYTONA_API_KEY', 'DAYTONA_API_URL', 'DAYTONA_TARGET'] },
  github: { x: 1880, y: 690, title: 'GitHub', kind: 'Repos + push', zone: 'external', glyph: '⌥',
    ins: [p('push', 'push', 'git'), p('repo', 'create repo', 'http')], outs: [],
    about: 'New projects get a private repo; Approve tests main and pushes it with the approver\'s own GitHub token (or GITHUB_TOKEN).',
    files: ['server/github.ts'], env: ['GITHUB_TOKEN', 'GITHUB_REMOTE'] },
  supabase: { x: 1880, y: 930, title: 'Supabase Auth', kind: 'GitHub OAuth + approvals', zone: 'external', glyph: '⚿',
    ins: [p('login', 'OAuth', 'auth'), p('verify', 'verify token', 'auth')], outs: [],
    about: 'Used only for sign-in and the approved flag in public.profiles. Off: no sign-in, names come from ?name=.',
    files: ['server/auth.ts', 'server/supabase-approvals.sql', 'web/lib/auth.ts'], env: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] },
};

const e = (source: string, sh: string, target: string, th: string): Edge => ({
  id: `${source}.${sh}->${target}.${th}`, source, target, sourceHandle: sh, targetHandle: th,
});

export const EDGES: Edge[] = [
  e('web', 'rest', 'api', 'rest'),
  e('web', 'sync', 'rt', 'sync'),
  e('web', 'login', 'supabase', 'login'),
  e('api', 'verify', 'supabase', 'verify'),
  e('api', 'start', 'session', 'start'),
  e('api', 'chat', 'planner', 'chat'),
  e('api', 'store', 'storage', 'store'),
  e('api', 'git', 'git', 'git'),
  e('api', 'repo', 'github', 'repo'),
  e('rt', 'store', 'storage', 'store'),
  e('session', 'llm', 'llm', 'in'),
  e('session', 'doc', 'rt', 'write'),
  e('session', 'git', 'git', 'git'),
  e('session', 'tests', 'runner', 'run'),
  e('session', 'search', 'opencode', 'in'),
  e('session', 'store', 'storage', 'store'),
  e('planner', 'llm', 'llm', 'in'),
  e('planner', 'doc', 'rt', 'write'),
  e('planner', 'shot', 'preview', 'shot'),
  e('planner', 'tests', 'runner', 'run'),
  e('runner', 'box', 'daytona', 'in'),
  e('preview', 'box', 'daytona', 'in'),
  e('git', 'push', 'github', 'push'),
];

export const ZONE_BOXES: { zone: Zone; x: number; y: number; w: number; h: number }[] = [
  { zone: 'client', x: -40, y: -70, w: 340, h: 1240 },
  { zone: 'server', x: 360, y: -70, w: 1060, h: 1240 },
  { zone: 'data', x: 1460, y: -70, w: 340, h: 1240 },
  { zone: 'external', x: 1840, y: -70, w: 340, h: 1240 },
];

const zoneNodes = (): ZoneNode[] => ZONE_BOXES.map(({ zone, x, y, w, h }) => ({
  id: `zone-${zone}`, type: 'zone', position: { x, y }, data: ZONES[zone],
  style: { width: w, height: h }, draggable: false, selectable: false, zIndex: -1,
}));

// Starting layout; each arch node's data is replaced by the live view when rendered.
export const initialNodes = (): AnyNode[] => [
  ...zoneNodes(),
  ...Object.entries(DEFS).map(([id, { x, y, ...d }]): ArchNode => ({ id, type: 'arch', position: { x, y }, data: { ...d, health: 'wait', widgets: [] } })),
];

// Session memory so switching pages keeps the layout.
export const saved: { nodes: AnyNode[] | null } = { nodes: null };

export interface LiveInputs {
  health: ServerHealth | null;
  env: EnvStatus | null;
  reachable: boolean | null;
  socket: string;          // this tab's Hocuspocus status
  me: string;
  online: number;          // people on this project, including me
  project: string;
  server: string;          // host:port of the API
}

// Each node's status and numbers, from what the server reports right now.
export function liveData(id: string, s: LiveInputs): Live {
  const set = (n: string) => isSet(s.env, n);
  const up: Health = s.reachable === null ? 'wait' : s.reachable ? 'live' : 'down';
  const h = s.health;
  const sandbox = set('DAYTONA_API_KEY');
  const or = (v: string | undefined, d = '—') => v || d;
  switch (id) {
    case 'web': return { health: 'live', widgets: [['you', s.me], ['online', String(s.online)], ['server', s.server]] };
    case 'api': return { health: up, widgets: [['address', s.server], ['projects', h ? String(h.projects) : '—'], ['sign-in', h ? (h.auth ? 'required' : 'off (?name=)') : '—']] };
    case 'rt': return { health: s.socket === 'connected' ? 'live' : s.reachable === false ? 'down' : 'wait',
      widgets: [['this tab', s.socket], ['doc', or(s.project, 'none open')], ['saved', set('MONGODB_URI') ? 'MongoDB · 2 s' : 'doc.bin · 2 s']] };
    case 'session': return { health: up, widgets: [['agent', or(h?.models.agent)], ['parallel', set('MAX_PARALLEL') ? 'from .env' : '2'], ['max steps', set('MAX_STEPS') ? 'from .env' : '20']] };
    case 'planner': return { health: up, widgets: [['model', or(h?.models.planner)], ['vision', set('VISION_MODEL') ? 'VISION_MODEL' : h?.provider === 'anthropic' ? 'planner' : 'text only']] };
    case 'runner': return { health: up, widgets: [['runs on', sandbox ? 'Daytona' : 'this machine'], ['env', 'PATH + HOME only']] };
    case 'preview': return { health: up, widgets: [['browser', sandbox ? 'in sandbox' : set('CHROME_PATH') ? 'CHROME_PATH' : 'auto-detected']] };
    case 'git': return { health: up, widgets: [['main', 'workspace/'], ['tasks', 'worktrees/<id> · task/<id>']] };
    case 'storage': {
      const mongo = set('MONGODB_URI');
      return { health: up, kind: mongo ? 'MongoDB' : 'Files under data/', widgets: [['backend', mongo ? 'MongoDB' : 'data/ files'], ['transcripts', mongo ? 'sessions collection' : 'sessions/<sid>.json']] };
    }
    case 'llm': {
      if (!h) return { health: s.reachable === false ? 'down' : 'wait', widgets: [['provider', '—']] };
      const kind = h.provider === 'anthropic' ? 'Anthropic' : h.provider === 'fake' ? 'Fake (scripted, no network)' : 'OpenAI-compatible (Luminal)';
      const keyed = h.provider === 'fake' || (h.provider === 'anthropic' ? set('ANTHROPIC_API_KEY') : set('LLM_API_KEY') && set('LLM_BASE_URL'));
      return { health: h.provider === 'fake' ? 'mock' : keyed && h.models.agent ? 'live' : 'down', kind,
        widgets: [['provider', h.provider], ['agent', or(h.models.agent)], ['planner', or(h.models.planner)]] };
    }
    case 'opencode': return { health: !s.env ? 'wait' : sandbox || set('OPENCODE_URL') ? 'live' : 'off', widgets: [['where', sandbox ? 'in sandbox' : set('OPENCODE_URL') ? 'OPENCODE_URL' : 'not set']] };
    case 'daytona': return { health: !s.env ? 'wait' : sandbox ? 'live' : 'off', widgets: [['status', sandbox ? 'agent code runs here' : 'off: runs locally']] };
    case 'github': {
      const on = !!h?.auth || set('GITHUB_TOKEN');
      return { health: !h ? 'wait' : on ? 'live' : 'off', widgets: [['push token', h?.auth ? 'approver\'s own' : set('GITHUB_TOKEN') ? 'GITHUB_TOKEN' : 'none: local merge']] };
    }
    case 'supabase': return { health: !h ? 'wait' : h.auth ? 'live' : 'off', widgets: [['sign-in', h?.auth ? 'GitHub OAuth' : 'off']] };
  }
  return { health: 'wait', widgets: [] };
}

export function portType(data: ArchData | undefined, handle: string | null | undefined, side: 'ins' | 'outs'): Wire | undefined {
  if (!data || !handle) return undefined;
  return data[side].find((x) => x.id === handle)?.type;
}
