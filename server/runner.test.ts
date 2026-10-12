import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { checkSyntax, parseTap, runCli, runTests, splitArgs } from './runner.ts';

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

test('failing tests come back with their reason, and files can be targeted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-tests-'));
  mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'test', 'a.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('adds', () => assert.equal(1 + 1, 3));\ntest('fine', () => {});\n");
  writeFileSync(join(dir, 'test', 'b.test.js'), "import { test } from 'node:test';\ntest('b ok', () => {});\n");
  const all = await runTests(dir);
  expect(all).toMatchObject({ passed: 2, failed: 1 });
  expect(all.failures).toContain('not ok');
  expect(all.failures).toContain('adds');
  expect(all.failures).toMatch(/expected|3/);
  expect(all.failures).not.toContain('fine');
  const one = await runTests(dir, undefined, ['test/b.test.js']);
  expect(one).toMatchObject({ passed: 1, failed: 0 });
  expect(one.failures).toBeUndefined();
  rmSync(dir, { recursive: true, force: true });
}, 60000);

test('a write that does not parse is caught at once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-check-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'src', 'bad.js'), 'export const a = (;\n');
  writeFileSync(join(dir, 'src', 'good.js'), 'export const a = 1;\n');
  expect(await checkSyntax(dir, 'src/bad.js', '')).toMatch(/SyntaxError/);
  expect(await checkSyntax(dir, 'src/good.js', '')).toBe('');
  expect(await checkSyntax(dir, 'src/x.json', '{oops')).not.toBe('');
  rmSync(dir, { recursive: true, force: true });
}, 30000);
