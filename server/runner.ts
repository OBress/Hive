import { spawn } from 'node:child_process';
import { sandboxExec, sandboxOn } from './sandbox.ts';

export interface TestResult { passed: number; failed: number; output: string; sandbox?: boolean }
export interface RunResult { exitCode: number; output: string; sandbox?: boolean }

// Agent code runs with no secrets: only what node and the OS need.
export function minimalEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR'];
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

export function parseTap(out: string): { passed: number; failed: number } {
  const num = (re: RegExp) => Number(re.exec(out)?.[1] ?? 0);
  return { passed: num(/^# pass (\d+)/m), failed: num(/^# fail (\d+)/m) };
}

// `node <args>` in dir with no input, passing output to onOutput as it arrives. Keeps the last 1 MB.
function runNode(dir: string, args: string[], ms: number, onOutput?: (chunk: string) => void) {
  return new Promise<{ stdout: string; all: string; code: number | null; killed: boolean }>((resolve) => {
    const p = spawn(process.execPath, args, { cwd: dir, env: minimalEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let all = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; p.kill(); }, ms);
    const take = (out: boolean) => (d: Buffer) => {
      const s = d.toString();
      if (out) stdout = (stdout + s).slice(-1e6);
      all = (all + s).slice(-1e6);
      onOutput?.(s);
    };
    p.stdout.on('data', take(true));
    p.stderr.on('data', take(false));
    p.on('error', (e) => { all += `\n${e.message}`; });
    p.on('close', (code) => { clearTimeout(timer); resolve({ stdout, all, code, killed }); });
  });
}

// With DAYTONA_API_KEY set the tests run in the sandbox; if it cannot be reached they run here so the demo keeps going.
// Here the output streams to onOutput; from the sandbox it arrives in one piece at the end.
export async function runTests(dir: string, onOutput?: (chunk: string) => void, files: string[] = []): Promise<TestResult> {
  if (sandboxOn()) {
    try {
      const r = await sandboxExec(dir, ['node --test --test-reporter=tap', ...files.map((f) => `'${f}'`)].join(' '), 30);
      onOutput?.(r.output);
      let { passed, failed } = parseTap(r.output);
      if (r.exitCode !== 0 && !/^# pass \d+/m.test(r.output) && failed === 0) failed = 1;   // crash or timeout
      return { passed, failed, output: r.output.slice(-3000), sandbox: true };
    } catch (e) {
      console.error(`Sandbox unavailable, running tests on this machine: ${(e as Error).message}`);
    }
  }
  const r = await runNode(dir, ['--test', '--test-reporter=tap', ...files], 30000, onOutput);
  let { passed, failed } = parseTap(r.stdout);
  const summary = /^# pass \d+/m.test(r.stdout);
  if ((r.code !== 0 || r.killed) && (r.killed || !summary) && failed === 0) failed = 1;   // crash or timeout
  return { passed, failed, output: r.all.slice(-3000) };
}

// The project's command-line tool: `node src/cli.js ...args`, 15 s at most, no input.
export async function runCli(dir: string, args: string[], onOutput?: (chunk: string) => void): Promise<RunResult> {
  if (sandboxOn()) {
    try {
      const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
      const r = await sandboxExec(dir, `node src/cli.js ${quoted}`, 15);
      onOutput?.(r.output);
      return { exitCode: r.exitCode, output: r.output.slice(-3000), sandbox: true };
    } catch (e) {
      console.error(`Sandbox unavailable, running the CLI on this machine: ${(e as Error).message}`);
    }
  }
  const r = await runNode(dir, ['src/cli.js', ...args], 15000, onOutput);
  if (r.killed) onOutput?.('\n(stopped after 15 s)\n');
  return { exitCode: r.killed ? 124 : r.code ?? 1, output: r.all.slice(-3000) };
}

// Split "add 'buy milk' --done" into ["add", "buy milk", "--done"]; at most 20 arguments.
export const splitArgs = (s: string): string[] =>
  [...s.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]).slice(0, 20);
