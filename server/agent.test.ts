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
  expect(parseAction('PLAN: x\n<search pattern="createStore"/>').action).toEqual({ type: 'search', pattern: 'createStore' });
});

test('accepts a bold or lowercase PLAN line', () => {
  expect(parseAction('**PLAN:** write it**\n<test/>').plan).toBe('write it');
  expect(parseAction('Plan: run tests\n<test/>').plan).toBe('run tests');
  expect(parseAction('Got it: adding createdAt.\n\n<test/>').plan).toBe('Got it: adding createdAt.');
  expect(parseAction('<test/>').plan).toBe('');
});

test('package.json is readable but not writable', () => {
  expect(parseAction('PLAN: x\n<read path="package.json"/>').action).toEqual({ type: 'read', path: 'package.json' });
  expect(parseAction('PLAN: x\n<write path="package.json">{}</write>').error).toMatch(/read-only/);
});

test('rejects unsafe paths and missing actions', () => {
  expect(parseAction('PLAN: x\n<write path="../etc/passwd">x</write>').error).toMatch(/not allowed/);
  expect(parseAction('PLAN: just thinking').action).toBeUndefined();
});

test('explains a reply cut off at the output limit', () => {
  expect(parseAction('PLAN: x\n<write path="src/big.js">\nexport const a = [1, 2,').error).toMatch(/cut off/);
  expect(parseAction('<think>first I will <test/> and then').error).toMatch(/ran out while thinking/);
});

test('messages alternate and end with the user', () => {
  const m = buildMessages('ctx', [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'PLAN: a\n<test/>' }]);
  expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
  expect(m[0].content).toBe('ctx\n\ngo');
});

test('parses a CLI run with quoted arguments', () => {
  expect(parseAction(`PLAN: try it\n<run args="add 'buy milk' --done"/>`).action).toEqual({ type: 'run', args: ['add', 'buy milk', '--done'] });
  expect(parseAction('PLAN: try it\n<run/>').action).toEqual({ type: 'run', args: [] });
});
