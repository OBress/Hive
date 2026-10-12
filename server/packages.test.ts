import { afterEach, expect, test } from 'vitest';
import { checkPackages, packageName } from './packages.ts';
import { consoleLines } from './preview.ts';

afterEach(() => { delete process.env.NPM_ALLOW; });

test('package specs are parsed and checked against the allowlist', () => {
  expect(packageName('three')).toBe('three');
  expect(packageName('three@0.170.0')).toBe('three');
  expect(packageName('@scope/pkg@^1.2')).toBe('@scope/pkg');
  expect(packageName('three; rm -rf /')).toBeNull();
  expect(packageName('../evil')).toBeNull();
  expect(checkPackages(['three@0.170.0', 'cannon-es'])).toBeNull();
  expect(checkPackages(['left-pad'])).toMatch(/not on this server's package list/);
  expect(checkPackages([])).toMatch(/at least one/);
  process.env.NPM_ALLOW = '*';
  expect(checkPackages(['left-pad'])).toBeNull();
  process.env.NPM_ALLOW = 'off';
  expect(checkPackages(['three'])).toMatch(/turned off/);
});

test('console lines are read from the browser log', () => {
  const log = '[1:2:1011/201942.259:INFO:CONSOLE:1] "hello", source: file:///C:/x/src/index.html (1)\n'
    + '[1:2:1011/201942.259:INFO:CONSOLE(7)] "Uncaught TypeError: x is not a function", source: http://127.0.0.1:5/app.js (7)\n';
  expect(consoleLines(log)).toEqual(['console: hello (index.html:1)', 'error: Uncaught TypeError: x is not a function (app.js:7)']);
});
