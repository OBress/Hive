'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, Controls, MiniMap, ReactFlow,
  ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type EdgeChange, type IsValidConnection, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArchNode, ZoneBox } from '@/components/ArchNode';
import TopBar from '@/components/TopBar';
import { Icon } from '@/components/ui';
import { useUserName } from '@/lib/hive';
import {
  INITIAL_EDGES, INITIAL_NODES, portType, saved, TEMPLATES, WIRES, ZONES,
  type AnyNode, type ArchData, type ArchNode as ArchNodeType, type Health,
} from '@/lib/architecture';

const nodeTypes = { arch: ArchNode, zone: ZoneBox };

export default function ArchitecturePage() {
  return (
    <ReactFlowProvider>
      <Architecture />
    </ReactFlowProvider>
  );
}

function Architecture() {
  const me = useUserName();
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<AnyNode[]>(() => saved.nodes ?? INITIAL_NODES);
  const [edges, setEdges] = useState<Edge[]>(() => saved.edges ?? INITIAL_EDGES);
  const [selected, setSelected] = useState<string | null>(null);
  const [traffic, setTraffic] = useState(true);
  const [palette, setPalette] = useState(false);

  useEffect(() => { saved.nodes = nodes; saved.edges = edges; }, [nodes, edges]);

  // Wires take the color of their socket type; "traffic" animates them.
  const styledEdges = useMemo(() => edges.map((e) => {
    const t = portType(nodes.find((n) => n.id === e.source), e.sourceHandle, 'outs') ?? 'https';
    const touches = selected && (e.source === selected || e.target === selected);
    return {
      ...e, animated: traffic, className: `hv-wire${touches ? ' is-hot' : ''}${selected && !touches ? ' is-dim' : ''}`,
      style: { stroke: WIRES[t].color },
    };
  }), [edges, nodes, traffic, selected]);

  const onNodesChange = useCallback((c: NodeChange<AnyNode>[]) => setNodes((ns) => applyNodeChanges(c, ns)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es)), []);
  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, id: `${c.source}.${c.sourceHandle}->${c.target}.${c.targetHandle}` }, es)), []);

  // Like ComfyUI: a wire only connects sockets of the same type.
  const isValidConnection: IsValidConnection = useCallback((c) => {
    const a = portType(nodes.find((n) => n.id === c.source), c.sourceHandle, 'outs');
    const b = portType(nodes.find((n) => n.id === c.target), c.targetHandle, 'ins');
    return !!a && a === b && c.source !== c.target;
  }, [nodes]);

  const addFromTemplate = (t: ArchData) => {
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 60 });
    const id = `${t.title.toLowerCase().replace(/\W+/g, '-')}-${Date.now().toString(36).slice(-4)}`;
    setNodes((ns) => [...ns, { id, type: 'arch', position: center, data: { ...t, ins: [...t.ins], outs: [...t.outs] }, selected: true }]);
    setSelected(id);
    setPalette(false);
  };

  const reset = () => { setNodes(INITIAL_NODES); setEdges(INITIAL_EDGES); setSelected(null); setTimeout(() => rf.fitView({ padding: 0.08, duration: 500 }), 30); };

  const setHealth = (id: string, health: Health) =>
    setNodes((ns) => ns.map((n) => (n.id === id && n.type === 'arch' ? { ...n, data: { ...n.data, health } } : n)));

  const sel = nodes.find((n) => n.id === selected && n.type === 'arch') as ArchNodeType | undefined;
  const counts = nodes.reduce((acc, n) => { if (n.type === 'arch') acc[n.data.health]++; return acc; }, { live: 0, mock: 0, planned: 0 } as Record<Health, number>);

  return (
    <div className="hv-app">
      <TopBar me={me}>
        <button className={`hv-btn ${traffic ? 'hv-btn--blue' : 'hv-btn--paper'}`} onClick={() => setTraffic(!traffic)} aria-pressed={traffic}>
          <Icon name="bolt" size={16} /> Traffic {traffic ? 'on' : 'off'}
        </button>
      </TopBar>
      <main className="hv-archstage">
        <ReactFlow
          nodes={nodes} edges={styledEdges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, n) => setSelected(n.type === 'arch' ? n.id : null)}
          onPaneClick={() => { setSelected(null); setPalette(false); }}
          onPaneContextMenu={(e) => { e.preventDefault(); setPalette(true); }}
          fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.2} maxZoom={1.6}
          defaultEdgeOptions={{ type: 'default' }}
          colorMode="dark"
        >
          <Background id="dots" variant={BackgroundVariant.Dots} gap={24} size={1.6} color="rgba(245,239,228,0.14)" />
          <Background id="grid" variant={BackgroundVariant.Lines} gap={120} lineWidth={1} color="rgba(245,239,228,0.05)" />
          <MiniMap pannable zoomable className="hv-minimap" nodeColor={(n) => (n.type === 'zone' ? 'transparent' : ZONES[(n.data as ArchData).zone].color)} maskColor="rgba(20,18,26,0.7)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>

        <div className="hv-archbar">
          <div className="hv-archbar__title">
            <b>System map</b>
            <span>{counts.live} live · {counts.mock} mock · {counts.planned} planned</span>
          </div>
          <div className="hv-archbar__menu">
            <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={() => setPalette(!palette)} aria-expanded={palette}>
              <Icon name="plus" size={14} /> Add node
            </button>
            {palette && (
              <div className="hv-palette" role="menu">
                <span className="hv-label">Add to the map</span>
                {TEMPLATES.map((t) => (
                  <button key={t.title} role="menuitem" className="hv-palette__item" onClick={() => addFromTemplate(t)}>
                    <span className={`hv-palette__glyph hv-arch--${t.zone}`}>{t.glyph}</span>
                    <span><b>{t.title}</b><em>{t.kind}</em></span>
                  </button>
                ))}
                <span className="hv-palette__hint">Tip: right-click the canvas to open this menu.</span>
              </div>
            )}
          </div>
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={reset}>Reset layout</button>
        </div>

        <div className="hv-wirelegend">
          {Object.entries(WIRES).map(([k, w]) => (
            <span key={k}><i style={{ background: w.color }} />{w.label}</span>
          ))}
        </div>

        {sel && <Inspector node={sel} edges={edges} nodes={nodes} onClose={() => setSelected(null)} onHealth={setHealth}
          onDelete={() => { setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelected(null); }} />}
      </main>
    </div>
  );
}

