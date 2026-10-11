'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges, Background, BackgroundVariant, ControlButton, Controls, MarkerType, ReactFlow, useNodesInitialized, useReactFlow,
  type Connection, type Edge, type EdgeChange, type NodeChange,
} from '@xyflow/react';
import { layoutGraph, NODE_H, overlaps } from '@hive/shared/layout';
import '@xyflow/react/dist/style.css';
import { usePeers } from '@/lib/hive';
import { taskMatches } from '@/lib/mentions';
import { addEdge, moveTask, moveTasks, removeEdge, useHive } from '@/lib/mock';
import TaskNode, { type TaskNodeType } from './TaskNode';

const nodeTypes = { task: TaskNode };

export default function Graph({ me, selected, onSelect, query, showDone }: {
  me: string; selected: string | null; onSelect: (id: string | null) => void; query: string; showDone: boolean;
}) {
  const s = useHive();
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<TaskNodeType[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Who has each task open: this tab plus everyone connected (Hocuspocus awareness).
  const peers = usePeers();
  const viewers = useMemo(() => {
    const out: Record<string, string[]> = {};
    const open: [string, string | undefined][] = [[me, selected ?? undefined], ...peers.map((p): [string, string | undefined] => [p.name, p.openTaskId])];
    for (const [name, id] of open) if (id) (out[id] ??= []).push(name);
    return out;
  }, [peers, me, selected]);

  // Completed tasks can be hidden; the open one always stays visible.
  const visible = useCallback((id: string) => showDone || s.runs[id]?.status !== 'done' || id === selected,
    [showDone, s.runs, selected]);

  // Tasks map -> React Flow nodes, keeping React Flow's own measurements and drag state.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return Object.values(s.tasks).filter((t) => visible(t.id)).map((t) => {
        const p = byId.get(t.id);
        return {
          ...p,
          id: t.id, type: 'task', deletable: false,
          position: p?.dragging ? p.position : { x: t.x, y: t.y },
          selected: t.id === selected,
          className: query.trim() && !taskMatches(t, query) ? 'is-dim' : '',
          data: { task: t, run: s.runs[t.id], viewers: viewers[t.id] ?? [], flash: s.focus?.id === t.id ? s.focus.at : 0 },
        } as TaskNodeType;
      });
    });
  }, [s.tasks, s.runs, s.focus, selected, viewers, query, visible]);

  const edges = useMemo<Edge[]>(() => Object.values(s.tasks).filter((t) => visible(t.id)).flatMap((t) =>
    t.dependsOn.filter((d) => s.tasks[d] && visible(d)).map((d) => {
      const st = s.runs[t.id]?.status;
      const id = `${d}->${t.id}`;
      return {
        id, source: d, target: t.id,
        animated: st === 'running',
        selected: id === selectedEdge,
        className: st === 'stale' ? 'is-stale' : st === 'running' ? 'is-running' : '',
        markerEnd: { type: MarkerType.ArrowClosed, width: 6, height: 6, color: st === 'stale' ? '#ff5c1a' : st === 'running' ? '#2563eb' : '#14121a' },
      };
    })), [s.tasks, s.runs, selectedEdge, visible]);

  const onNodesChange = useCallback((changes: NodeChange<TaskNodeType>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) if (c.type === 'position' && c.position) moveTask(c.id, Math.round(c.position.x), Math.round(c.position.y));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) {
      if (c.type === 'select') setSelectedEdge(c.selected ? c.id : null);
      if (c.type === 'remove') { const [from, to] = c.id.split('->'); removeEdge(from, to, me); }
    }
  }, [me]);

  const onConnect = useCallback((c: Connection) => addEdge(c.source, c.target, me), [me]);

  // Cards never overlap: when tasks or links change and any two visible cards (at their real, measured
  // heights) overlap, lay the whole graph out again, top to bottom (shared/layout.ts, the same as the server).
  // Never on drags, so it doesn't fight a person moving cards. The Tidy button does it on demand.
  const measured = useNodesInitialized();
  const shape = Object.values(s.tasks).map((t) => `${t.id}<${t.dependsOn.join('|')}`).sort().join(',');
  const tidied = useRef('');
  const tidy = useCallback(() => {
    const h = new Map(rf.getNodes().map((n) => [n.id, n.measured?.height ?? NODE_H]));
    moveTasks(layoutGraph(Object.values(s.tasks).map((t) => ({ id: t.id, deps: t.dependsOn })), (id) => h.get(id) ?? NODE_H));
    setTimeout(() => rf.fitView({ padding: 0.22, duration: 500, maxZoom: 1.05 }), 50);
  }, [rf, s.tasks]);
  useEffect(() => {
    if (!measured || !shape || tidied.current === shape) return;
    tidied.current = shape;
    const boxes = rf.getNodes().map((n) => ({ x: n.position.x, y: n.position.y, h: n.measured?.height ?? NODE_H }));
    if (overlaps(boxes)) tidy();
  }, [measured, shape, rf, tidy]);

  // Zoom to fit as the Planner adds nodes.
  const count = nodes.length;
  useEffect(() => {
    if (!count) return;
    const t = setTimeout(() => rf.fitView({ padding: 0.22, duration: 500, maxZoom: 1.05 }), 250);
    return () => clearTimeout(t);
  }, [count, rf]);

  // Center a cited or chip-clicked task in the part of the canvas the task panel doesn't cover.
  useEffect(() => {
    const t = s.focus && s.tasks[s.focus.id];
    if (t) rf.setCenter(t.x + 130 + 227, t.y + 70, { zoom: 1, duration: 600 });
  }, [s.focus, rf]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => { onSelect(null); setSelectedEdge(null); }}
      minZoom={0.35} maxZoom={1.6} fitView
      defaultEdgeOptions={{ type: 'default' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={2.4} color="rgba(20,18,26,0.16)" />
      <Controls showInteractive={false} position="bottom-right">
        <ControlButton onClick={tidy} title="Tidy: lay the graph out again" aria-label="Tidy the graph layout">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v4H4zM14 5h6v4h-6zM9 15h6v4H9zM7 9v3h10V9M12 12v3" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>
        </ControlButton>
      </Controls>
    </ReactFlow>
  );
}
