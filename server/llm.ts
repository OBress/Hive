import Anthropic from '@anthropic-ai/sdk';
import { fakeTurn } from './fake.ts';

// A provider-neutral conversation. Assistant turns may call tools; the next user turn answers every call in
// `results` (before its own text). `raw` keeps an Anthropic reply's content blocks (thinking included) so the
// turn is replayed unchanged; `reasoning` does the same for an OpenAI-compatible model's reasoning_content.
export interface ToolCall { id: string; name: string; input: Record<string, unknown>; bad?: string }
export interface ToolResult { id: string; content: string; images?: string[]; isError?: boolean }
export interface Msg {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];                  // base64 PNG, user turns only
  calls?: ToolCall[];                 // assistant
  results?: ToolResult[];             // user
  raw?: unknown[]; rawModel?: string; // assistant, Anthropic
  reasoning?: string;                 // assistant, OpenAI-compatible
}
export interface ToolDef { name: string; description: string; schema: { type: 'object'; properties: Record<string, unknown>; required: string[] } }

export interface GenerateOptions {
  model: string;
  system: string;
  messages: Msg[];                    // start with user; tool results answer the previous assistant's calls
  tools?: ToolDef[];
  onToken?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onToolInput?: (index: number, name: string, json: string) => void;   // a call's input JSON so far
  signal?: AbortSignal;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';   // Claude: how hard to think (default high)
  json?: boolean;                     // the reply must be one JSON object (JSON mode where the provider has it)
}
export type Stop = 'end' | 'tool' | 'length' | 'refusal';
export interface Turn { text: string; calls: ToolCall[]; stop: Stop; raw?: unknown[]; reasoning?: string }

export const provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
export const models = { agent: '', planner: '' };
// The default for OpenAI-compatible providers (Luminal): agents and the planner both use it unless overridden.
export const DEFAULT_OPENAI_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash';

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
    models.agent ||= 'claude-opus-5-5';
    models.planner ||= 'claude-opus-5-5';
  } else if (!baseUrl() || !process.env.LLM_API_KEY) {
    configError = 'Set LLM_BASE_URL and LLM_API_KEY in .env (or LLM_PROVIDER=fake for scripted agents).';
  } else {
    models.agent ||= DEFAULT_OPENAI_MODEL;
    models.planner ||= DEFAULT_OPENAI_MODEL;
    // Only a check: say so when the provider doesn't list the chosen model, but still use it.
    try {
      const res = await fetch(`${baseUrl()}/models`, { headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` } });
      const ids: string[] = res.ok ? ((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [] : [];
      for (const m of new Set([models.agent, models.planner])) if (ids.length && !ids.includes(m)) console.log(`Warning: LLM_BASE_URL does not list ${m}`);
    } catch { /* the provider may not offer /models */ }
  }
  if (configError) console.log(`LLM not configured: ${configError}`);
  console.log(`LLM provider ${provider}: agent=${models.agent || '-'} planner=${models.planner || '-'}`);
}

// Agent replies carry whole files (plus any reasoning), so they get far more room than planner calls.
// OpenAI-compatible providers often cap output at 8192; raise AGENT_MAX_TOKENS if yours allows more.
export const agentMaxTokens = () => Number(process.env.AGENT_MAX_TOKENS) || (provider === 'anthropic' ? 64000 : 8192);

// How many characters of transcript an agent keeps before older steps are shortened (agent.ts compact()).
// Claude has a 1M-token window and clears old tool results server-side, so it gets far more room.
export const contextBudget = () => Number(process.env.AGENT_CONTEXT_CHARS) || (provider === 'anthropic' ? 1_500_000 : 300_000);

// Extra JSON merged into every OpenAI-compatible request body, e.g. {"reasoning_effort":"high"} or a provider's
// switch for thinking mode. Read once; a bad value is reported and ignored.
const extraBody = (() => {
  try { return JSON.parse(process.env.LLM_EXTRA_BODY || '{}') as Record<string, unknown>; }
  catch { console.error('LLM_EXTRA_BODY is not valid JSON; ignoring it'); return {}; }
})();
let jsonMode = true;   // turned off if the provider rejects response_format

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

// One model reply: text, tool calls and why it stopped.
export async function generateTurn(opts: GenerateOptions): Promise<Turn> {
  if (configError) throw new Error(configError);
  await acquire();
  try {
    let emitted = false;
    const mark = <T extends unknown[]>(f?: (...a: T) => void) => (...a: T) => { emitted = true; f?.(...a); };
    const o = { ...opts, onToken: mark(opts.onToken), onReasoning: mark(opts.onReasoning), onToolInput: mark(opts.onToolInput) };
    const call = provider === 'fake' ? fakeTurn : provider === 'anthropic' ? anthropicTurn : openaiTurn;
    // Rate limits, overloads and dropped connections are retried with exponential backoff (honouring Retry-After),
    // as long as nothing has streamed yet.
    for (let attempt = 0; ; attempt++) {
      try {
        return await call(o);
      } catch (e) {
        if (opts.signal?.aborted || emitted || !retryable(e) || attempt >= 4) throw e;
        const after = Number((e as { retryAfter?: number }).retryAfter) || 0;
        await sleep(Math.min(60000, Math.max(after * 1000, 1000 * 2 ** attempt) + Math.random() * 500), opts.signal);
      }
    }
  } finally {
    release();
  }
}

// Plain text (planner, summaries, goal check).
export async function generate(opts: GenerateOptions): Promise<string> {
  return (await generateTurn(opts)).text;
}

const retryable = (e: unknown) => {
  const status = (e as { status?: number }).status;
  return status === undefined ? e instanceof TypeError || (e as Error).name === 'APIConnectionError' : status === 408 || status === 429 || status >= 500;
};

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
  });
}
const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });

// Parse a call's input JSON; a reply cut off or garbled mid-call is marked bad instead of run.
function parseInput(json: string, cut: boolean): { input: Record<string, unknown>; bad?: string } {
  try {
    const v = JSON.parse(json || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return { input: v };
    return { input: {}, bad: 'the input was not a JSON object' };
  } catch {
    return { input: {}, bad: cut ? 'the reply hit the output limit in the middle of this call' : 'the input was not valid JSON' };
  }
}

// ---- OpenAI-compatible (Luminal, DeepSeek, ...) ----

type OpenAIMsg = Record<string, unknown>;
export function toOpenAI(system: string, messages: Msg[]): OpenAIMsg[] {
  const out: OpenAIMsg[] = [{ role: 'system', content: system }];
  const image = (d: string) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${d}` } });
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant', content: m.content || null,
        ...(m.reasoning ? { reasoning_content: m.reasoning } : {}),
        ...(m.calls?.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      });
      continue;
    }
    const images = [...(m.results ?? []).flatMap((r) => r.images ?? []), ...(m.images ?? [])];
    for (const r of m.results ?? []) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    if (m.content || images.length || !m.results?.length) {
      const text = m.content || 'Continue.';
      out.push({ role: 'user', content: images.length ? [{ type: 'text', text }, ...images.map(image)] : text });
    }
  }
  return out;
}

