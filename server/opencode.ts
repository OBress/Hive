import { sandboxOn, sandboxOpenCode } from './sandbox.ts';

// The agent looks through a task's files with an OpenCode server (`opencode serve`): its search and file
// endpoints need no model, so Hive's own step loop stays in charge. With a sandbox, the OpenCode server
// inside it is used; otherwise set OPENCODE_URL to one running on this machine.
const url = () => (process.env.OPENCODE_URL ?? '').trim().replace(/\/+$/, '');
export const openCodeOn = () => sandboxOn() || !!url();

export interface Match { path: string; line: number; text: string }
type Found = { path: { text: string }; lines: { text: string }; line_number: number }[];

async function local(dir: string, pattern: string): Promise<unknown> {
  const pw = process.env.OPENCODE_SERVER_PASSWORD;
  const headers: Record<string, string> = pw
    ? { Authorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${pw}`).toString('base64')}` }
    : {};
  const res = await fetch(`${url()}/find?${new URLSearchParams({ pattern, directory: dir })}`, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`OpenCode HTTP ${res.status}`);
  return res.json();
}

// Regex search (ripgrep) over src/ and test/ of one worktree.
export async function search(dir: string, pattern: string): Promise<Match[]> {
  const found = (await (sandboxOn() ? sandboxOpenCode(dir, '/find', { pattern }) : local(dir, pattern))) as Found;
  return found
    .map((m) => ({ path: m.path.text.replace(/\\/g, '/'), line: m.line_number, text: m.lines.text.trim().slice(0, 200) }))
    .filter((m) => /^(src|test)\//.test(m.path))
    .slice(0, 30);
}
