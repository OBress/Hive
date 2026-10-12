import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request } from 'express';
import { authEnabled, githubTokensByLogin } from './auth.ts';
import { HttpError } from './doc.ts';
import { DATA_DIR, SERVER_DIR } from './paths.ts';
import { current } from './projects.ts';
import { epochDb, storageOn, setEpochDb } from './store.ts';

const EPOCH_FILE = join(DATA_DIR, 'epoch.txt');
const ENV_FILE = join(SERVER_DIR, '..', '.env');

// The doc's epoch changes on every fresh start (first run or `pnpm reset`). Browser tabs send the epoch
// they loaded with; a tab from an older epoch is refused instead of merging its stale doc into the new one.
let epoch = '';
export const getEpoch = () => epoch;
export async function initEpoch(freshDoc: boolean) {
  if (storageOn()) {   // kept across redeploys; a new one only for a brand-new database
    epoch = (await epochDb()) ?? randomUUID();
    await setEpochDb(epoch);
    return;
  }
  if (freshDoc || !existsSync(EPOCH_FILE)) writeFileSync(EPOCH_FILE, randomUUID());
  epoch = readFileSync(EPOCH_FILE, 'utf8').trim();
}

// The current project's push target: its own repo (created with it, or set on Overview as owner/repo), else none.
// Never a server-wide fallback: a project without a repo must not restore from or push to someone else's
// (a shared GITHUB_REMOTE once seeded a new project with Hive's own source).
export function pushRemote(): string {
  const repo = current()?.repo;
  if (!repo) return '';
  // owner/repo from the API; tests set a local bare repo path directly.
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}.git` : repo;
}

// A token that can push the current project's repo without a request: a signed-in member's (owner first), else GITHUB_TOKEN.
export function projectToken(): string | undefined {
  const p = current();
  for (const login of p ? [p.createdBy, ...p.sharedWith] : []) {
    const t = githubTokensByLogin.get(login.toLowerCase());
    if (t) return t;
  }
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

// Every variable the server reads (names only ever leave the server, never values).
export const ENV_NAMES = [
  'LLM_PROVIDER', 'LLM_API_KEY', 'LLM_BASE_URL', 'AGENT_MODEL', 'PLANNER_MODEL', 'ANTHROPIC_API_KEY',
  'MAX_PARALLEL', 'MAX_STEPS', 'GITHUB_TOKEN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PORT',
  'DAYTONA_API_KEY', 'DAYTONA_API_URL', 'DAYTONA_TARGET', 'OPENCODE_URL', 'CHROME_PATH', 'VISION_MODEL',
  'AGENT_MAX_TOKENS', 'AGENT_CONTEXT_CHARS', 'LLM_EXTRA_BODY', 'LLM_CONCURRENCY', 'TEST_TIMEOUT_S', 'REVIEW', 'NPM_ALLOW', 'AGENT_VISION',
];
// Read per request; the rest need a restart.
const LIVE = new Set(['GITHUB_TOKEN', 'AGENT_MAX_TOKENS', 'AGENT_CONTEXT_CHARS', 'REVIEW', 'NPM_ALLOW']);

// Only the machine running the server may change .env: a LAN visitor who could set LLM_BASE_URL could capture the key.
const isLocal = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

function writeEnv(name: string, value: string) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (i >= 0) lines[i] = `${name}=${value}`;
  else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
  writeFileSync(ENV_FILE, lines.join('\n'));
  process.env[name] = value;
}

export const settings = Router();

// What the browser needs before it connects. The Supabase anon key is public by design.
settings.get('/config', (_req, res) => {
  res.json({
    auth: authEnabled(),
    supabaseUrl: authEnabled() ? process.env.SUPABASE_URL?.trim() : undefined,
    supabaseAnonKey: authEnabled() ? process.env.SUPABASE_ANON_KEY?.trim() : undefined,
    epoch,
  });
});

settings.get('/env', (_req, res) => {
  res.json(Object.fromEntries(ENV_NAMES.map((n) => [n, { set: !!process.env[n]?.trim() }])));
});

settings.post('/env', (req, res) => {
  if (!isLocal(req)) throw new HttpError(403, 'Env changes are only accepted on the machine running the server');
  const { name, value } = (req.body ?? {}) as { name?: unknown; value?: unknown };
  if (typeof name !== 'string' || !ENV_NAMES.includes(name)) throw new HttpError(400, 'Unknown variable');
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new HttpError(400, 'value must be one line of text');
  writeEnv(name, value.trim());
  console.log(`.env: ${name} updated`);
  res.json({ ok: true, restartNeeded: !LIVE.has(name) });
});
