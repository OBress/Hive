'use client';

import { useEffect, useRef, useState } from 'react';
import type { AutonomyMode } from '@hive/shared/types';
import { setMode, useHive } from '@/lib/mock';
import { reloadProjects, useProject } from '@/lib/projects';
import { Icon } from './ui';

// The open project's mode as a dropdown: Manual / Semi-auto / Auto (unset = Auto). The server keeps the graph
// moving in Semi-auto and Auto; this only switches. Another person's switch shows up as a 'mode' step, which
// reloads the project list so every window agrees.
export const MODES: { id: AutonomyMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Manual', hint: 'Nothing starts by itself. Press Start on a task, or Run ready.' },
  { id: 'semi', label: 'Semi-auto', hint: 'Tasks start by themselves, except ones marked "ask", which wait for your OK.' },
  { id: 'auto', label: 'Auto', hint: 'Everything runs. When all is done it tests, takes a screenshot and adds follow-ups.' },
];

export function useMode(): AutonomyMode {
  return useProject()?.mode ?? 'auto';
}

export default function ModeSwitch() {
  const s = useHive();
  const project = useProject();
  const mode = project?.mode ?? 'auto';
  const [pending, setPending] = useState<AutonomyMode | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = pending ?? mode;
  const changes = s.steps.filter((x) => x.kind === 'mode').length;

  useEffect(() => { if (changes) void reloadProjects(); }, [changes]);
  useEffect(() => { if (pending === mode) setPending(null); }, [pending, mode]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [open]);

  const pick = (m: AutonomyMode) => {
    setOpen(false);
    if (m === shown) return;
    setPending(m);
    void setMode(m).finally(() => reloadProjects()).catch(() => setPending(null));
  };

  return (
    <div className="hv-mode" ref={box}>
      <button type="button" className={`hv-mode__btn hv-mode--${shown}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title={project?.modeSetBy ? `Set by ${project.modeSetBy}` : 'The default for new projects'}>
        <span className="hv-mode__dot" />
        Mode: {MODES.find((m) => m.id === shown)!.label}
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <ul className="hv-mode__menu" role="listbox" aria-label="How much agents do on their own">
          {MODES.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === shown}>
              <button type="button" className={m.id === shown ? 'is-on' : ''} onClick={() => pick(m.id)}>
                <b><span className={`hv-mode__dot hv-mode--${m.id}`} />{m.label}{m.id === shown && <Icon name="check" size={14} />}</b>
                <em>{m.hint}</em>
              </button>
            </li>
          ))}
          {project?.modeSetBy && <li className="hv-mode__by">Set by {project.modeSetBy}</li>}
        </ul>
      )}
    </div>
  );
}
