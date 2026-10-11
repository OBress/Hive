'use client';

import { useEffect, useRef, useState } from 'react';
import { allFiles, taskMatches } from '@/lib/mentions';
import { useHive } from '@/lib/mock';
import ModeSwitch from './ModeSwitch';
import { displayStatus, StatusSticker } from './Status';
import { Icon } from './ui';

// Top of the tasks canvas: search (tasks by id/title/spec/checks/files/assignee, plus files) and the
// "show completed" toggle, and the project's mode (Manual / Semi-auto / Auto). Press / anywhere to jump into search.
export default function TaskToolbar({ query, setQuery, showDone, setShowDone, onFocusTask }: {
  query: string; setQuery: (q: string) => void; showDone: boolean; setShowDone: (v: boolean) => void; onFocusTask: (id: string) => void;
}) {
  const s = useHive();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest('input, textarea, [contenteditable]'));
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim();
  const taskHits = q ? Object.values(s.tasks).filter((t) => taskMatches(t, q)) : [];
  const fileHits = q ? [...allFiles(s.tasks)].filter(([f]) => f.toLowerCase().includes(q.toLowerCase().replace(/^@/, ''))) : [];
  const results: { key: string; task: string; file?: string; ids?: string[] }[] = [
    ...taskHits.map((t) => ({ key: `t-${t.id}`, task: t.id })),
    ...fileHits.map(([f, ids]) => ({ key: `f-${f}`, task: ids[0], file: f, ids })),
  ].slice(0, 8);
  const doneCount = Object.values(s.runs).filter((r) => r.status === 'done' && s.tasks[r.taskId]).length;

  const pick = (i: number) => {
    const r = results[i];
    if (!r) return;
    onFocusTask(r.task);
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="hv-toolbar">
      <div className="hv-search">
        <Icon name="search" size={18} />
        <input ref={input} value={query} placeholder="Search tasks, files, specs…" aria-label="Search tasks"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); pick(active); }
            if (e.key === 'Escape') { setQuery(''); input.current?.blur(); }
          }} />
        {query ? (
          <button className="hv-search__clear" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={14} /></button>
        ) : <kbd className="hv-search__kbd">/</kbd>}

        {open && q && (
          <div className="hv-search__results" role="listbox">
            <div className="hv-search__count">{taskHits.length} {taskHits.length === 1 ? 'task' : 'tasks'} · {fileHits.length} {fileHits.length === 1 ? 'file' : 'files'}</div>
            {results.length === 0 && <div className="hv-search__empty">Nothing matches “{q}”.</div>}
            {results.map((r, i) => {
              const t = s.tasks[r.task];
              return (
                <button key={r.key} role="option" aria-selected={i === active} className={`hv-search__row${i === active ? ' is-on' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setActive(i)}>
                  {r.file ? (
                    <>
                      <span className="hv-mention hv-mention--file">{r.file}</span>
                      <span className="hv-search__sub">{r.ids?.map((x) => `#${x}`).join(' ')}</span>
                    </>
                  ) : t && (
                    <>
                      <span className="hv-mention hv-mention--task">#{t.id}</span>
                      <span className="hv-search__title">{t.title}</span>
                      <StatusSticker status={displayStatus(t, s.runs[t.id])} size="sm" short />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <label className="hv-check">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
        <span className="hv-check__box"><Icon name="check" size={14} /></span>
        Show completed{doneCount > 0 && <span className="hv-check__count">{doneCount}</span>}
      </label>
      <ModeSwitch />
    </div>
  );
}
