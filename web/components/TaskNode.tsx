'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Task, TaskRun } from '@/lib/types';
import { displayStatus, StatusSticker } from './Status';
import { Avatar, Icon } from './ui';

export type TaskNodeData = { task: Task; run?: TaskRun; viewers: string[]; flash: number };
export type TaskNodeType = Node<TaskNodeData, 'task'>;

export default function TaskNode({ data, selected }: NodeProps<TaskNodeType>) {
  const { task, run, viewers, flash } = data;
  const status = displayStatus(task, run);
  const human = task.assignee !== 'agent';

  return (
    <div className={`hv-node hv-s-${status}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      {viewers.length > 0 && (
        <div className="hv-node__viewers">
          {viewers.map((v) => <Avatar key={v} name={v} size={26} />)}
        </div>
      )}
      {/* keyed on status so the one-shot transition animation replays on every change */}
      <div key={status} className="hv-node__body">
        <div className="hv-node__top">
          <span className="hv-node__id">#{task.id}</span>
          <span className={`hv-node__who${human ? ' is-human' : ''}`}>
            {human ? <Avatar name={task.assignee} size={22} /> : <Icon name="bot" size={16} />}
            {human ? task.assignee : 'agent'}
          </span>
        </div>
        <div className="hv-node__title">{task.title}</div>
        <div className="hv-node__foot">
          <StatusSticker status={status} size="sm" />
          {run?.commit && status === 'done' && <span className="hv-node__commit">{run.commit}</span>}
        </div>
      </div>
      {(status === 'running' || status === 'stale') && <div className="hv-node__bar" />}
      {flash > 0 && <span key={flash} className="hv-node__flash" />}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
