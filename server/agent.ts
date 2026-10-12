import type { Msg, ToolCall, ToolDef } from './llm.ts';
import { splitArgs } from './runner.ts';
import { safePath } from './workspace.ts';

export const AGENT_SYSTEM = `You are a coding agent working on one task in a shared team workspace. Your teammates watch every step live and may message you while you work.

How you work:
- You act through tools. Start every reply with one short sentence (under 25 words) saying what you are doing now and why, then make your tool calls. Results arrive in the next message.
- Make several tool calls in one reply when they don't depend on each other: read every file you need at once, or write a module and its test file together. Calls run in the order you give them.
- Trust only the file list in the latest message and your tool results, never your own earlier plans. A file not in that list does not exist yet.
- Change existing files with edit_file (an exact, unique snippet and its replacement). Use write_file for new files or when most of a file changes. Keep files small and focused (under about 300 lines); split a large module into several files.

The workspace:
- You may write only under src/ and test/. You may also read package.json and README.md. ES modules ("type": "module"), Node built-ins only, no dependencies.
- run_tests runs node --test on every .js file under test/; pass files to run only some of them while you iterate.
- If the project is something people open (a website, an API with pages, a game), the app starts with "node src/server.js" and listens on process.env.PORT, or it is a static src/index.html. Hive opens it that way to take screenshots. Export the server's start function so tests can import it without it listening on import. A static page loads its scripts and styles with relative paths (app.js, not /app.js).
- If the project is a command-line tool, it starts with "node src/cli.js <args>": it reads process.argv.slice(2), prints to stdout and exits, and never waits for input. Keep its logic in other src/ files so tests import those. run_cli runs it (15 s at most) and shows you and your teammates what it prints; try it once tests pass.

How to do the task:
- Read the files you need (dependencies' code is already in src/). Write the src/ code, then its tests in test/<task id>.test.js (or the test file the spec names) using node:test and node:assert/strict, then run the tests.
- If tests fail, read the failure output, fix the code or the test, and run them again. Call finish only after a full run_tests (no files filter) where your task's tests ran and every test passed.
- When a teammate's message appears, your next reply's first sentence starts with "Got it:" and says what you are changing, like "Got it: counting unique visitors; rewriting src/stats.js." Do this once per message, not on every later reply.
- Never print secrets.`;

const str = (description: string) => ({ type: 'string', description });
export const TOOLS: ToolDef[] = [
  {
    name: 'read_file', description: 'Read a file under src/ or test/ (or package.json, README.md). Lines are numbered. Optionally only a range of lines.',
    schema: { type: 'object', properties: { path: str('e.g. src/store.js'), start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] },
  },
  {
    name: 'write_file', description: 'Create or fully replace a file under src/ or test/ with the complete content.',
    schema: { type: 'object', properties: { path: str('e.g. src/stats.js'), content: str('the complete file') }, required: ['path', 'content'] },
  },
  {
    name: 'edit_file', description: 'Replace an exact snippet of an existing file. old_string must match the file exactly (whitespace included) and be unique unless replace_all is true. Include enough surrounding lines to make it unique.',
    schema: {
      type: 'object',
      properties: { path: str('the file to change'), old_string: str('exact text to find'), new_string: str('its replacement'), replace_all: { type: 'boolean' } },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'search', description: 'Search every file under src/ and test/ for a regular expression; returns matching lines with file and line number.',
    schema: { type: 'object', properties: { pattern: str('a JavaScript regular expression, e.g. createStore|export function') }, required: ['pattern'] },
  },
  {
    name: 'run_tests', description: 'Run node --test. With files, only those test files run; without, the whole suite runs.',
    schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'test files, e.g. ["test/stats.test.js"]' } }, required: [] },
  },
  {
    name: 'run_cli', description: 'Run node src/cli.js with these arguments (15 s at most) and show what it prints.',
    schema: { type: 'object', properties: { args: str(`e.g. add 'buy milk' --done`) }, required: [] },
  },
  {
    name: 'finish', description: 'Finish the task after a full test run passed. The summary says what you built, how it is tested, and anything left.',
    schema: { type: 'object', properties: { summary: str('two or three sentences') }, required: ['summary'] },
  },
];

export type Action =
  | { type: 'read'; path: string; start?: number; end?: number }
  | { type: 'search'; pattern: string }
  | { type: 'write'; path: string; content: string }
  | { type: 'edit'; path: string; old: string; new: string; all: boolean }
  | { type: 'test'; files?: string[] }
  | { type: 'run'; args: string[] }
  | { type: 'finish'; summary: string };

