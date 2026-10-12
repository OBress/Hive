import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDeps } from './packages.ts';
import { minimalEnv } from './runner.ts';
import type { Preview } from '@hive/shared/types';
import { sandboxOn, sandboxServe } from './sandbox.ts';
import { head } from './workspace.ts';

// A screenshot of what main builds, for the goal check: `node src/server.js` (it reads PORT) or src/index.html,
// opened in the Chrome or Edge already on this machine (headless; CHROME_PATH overrides). No new dependencies.
// Agent code runs here with no secrets, the same as its tests; with a Daytona sandbox on, it is skipped.

const CANDIDATES = [
  process.env.CHROME_PATH?.trim() ?? '',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
export const findChrome = () => CANDIDATES.find((p) => p && existsSync(p)) ?? null;

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});

async function waitForHttp(url: string, ms: number, alive = () => true): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end && alive()) {
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); return true; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return false;
}

// `console`: what the page logged (console.* and uncaught errors), from Chrome's own log.
export type Shot = { ok: true; file: string; console: string[] } | { ok: false; why: string };

export async function screenshot(dir: string, file: string, page = '/'): Promise<Shot> {
  if (sandboxOn()) return { ok: false, why: 'agent code runs in the sandbox, so Hive does not start it here' };
  const chrome = findChrome();
  await ensureDeps(dir);
  if (!chrome) return { ok: false, why: 'no Chrome or Edge found (set CHROME_PATH)' };
  let app: ReturnType<typeof spawn> | null = null;
  let url: string;
  if (existsSync(join(dir, 'src', 'server.js'))) {
    const port = await freePort();
    app = spawn(process.execPath, ['src/server.js'], { cwd: dir, env: { ...minimalEnv(), NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore' });
    url = `http://127.0.0.1:${port}${page.startsWith('/') ? page : `/${page}`}`;
    if (!await waitForHttp(`http://127.0.0.1:${port}/`, 10000)) { app.kill(); return { ok: false, why: 'src/server.js did not answer on PORT within 10 s' }; }
  } else if (existsSync(join(dir, 'src', 'index.html'))) {
    const html = page.replace(/^\/+/, '').split(/[?#]/)[0] || 'index.html';
    if (html.includes('..') || !existsSync(join(dir, 'src', html))) return { ok: false, why: `src/${html} does not exist` };
    url = pathToFileURL(join(dir, 'src', html)).href;
  } else {
    return { ok: false, why: 'nothing to look at yet (no src/server.js or src/index.html)' };
  }
  const profile = mkdtempSync(join(tmpdir(), 'hive-chrome-'));
  mkdirSync(dirname(file), { recursive: true });
  try {
    const log = await new Promise<string>((resolve, reject) => {
      execFile(chrome, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        '--enable-logging=stderr', '--v=0',
        `--user-data-dir=${profile}`, '--window-size=1280,800', '--virtual-time-budget=5000', `--screenshot=${file}`, url,
      ], { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }, (err, _out, stderr) => (err && !existsSync(file) ? reject(err) : resolve(String(stderr))));
    });
    return existsSync(file) ? { ok: true, file, console: consoleLines(log) } : { ok: false, why: 'the browser produced no screenshot' };
  } catch (e) {
    return { ok: false, why: `the browser failed: ${(e as Error).message.split('\n')[0].slice(0, 160)}` };
  } finally {
    app?.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

// Chrome's log lines for the page's console: `...:INFO:CONSOLE:12] "message", source: url (12)`.
export function consoleLines(log: string): string[] {
  const out: string[] = [];
  for (const m of log.matchAll(/:(INFO|WARNING|ERROR):CONSOLE[:(](\d+)\)?\] "([\s\S]*?)", source: (\S*) \((\d+)\)/g)) {
    const where = m[4].split('/').pop() || m[4];
    out.push(`${m[1] !== 'INFO' || /^Uncaught/.test(m[3]) ? 'error' : 'console'}: ${m[3]} (${where}:${m[5]})`.slice(0, 400));
    if (out.length >= 40) break;
  }
  return out;
}

// ---- Live preview: what a task's folder (or main) builds, for an iframe or a terminal ----
// src/server.js runs in the Daytona sandbox when it is on, else here with no secrets (as for screenshots) on its own
// port, restarted when the folder's commit changes and stopped after 30 idle minutes. src/index.html is served by
// Hive (routes.ts) under a sandbox CSP. src/cli.js has no page: the web app shows terminal[taskId].

interface Local { rev: string; used: number; proc?: ChildProcess; up: Promise<{ port: number } | { why: string }> }
const servers = new Map<string, Local>();
const IDLE_MS = 30 * 60 * 1000;
const alive = (p?: ChildProcess) => !p || (p.exitCode === null && p.signalCode === null);

export async function livePreview(dir: string, filesUrl: string, host: string): Promise<Preview> {
  const has = (f: string) => existsSync(join(dir, f));
  if (has('src/server.js')) {
    const rev = await head(dir).catch(() => '');
    if (!sandboxOn()) return serveLocal(dir, rev, host);
    try {
      return { kind: 'web', how: 'sandbox', url: await sandboxServe(dir, rev) };
    } catch (e) {
      return { kind: 'none', why: (e as Error).message };
    }
  }
  if (has('src/index.html')) return { kind: 'web', how: 'static', url: `${filesUrl}/index.html` };
  if (has('src/cli.js')) return { kind: 'cli' };
  return { kind: 'none', why: 'nothing to preview yet (no src/server.js, src/index.html or src/cli.js)' };
}

async function serveLocal(dir: string, rev: string, host: string): Promise<Preview> {
  await ensureDeps(dir);
  let s = servers.get(dir);
  if (!s || s.rev !== rev || !alive(s.proc)) {
    s?.proc?.kill();
    const entry: Local = { rev, used: Date.now(), up: Promise.resolve({ why: '' }) };
    entry.up = (async () => {
      const port = await freePort();
      if (servers.get(dir) !== entry) return { why: 'replaced by a newer version' };
      let log = '';
      const proc = entry.proc = spawn(process.execPath, ['src/server.js'], {
        cwd: dir, env: { ...minimalEnv(), NODE_ENV: 'development', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      const keep = (d: Buffer) => { log = (log + d.toString()).slice(-600); };
      proc.stdout.on('data', keep);
      proc.stderr.on('data', keep);
      proc.on('error', (e) => { log += e.message; });
      if (await waitForHttp(`http://127.0.0.1:${port}/`, 10000, () => alive(proc))) return { port };
      proc.kill();
      return { why: `src/server.js did not answer on PORT within 10 s${log.trim() ? `:\n${log.trim()}` : ''}` };
    })();
    servers.set(dir, s = entry);
  }
  s.used = Date.now();
  const r = await s.up;
  if (!('port' in r)) return { kind: 'none', why: r.why };
  return { kind: 'web', how: 'server', url: `http://${host.includes(':') ? `[${host}]` : host}:${r.port}/` };
}

// Stop the preview servers under a folder (a project being deleted), or all of them.
export function stopPreviews(under = '') {
  for (const [dir, s] of servers) if (dir.startsWith(under)) { s.proc?.kill(); servers.delete(dir); }
}
setInterval(() => {
  for (const [dir, s] of servers) if (Date.now() - s.used > IDLE_MS) { s.proc?.kill(); servers.delete(dir); }
}, 60000).unref();
process.on('exit', () => stopPreviews());
