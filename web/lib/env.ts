// The variables Hive's server reads, by name only. Secret VALUES never reach the browser:
// the Environment page can set or rotate a value (POST /api/env, write-only) and shows
// set/missing status from GET /api/env once the server implements them.

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
  { name: 'ANTHROPIC_API_KEY', kind: 'secret', usedBy: ['Planner', 'Builder'], source: 'env.example',
    about: 'Claude API key. Only the server reads it; never sent to web/, logs or the doc.' },
  { name: 'GITHUB_TOKEN', kind: 'secret', usedBy: ['Push'], source: 'spec',
    about: 'Token that can push to the demo repo. Used only by “Approve & push”.' },
  { name: 'GITHUB_REMOTE', kind: 'config', usedBy: ['Push'], source: 'spec',
    about: 'owner/repo that main is pushed to.' },
  { name: 'PLANNER_MODEL', kind: 'config', usedBy: ['Planner'], source: 'spec', example: 'claude-haiku-5-5',
    about: 'Model for chat → graph ops and answers. Fast model while building.' },
  { name: 'BUILDER_MODEL', kind: 'config', usedBy: ['Builder'], source: 'spec', example: 'claude-haiku-5-5',
    about: 'Model that writes code per task. Switch to the stronger model for final rehearsals.' },
  { name: 'DESIGN_MODEL', kind: 'config', usedBy: ['Legacy'], source: 'env.example', example: 'claude-haiku-5-5',
    about: 'From the landing-page build. Unused by the task-graph spec.' },
  { name: 'ENGINEERING_MODEL', kind: 'config', usedBy: ['Legacy'], source: 'env.example', example: 'claude-haiku-5-5',
    about: 'From the landing-page build. Superseded by BUILDER_MODEL.' },
  { name: 'ASK_MODEL', kind: 'config', usedBy: ['Legacy'], source: 'env.example', example: 'claude-haiku-5-5',
    about: 'From the landing-page build. Superseded by PLANNER_MODEL.' },
  { name: 'PORT', kind: 'config', usedBy: ['Server'], source: 'env.example', example: '4000',
    about: 'Express + Hocuspocus port.' },
];

export type EnvStatus = Record<string, { set: boolean }>;

// .env template text: names, non-secret defaults, empty secrets.
export function envTemplate(vars: EnvVar[]): string {
  return vars.map((v) => `${v.name}=${v.kind === 'secret' ? '' : v.example ?? ''}`).join('\n');
}