// Check a tool call's input and turn it into an action, or say what is wrong so the model can fix it.
export function toAction(c: ToolCall): { action?: Action; error?: string } {
  if (c.bad) return { error: `${c.bad}; nothing ran. If a file was too long for one reply, write it in smaller files or change it with edit_file.` };
  const i = c.input;
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined);
  const n = (k: string) => (typeof i[k] === 'number' && Number.isFinite(i[k]) ? Math.floor(i[k] as number) : undefined);
  const path = (read = false) => {
    const p = safePath(s('path'), read);
    if (!p) throw new Error(`path "${s('path') ?? ''}" is not allowed: write only under src/ or test/ (package.json and README.md are read-only)`);
    return p;
  };
  const need = (k: string) => { const v = s(k); if (v === undefined) throw new Error(`${c.name} needs a string "${k}"`); return v; };
  try {
    switch (c.name) {
      case 'read_file': return { action: { type: 'read', path: path(true), start: n('start_line'), end: n('end_line') } };
      case 'write_file': return { action: { type: 'write', path: path(), content: withNewline(need('content')) } };
      case 'edit_file': return { action: { type: 'edit', path: path(), old: need('old_string'), new: need('new_string'), all: i.replace_all === true } };
      case 'search': return { action: { type: 'search', pattern: need('pattern') } };
      case 'run_tests': {
        const files = Array.isArray(i.files) ? i.files.map((f) => safePath(f)).filter((f): f is string => !!f) : undefined;
        return { action: { type: 'test', files: files?.length ? files : undefined } };
      }
      case 'run_cli': return { action: { type: 'run', args: splitArgs(s('args') ?? '') } };
      case 'finish': return { action: { type: 'finish', summary: need('summary').trim() } };
      default: return { error: `there is no tool named "${c.name}"` };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const withNewline = (s: string) => (s.endsWith('\n') ? s : `${s}\n`);

// Apply an edit_file action to a file's text: the new text, or why it could not be applied.
export function applyEdit(text: string, old: string, rep: string, all: boolean): { text?: string; error?: string } {
  if (!old) return { error: 'old_string is empty; use write_file to create a file' };
  const count = text.split(old).length - 1;
  if (!count) {
    const loose = text.replace(/\r\n/g, '\n').split(old.replace(/\r\n/g, '\n')).length - 1;
    return { error: loose ? 'old_string matched only after normalizing line endings; copy it exactly from read_file' : 'old_string was not found; read the file again and copy the snippet exactly' };
  }
  if (count > 1 && !all) return { error: `old_string appears ${count} times; add surrounding lines to make it unique, or set replace_all` };
  return { text: all ? text.split(old).join(rep) : text.replace(old, () => rep) };
}

// Fallback for models that write the old text tags instead of calling tools (<write path="...">...</write> etc.).
export function parseAction(raw: string): { plan: string; action?: Action; error?: string } {
  // Drop reasoning, including an unclosed <think> left by a reply that hit the output limit.
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '');
  // The PLAN line, or failing that the first line of prose before any action (models sometimes drop the label).
  const labeled = /^[\s*#]*PLAN\**:\**\s*(.+)$/im.exec(text)?.[1];
  const prose = text.split(/<(?:read|search|write|test|run|finish)\b/)[0].split('\n').map((l) => l.trim()).find(Boolean);
  const plan = (labeled ?? prose ?? '').replace(/\*+$/, '').trim().slice(0, 300);
  const found = [
    { re: /<read\s+path="([^"]*)"\s*\/>/, make: (m: RegExpExecArray) => ({ type: 'read', path: m[1] }) },
    { re: /<search\s+pattern="([^"]+)"\s*\/>/, make: (m: RegExpExecArray) => ({ type: 'search', pattern: m[1] }) },
    { re: /<write\s+path="([^"]*)"\s*>([\s\S]*?)<\/write>/, make: (m: RegExpExecArray) => ({ type: 'write', path: m[1], content: unfence(m[2]) }) },
    { re: /<test\s*\/>/, make: () => ({ type: 'test' }) },
    { re: /<run(?:\s+args="([^"]*)")?\s*\/>/, make: (m: RegExpExecArray) => ({ type: 'run', args: splitArgs(m[1] ?? '') }) },
    { re: /<finish>([\s\S]*?)<\/finish>/, make: (m: RegExpExecArray) => ({ type: 'finish', summary: m[1].trim() }) },
  ].map(({ re, make }) => { const m = re.exec(text); return m ? { index: m.index, action: make(m) as Action } : null; })
    .filter((x) => x !== null)
    .sort((a, b) => a.index - b.index)[0];
  if (!found) {
    // A reply that hit the output limit mid-file leaves an unclosed <write>; say so, or the model repeats it.
    const cut = /<write\s+path="[^"]*"\s*>/.test(text) ? 'your <write> was cut off before </write> because the reply was too long; write a shorter file, splitting it into several smaller files if needed'
      : text.trim() === '' && /<think>/.test(raw) ? 'the reply ran out while thinking; think less and act' : '';
    return { plan, error: cut || 'no action found' };
  }
  const action = found.action;
  if (action.type === 'read' || action.type === 'write') {
    const p = safePath(action.path, action.type === 'read');
    if (!p) return { plan, error: `path "${action.path}" is not allowed: write only under src/ or test/ (package.json and README.md are read-only)` };
    action.path = p;
  }
  return { plan, action };
}

