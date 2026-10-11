'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyNodeChanges, Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArchNode, HEALTH_LABEL, ZoneBox } from '@/components/ArchNode';
import TopBar from '@/components/TopBar';
import { Icon } from '@/components/ui';
import { apiUrl, usePeers, useStatus, useUserName } from '@/lib/hive';
import { appQuery, projectId } from '@/lib/projects';
import { isSet, useSystem } from '@/lib/system';
import {
  DEFS, EDGES, initialNodes, liveData, portType, saved, WIRES, ZONES,
  type AnyNode, type ArchData, type Health, type LiveInputs,
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
  const sys = useSystem();
  const socket = useStatus();
  const peers = usePeers().filter((p) => p.name !== me);
  const [layout, setLayout] = useState<AnyNode[]>(() => saved.nodes ?? initialNodes());
  const [selected, setSelected] = useState<string | null>(null);
  const [traffic, setTraffic] = useState(true);
  const [server, setServer] = useState('');
  const [project, setProject] = useState('');
  useEffect(() => { setServer(new URL(apiUrl('/')).host); setProject(projectId()); }, []);
  useEffect(() => { saved.nodes = layout; }, [layout]);

  const inputs: LiveInputs = { health: sys.health, env: sys.env, reachable: sys.reachable, socket, me, online: peers.length + 1, project, server };
  const data: Record<string, ArchData> = Object.fromEntries(Object.entries(DEFS).map(([id, d]) => {
    const live = liveData(id, inputs);
    return [id, { ...d, ...live, kind: live.kind ?? d.kind }];
  }));
  const dataKey = JSON.stringify(data);

  // Layout (positions, sizes, selection) is React Flow's; the data on each node is the live view.
  const nodes: AnyNode[] = useMemo(
    () => layout.map((n) => (n.type === 'arch' ? { ...n, data: data[n.id] } : n)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, dataKey],
  );

  // Wires take the color of their socket type; "traffic" animates the ones whose both ends are up.
  const edges: Edge[] = useMemo(() => EDGES.map((e) => {
    const t = portType(data[e.source], e.sourceHandle, 'outs') ?? 'http';
    const dead = (['off', 'down'] as Health[]).some((h) => data[e.source].health === h || data[e.target].health === h);
    const touches = selected && (e.source === selected || e.target === selected);
    return {
      ...e, animated: traffic && !dead, selectable: false,
      className: `hv-wire${touches ? ' is-hot' : ''}${dead ? ' is-off' : ''}${selected && !touches ? ' is-dim' : ''}`,
      style: { stroke: WIRES[t].color },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [traffic, selected, dataKey]);

  const onNodesChange = useCallback((c: NodeChange<AnyNode>[]) => setLayout((ns) => applyNodeChanges(c, ns)), []);

  const reset = () => { setLayout(initialNodes()); setSelected(null); setTimeout(() => rf.fitView({ padding: 0.08, duration: 500 }), 30); };

  const counts = Object.values(data).reduce((acc, d) => { acc[d.health]++; return acc; }, { live: 0, mock: 0, off: 0, down: 0, wait: 0 } as Record<Health, number>);
  const sel = selected ? data[selected] : undefined;

  return (
    <div className="hv-app">
      <TopBar me={me}>
        <button className={`hv-btn ${traffic ? 'hv-btn--blue' : 'hv-btn--paper'}`} onClick={() => setTraffic(!traffic)} aria-pressed={traffic}>
          <Icon name="bolt" size={16} /> Traffic {traffic ? 'on' : 'off'}
        </button>
      </TopBar>
      <main className="hv-archstage">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} nodesConnectable={false} edgesFocusable={false}
          onNodeClick={(_, n) => setSelected(n.type === 'arch' ? n.id : null)}
          onPaneClick={() => setSelected(null)}
          fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.2} maxZoom={1.6}
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
            <span>
              {sys.reachable === false ? 'server unreachable · ' : ''}
              {counts.live} live{counts.mock ? ` · ${counts.mock} fake` : ''} · {counts.off} off{counts.down ? ` · ${counts.down} down` : ''}
            </span>
          </div>
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={sys.refresh}>Refresh</button>
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={reset}>Reset layout</button>
        </div>

        <div className="hv-wirelegend">
          {Object.entries(WIRES).map(([k, w]) => (
            <span key={k}><i style={{ background: w.color }} />{w.label}</span>
          ))}
        </div>

        {sel && selected && <Inspector id={selected} d={sel} data={data} env={sys.env} me={me} onClose={() => setSelected(null)} />}
      </main>
    </div>
  );
}

function Inspector({ id, d, data, env, me, onClose }: {
  id: string; d: ArchData; data: Record<string, ArchData>; env: ReturnType<typeof useSystem>['env']; me: string; onClose: () => void;
}) {
  const ins = EDGES.filter((e) => e.target === id);
  const outs = EDGES.filter((e) => e.source === id);

  return (
    <aside className="hv-inspector" key={id}>
      <header className="hv-panel__head">
        <span className={`hv-sticker hv-arch--${d.zone} hv-inspector__zone`}>{ZONES[d.zone].label}</span>
        <button className="hv-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </header>
      <h2><span aria-hidden="true">{d.glyph}</span> {d.title}</h2>
      <p className="hv-inspector__kind">{d.kind} · <b className={`hv-inspector__health is-${d.health}`}>{HEALTH_LABEL[d.health]}</b></p>
      <p>{d.about}</p>

      {d.widgets.length > 0 && (
        <dl className="hv-inspector__kv">
          {d.widgets.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}

      {d.env.length > 0 && (
        <div className="hv-field">
          <span className="hv-label">Environment</span>
          <ul className="hv-conns">
            {d.env.map((n) => (
              <li key={n}>
                <i style={{ background: env ? (isSet(env, n) ? 'var(--green)' : 'transparent') : '#fde68a' }} />
                <Link href={`/environment${appQuery(me)}#${n}`}><b>{n}</b></Link>
                <em>{env ? (isSet(env, n) ? 'set' : 'not set') : '…'}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="hv-field">
        <span className="hv-label">Connections</span>
        <ul className="hv-conns">
          {ins.map((e) => <Conn key={e.id} dir="from" other={data[e.source].title} type={portType(d, e.targetHandle, 'ins')} />)}
          {outs.map((e) => <Conn key={e.id} dir="to" other={data[e.target].title} type={portType(d, e.sourceHandle, 'outs')} />)}
        </ul>
      </div>

      <div className="hv-field">
        <span className="hv-label">Code</span>
        <div className="hv-chips">{d.files.map((f) => <span key={f} className="hv-sticker hv-sticker--file">{f}</span>)}</div>
      </div>
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
