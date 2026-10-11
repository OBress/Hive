import type { Msg } from './llm.ts';
import { safePath } from './workspace.ts';

export const AGENT_SYSTEM = `You are a coding agent working on one task in a shared team workspace. Your teammates watch every step live and may message you while you work.

You work one action at a time. Each reply is exactly:
PLAN: <one line, under 25 words: the single action in THIS reply and why>
<exactly one action>

Actions:
<read path="src/store.js"/>
<write path="src/stats.js">
...the complete file content...
</write>
<test/>
<finish>Two or three sentences: what you built, how it is tested, anything left.</finish>

How the workspace works:
- Only the one action in your reply runs. Anything else you meant to do has not happened until a later reply does it, so the PLAN line describes only this reply's action.
- Trust only the "Files in the workspace" list and the results of your actions, never your earlier PLAN lines. A file not in that list does not exist yet.
- You may write only under src/ and test/. You may also read package.json and README.md. ES modules ("type": "module"), Node built-ins only, no dependencies.
- <test/> runs node --test, which picks up every .js file under test/ automatically; there is no config to check. Each result lists the test files that ran.

How to do the task:
- Read only the files you need (dependencies' code is already in src/). Write the src/ file, then write its tests in test/<task id>.test.js (or the test file the spec names) using node:test and node:assert/strict, then run <test/>.
- If tests fail, read the failure output, fix the code or the test, and run <test/> again. Finish only after a <test/> where your task's tests ran and all tests passed.
- When a teammate's message appears, your next reply's PLAN line starts with "Got it:" and says what you are changing, like "PLAN: Got it: counting unique visitors; rewriting src/stats.js." Do this once per message, not on every later reply.
- Keep files small and readable. Never print secrets.`;

// Added to the system prompt when an OpenCode server is connected.
export const SEARCH_HELP = `

One more action is available: <search pattern="createStore"/> searches every file under src/ and test/ for a regular expression and returns the matching lines with their file and line number. Use it to find where something is defined or used before you read whole files.`;

export type Action =
  | { type: 'read'; path: string }
  | { type: 'search'; pattern: string }
  | { type: 'write'; path: string; content: string }
  | { type: 'test' }
  | { type: 'finish'; summary: string };

export function parseAction(raw: string): { plan: string; action?: Action; error?: string } {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  // The PLAN line, or failing that the first line of prose before any action (models sometimes drop the label).
  const labeled = /^[\s*#]*PLAN\**:\**\s*(.+)$/im.exec(text)?.[1];
  const prose = text.split(/<(?:read|search|write|test|finish)\b/)[0].split('\n').map((l) => l.trim()).find(Boolean);
  const plan = (labeled ?? prose ?? '').replace(/\*+$/, '').trim().slice(0, 300);
  const found = [
    { re: /<read\s+path="([^"]*)"\s*\/>/, make: (m: RegExpExecArray) => ({ type: 'read', path: m[1] }) },
    { re: /<search\s+pattern="([^"]+)"\s*\/>/, make: (m: RegExpExecArray) => ({ type: 'search', pattern: m[1] }) },
    { re: /<write\s+path="([^"]*)"\s*>([\s\S]*?)<\/write>/, make: (m: RegExpExecArray) => ({ type: 'write', path: m[1], content: unfence(m[2]) }) },
    { re: /<test\s*\/>/, make: () => ({ type: 'test' }) },
    { re: /<finish>([\s\S]*?)<\/finish>/, make: (m: RegExpExecArray) => ({ type: 'finish', summary: m[1].trim() }) },
  ].map(({ re, make }) => { const m = re.exec(text); return m ? { index: m.index, action: make(m) as Action } : null; })
    .filter((x) => x !== null)
    .sort((a, b) => a.index - b.index)[0];
  if (!found) return { plan, error: 'no action found' };
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

// The files `node --test` picks up by default among those listFiles shows.
export const isTestFile = (f: string) => /^test\/.*\.js$/.test(f) || f.endsWith('.test.js');

export interface AgentContext {
  task: { id: string; title: string; spec: string };
  deps: { title: string; spec: string; summary: string }[];
  files: string[];
  lastTest?: { passed: number; failed: number };
  summary: string;
  stack?: string;                     // the project's approved stack / spec doc
}

export function contextText(c: AgentContext): string {
  return [
    `Task id: ${c.task.id}`,
    `Title: ${c.task.title}`,
    `Spec: ${c.task.spec}`,
    c.stack ? `Project stack and spec (follow it where it applies to this task):\n${c.stack}` : '',
    c.deps.length ? `Finished dependencies (their code is in the workspace):\n${c.deps.map((d) => `- ${d.title}: ${d.spec}\n  Summary: ${d.summary || 'none'}`).join('\n')}` : '',
    `Files in the workspace: ${c.files.join(', ') || 'none'}`,
    `Test files <test/> will run: ${c.files.filter(isTestFile).join(', ') || 'none'}`,
    `Last test run: ${c.lastTest ? `${c.lastTest.passed} passed, ${c.lastTest.failed} failed` : 'none yet'}`,
    c.summary ? `Summary of this session so far:\n${c.summary}` : '',
  ].filter(Boolean).join('\n\n');
}

// The context message, then the last 16 transcript messages, alternating and ending with a user message.
export function buildMessages(context: string, transcript: Msg[]): Msg[] {
  const window = transcript.slice(-16);
  const out: Msg[] = [{ role: 'user', content: context }];
  for (const m of window) {
    const last = out[out.length - 1];
    if (last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ ...m });
  }
  if (out[out.length - 1].role !== 'user') out.push({ role: 'user', content: 'Continue.' });
  return out;
}
