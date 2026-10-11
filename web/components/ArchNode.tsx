'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { WIRES, type ArchNode as ArchNodeType, type Port, type ZoneNode } from '@/lib/architecture';

export const HEALTH_LABEL = { live: 'Live', mock: 'Fake', off: 'Off', down: 'Down', wait: '…' } as const;

// ComfyUI-style node: title bar, typed sockets on the sides (inputs left, outputs right), live value rows.
export function ArchNode({ data, selected }: NodeProps<ArchNodeType>) {
  const rows = Math.max(data.ins.length, data.outs.length);
  return (
    <div className={`hv-arch hv-arch--${data.zone} is-${data.health}${selected ? ' is-selected' : ''}`}>
      <header className="hv-arch__head">
        <span className="hv-arch__glyph" aria-hidden="true">{data.glyph}</span>
        <div className="hv-arch__titles">
          <b>{data.title}</b>
          <span>{data.kind}</span>
        </div>
        <span className={`hv-arch__health is-${data.health}`}>{HEALTH_LABEL[data.health]}</span>
      </header>

      {rows > 0 && (
        <div className="hv-arch__ports">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="hv-arch__row">
              {data.ins[i] ? <Socket port={data.ins[i]} side="in" /> : <span />}
              {data.outs[i] ? <Socket port={data.outs[i]} side="out" /> : <span />}
            </div>
          ))}
        </div>
      )}

      {data.widgets.length > 0 && (
        <div className="hv-arch__widgets">
          {data.widgets.map(([k, v]) => (
            <div key={k} className="hv-arch__widget">
              <span>{k}</span><b>{v}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Socket({ port, side }: { port: Port; side: 'in' | 'out' }) {
  const color = WIRES[port.type].color;
  return (
    <div className={`hv-socket hv-socket--${side}`} title={`${port.label} · ${WIRES[port.type].label}`}>
      <Handle id={port.id} type={side === 'in' ? 'target' : 'source'} position={side === 'in' ? Position.Left : Position.Right}
        className="hv-socket__dot" style={{ background: color }} />
      <span>{port.label}</span>
    </div>
  );
}

export function ZoneBox({ data }: NodeProps<ZoneNode>) {
  return (
    <div className="hv-zone" style={{ '--zone': data.color } as React.CSSProperties}>
      <span className="hv-zone__label">{data.label}</span>
    </div>
  );
}
