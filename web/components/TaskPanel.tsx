'use client';

import { useEffect, useState } from 'react';
import { usePeers } from '@/lib/hive';
import { runReady, updateTask, useHive } from '@/lib/mock';
import type { Task, TaskRun } from '@/lib/types';
import LiveSession from './LiveSession';
import RunSteps from './RunSteps';
import { displayStatus, StatusSticker } from './Status';
import { Avatar, Icon, tilt } from './ui';

export default function TaskPanel({ id, me, onClose }: { id: string; me: string; onClose: () => void }) {
  const s = useHive();
  const task = s.tasks[id];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;
  return (
    <aside className="hv-panel" aria-label={`Task ${task.title}`}>
      <Body key={id} task={task} run={s.runs[id]} me={me} onClose={onClose} />
    </aside>
  );
}

function Body({ task, run, me, onClose }: { task: Task; run?: TaskRun; me: string; onClose: () => void }) {
  const [spec, setSpec] = useState(task.spec);
  const [acc, setAcc] = useState(task.acceptance);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState('');
  const [newFile, setNewFile] = useState('');
  const [copied, setCopied] = useState(false);
  const copyRef = () => {
    navigator.clipboard?.writeText(`@${task.id}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {});
  };
  const status = displayStatus(task, run);
  const peers = usePeers();
  // Assignable: the agent, this person, everyone connected, and whoever holds it now.
  const assignees = [...new Set(['agent', me, ...peers.map((p) => p.name), task.assignee])].filter((n) => n && n !== 'Guest');

  // Follow remote edits unless this person is mid-edit.
  useEffect(() => {
    if (!editing) { setSpec(task.spec); setAcc(task.acceptance); }
  }, [task.spec, task.acceptance, editing]);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setEditing(true); setter(v); };
  const discard = () => { setEditing(false); setAsking(false); setWhy(''); };
  const commit = () => {
    updateTask(task.id, { spec, acceptance: acc.filter((a) => a.trim()), lastWhy: why.trim() || undefined }, me);
    discard();
  };
  const dirty = editing && (spec !== task.spec || JSON.stringify(acc) !== JSON.stringify(task.acceptance));

  return (
    <>
      <header className="hv-panel__head">
        <div className="hv-panel__id">
          <span className="hv-sticker hv-sticker--ink" style={tilt(task.id, 2)} title="Task ID: stays the same when the task is renamed">#{task.id}</span>
          <button className="hv-linkbtn hv-panel__copy" onClick={copyRef} title="Copy a chat reference to this task">
            <Icon name="copy" size={14} /> {copied ? 'Copied' : `@${task.id}`}
          </button>
        </div>
        <button className="hv-iconbtn" onClick={onClose} aria-label="Close panel"><Icon name="close" /></button>
      </header>

      <label className="hv-panel__rename">
        <input className="hv-panel__title" value={task.title} aria-label="Task name (click to rename)"
          onChange={(e) => updateTask(task.id, { title: e.target.value }, me)} />
        <span className="hv-panel__pencil" aria-hidden="true"><Icon name="pencil" size={16} /></span>
      </label>

      <div className={`hv-runbox hv-s-${status}`}>
        <StatusSticker status={status} size="lg" />
        <p className="hv-runbox__note">{run?.note || (status === 'human' ? `Assigned to ${task.assignee}; the Builder skips it.` : 'Waiting for its dependencies.')}</p>
        {(task.assignee === 'agent' || run) && <RunSteps task={task} run={run} />}
        {run && run.status !== 'todo' && run.status !== 'ready' && (
          <dl className="hv-runbox__meta">
            <div><dt>branch</dt><dd>{run.branch}</dd></div>
            {run.commit && <div><dt>commit</dt><dd>{run.commit}</dd></div>}
            <div><dt>built from</dt><dd>v{run.builtFromVersion}</dd></div>
          </dl>
        )}
        {task.assignee === 'agent' && (
          <button className="hv-btn hv-btn--blue hv-btn--sm" onClick={() => runReady(task.id)} disabled={run?.status === 'running'}>
            <Icon name="play" size={14} /> Run this task
          </button>
        )}
      </div>

      <LiveSession id={task.id} me={me} />

      <section className="hv-field">
        <label className="hv-label" htmlFor="spec">Spec</label>
        <textarea id="spec" className="hv-input hv-input--area" rows={4} value={spec}
          onChange={(e) => edit(setSpec)(e.target.value)} />
        {task.lastWhy && !dirty && (
          <blockquote className="hv-why" style={tilt(task.lastWhy, 1.2)}>“{task.lastWhy}”</blockquote>
        )}
      </section>

      <section className="hv-field">
        <span className="hv-label">Acceptance checks</span>
        <ul className="hv-checks">
          {acc.map((a, i) => (
            <li key={i}>
              <span className="hv-checks__box"><Icon name="check" size={14} /></span>
              <input className="hv-input" value={a} aria-label={`Check ${i + 1}`}
                onChange={(e) => edit(setAcc)(acc.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="hv-iconbtn hv-iconbtn--sm" aria-label="Remove check"
                onClick={() => edit(setAcc)(acc.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
        <button className="hv-linkbtn" onClick={() => edit(setAcc)([...acc, ''])}><Icon name="plus" size={14} /> Add check</button>
      </section>

      {dirty && !asking && (
        <div className="hv-savebar">
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={discard}>Discard</button>
          <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={() => setAsking(true)}>Save change <Icon name="arrow" size={14} /></button>
        </div>
      )}
      {asking && (
        <div className="hv-whyprompt" style={tilt('why', 1)}>
          <label className="hv-label" htmlFor="why">Why the change?</label>
          <textarea id="why" className="hv-input hv-input--area" rows={2} autoFocus value={why}
            placeholder="So the team (and Ask) knows later"
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } }} />
          <div className="hv-savebar">
            <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={() => setAsking(false)}>Back</button>
            <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={commit}>Save with reason <Icon name="arrow" size={14} /></button>
          </div>
        </div>
      )}

      <section className="hv-field">
        <span className="hv-label">Files</span>
        <div className="hv-chips">
          {task.files.map((f) => (
            <span key={f} className="hv-sticker hv-sticker--file">
              {f}
              <button aria-label={`Remove ${f}`} onClick={() => updateTask(task.id, { files: task.files.filter((x) => x !== f) }, me)}>×</button>
            </span>
          ))}
          <input className="hv-input hv-input--chip" placeholder="+ path" value={newFile}
            onChange={(e) => setNewFile(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newFile.trim()) { updateTask(task.id, { files: [...task.files, newFile.trim()] }, me); setNewFile(''); }
            }} />
        </div>
      </section>

      <section className="hv-field">
        <span className="hv-label">Assignee</span>
        <div className="hv-seg" role="radiogroup">
          {assignees.map((n) => (
            <button key={n} role="radio" aria-checked={task.assignee === n}
              className={`hv-seg__opt${task.assignee === n ? ' is-on' : ''}`}
              onClick={() => updateTask(task.id, { assignee: n }, me)}>
              {n === 'agent' ? <><Icon name="bot" size={16} /> Agent</> : <><Avatar name={n} size={20} /> {n}</>}
            </button>
          ))}
        </div>
      </section>

      {run?.diff && (
        <details className="hv-code" open>
          <summary>Diff</summary>
          <pre>{run.diff.split('\n').map((l, i) => (
            <span key={i} className={l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : l.startsWith('diff') || l.startsWith('@@') ? 'is-meta' : ''}>{l}{'\n'}</span>
          ))}</pre>
        </details>
      )}
      {run?.testOutput && (
        <details className="hv-code hv-code--ink" open>
          <summary>Test output</summary>
          <pre>{run.testOutput}</pre>
        </details>
      )}
    </>
  );
}
