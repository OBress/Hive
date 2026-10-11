import { expect, test } from 'vitest';
import { parseTap } from './runner.ts';

test('parseTap reads pass and fail counts', () => {
  const out = 'TAP version 13\nok 1 - a\nnot ok 2 - b\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n';
  expect(parseTap(out)).toEqual({ passed: 1, failed: 1 });
});

test('parseTap defaults to zero without a summary', () => {
  expect(parseTap('Error: boom')).toEqual({ passed: 0, failed: 0 });
});
