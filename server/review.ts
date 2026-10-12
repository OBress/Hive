import type { TaskSpec } from '@hive/shared/types';
import { trim } from './doc.ts';
import { git } from './git.ts';
import { generate, models } from './llm.ts';
import { extractJson } from './planner.ts';

// A second look before a task merges: the planner model reads the task's whole change against its spec and either
// approves it or sends concrete issues back to the agent. REVIEW=off skips it.

export const reviewOn = () => (process.env.REVIEW ?? 'on').toLowerCase() !== 'off';

const REVIEW_SYSTEM = `You are reviewing one task's change before it merges into main, in a shared workspace where coding agents build a project task by task.
Reply with strict JSON only: {"approve": true, "issues": []}

Approve unless there is a real problem a teammate would block the merge for:
- the change does not do what the task's spec asks, or misses part of it;
- the tests do not exercise the behaviour the spec asks for (missing, trivial, or asserting nothing meaningful);
- the code is clearly broken or wrong in a way the tests miss (bad logic, unhandled cases the spec names, crashes);
- it deletes or breaks other tasks' code without need.
Do not block on style, naming, comments or nice-to-haves. Each issue is one concrete sentence the agent can act on, naming the file.`;

export async function review(dir: string, t: TaskSpec, tests: { passed: number; failed: number }): Promise<{ approve: boolean; issues: string[] }> {
  const change = await git(dir, ['diff', 'main...HEAD']).catch(() => '');
  if (!change.trim()) return { approve: true, issues: [] };
  const text = await generate({
    model: models.planner, system: REVIEW_SYSTEM, maxTokens: 8000, json: true,
    messages: [{
      role: 'user',
      content: `Task ${t.id} "${t.title}"\nSpec: ${t.spec}\n\nTests on this branch: ${tests.passed} passed, ${tests.failed} failed.\n\nThe change (git diff against main):\n${trim(change, 60000)}`,
    }],
  });
  const out = (extractJson(text) ?? {}) as { approve?: unknown; issues?: unknown };
  const issues = Array.isArray(out.issues) ? out.issues.filter((i): i is string => typeof i === 'string' && !!i.trim()).slice(0, 8) : [];
  // Only an explicit "no" with something to fix blocks the merge; an unreadable reply never does.
  return { approve: !(out.approve === false && issues.length), issues };
}
