import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DATA_DIR } from './paths.ts';
import { listFiles } from './workspace.ts';

// Agent-written code runs in a Daytona sandbox instead of on this machine (plain REST, no SDK).
// The git worktree here stays the source of truth; before each run its files are mirrored into the sandbox.
export const sandboxOn = () => !!process.env.DAYTONA_API_KEY?.trim();
const api = () => (process.env.DAYTONA_API_URL?.trim() || 'https://app.daytona.io/api').replace(/\/+$/, '');

interface Box {
  id: string;
  toolbox: string;                              // toolbox URL for this sandbox
  root: string;                                 // folder in the sandbox holding one mirror per worktree
  synced: Map<string, Map<string, string>>;     // mirror name -> path -> content already uploaded
  openCode: Promise<void>;                      // settles when the OpenCode server inside is up
  servers: Map<string, Served>;                 // mirror folder -> its web app's server (sandboxServe)
  nextPort: number;
}
interface Served { rev: string; up: Promise<{ port: number; pid: string }>; url: string; until: number }
let box: Promise<Box> | null = null;
const OPENCODE_PORT = 4096;

async function call(url: string, init: RequestInit = {}, ms = 30000, allow = 0): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.DAYTONA_API_KEY!.trim()}`, ...init.headers },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok && res.status !== allow) throw new Error(`Daytona HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

interface Exec { exitCode: number; output: string }
async function exec(b: Pick<Box, 'toolbox'>, command: string, cwd?: string, timeout = 10): Promise<Exec> {
  const res = await call(`${b.toolbox}/process/execute`, post({ command, cwd, timeout }), (timeout + 15) * 1000, 408);
  if (res.status === 408) return { exitCode: 124, output: `Timed out after ${timeout} s` };
  const r = (await res.json()) as { exitCode?: number; result?: string };
  return { exitCode: r.exitCode ?? 0, output: r.result ?? '' };
}

