import { expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conflictHunks, hasMarkers, safePath } from './workspace.ts';

test('safePath allows src/ and test/ files', () => {
  expect(safePath('src/store.js')).toBe('src/store.js');
  expect(safePath('test\\store.test.js')).toBe('test/store.test.js');
  expect(safePath('src/./lib/a.js')).toBe('src/lib/a.js');
});

test('safePath rejects escapes, absolute paths and other folders', () => {
  for (const p of ['../x.js', 'src/../../x.js', '/etc/passwd', 'C:\\x.js', 'c:/x.js', 'package.json', '.git/config', 'src/', 'src', '', null, 3]) {
    expect(safePath(p)).toBeNull();
  }
});

test('safePath allows reading package.json and README.md, never writing them', () => {
  expect(safePath('package.json', true)).toBe('package.json');
  expect(safePath('./README.md', true)).toBe('README.md');
  expect(safePath('src/a.js', true)).toBe('src/a.js');
  for (const p of ['package.json', 'README.md']) expect(safePath(p)).toBeNull();
  for (const p of ['.env', '.git/config', '../package.json', 'src/../.env', 'node_modules/x/package.json']) expect(safePath(p, true)).toBeNull();
});

test('conflict regions are shown with their location and markers are detected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-conflict-'));
  mkdirSync(join(dir, 'src'));
  const text = 'a\nb\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> main\nc\nd\ne\n';
  writeFileSync(join(dir, 'src', 'x.js'), text);
  expect(hasMarkers(text)).toBe(true);
  expect(hasMarkers('a <<<<<<< b')).toBe(false);
  expect(conflictHunks(dir, ['src/x.js'])).toBe('src/x.js:3\na\nb\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> main\nc\nd');
  rmSync(dir, { recursive: true, force: true });
});
