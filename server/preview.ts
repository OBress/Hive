import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { minimalEnv } from './runner.ts';
import { sandboxOn } from './sandbox.ts';

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

async function waitForHttp(url: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); return true; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return false;
}

export type Shot = { ok: true; file: string } | { ok: false; why: string };

export async function screenshot(dir: string, file: string): Promise<Shot> {
  if (sandboxOn()) return { ok: false, why: 'agent code runs in the sandbox, so Hive does not start it here' };
  const chrome = findChrome();
  if (!chrome) return { ok: false, why: 'no Chrome or Edge found (set CHROME_PATH)' };
  let app: ReturnType<typeof spawn> | null = null;
  let url: string;
  if (existsSync(join(dir, 'src', 'server.js'))) {
    const port = await freePort();
    app = spawn(process.execPath, ['src/server.js'], { cwd: dir, env: { ...minimalEnv(), NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore' });
    url = `http://127.0.0.1:${port}/`;
    if (!await waitForHttp(url, 10000)) { app.kill(); return { ok: false, why: 'src/server.js did not answer on PORT within 10 s' }; }
  } else if (existsSync(join(dir, 'src', 'index.html'))) {
    url = pathToFileURL(join(dir, 'src', 'index.html')).href;
  } else {
    return { ok: false, why: 'nothing to look at yet (no src/server.js or src/index.html)' };
  }
  const profile = mkdtempSync(join(tmpdir(), 'hive-chrome-'));
  mkdirSync(dirname(file), { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(chrome, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`, '--window-size=1280,800', '--virtual-time-budget=5000', `--screenshot=${file}`, url,
      ], { timeout: 45000 }, (err) => (err && !existsSync(file) ? reject(err) : resolve()));
    });
    return existsSync(file) ? { ok: true, file } : { ok: false, why: 'the browser produced no screenshot' };
  } catch (e) {
    return { ok: false, why: `the browser failed: ${(e as Error).message.split('\n')[0].slice(0, 160)}` };
  } finally {
    app?.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