function Inspector({ node, nodes, edges, onClose, onHealth, onDelete }: {
  node: ArchNodeType; nodes: AnyNode[]; edges: Edge[]; onClose: () => void; onHealth: (id: string, h: Health) => void; onDelete: () => void;
}) {
  const d = node.data;
  const title = (id: string) => { const n = nodes.find((x) => x.id === id); return n?.type === 'arch' ? n.data.title : id; };
  const ins = edges.filter((e) => e.target === node.id);
  const outs = edges.filter((e) => e.source === node.id);

  return (
    <aside className="hv-inspector" key={node.id}>
      <header className="hv-panel__head">
        <span className={`hv-sticker hv-arch--${d.zone} hv-inspector__zone`}>{ZONES[d.zone].label}</span>
        <button className="hv-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </header>
      <h2><span aria-hidden="true">{d.glyph}</span> {d.title}</h2>
      <p className="hv-inspector__kind">{d.kind}</p>
      <p>{d.about}</p>

      <div className="hv-field">
        <span className="hv-label">Status</span>
        <div className="hv-seg">
          {(['live', 'mock', 'planned'] as Health[]).map((h) => (
            <button key={h} className={`hv-seg__opt${d.health === h ? ' is-on' : ''}`} onClick={() => onHealth(node.id, h)}>
              <i className={`hv-dot is-${h}`} /> {h[0].toUpperCase() + h.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {d.widgets.length > 0 && (
        <dl className="hv-inspector__kv">
          {d.widgets.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}

      <div className="hv-field">
        <span className="hv-label">Connections</span>
        <ul className="hv-conns">
          {ins.map((e) => <Conn key={e.id} dir="from" other={title(e.source)} type={portType(node, e.targetHandle, 'ins')} />)}
          {outs.map((e) => <Conn key={e.id} dir="to" other={title(e.target)} type={portType(node, e.sourceHandle, 'outs')} />)}
          {!ins.length && !outs.length && <li className="hv-conns__none">Not wired yet. Drag from a socket to connect.</li>}
        </ul>
      </div>

      {d.files && (
        <div className="hv-field">
          <span className="hv-label">Code</span>
          <div className="hv-chips">{d.files.map((f) => <span key={f} className="hv-sticker hv-sticker--file">{f}</span>)}</div>
        </div>
      )}

      <button className="hv-linkbtn hv-inspector__delete" onClick={onDelete}>Remove from map</button>
    </aside>
  );
}

function Conn({ dir, other, type }: { dir: 'from' | 'to'; other: string; type?: keyof typeof WIRES }) {
  const w = type ? WIRES[type] : undefined;
  return (
    <li>
      <i style={{ background: w?.color }} />
      <span className="hv-conns__dir">{dir === 'from' ? '←' : '→'}</span>
      <b>{other}</b>
      <em>{w?.label}</em>
    </li>
  );
}
