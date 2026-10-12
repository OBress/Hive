import type { GenerateOptions, Msg, ToolCall, Turn } from './llm.ts';

// ---- Fake provider: scripted, no network. Streams with a delay so the live view is visible. ----

const FAKE_DELAY = Number(process.env.FAKE_DELAY_MS || 12);

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true });
});

export async function fakeTurn(o: GenerateOptions): Promise<Turn> {
  if (o.model === 'fake-agent' && o.tools?.length) {
    const { text, calls } = fakeAgent(o.messages);
    for (let i = 0; i < text.length; i += 6) { await wait(FAKE_DELAY, o.signal); o.onToken?.(text.slice(i, i + 6)); }
    for (const [i, c] of calls.entries()) {
      const json = JSON.stringify(c.input);
      for (let j = 0; j < json.length; j += 24) { await wait(FAKE_DELAY, o.signal); o.onToolInput?.(i, c.name, json.slice(0, j + 24)); }
    }
    return { text, calls, stop: calls.length ? 'tool' : 'end' };
  }
  const text = fakePlanner(o.system, o.messages);
  for (let i = 0; i < text.length; i += 6) { await wait(FAKE_DELAY, o.signal); o.onToken?.(text.slice(i, i + 6)); }
  return { text, calls: [], stop: 'end' };
}

let callN = 0;
const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `fake_${++callN}`, name, input });

function fakeAgent(messages: Msg[]): { text: string; calls: ToolCall[] } {
  const ctx = messages[0]?.content ?? '';
  const id = /^Task id: (.+)$/m.exec(ctx)?.[1]?.trim() ?? 'task';
  const lastMsg = messages[messages.length - 1];
  const last = [lastMsg?.content ?? '', ...(lastMsg?.results ?? []).map((r) => r.content)].join('\n');
  const prev = [...messages].reverse().find((m) => m.role === 'assistant')?.calls ?? [];
  const did = (name: string, path?: RegExp) => prev.some((c) => c.name === name && (!path || path.test(String(c.input.path ?? ''))));
  const steer = /^(.+?) says: (.+)$/m.exec(last);
  const handback = /edited the code while you were paused/.test(last);
  const fn = id.replace(/[^a-zA-Z0-9]/g, '_');

  let plan: string;
  let calls: ToolCall[];
  if (handback) {
    plan = "Picking up my teammate's edits and re-running the tests.";
    calls = [call('run_tests', {})];
  } else if (did('run_tests') && /(^|\D)0 failed/.test(last)) {
    plan = 'All tests pass, so I will finish.';
    calls = [call('finish', { summary: `Built src/${id}.js with a tested ${fn}() export. Covered by test/${id}.test.js. Nothing left.` })];
  } else if (did('write_file', /^test\//) || did('finish') || did('run_tests')) {
    plan = 'Running the tests to check my work.';
    calls = [call('run_tests', {})];
  } else if (did('write_file', /^src\//)) {
    plan = `Writing tests for ${id} with node:test.`;
    calls = [call('write_file', { path: `test/${id}.test.js`, content: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn} } from '../src/${id}.js';\n\ntest('${id} works', () => {\n  assert.equal(${fn}(), '${id}');\n});\n` })];
  } else {
    plan = `Writing src/${id}.js for this task.`;
    calls = [call('write_file', { path: `src/${id}.js`, content: `// ${id}: written by the fake agent.\nexport function ${fn}() {\n  return '${id}';\n}\n` })];
  }
  if (steer) plan = `Got it: ${steer[2].trim()}. ${plan}`;
  return { text: plan, calls };
}

function fakePlanner(system: string, messages: Msg[]): string {
  const last = messages[messages.length - 1]?.content ?? '';
  if (/running the goal check/.test(system)) {
    const failing = /^Tests on main: \d+ passed, ([1-9]\d*) failed/m.test(last);
    return JSON.stringify(failing
      ? { done: false, reply: 'Tests fail on main, so I added a task to fix them.', ops: [{ op: 'addTask', task: { id: 'fix-tests', title: 'Fix failing tests on main', spec: 'Make every test under test/ pass on main.', deps: [] } }] }
      : { done: true, reply: 'Goal check: every task is done and the tests pass on main.', ops: [] });
  }
  if (/architect/.test(system)) {
    const name = /^Project: (.+)$/m.exec(last)?.[1] ?? 'Project';
    return `# Stack and spec: ${name}
## In plain words
A small Node.js app with tests (written by the fake planner).
## Stack
- Node.js ES modules, built-ins only: nothing to install.
- node:http serves it.
- A JSON file stores the data.
- node:test checks every module.
## Modules
- \`src/store.js\`: load and save records.
- \`src/server.js\`: the HTTP routes.
## Data
- Item: id, title, createdAt.
## Interface
- GET /items, POST /items.
## Build order
1. src/store.js with tests.
2. src/server.js with tests.
## Open questions
- None.`;
  }
  if (!/strict JSON/i.test(system)) {
    return 'Done: wrote the module and its tests.\nLeft: nothing major.\nTried and failed: nothing.\nOpen questions: none.';
  }
  const ids = [...last.matchAll(/\[(st_\d+)\]/g)].map((m) => m[1]);
  const cites = ids.slice(-3);
  return JSON.stringify({ reply: `Here is what happened, based on the latest steps (${cites.join(', ') || 'none yet'}).`, ops: [], cites });
}
