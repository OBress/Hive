import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { tar } from './sandbox.ts';

test('the sandbox upload archive unpacks with tar, long paths included', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-tar-'));
  const long = `src/${'deep/'.repeat(25)}file.js`;
  writeFileSync(join(dir, 'a.tgz'), gzipSync(tar([
    { path: 'src/a.js', content: 'export const a = 1; // é\n' },
    { path: 'test/b.test.js', content: 'x'.repeat(1000) },
    { path: long, content: 'long\n' },
  ])));
  execFileSync('tar', ['xzf', 'a.tgz'], { cwd: dir });
  expect(readFileSync(join(dir, 'src/a.js'), 'utf8')).toBe('export const a = 1; // é\n');
  expect(readFileSync(join(dir, 'test/b.test.js'), 'utf8')).toHaveLength(1000);
  expect(readFileSync(join(dir, long), 'utf8')).toBe('long\n');
  rmSync(dir, { recursive: true, force: true });
});
