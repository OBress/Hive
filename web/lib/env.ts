// The variables Hive's server reads (server/settings.ts ENV_NAMES), by name only. Secret VALUES never reach
// the browser: the Environment page shows set/unset from GET /api/env and can set a value with POST /api/env
// (write-only, accepted only from the machine running the server; most need a server restart).

import type { EnvStatus, ServerHealth } from './system';

export type EnvKind = 'secret' | 'config';

export interface EnvVar {
  name: string;
  kind: EnvKind;
  group: string;
  about: string;
  example?: string;            // non-secret default, as in .env.example
}

export const ENV_GROUPS = ['Model', 'Limits', 'GitHub', 'Sign-in', 'Storage', 'Sandbox', 'Goal check', 'Server'] as const;

export const ENV_VARS: EnvVar[] = [
  { name: 'LLM_PROVIDER', kind: 'config', group: 'Model', example: 'openai', about: 'openai (any OpenAI-compatible API, e.g. Luminal), anthropic, or fake (scripted, no key).' },
  { name: 'LLM_API_KEY', kind: 'secret', group: 'Model', about: 'Key for the OpenAI-compatible provider.' },
  { name: 'LLM_BASE_URL', kind: 'config', group: 'Model', example: 'https://<host>/v1', about: 'OpenAI-compatible API address.' },
  { name: 'AGENT_MODEL', kind: 'config', group: 'Model', about: 'Blank: a DeepSeek model from the provider\'s list (Sonnet with anthropic).' },
  { name: 'PLANNER_MODEL', kind: 'config', group: 'Model', about: 'Blank: a fast GLM Flash model (Haiku with anthropic).' },
  { name: 'ANTHROPIC_API_KEY', kind: 'secret', group: 'Model', about: 'Only for LLM_PROVIDER=anthropic.' },
  { name: 'MAX_PARALLEL', kind: 'config', group: 'Limits', example: '2', about: 'Agents running at once.' },
  { name: 'MAX_STEPS', kind: 'config', group: 'Limits', example: '20', about: 'Steps per session before an agent pauses.' },
  { name: 'GITHUB_REMOTE', kind: 'config', group: 'GitHub', about: 'Fallback push target; a project\'s own repo wins.' },
  { name: 'GITHUB_TOKEN', kind: 'secret', group: 'GitHub', about: 'Fallback push token; signed-in people push with their own.' },
  { name: 'SUPABASE_URL', kind: 'config', group: 'Sign-in', about: 'Supabase project URL. Blank turns sign-in off.' },
  { name: 'SUPABASE_ANON_KEY', kind: 'config', group: 'Sign-in', about: 'Public anon key; the browser gets it from /api/config.' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', kind: 'secret', group: 'Storage', about: 'Blank: files under data/. Set: projects, docs and history in Supabase (run server/supabase.sql first).' },
  { name: 'DAYTONA_API_KEY', kind: 'secret', group: 'Sandbox', about: 'Set: agent code and tests run in a Daytona sandbox.' },
  { name: 'DAYTONA_API_URL', kind: 'config', group: 'Sandbox', about: 'Blank: https://app.daytona.io/api.' },
  { name: 'DAYTONA_TARGET', kind: 'config', group: 'Sandbox', about: 'Blank: the account\'s default region.' },
  { name: 'OPENCODE_URL', kind: 'config', group: 'Sandbox', about: 'Local OpenCode server for file search (not needed with Daytona).' },
  { name: 'CHROME_PATH', kind: 'config', group: 'Goal check', about: 'Blank: Chrome or Edge found in the usual places.' },
  { name: 'VISION_MODEL', kind: 'config', group: 'Goal check', about: 'A model that can read screenshots (the anthropic planner already can).' },
  { name: 'PORT', kind: 'config', group: 'Server', example: '4000', about: 'Express + Hocuspocus port.' },
];

// Variables the server can't work without, given the provider it is running with.
export function needed(v: EnvVar, health: ServerHealth | null): boolean {
  const p = health?.provider;
  if (p === 'openai') return v.name === 'LLM_API_KEY' || v.name === 'LLM_BASE_URL';
  if (p === 'anthropic') return v.name === 'ANTHROPIC_API_KEY';
  return false;
}

// Every name the server reports, in the order above; any new server name we don't describe yet goes last.
export function allVars(status: EnvStatus | null): EnvVar[] {
  const known = new Set(ENV_VARS.map((v) => v.name));
  const extra = Object.keys(status ?? {}).filter((n) => !known.has(n))
    .map((name): EnvVar => ({ name, kind: /KEY|TOKEN|SECRET|PASSWORD|URI/.test(name) ? 'secret' : 'config', group: 'Server', about: 'Read by the server.' }));
  return [...ENV_VARS, ...extra];
}

// .env template text: names, non-secret defaults, empty secrets.
export function envTemplate(vars: EnvVar[]): string {
  return vars.map((v) => `${v.name}=${v.kind === 'secret' ? '' : v.example ?? ''}`).join('\n');
}
