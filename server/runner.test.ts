import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseTap, runCli, splitArgs } from './runner.ts';

test('parseTap reads pass and fail counts', () => {
  const out = 'TAP version 13\nok 1 - a\nnot ok 2 - b\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n';
  expect(parseTap(out)).toEqual({ passed: 1, failed: 1 });
});

test('parseTap defaults to zero without a summary', () => {
  expect(parseTap('Error: boom')).toEqual({ passed: 0, failed: 0 });
});

test('runCli streams the output and returns the exit code', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-cli-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'cli.js'), "console.log('args:', process.argv.slice(2).join('|')); process.exit(3);\n");
  let streamed = '';
  const r = await runCli(dir, splitArgs(`add "buy milk"`), (c) => { streamed += c; });
  expect(r).toMatchObject({ exitCode: 3, output: 'args: add|buy milk\n' });
  expect(streamed).toBe('args: add|buy milk\n');
  rmSync(dir, { recursive: true, force: true });
});
