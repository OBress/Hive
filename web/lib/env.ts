// The variables Hive's server reads, by name only. Secret VALUES never reach the browser:
// the Environment page shows set/missing from GET /api/env and can set a value with POST /api/env
// (write-only, accepted only from the machine running the server; most need a server restart).

export type EnvKind = 'secret' | 'config';

export interface EnvVar {
  name: string;
  kind: EnvKind;
  usedBy: string[];
  about: string;
  example?: string;            // non-secret default, as in .env.example
  source: 'env.example' | 'spec';
}

export const ENV_VARS: EnvVar[] = [
  { name: 'LLM_PROVIDER', kind: 'config', usedBy: ['Agents', 'Planner'], source: 'env.example', example: 'openai',
    about: 'openai = any OpenAI-compatible API (Luminal), anthropic, or fake (scripted agents, no key).' },
  { name: 'LLM_API_KEY', kind: 'secret', usedBy: ['Agents', 'Planner'], source: 'env.example',
    about: 'Luminal API key. Only the server reads it; never sent to web/, logs or the doc.' },
  { name: 'LLM_BASE_URL', kind: 'config', usedBy: ['Agents', 'Planner'], source: 'env.example', example: 'https://<host>/v1',
    about: 'Luminal API address. Only editable from the machine running the server.' },
  { name: 'AGENT_MODEL', kind: 'config', usedBy: ['Agents'], source: 'env.example',
    about: 'Blank: the server picks a DeepSeek model from the provider\'s model list.' },
  { name: 'PLANNER_MODEL', kind: 'config', usedBy: ['Planner'], source: 'env.example',
    about: 'Blank: a fast GLM Flash model for chat, catch-up answers and hand-off summaries.' },
  { name: 'ANTHROPIC_API_KEY', kind: 'secret', usedBy: ['Agents', 'Planner'], source: 'env.example',
    about: 'Only for LLM_PROVIDER=anthropic.' },
  { name: 'MAX_PARALLEL', kind: 'config', usedBy: ['Scheduler'], source: 'env.example', example: '2',
    about: 'Agents running at once.' },
  { name: 'MAX_STEPS', kind: 'config', usedBy: ['Agents'], source: 'env.example', example: '20',
    about: 'Steps per run before an agent pauses.' },
  { name: 'GITHUB_REMOTE', kind: 'config', usedBy: ['Push'], source: 'env.example',
    about: 'https://github.com/<owner>/<repo>.git. The repo connected on Overview takes precedence.' },
  { name: 'GITHUB_TOKEN', kind: 'secret', usedBy: ['Push'], source: 'env.example',
    about: 'Fallback push token (fine-grained, Contents read/write). Signed-in approvers push with their own GitHub token.' },
  { name: 'SUPABASE_URL', kind: 'config', usedBy: ['Sign-in'], source: 'env.example',
    about: 'Supabase project URL. Blank turns sign-in off.' },
  { name: 'SUPABASE_ANON_KEY', kind: 'config', usedBy: ['Sign-in'], source: 'env.example',
    about: 'The project\'s anon (public) key; the browser gets it from the server.' },
  { name: 'MONGODB_URI', kind: 'secret', usedBy: ['History'], source: 'env.example',
    about: 'Optional MongoDB mirror of steps and chat. Blank = off.' },
  { name: 'PORT', kind: 'config', usedBy: ['Server'], source: 'env.example', example: '4000',
    about: 'Express + Hocuspocus port.' },
];

export type EnvStatus = Record<string, { set: boolean }>;

// .env template text: names, non-secret defaults, empty secrets.
export function envTemplate(vars: EnvVar[]): string {
  return vars.map((v) => `${v.name}=${v.kind === 'secret' ? '' : v.example ?? ''}`).join('\n');
}
