import Anthropic from '@anthropic-ai/sdk';

export interface Msg { role: 'user' | 'assistant'; content: string; images?: string[] }   // images: base64 PNG, user turns only
export interface GenerateOptions {
  model: string;
  system: string;
  messages: Msg[];                    // alternate user/assistant, start with user
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
}

export const provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
export const models = { agent: '', planner: '' };

// A model that can look at screenshots (the goal check): VISION_MODEL, else the planner with Anthropic (Claude sees
// images). Empty means screenshots are still taken and shown to people, but the planner judges from text.
export const visionModel = () => process.env.VISION_MODEL?.trim() || (provider === 'anthropic' ? models.planner : '');
const baseUrl = () => (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '');
let configError = '';

// Pick models at startup. Never throws: a missing config is logged and makes calls fail with that message.
export async function initModels() {
  models.agent = process.env.AGENT_MODEL ?? '';
  models.planner = process.env.PLANNER_MODEL ?? '';
  if (provider === 'fake') {
    models.agent ||= 'fake-agent';
    models.planner ||= 'fake-planner';
  } else if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) configError = 'Set ANTHROPIC_API_KEY in .env (or LLM_PROVIDER=fake).';
    models.agent ||= 'claude-sonnet-5-5';
    models.planner ||= 'claude-haiku-5-5';
  } else if (!baseUrl() || !process.env.LLM_API_KEY) {
    configError = 'Set LLM_BASE_URL and LLM_API_KEY in .env (or LLM_PROVIDER=fake for scripted agents).';
  } else if (!models.agent || !models.planner) {
    try {
      const res = await fetch(`${baseUrl()}/models`, { headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ids: string[] = ((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
      console.log(`Models available: ${ids.join(', ')}`);
      const find = (re: RegExp) => ids.find((id) => re.test(id));
      models.agent ||= find(/deepseek/i) ?? find(/glm/i) ?? ids[0] ?? '';
      models.planner ||= find(/glm.*flash/i) ?? find(/glm/i) ?? models.agent;
      if (!models.agent) configError = 'The provider listed no models; set AGENT_MODEL and PLANNER_MODEL in .env.';
    } catch (e) {
      configError = `Could not list models at LLM_BASE_URL (${(e as Error).message}); set AGENT_MODEL and PLANNER_MODEL in .env.`;
    }
  }
  if (configError) console.log(`LLM not configured: ${configError}`);
  console.log(`LLM provider ${provider}: agent=${models.agent || '-'} planner=${models.planner || '-'}`);
}

// Agent replies carry whole files (plus any reasoning), so they get far more room than planner calls.
// OpenAI-compatible providers often cap output at 8192; raise AGENT_MAX_TOKENS if yours allows more.
export const agentMaxTokens = () => Number(process.env.AGENT_MAX_TOKENS) || (provider === 'anthropic' ? 16000 : 8192);

// A small semaphore so we never run more than MAX_PARALLEL + 1 calls at once.
const limit = Number(process.env.MAX_PARALLEL || 2) + 1;
let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < limit) { active++; return; }
  await new Promise<void>((r) => waiting.push(r));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else active--;
}

export async function generate(opts: GenerateOptions): Promise<string> {
  if (configError) throw new Error(configError);
  await acquire();
  try {
    let emitted = false;
    const o = { ...opts, onToken: (d: string) => { emitted = true; opts.onToken?.(d); } };
    const call = provider === 'fake' ? fakeGenerate : provider === 'anthropic' ? anthropicGenerate : openaiGenerate;
    try {
      return await call(o);
    } catch (e) {
      if (opts.signal?.aborted || emitted || !retryable(e)) throw e;
      await sleep(1000, opts.signal);
      return await call(o);
    }
  } finally {
    release();
  }
}

const retryable = (e: unknown) => {
  const status = (e as { status?: number }).status;
  return status === undefined ? e instanceof TypeError || (e as Error).name === 'APIConnectionError' : status === 429 || status >= 500;
};

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
  });
}
const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });

async function openaiGenerate(o: GenerateOptions): Promise<string> {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: o.model, stream: true, max_tokens: o.maxTokens ?? 4096,
      messages: [{ role: 'system', content: o.system }, ...o.messages.map((m) => (m.images?.length ? {
        role: m.role,
        content: [{ type: 'text', text: m.content }, ...m.images.map((d) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${d}` } }))],
      } : { role: m.role, content: m.content }))],
    }),
    signal: o.signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw Object.assign(new Error(`LLM HTTP ${res.status}: ${body}`), { status: res.status });
  }
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') return text;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) { text += delta; o.onToken?.(delta); }
      } catch { /* keep-alive or partial line */ }
    }
  }
  return text;
}

let anthropic: Anthropic | null = null;
async function anthropicGenerate(o: GenerateOptions): Promise<string> {
  anthropic ??= new Anthropic();
  const stream = anthropic.messages.stream(
    {
      model: o.model, system: o.system, max_tokens: o.maxTokens ?? 4096,
      messages: o.messages.map((m) => (m.images?.length ? {
        role: m.role,
        content: [
          ...m.images.map((d) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: d } })),
          { type: 'text' as const, text: m.content },
        ],
      } : { role: m.role, content: m.content })),
    },
    { signal: o.signal },
  );
  stream.on('text', (d) => o.onToken?.(d));
  return stream.finalText();
}

// ---- Fake provider: scripted, no network. Streams with a delay so the live view is visible. ----

const FAKE_DELAY = Number(process.env.FAKE_DELAY_MS || 12);

async function fakeGenerate(o: GenerateOptions): Promise<string> {
  const text = o.model === 'fake-agent' ? fakeAgent(o.messages) : fakePlanner(o.system, o.messages);
  for (let i = 0; i < text.length; i += 6) {
    await sleep(FAKE_DELAY, o.signal);
    o.onToken?.(text.slice(i, i + 6));
  }
  return text;
}

function fakeAgent(messages: Msg[]): string {
  const ctx = messages[0]?.content ?? '';
  const id = /^Task id: (.+)$/m.exec(ctx)?.[1]?.trim() ?? 'task';
  const last = messages[messages.length - 1]?.content ?? '';
  const prev = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const steer = /^(.+?) says: (.+)$/m.exec(last);
  const handback = /edited the code while you were paused/.test(last);
  const fn = id.replace(/[^a-zA-Z0-9]/g, '_');

  let plan: string, action: string;
  if (handback) {
    plan = "Picking up my teammate's edits and re-running the tests.";
    action = '<test/>';
  } else if (/<test\/>/.test(prev) && /(^|\D)0 failed/.test(last)) {
    plan = 'All tests pass, so I will finish.';
    action = `<finish>Built src/${id}.js with a tested ${fn}() export. Covered by test/${id}.test.js. Nothing left.</finish>`;
  } else if (/<write path="test\//.test(prev) || /<finish>/.test(prev) || /<test\/>/.test(prev)) {
    plan = 'Running the tests to check my work.';
    action = '<test/>';
  } else if (/<write path="src\//.test(prev)) {
    plan = `Writing tests for ${id} with node:test.`;
    action = `<write path="test/${id}.test.js">\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn} } from '../src/${id}.js';\n\ntest('${id} works', () => {\n  assert.equal(${fn}(), '${id}');\n});\n</write>`;
  } else {
    plan = `Writing src/${id}.js for this task.`;
    action = `<write path="src/${id}.js">\n// ${id}: written by the fake agent.\nexport function ${fn}() {\n  return '${id}';\n}\n</write>`;
  }
  if (steer) plan = `Got it: ${steer[2].trim()}. ${plan}`;
  return `PLAN: ${plan}\n${action}`;
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
