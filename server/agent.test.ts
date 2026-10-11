import { expect, test } from 'vitest';
import { buildMessages, parseAction } from './agent.ts';

test('parses a plan and a write, unwrapping a code fence', () => {
  const r = parseAction('<think>hmm <test/></think>PLAN: write the store\n<write path="src/store.js">\n```js\nexport const a = 1;\n```\n</write>\n<test/>');
  expect(r.plan).toBe('write the store');
  expect(r.action).toEqual({ type: 'write', path: 'src/store.js', content: 'export const a = 1;\n' });
});

test('takes the earliest action', () => {
  expect(parseAction('PLAN: x\n<test/>\n<finish>done</finish>').action).toEqual({ type: 'test' });
  expect(parseAction('PLAN: x\n<read path="src/a.js"/>').action).toEqual({ type: 'read', path: 'src/a.js' });
  expect(parseAction('PLAN: x\n<finish>All good.</finish>').action).toEqual({ type: 'finish', summary: 'All good.' });
});

test('rejects unsafe paths and missing actions', () => {
  expect(parseAction('PLAN: x\n<write path="../etc/passwd">x</write>').error).toMatch(/not allowed/);
  expect(parseAction('PLAN: just thinking').action).toBeUndefined();
});

test('messages alternate and end with the user', () => {
  const m = buildMessages('ctx', [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'PLAN: a\n<test/>' }]);
  expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
  expect(m[0].content).toBe('ctx\n\ngo');
});
