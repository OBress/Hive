import { expect, test } from 'vitest';
import type { TaskSpec, TaskState } from '@hive/shared/types';
import { applyOps, hasCycle, readyTasks, topoOrder } from './graph.ts';

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

test('a duplicate id is renamed and placed right of its dependency', () => {
  const r = applyOps(base(), {}, [{ op: 'addTask', task: { id: 'stats', title: 'Unique stats', spec: 'x', deps: ['stats'] } }]);
  expect(r.changedIds).toEqual(['stats-2']);
  expect(r.tasks['stats-2']).toMatchObject({ deps: ['stats'], x: 840, createdBy: 'planner' });
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
