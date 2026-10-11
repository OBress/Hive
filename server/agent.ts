import type { Msg } from './llm.ts';
import { safePath } from './workspace.ts';

export const AGENT_SYSTEM = `You are a coding agent working on one task in a shared team workspace. Your teammates watch every step live and may message you while you work.

Each turn, write exactly:
1. One line starting with "PLAN:" saying what you will do next and why (under 25 words).
2. Exactly one action:
   <read path="src/store.js"/>
   <write path="src/stats.js">
   ...the complete file content...
   </write>
   <test/>
   <finish>Two or three sentences: what you built, how it is tested, anything left.</finish>

Rules:
- Only touch files under src/ and test/. ES modules, Node built-ins only, no dependencies.
- Write tests for your task in test/<task id>.test.js using node:test and node:assert/strict.
- Run <test/> before <finish>. Finish only when all tests pass.
- When a message from a teammate appears, start your next PLAN with "Got it:" and say what you are changing.
- Keep files small and readable. Never print secrets.`;

export type Action =
  | { type: 'read'; path: string }
  | { type: 'write'; path: string; content: string }
  | { type: 'test' }
  | { type: 'finish'; summary: string };

export function parseAction(raw: string): { plan: string; action?: Action; error?: string } {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const plan = /^\s*PLAN:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  const found = [
    { re: /<read\s+path="([^"]*)"\s*\/>/, make: (m: RegExpExecArray) => ({ type: 'read', path: m[1] }) },
    { re: /<write\s+path="([^"]*)"\s*>([\s\S]*?)<\/write>/, make: (m: RegExpExecArray) => ({ type: 'write', path: m[1], content: unfence(m[2]) }) },
    { re: /<test\s*\/>/, make: () => ({ type: 'test' }) },
    { re: /<finish>([\s\S]*?)<\/finish>/, make: (m: RegExpExecArray) => ({ type: 'finish', summary: m[1].trim() }) },
  ].map(({ re, make }) => { const m = re.exec(text); return m ? { index: m.index, action: make(m) as Action } : null; })
    .filter((x) => x !== null)
    .sort((a, b) => a.index - b.index)[0];
  if (!found) return { plan, error: 'no action found' };
  const action = found.action;
  if (action.type === 'read' || action.type === 'write') {
    const p = safePath(action.path);
    if (!p) return { plan, error: `path "${action.path}" is not allowed; use src/ or test/` };
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

export interface AgentContext {
  task: { id: string; title: string; spec: string };
  deps: { title: string; spec: string; summary: string }[];
  files: string[];
  lastTest?: { passed: number; failed: number };
  summary: string;
}

export function contextText(c: AgentContext): string {
  return [
    `Task id: ${c.task.id}`,
    `Title: ${c.task.title}`,
    `Spec: ${c.task.spec}`,
    c.deps.length ? `Finished dependencies (their code is in the workspace):\n${c.deps.map((d) => `- ${d.title}: ${d.spec}\n  Summary: ${d.summary || 'none'}`).join('\n')}` : '',
    `Files in the workspace: ${c.files.join(', ') || 'none'}`,
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
