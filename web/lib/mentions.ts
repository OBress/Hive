import type { Task } from './types';

// Chat references: @T3 points at a task, @src/app.js at a file. Plain text on the wire,
// so the server (Planner) sees exactly what the person typed.

export type MentionOption =
  | { kind: 'task'; id: string; title: string }
  | { kind: 'file'; path: string; tasks: string[] };

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'task'; id: string; title: string }
  | { kind: 'file'; path: string };

export const TOKEN = /@([\w./-]+)/g;

export function allFiles(tasks: Record<string, Task>): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const t of Object.values(tasks)) for (const f of t.files) files.set(f, [...(files.get(f) ?? []), t.id]);
  return files;
}

export function mentionOptions(tasks: Record<string, Task>, query: string): MentionOption[] {
  const q = query.toLowerCase();
  const taskOpts: MentionOption[] = Object.values(tasks)
    .filter((t) => !q || t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .map((t) => ({ kind: 'task', id: t.id, title: t.title }));
  const fileOpts: MentionOption[] = [...allFiles(tasks)]
    .filter(([f]) => !q || f.toLowerCase().includes(q))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, ids]) => ({ kind: 'file', path, tasks: ids }));
  return [...taskOpts.slice(0, 6), ...fileOpts.slice(0, 6)];
}

export const mentionText = (o: MentionOption) => `@${o.kind === 'task' ? o.id : o.path}`;

// Split a message into text and resolved mentions. Unknown @words stay plain text.
export function parseMentions(text: string, tasks: Record<string, Task>): Segment[] {
  const files = allFiles(tasks);
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[1].replace(/[.,!?;:]+$/, '');          // "see @T3." -> T3
    const task = tasks[raw] ?? tasks[raw.toUpperCase()];
    const seg: Segment | null = task ? { kind: 'task', id: task.id, title: task.title }
      : files.has(raw) ? { kind: 'file', path: raw } : null;
    if (!seg) continue;
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push(seg);
    last = m.index! + 1 + raw.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

// Search across a task's id, title, spec, checks, files and assignee.
export function taskMatches(t: Task, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^[@#]/, '');
  if (!q) return true;
  return [t.id, t.title, t.spec, t.assignee, ...t.acceptance, ...t.files].some((f) => f.toLowerCase().includes(q));
}
