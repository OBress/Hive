import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskSpec, TaskState } from '@hive/shared/types';
import { addChat, addStep, sessions, taskState, tasks } from './doc.ts';
import { withRepoLock } from './git.ts';
import { autoStartable, waitingForOk } from './graph.ts';
import { generate, models, visionModel } from './llm.ts';
import { applyGraphOps, extractJson } from './planner.ts';
import { screenshot } from './preview.ts';
import { current, currentId, projectDir, workspaceDir } from './projects.ts';
import { runTests } from './runner.ts';
import { modeOf, schedule } from './session.ts';
import { listFiles } from './workspace.ts';

// The goal check. In Semi-auto and Automatic, once every task is done the planner tests main, looks at a
// screenshot of the app when it can, and decides whether the goal is met. If not it adds follow-up tasks:
// Automatic runs them, Semi-auto marks them "ask" so a person OKs each one. At most MAX_ROUNDS checks run
// before a person speaks again (chat or a mode change), and the graph never grows past MAX_TASKS.
// It also says once when the graph is stuck: nothing running or startable because tasks failed twice.

const MAX_ROUNDS = 3;
const MAX_TASKS = 40;
const rounds = new Map<string, number>();
const seen = new Map<string, string>();   // project -> graph signature last checked or reported
const checking = new Set<string>();
const capped = new Set<string>();         // projects that hit MAX_ROUNDS and are waiting for a person

// A person spoke or changed the mode: the round limit starts over, and a project stopped at the limit checks again.
export function resetRounds() {
  const id = currentId();
  rounds.delete(id);
  if (capped.delete(id)) seen.delete(id);
}

export async function afterSchedule() {
  const mode = modeOf();
  const id = currentId();
  if (mode === 'manual' || checking.has(id)) return;
  const all = tasks().toJSON() as Record<string, TaskSpec>;
  const states = taskState().toJSON() as Record<string, TaskState>;
  const ids = Object.keys(all);
  if (!ids.length) return;
  const sig = ids.sort().map((t) => `${t}:${states[t]?.status}`).join(',');
  if (seen.get(id) === sig) return;

  if (!ids.every((t) => states[t]?.status === 'done')) {
    const moving = ids.some((t) => states[t]?.status === 'running' || states[t]?.owner.kind === 'human')
      || autoStartable(all, states, mode).length > 0 || waitingForOk(all, states, mode).length > 0;
    const stuck = ids.filter((t) => states[t]?.status === 'failed' || states[t]?.status === 'needs_review');
    if (moving || !stuck.length) return;
    seen.set(id, sig);
    addChat({ from: 'planner', text: `I stopped: ${stuck.map((t) => all[t].title).join(', ')} ${stuck.length > 1 ? 'are' : 'is'} stuck (failed twice or needs review), and the rest depends on ${stuck.length > 1 ? 'them' : 'it'}. Take it over, change its spec, or press Start to try again.`, taskIds: stuck });
    return;
  }

  seen.set(id, sig);
  const n = rounds.get(id) ?? 0;
  if (n >= MAX_ROUNDS) {
    capped.add(id);
    addChat({ from: 'planner', text: `I ran ${MAX_ROUNDS} goal checks in a row, so I'm stopping here. Tell me to keep going, or what to change.` });
    return;
  }
  rounds.set(id, n + 1);
  checking.add(id);
  try {
    await checkGoal(all, mode === 'semi');
  } catch (e) {
    console.error('Goal check failed:', (e as Error).message);
    addChat({ from: 'planner', text: `I could not run the goal check: ${(e as Error).message}` });
  } finally {
    checking.delete(id);
  }
}

const CHECK_SYSTEM = `You are Hive's planner, running the goal check. Every task in the graph is done and merged into main. Decide whether the project now meets its goal (and its stack and spec, if given), using the test results on main and, when attached, a screenshot of the running app.
Reply with strict JSON only:
{"done": true, "reply": "...", "ops": []}

- "done": true when the goal is met and tests pass; then "ops" is empty.
- "reply": two or three sentences for the team chat: what you checked, what you saw, and what is missing if anything.
- "ops": follow-up tasks only, as {"op":"addTask","task":{"id":"short-id","title":"...","spec":"what to build, naming the file under src/","deps":["existing ids"]}}.
  Add a task to fix failing tests on main. Add tasks for clearly missing parts of the goal or for visible problems in the screenshot.
  Keep each task small and testable on its own; add at most 5. Add "ask": true to tasks that deploy, delete data, spend money or touch outside accounts.`;

async function checkGoal(all: Record<string, TaskSpec>, semi: boolean) {
  const p = current();
  const r = await withRepoLock(() => runTests(workspaceDir()));
  const rel = `previews/check-${Date.now()}.png`;
  const shot = await screenshot(workspaceDir(), join(projectDir(), rel));
  const vision = shot.ok ? visionModel() : '';
  const summary = (t: TaskSpec) => sessions().get(taskState().get(t.id)?.sessionId ?? '')?.summary || 'none';
  const room = Math.max(0, MAX_TASKS - Object.keys(all).length);
  const content = [
    `Project: ${p.name}`, `Goal: ${p.goal || '(none given)'}`,
    p.stack ? `Approved stack and spec:\n${p.stack}` : '',
    `Tasks (all done):\n${Object.values(all).map((t) => `- ${t.id} "${t.title}": ${t.spec}\n  Summary: ${summary(t)}`).join('\n')}`,
    `Files on main: ${listFiles(workspaceDir()).join(', ') || 'none'}`,
    `Tests on main: ${r.passed} passed, ${r.failed} failed\n${r.output.slice(-1500)}`,
    shot.ok ? (vision ? 'A screenshot of the running app is attached.' : 'A screenshot was taken, but you cannot see images; judge from the tests and files.') : `No screenshot: ${shot.why}.`,
    room ? `You may add up to ${Math.min(5, room)} tasks.` : 'The graph is full: add no tasks.',
  ].filter(Boolean).join('\n\n');

  const text = await generate({
    model: vision || models.planner, system: CHECK_SYSTEM, maxTokens: 8000, json: true,
    messages: [{ role: 'user', content, images: vision && shot.ok ? [readFileSync(shot.file).toString('base64')] : undefined }],
  });
  const out = (extractJson(text) ?? {}) as { done?: unknown; reply?: unknown; ops?: unknown };
  const ops = (Array.isArray(out.ops) ? out.ops : []).filter((o) => (o as { op?: string })?.op === 'addTask').slice(0, Math.min(5, room));
  const added = ops.length ? applyGraphOps(ops, 'goal check', semi ? { ask: true } : {}).taskIds : [];
  const verdict = added.length ? `added ${added.length} follow-up task${added.length > 1 ? 's' : ''}` : out.done === false ? 'not done yet' : 'goal met';
  addStep({
    kind: 'check', by: 'planner', text: `Goal check: ${r.passed} passed, ${r.failed} failed on main; ${verdict}`,
    test: r, image: shot.ok ? rel : undefined,
  });
  const reply = typeof out.reply === 'string' && out.reply.trim() ? out.reply.trim() : `Goal check: ${verdict}.`;
  const next = !added.length ? '' : semi ? '\n\nThe new tasks are marked "ask": press Start on each one you want built.' : '\n\nStarting them now.';
  addChat({ from: 'planner', text: reply + next, taskIds: added.length ? added : undefined });
  if (added.length) schedule();
}
