import { execFile } from 'node:child_process';
import { sandboxExec, sandboxOn } from './sandbox.ts';

export interface TestResult { passed: number; failed: number; output: string; sandbox?: boolean }

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

// With DAYTONA_API_KEY set the tests run in the sandbox; if it cannot be reached they run here so the demo keeps going.
export async function runTests(dir: string): Promise<TestResult> {
  if (sandboxOn()) {
    try {
      const r = await sandboxExec(dir, 'node --test --test-reporter=tap', 30);
      let { passed, failed } = parseTap(r.output);
      if (r.exitCode !== 0 && !/^# pass \d+/m.test(r.output) && failed === 0) failed = 1;   // crash or timeout
      return { passed, failed, output: r.output.slice(-3000), sandbox: true };
    } catch (e) {
      console.error(`Sandbox unavailable, running tests on this machine: ${(e as Error).message}`);
    }
  }
  return new Promise((resolve) => {
    execFile(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, timeout: 30000, env: minimalEnv(), maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const all = `${stdout}${stderr ? `\n${stderr}` : ''}`;
        let { passed, failed } = parseTap(stdout);
        const summary = /^# pass \d+/m.test(stdout);
        if (err && (err.killed || !summary) && failed === 0) failed = 1;   // crash or timeout
        resolve({ passed, failed, output: all.slice(-3000) });
      });
  });
}
