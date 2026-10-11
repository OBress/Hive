import { expect, test } from 'vitest';
import type { TaskSpec, TaskState } from '@hive/shared/types';
import { NODE_H, overlaps } from '@hive/shared/layout';
import { applyOps, autoStartable, hasCycle, readyTasks, topoOrder, waitingForOk } from './graph.ts';

const t = (id: string, deps: string[] = [], x = 0): TaskSpec => ({ id, title: id, spec: `${id} spec`, deps, x, y: 40, createdBy: 'seed' });
const base = () => ({ store: t('store'), redirect: t('redirect', ['store'], 280), stats: t('stats', ['redirect'], 560) });
const st = (id: string, status: TaskState['status']): TaskState => ({ taskId: id, status, owner: { kind: 'agent', name: 'agent' }, updatedAt: '' });

test('topological order and ready set', () => {
  expect(topoOrder(base())).toEqual(['store', 'redirect', 'stats']);
  const states = { store: st('store', 'done'), redirect: st('redirect', 'todo'), stats: st('stats', 'todo') };
  expect(readyTasks(base(), states)).toEqual(['redirect']);
});

test('a cycle is rejected', () => {
  const r = applyOps(base(), {}, [{ op: 'addDep', from: 'stats', to: 'store' }]);
  expect(r.rejected[0]).toMatch(/cycle/);
  expect(r.tasks.store.deps).toEqual([]);
  expect(hasCycle(r.tasks)).toBe(false);
});

test('a dependency is added', () => {
  const r = applyOps(base(), {}, [{ op: 'addDep', from: 'store', to: 'stats' }]);
  expect(r.rejected).toEqual([]);
  expect(r.tasks.stats.deps).toEqual(['redirect', 'store']);
  expect(r.changedIds).toEqual(['stats']);
});

test('a duplicate id is renamed and laid out one row below its dependency', () => {
  const r = applyOps(base(), {}, [{ op: 'addTask', task: { id: 'stats', title: 'Unique stats', spec: 'x', deps: ['stats'] } }]);
  expect(r.changedIds).toEqual(['stats-2']);
  expect(r.tasks['stats-2']).toMatchObject({ deps: ['stats'], createdBy: 'planner' });
  expect(r.tasks['stats-2'].y).toBeGreaterThan(r.tasks.stats.y);
});

test('the layout never overlaps cards, even side by side', () => {
  const r = applyOps({}, {}, ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ op: 'addTask', task: { id, title: id, spec: 's', deps: i ? ['a'] : [] } })));
  const boxes = Object.values(r.tasks).map((t) => ({ x: t.x, y: t.y, h: NODE_H }));
  expect(overlaps(boxes)).toBe(false);
  expect(new Set(Object.values(r.tasks).filter((t) => t.id !== 'a').map((t) => t.y)).size).toBe(1);   // one row
  expect(overlaps([{ x: 0, y: 0, h: 130 }, { x: 0, y: 120, h: 130 }])).toBe(true);
});

test('modes decide which ready tasks start by themselves', () => {
  const tasks = { a: t('a'), b: { ...t('b'), ask: true } };
  const states = { a: st('a', 'todo'), b: st('b', 'todo') };
  expect(autoStartable(tasks, states, 'manual')).toEqual([]);
  expect(autoStartable(tasks, states, 'semi')).toEqual(['a']);
  expect(waitingForOk(tasks, states, 'semi')).toEqual(['b']);
  expect(autoStartable(tasks, states, 'auto').sort()).toEqual(['a', 'b']);
  expect(waitingForOk(tasks, states, 'auto')).toEqual([]);
});

test('unknown ids and running removals are rejected', () => {
  const r = applyOps(base(), { store: st('store', 'running') }, [
    { op: 'updateTask', id: 'nope', fields: { title: 'x' } },
    { op: 'removeTask', id: 'store' },
    { op: 'addTask', task: { id: 'a', title: 'A', spec: 's', deps: ['ghost'] } },
  ]);
  expect(r.rejected).toHaveLength(3);
  expect(Object.keys(r.tasks)).toEqual(['store', 'redirect', 'stats']);
});