interface Info { id: string; state: string; toolboxProxyUrl?: string; errorReason?: string }
async function create(): Promise<Box> {
  const started = Date.now();
  // Stops after 30 idle minutes and is deleted when stopped, so a crashed server leaves nothing running.
  const body = { labels: { app: 'hive' }, autoStopInterval: 30, autoDeleteInterval: 0, target: process.env.DAYTONA_TARGET?.trim() || undefined };
  let sb = (await (await call(`${api()}/sandbox`, post(body), 120000)).json()) as Info;
  for (let i = 0; sb.state !== 'started'; i++) {
    if (['error', 'build_failed', 'destroyed', 'destroying'].includes(sb.state) || i >= 90) {
      void call(`${api()}/sandbox/${sb.id}`, { method: 'DELETE' }).catch(() => {});
      throw new Error(`Sandbox is ${sb.state}${sb.errorReason ? `: ${sb.errorReason}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    sb = (await (await call(`${api()}/sandbox/${sb.id}`)).json()) as Info;
  }
  const proxy = sb.toolboxProxyUrl
    ?? ((await (await call(`${api()}/sandbox/${sb.id}/toolbox-proxy-url`)).json()) as { url: string }).url;
  const toolbox = `${proxy.replace(/\/+$/, '')}/${sb.id}`;
  const home = (await exec({ toolbox }, 'pwd')).output.trim();
  const node = await exec({ toolbox }, 'node --version');
  if (node.exitCode !== 0) throw new Error('The sandbox image has no node');
  console.log(`Sandbox ${sb.id} ready in ${Math.round((Date.now() - started) / 1000)} s (node ${node.output.trim()})`);
  const openCode = startOpenCode(toolbox, home);
  openCode.catch((e) => console.error(`No search in the sandbox: ${(e as Error).message}`));
  return { id: sb.id, toolbox, root: `${home}/hive`, synced: new Map(), openCode, servers: new Map(), nextPort: 3001 };
}

// An OpenCode server in the sandbox lets the agent search the mirrored files (see opencode.ts). The image's own
// copy is old and breaks on patterns with spaces or brackets, so a current one is installed; it is the fallback.
async function startOpenCode(toolbox: string, home: string) {
  const dir = `${home}/.hive-opencode`;
  const npm = await exec({ toolbox }, `npm i --no-audit --no-fund --prefix ${dir} opencode-ai`, undefined, 120).catch(() => null);
  const bin = npm?.exitCode === 0 ? `${dir}/node_modules/.bin/opencode` : 'opencode';
  await exec({ toolbox }, `sh -c "nohup ${bin} serve --port ${OPENCODE_PORT} > /tmp/opencode.log 2>&1 &"`);
  for (let i = 0; i < 30; i++) {
    const up = await exec({ toolbox }, `curl -s -m 2 http://127.0.0.1:${OPENCODE_PORT}/global/health`).catch(() => null);
    if (up?.output.includes('healthy')) return void console.log(`OpenCode in the sandbox: ${up.output.trim()}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('OpenCode did not start in the sandbox');
}

const getBox = () => (box ??= create().catch((e) => { box = null; throw e; }));

// Start the sandbox ahead of the first test run.
export function warmSandbox() {
  if (sandboxOn()) getBox().catch((e) => console.error(`Sandbox not ready: ${(e as Error).message}`));
}

export async function disposeSandbox() {
  const b = await box?.catch(() => null);
  box = null;
  if (b) await call(`${api()}/sandbox/${b.id}`, { method: 'DELETE' }, 5000).catch(() => {});
}

// Mirror package.json, src/ and test/ of a local worktree into the sandbox; only changed files are sent.
async function sync(b: Box, dir: string): Promise<string> {
  const name = relative(DATA_DIR, dir).replace(/[^\w.-]+/g, '_');   // projects_<project>_worktrees_<task>
  const remote = `${b.root}/${name}`;
  const have = b.synced.get(name) ?? new Map<string, string>();
  b.synced.set(name, have);
  const files = ['package.json', ...(existsSync(join(dir, 'package-lock.json')) ? ['package-lock.json'] : []), ...listFiles(dir)];
  const pkgBefore = have.get('package.json');
  const changed = files.map((rel) => ({ rel, content: readFileSync(join(dir, rel), 'utf8') })).filter((f) => have.get(f.rel) !== f.content);
  if (changed.length > 3) {
    // Many files (a fresh task, a merge from main): one gzipped tar and one extract instead of a request per file.
    const archive = `${b.root}/.sync-${name}.tgz`;
    await call(`${b.toolbox}/files/upload-v2?path=${encodeURIComponent(archive)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: gzipSync(tar(changed.map((f) => ({ path: f.rel, content: f.content })))) });
    const r = await exec(b, `sh -c 'mkdir -p "${remote}" && tar xzf "${archive}" -C "${remote}" && rm -f "${archive}"'`, undefined, 60);
    if (r.exitCode !== 0) throw new Error(`could not unpack files in the sandbox: ${r.output.slice(0, 200)}`);
  } else {
    await Promise.all(changed.map((f) => call(`${b.toolbox}/files/upload-v2?path=${encodeURIComponent(`${remote}/${f.rel}`)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f.content })));
  }
  for (const f of changed) have.set(f.rel, f.content);
  for (const rel of [...have.keys()].filter((r) => !files.includes(r))) {
    await call(`${b.toolbox}/files?path=${encodeURIComponent(`${remote}/${rel}`)}`, { method: 'DELETE' }).catch(() => {});
    have.delete(rel);
  }
  // Dependencies changed: install them in the sandbox too (never running install scripts).
  const pkg = have.get('package.json') ?? '';
  if (pkg !== pkgBefore && /"(dev)?[dD]ependencies"\s*:\s*\{\s*"/.test(pkg)) {
    await exec(b, 'npm install --ignore-scripts --no-audit --no-fund --loglevel=error', remote, 180);
  }
  return remote;
}

// Run a command in the sandbox's mirror of `dir`. A sandbox that has gone away is replaced once.
export async function sandboxExec(dir: string, command: string, timeout: number): Promise<Exec> {
  for (let attempt = 0; ; attempt++) {
    try {
      const b = await getBox();
      return await exec(b, command, await sync(b, dir), timeout);
    } catch (e) {
      if (attempt) throw e;
      console.error(`Sandbox call failed, starting a new one: ${(e as Error).message}`);
      void disposeSandbox();
    }
  }
}

// Ask the OpenCode server inside the sandbox for a path such as `/find?pattern=x`, scoped to the mirror of `dir`.
export async function sandboxOpenCode(dir: string, path: string, query: Record<string, string>): Promise<unknown> {
  const b = await getBox();
  await b.openCode;
  const params = new URLSearchParams({ ...query, directory: await sync(b, dir) });
  const r = await exec(b, `curl -s -m 8 "http://127.0.0.1:${OPENCODE_PORT}${path}?${params.toString().replace(/[^\w%&=.+*-]/g, '')}"`, undefined, 15);
  return JSON.parse(r.output);
}

// A web app's own server in the sandbox: `node src/server.js` with its own PORT in the mirror of `dir`, restarted
// when `rev` (the worktree's commit) changes. Returns a signed preview URL that works in an iframe for an hour.
export async function sandboxServe(dir: string, rev: string): Promise<string> {
  const b = await getBox();
  const remote = await sync(b, dir);
  let s = b.servers.get(remote);
  if (!s || s.rev !== rev) {
    const old = s;
    const port = b.nextPort++;
    s = { rev, url: '', until: 0, up: (async () => {
      const prev = await old?.up.catch(() => null);
      if (prev) await exec(b, `kill ${prev.pid}`).catch(() => {});
      const log = `/tmp/hive-${port}.log`;
      const pid = (await exec(b, `sh -c 'cd ${remote} && PORT=${port} nohup node src/server.js > ${log} 2>&1 & echo $!'`)).output.trim();
      if (!/^\d+$/.test(pid)) throw new Error(`could not start src/server.js: ${pid.slice(0, 200)}`);
      for (let i = 0; i < 20; i++) {
        const code = await exec(b, `curl -s -o /dev/null -m 1 -w %{http_code} http://127.0.0.1:${port}/`).catch(() => null);
        if (code && /^[1-5]\d\d$/.test(code.output.trim())) return { port, pid };
        await new Promise((r) => setTimeout(r, 500));
      }
      const tail = (await exec(b, `tail -c 600 ${log}`).catch(() => null))?.output.trim();
      await exec(b, `kill ${pid}`).catch(() => {});
      throw new Error(`src/server.js did not answer on PORT within 10 s${tail ? `:\n${tail}` : ''}`);
    })() };
    b.servers.set(remote, s);
    s.up.catch(() => { if (b.servers.get(remote) === s) b.servers.delete(remote); });
  }
  const { port } = await s.up;
  if (Date.now() > s.until) {
    const r = await call(`${api()}/sandbox/${b.id}/ports/${port}/signed-preview-url?expiresInSeconds=3600`);
    s.url = ((await r.json()) as { url: string }).url;
    s.until = Date.now() + 50 * 60 * 1000;
  }
  return s.url;
}

// A plain ustar archive of text files (no dependency): a 512-byte header per file, the content padded to 512 bytes,
// then two empty blocks. Long paths use the ustar prefix field.
export function tar(files: { path: string; content: string }[]): Buffer {
  const blocks: Buffer[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const f of files) {
    const body = Buffer.from(f.content, 'utf8');
    const h = Buffer.alloc(512);
    let name = f.path;
    let prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const cut = name.lastIndexOf('/', name.length - 1 - Math.max(0, Buffer.byteLength(name) - 100 - 1));
      prefix = name.slice(0, cut);
      name = name.slice(cut + 1);
    }
    const put = (text: string, at: number, len: number) => h.write(text, at, len, 'utf8');
    const oct = (n: number, len: number) => `${n.toString(8).padStart(len - 1, '0')}\0`;
    put(name, 0, 100);
    put(oct(0o644, 8), 100, 8);
    put(oct(0, 8), 108, 8);
    put(oct(0, 8), 116, 8);
    put(oct(body.length, 12), 124, 12);
    put(oct(now, 12), 136, 12);
    put('        ', 148, 8);
    put('0', 156, 1);
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    put(prefix, 345, 155);
    let sum = 0;
    for (const byte of h) sum += byte;
    put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