// Unwrap a Markdown code fence around file content; drop the newline right after <write ...>.
function unfence(s: string): string {
  const fenced = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(s);
  const body = fenced ? fenced[1] : s.replace(/^\r?\n/, '').replace(/[ \t]*$/, '');
  return body.endsWith('\n') ? body : `${body}\n`;
}

// The first sentence of a reply: the plan shown in the feed.
export const planOf = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s*#]*PLAN\**:\**\s*/i, '')
  .split('\n').map((l) => l.trim()).find(Boolean)?.replace(/\*+$/, '').slice(0, 300) ?? '';

// The files `node --test` picks up by default among those listFiles shows.
export const isTestFile = (f: string) => /^test\/.*\.js$/.test(f) || f.endsWith('.test.js');

export interface AgentContext {
  task: { id: string; title: string; spec: string };
  deps: { title: string; spec: string; summary: string }[];
  stack?: string;                     // the project's approved stack / spec doc
}

// The first message of every request. It changes only when the task does, so providers cache everything after it.
export function contextText(c: AgentContext): string {
  return [
    `Task id: ${c.task.id}`,
    `Title: ${c.task.title}`,
    `Spec: ${c.task.spec}`,
    c.stack ? `Project stack and spec (follow it where it applies to this task):\n${c.stack}` : '',
    c.deps.length ? `Finished dependencies (their code is in the workspace):\n${c.deps.map((d) => `- ${d.title}: ${d.spec}\n  Summary: ${d.summary || 'none'}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

// The workspace as it is now, sent with each new user message (and kept in the transcript, so history never changes).
export function stateText(files: string[], lastTest?: { passed: number; failed: number }): string {
  return [
    `Files in the workspace: ${files.join(', ') || 'none'}`,
    `Test files run_tests will run: ${files.filter(isTestFile).join(', ') || 'none'}`,
    `Last test run: ${lastTest ? `${lastTest.passed} passed, ${lastTest.failed} failed` : 'none yet'}`,
  ].join('\n');
}

// The context message, then the transcript. Consecutive plain user messages merge; tool results whose calls are no
// longer in the transcript (older sessions were trimmed) become plain text, so every call still has its answer.
export function buildMessages(context: string, transcript: Msg[]): Msg[] {
  const out: Msg[] = [{ role: 'user', content: context }];
  for (const [i, m] of transcript.entries()) {
    const orphan = i === 0 && m.role === 'user' && m.results?.length;
    const msg: Msg = orphan ? { role: 'user', content: [...m.results!.map((r) => r.content), m.content].filter(Boolean).join('\n\n') } : { ...m };
    const last = out[out.length - 1];
    if (last.role === msg.role && !msg.results?.length && !msg.calls?.length && !last.calls?.length) last.content = [last.content, msg.content].filter(Boolean).join('\n\n');
    else out.push(msg);
  }
  if (out[out.length - 1].role !== 'user') out.push({ role: 'user', content: 'Continue.' });
  return out;
}

const msgSize = (m: Msg) => m.content.length + (m.results ?? []).reduce((n, r) => n + r.content.length, 0)
  + (m.calls ?? []).reduce((n, c) => n + JSON.stringify(c.input).length, 0) + (m.reasoning?.length ?? 0);

// Keep a long session within budget without rewriting history every turn: once the transcript passes `budget`
// characters, older tool results and file bodies are shortened in one go (so the cached prefix is stable again
// until the next time). Thinking blocks are dropped everywhere then, since they are only valid on unedited history.
// Returns whether it changed anything.
export function compact(transcript: Msg[], budget: number, keep = 12): boolean {
  const size = transcript.reduce((n, m) => n + msgSize(m), 0);
  if (size <= budget) return false;
  const cut = Math.max(0, transcript.length - keep);
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …(${s.length - n} more characters elided to save space; read the file again if you need it)` : s);
  for (const [i, m] of transcript.entries()) {
    delete m.raw; delete m.rawModel; delete m.reasoning;
    if (i >= cut) continue;
    m.content = short(m.content, 1500);
    for (const r of m.results ?? []) { r.content = short(r.content, 300); delete r.images; }
    for (const c of m.calls ?? []) {
      for (const k of ['content', 'old_string', 'new_string']) {
        const v = c.input[k];
        if (typeof v === 'string' && v.length > 200) c.input[k] = `(${v.length} characters, elided)`;
      }
    }
  }
  return true;
}