async function openaiTurn(o: GenerateOptions): Promise<Turn> {
  const json = o.json && jsonMode;
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      ...extraBody,
      model: o.model, stream: true, max_tokens: o.maxTokens ?? 4096,
      messages: toOpenAI(o.system, o.messages),
      ...(o.tools?.length ? { tools: o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: o.signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    if (json && res.status === 400 && /response_format|json/i.test(body)) {
      jsonMode = false;
      console.log('The provider rejected JSON mode; planner replies are parsed from plain text instead');
      return openaiTurn(o);
    }
    throw Object.assign(new Error(`LLM HTTP ${res.status}: ${body}`), { status: res.status, retryAfter: Number(res.headers.get('retry-after')) || undefined });
  }
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let reasoning = '';
  let finish = '';
  const calls: { id: string; name: string; json: string }[] = [];
  const handle = (data: string) => {
    const choice = JSON.parse(data).choices?.[0];
    if (!choice) return;
    const d = choice.delta ?? {};
    if (typeof d.content === 'string' && d.content) { text += d.content; o.onToken?.(d.content); }
    if (typeof d.reasoning_content === 'string' && d.reasoning_content) { reasoning += d.reasoning_content; o.onReasoning?.(d.reasoning_content); }
    for (const tc of (d.tool_calls ?? []) as { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]) {
      const i = tc.index ?? calls.length;
      const c = calls[i] ??= { id: '', name: '', json: '' };
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.json += tc.function.arguments;
      o.onToolInput?.(i, c.name, c.json);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  };
  outer: for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') break outer;
      try { handle(data); } catch { /* keep-alive or partial line */ }
    }
  }
  const cut = finish === 'length';
  const stop: Stop = cut ? 'length' : finish === 'content_filter' ? 'refusal' : calls.length ? 'tool' : 'end';
  return {
    text, reasoning: reasoning || undefined, stop,
    calls: calls.filter((c) => c.name).map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, ...parseInput(c.json, cut) })),
  };
}

