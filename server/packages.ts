import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { minimalEnv } from './runner.ts';

// npm packages for agent-built projects. Agents ask with the install_packages tool; only packages on the allowlist
// (NPM_ALLOW: a comma list, "*" for any, "off" to disable) are installed, always with --ignore-scripts so nothing runs
// at install time. node_modules stays out of git; any folder that runs the code installs what package.json lists.

const DEFAULT_ALLOW = [
  'three', 'cannon-es', 'gsap', 'howler', 'tone', 'pixi.js', 'phaser', 'matter-js', 'simplex-noise', 'seedrandom',
  'd3', 'chart.js', 'mathjs', 'marked', 'dompurify', 'preact', 'htm', 'lit',
  'express', 'ws', 'socket.io', 'socket.io-client', 'zod', 'nanoid', 'uuid', 'date-fns', 'lodash-es', 'yaml', 'csv-parse',
  'commander', 'chalk', 'cheerio', 'jsdom', 'happy-dom', 'supertest',
];

export function npmAllow(): string[] | '*' | null {
  const v = (process.env.NPM_ALLOW ?? '').trim();
  if (v.toLowerCase() === 'off') return null;
  if (v === '*') return '*';
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ALLOW;
}
export const packagesOn = () => npmAllow() !== null;
export const allowText = () => { const a = npmAllow(); return a === '*' ? 'any package on npm' : (a ?? []).join(', '); };

// "three", "three@0.170.0", "@scope/name@^1": the name, or null if it is not a plain npm package spec.
export function packageName(spec: string): string | null {
  const m = /^((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)(?:@[\w.^~<>=*|-]+)?$/i.exec(spec.trim());
  return m ? m[1].toLowerCase() : null;
}

// Why these specs can't be installed, or null when they all can.
export function checkPackages(specs: string[]): string | null {
  const allow = npmAllow();
  if (!allow) return 'installing packages is turned off on this Hive server';
  if (!specs.length) return 'name at least one package';
  for (const s of specs) {
    const name = packageName(s);
    if (!name) return `"${s}" is not a package name`;
    if (allow !== '*' && !allow.includes(name)) return `${name} is not on this server's package list (${allowText()})`;
  }
  return null;
}

// npm's own CLI script, run with this Node (no shell, works the same on Windows and macOS).
function npmCli(): string | null {
  const bin = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : '',
    join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

function npm(dir: string, args: string[], onOutput?: (chunk: string) => void, ms = 180000): Promise<{ code: number; output: string }> {
  const cli = npmCli();
  if (!cli) return Promise.resolve({ code: 1, output: 'npm was not found next to this Node installation' });
  const keep = ['APPDATA', 'LOCALAPPDATA', 'npm_config_cache', 'npm_config_registry'];
  const env: NodeJS.ProcessEnv = { ...minimalEnv(), NODE_ENV: 'development' };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args, '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, env, windowsHide: true });
    let output = '';
    const take = (d: Buffer) => { output = (output + d.toString()).slice(-20000); onOutput?.(d.toString()); };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    const timer = setTimeout(() => p.kill(), ms);
    p.on('error', (e) => { output += e.message; });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}

// node_modules must never be committed.
export function ensureGitignore(dir: string) {
  const file = join(dir, '.gitignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (!/^\/?node_modules\/?$/m.test(text)) appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}node_modules/\n`);
}

export async function install(dir: string, specs: string[], onOutput?: (chunk: string) => void) {
  ensureGitignore(dir);
  const r = await npm(dir, ['install', '--save', ...specs], onOutput);
  if (r.code === 0) stamp(dir);
  return r;
}

const depsHash = (dir: string): string | null => {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: object; devDependencies?: object };
    if (!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length) return null;
    return createHash('sha1').update(JSON.stringify([pkg.dependencies, pkg.devDependencies])).digest('hex');
  } catch { return null; }
};
const stampFile = (dir: string) => join(dir, 'node_modules', '.hive-deps');
function stamp(dir: string) {
  const h = depsHash(dir);
  if (!h) return;
  mkdirSync(dirname(stampFile(dir)), { recursive: true });
  writeFileSync(stampFile(dir), h);
}

// Before code runs in a folder (tests, the CLI, a preview): install what package.json lists if it changed since
// the last install there. A no-op for projects without dependencies.
const installing = new Map<string, Promise<void>>();
export function ensureDeps(dir: string): Promise<void> {
  const h = depsHash(dir);
  if (!h || (existsSync(stampFile(dir)) && readFileSync(stampFile(dir), 'utf8') === h)) return Promise.resolve();
  let p = installing.get(dir);
  if (!p) {
    p = (async () => {
      ensureGitignore(dir);
      const r = await npm(dir, ['install']);
      if (r.code === 0) stamp(dir);
      else console.error(`npm install in ${dir} failed: ${r.output.slice(-300)}`);
    })().finally(() => installing.delete(dir));
    installing.set(dir, p);
  }
  return p;
}
