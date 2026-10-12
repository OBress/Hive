import { expect, test } from 'vitest';
import { applyEdit, buildMessages, toAction } from './agent.ts';
import { toOpenAI } from './llm.ts';
import { partialFields } from './session.ts';

test('tool calls become actions, with clear errors', () => {
  expect(toAction({ id: '1', name: 'read_file', input: { path: 'src/a.js', start_line: 3 } }).action).toEqual({ type: 'read', path: 'src/a.js', start: 3, end: undefined });
  expect(toAction({ id: '2', name: 'write_file', input: { path: 'src/a.js', content: 'x' } }).action).toEqual({ type: 'write', path: 'src/a.js', content: 'x\n' });
  expect(toAction({ id: '3', name: 'write_file', input: { path: 'package.json', content: '{}' } }).error).toMatch(/not allowed/);
  expect(toAction({ id: '4', name: 'edit_file', input: { path: 'src/a.js', old_string: 'a' } }).error).toMatch(/new_string/);
  expect(toAction({ id: '5', name: 'run_tests', input: { files: ['test/a.test.js', '../x'] } }).action).toEqual({ type: 'test', files: ['test/a.test.js'] });
  expect(toAction({ id: '6', name: 'write_file', input: {}, bad: 'the reply hit the output limit' }).error).toMatch(/output limit.*edit_file/);
  expect(toAction({ id: '7', name: 'nope', input: {} }).error).toMatch(/no tool/);
});

test('edits need a unique exact match', () => {
  expect(applyEdit('a\nb\nc\n', 'b', 'B', false).text).toBe('a\nB\nc\n');
  expect(applyEdit('x x', 'x', 'y', false).error).toMatch(/2 times/);
  expect(applyEdit('x x', 'x', 'y', true).text).toBe('y y');
  expect(applyEdit('abc', 'zzz', 'y', false).error).toMatch(/not found/);
  expect(applyEdit('a$b', '$', '$$', false).text).toBe('a$$b');
});

test('results whose calls fell out of the window become text', () => {
  // The first message answers a call that is no longer in the transcript (it was trimmed earlier).
  const t = Array.from({ length: 15 }, (_, i) => i % 2
    ? { role: 'assistant' as const, content: 'go', calls: [{ id: `c${i}`, name: 'run_tests', input: {} }] }
    : { role: 'user' as const, content: '', results: [{ id: `c${i - 1}`, content: `result ${i}` }] });
  const m = buildMessages('ctx', t);
  expect(m[0].content).toBe('ctx\n\nresult 0');
  expect(m[0].results).toBeUndefined();
  expect(m[1].calls?.[0].id).toBe('c1');
  expect(m[m.length - 1].results?.[0].id).toBe('c13');
});

test('OpenAI messages carry tool calls and tool results', () => {
  const out = toOpenAI('sys', [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'reading', calls: [{ id: 'a', name: 'read_file', input: { path: 'src/x.js' } }] },
    { role: 'user', content: 'note', results: [{ id: 'a', content: 'file' }] },
  ]);
  expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
  expect((out[2].tool_calls as { function: { arguments: string } }[])[0].function.arguments).toBe('{"path":"src/x.js"}');
  expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'a', content: 'file' });
});

test('partial tool input shows the file as it streams', () => {
  expect(partialFields('{"path":"src/a.js","content":"line 1\nline')).toEqual({ path: 'src/a.js', content: 'line 1\nline' });
  expect(partialFields('{"path":"src/a.js","content":"x\\u00')).toEqual({ path: 'src/a.js', content: 'x' });
});