// ---- Anthropic ----

let anthropic: Anthropic | null = null;

function toAnthropic(messages: Msg[], model: string): Anthropic.MessageParam[] {
  const image = (d: string) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: d } });
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'assistant') {
      if (m.raw && m.rawModel === model) return { role: 'assistant', content: m.raw as Anthropic.ContentBlockParam[] };
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.calls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      return { role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no reply)' }] };
    }
    const content: Anthropic.ContentBlockParam[] = (m.results ?? []).map((r) => ({
      type: 'tool_result' as const, tool_use_id: r.id, is_error: r.isError || undefined,
      content: r.images?.length ? [...r.images.map(image), { type: 'text' as const, text: r.content }] : r.content,
    }));
    for (const d of m.images ?? []) content.push(image(d));
    if (m.content || !content.length) content.push({ type: 'text', text: m.content || 'Continue.' });
    return { role: 'user', content };
  });
}

// Current Claude models think adaptively and take an effort level; older ones (if configured) get neither.
const adaptive = (model: string) => /^claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[6-9])/.test(model);
// Models that accept server-side refusal fallbacks ("default" routes by refusal category).
const withFallbacks = (model: string) => /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/.test(model);

async function anthropicTurn(o: GenerateOptions): Promise<Turn> {
  anthropic ??= new Anthropic({ maxRetries: 4 });
  const betas = ['context-management-2025-06-27'];
  const tools = o.tools?.length;
  if (withFallbacks(o.model)) betas.push('server-side-fallback-2026-07-01');
  const params = {
    model: o.model, max_tokens: o.maxTokens ?? 4096, betas,
    // Prompt caching: the system prompt (and the tools before it) is a fixed breakpoint; the top-level breakpoint
    // moves to the end of the conversation, so each turn reuses everything the last one sent.
    system: [{ type: 'text' as const, text: o.system, cache_control: { type: 'ephemeral' as const } }],
    cache_control: { type: 'ephemeral' as const },
    messages: toAnthropic(o.messages, o.model) as Anthropic.Beta.BetaMessageParam[],
    ...(adaptive(o.model) ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const }, output_config: { effort: o.effort ?? 'high' } } : {}),
    ...(withFallbacks(o.model) ? { fallbacks: 'default' as const } : {}),
    ...(tools ? {
      tools: o.tools!.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true })),
      // Old tool results are cleared server-side once the context grows, instead of rewriting history here.
      context_management: { edits: [{ type: 'clear_tool_uses_20250919' as const }] },
    } : {}),
  };
  const stream = anthropic.beta.messages.stream(params, { signal: o.signal });
  const json: string[] = [];
  const names: string[] = [];
  stream.on('streamEvent', (ev) => {
    if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') { names[ev.index] = ev.content_block.name; json[ev.index] = ''; }
    else if (ev.type === 'content_block_delta' && ev.delta.type === 'input_json_delta') {
      json[ev.index] += ev.delta.partial_json;
      o.onToolInput?.(names.slice(0, ev.index + 1).filter((n) => n !== undefined).length - 1, names[ev.index], json[ev.index]);
    } else if (ev.type === 'content_block_delta' && ev.delta.type === 'thinking_delta') o.onReasoning?.(ev.delta.thinking);
  });
  stream.on('text', (d) => o.onToken?.(d));
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIError || o.signal?.aborted) throw e;
    // The SDK could not parse a tool input at all (cut off or garbled): no call to answer, so the turn is re-asked.
    throw Object.assign(new Error(`a tool input could not be parsed: ${(e as Error).message}`), { badReply: true });
  }
  const cut = msg.stop_reason === 'max_tokens';
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const blocks = msg.content.flatMap((b) => (b.type === 'tool_use' ? [b] : []));
  const calls = blocks.map((b, i): ToolCall => {
    const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
    return { id: b.id, name: b.name, input, bad: cut && i === blocks.length - 1 ? 'the reply hit the output limit in the middle of this call' : undefined };
  });
  const stop: Stop = cut ? 'length' : msg.stop_reason === 'refusal' ? 'refusal' : calls.length ? 'tool' : 'end';
  // Replay the reply unchanged (thinking blocks are bound to it), unless another model served it after a refusal.
  const replay = !msg.content.some((b) => (b.type as string) === 'fallback');
  return { text, calls, stop, raw: replay ? (msg.content as unknown[]) : undefined };
}
