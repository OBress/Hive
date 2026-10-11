import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Request } from 'express';
import { authEnabled } from './auth.ts';
import { HttpError } from './doc.ts';
import { DATA_DIR, SERVER_DIR } from './paths.ts';

const EPOCH_FILE = join(DATA_DIR, 'epoch.txt');
const REPO_FILE = join(DATA_DIR, 'repo.json');
const ENV_FILE = join(SERVER_DIR, '..', '.env');

// The doc's epoch changes on every fresh seed (first run or `pnpm reset`). Browser tabs send the epoch
// they loaded with; a tab from an older epoch is refused instead of merging its stale doc into the new one.
let epoch = '';
export const getEpoch = () => epoch;
export function initEpoch(freshDoc: boolean) {
  if (freshDoc || !existsSync(EPOCH_FILE)) writeFileSync(EPOCH_FILE, randomUUID());
  epoch = readFileSync(EPOCH_FILE, 'utf8').trim();
}

// Push target: set from the Overview page (owner/repo), else GITHUB_REMOTE.
function storedRepo(): string | null {
  try { return (JSON.parse(readFileSync(REPO_FILE, 'utf8')) as { repo: string | null }).repo; } catch { return null; }
}
export function pushRemote(): string {
  const repo = storedRepo();
  return repo ? `https://github.com/${repo}.git` : process.env.GITHUB_REMOTE?.trim() ?? '';
}
const repoName = () => /github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(pushRemote())?.[1] ?? null;

// Every variable the server reads (names only ever leave the server, never values).
export const ENV_NAMES = [
  'LLM_PROVIDER', 'LLM_API_KEY', 'LLM_BASE_URL', 'AGENT_MODEL', 'PLANNER_MODEL', 'ANTHROPIC_API_KEY',
  'MAX_PARALLEL', 'MAX_STEPS', 'GITHUB_REMOTE', 'GITHUB_TOKEN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'MONGODB_URI', 'PORT',
  'DAYTONA_API_KEY', 'DAYTONA_API_URL', 'DAYTONA_TARGET', 'OPENCODE_URL',
];
const LIVE = new Set(['GITHUB_REMOTE', 'GITHUB_TOKEN']);   // read per request; the rest need a restart

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
    repo: repoName(),
  });
});

settings.post('/repo', (req, res) => {
  const repo = req.body?.repo;
  if (repo !== null && !(typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo.trim()))) {
    throw new HttpError(400, 'repo must be "owner/repo" or null');
  }
  writeFileSync(REPO_FILE, JSON.stringify({ repo: repo?.trim() ?? null }));
  res.json({ repo: repoName() });
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
