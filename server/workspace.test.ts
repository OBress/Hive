import { expect, test } from 'vitest';
import { safePath } from './workspace.ts';

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
