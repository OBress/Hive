'use client';

import { useRef, useState } from 'react';
import { mentionOptions, mentionText, parseMentions, type MentionOption } from '@/lib/mentions';
import type { Task } from '@/lib/types';
import { Icon } from './ui';

// Chat input with an @ picker for tasks (@T3) and files (@src/app.js).
export default function Composer({ me, tasks, disabled, onSend }: {
  me: string; tasks: Record<string, Task>; disabled: boolean; onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const options = picker ? mentionOptions(tasks, picker.query) : [];

  // Open the picker when the word before the caret starts with @.
  const detect = (value: string, caret: number) => {
    const m = /(^|\s)@([\w./-]*)$/.exec(value.slice(0, caret));
    setPicker(m ? { start: caret - m[2].length - 1, query: m[2] } : null);
    setActive(0);
  };

  const choose = (o: MentionOption) => {
    if (!picker || !ref.current) return;
    const caret = ref.current.selectionStart;
    const insert = `${mentionText(o)} `;
    const next = text.slice(0, picker.start) + insert + text.slice(caret);
    setText(next);
    setPicker(null);
    requestAnimationFrame(() => {
      const pos = picker.start + insert.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const startMention = () => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const pad = caret > 0 && !/\s/.test(text[caret - 1]) ? ' @' : '@';
    const next = text.slice(0, caret) + pad + text.slice(caret);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret + pad.length, caret + pad.length); detect(next, caret + pad.length); });
  };

  const send = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
    setPicker(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(options[active]); return; }
    }
    if (picker && e.key === 'Escape') { e.preventDefault(); setPicker(null); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const hasMentions = parseMentions(text, tasks).some((s) => s.kind !== 'text');

  return (
    <div className="hv-composer-wrap">
      {picker && (
        <div className="hv-picker" role="listbox" aria-label="Mention a task or file">
          {options.length === 0 ? (
            <div className="hv-picker__empty">No task or file matches “{picker.query}”</div>
          ) : (
            options.map((o, i) => (
              <button key={mentionText(o)} role="option" aria-selected={i === active}
                className={`hv-picker__opt${i === active ? ' is-on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}>
                {(i === 0 || options[i - 1].kind !== o.kind) && <span className="hv-picker__group">{o.kind === 'task' ? 'Tasks' : 'Files'}</span>}
                {o.kind === 'task'
                  ? <><span className="hv-mention hv-mention--task">@{o.id}</span><span className="hv-picker__name">{o.title}</span></>
                  : <><span className="hv-mention hv-mention--file">@{o.path}</span><span className="hv-picker__name">{o.tasks.map((t) => `#${t}`).join(' ')}</span></>}
              </button>
            ))
          )}
          <div className="hv-picker__hint"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> pick · <kbd>Esc</kbd> close</div>
        </div>
      )}
      <div className="hv-composer">
        <button className="hv-composer__at" onClick={startMention} aria-label="Mention a task or file" title="Mention a task or file">@</button>
        <textarea ref={ref} rows={2} value={text} placeholder={`Message as ${me}… use @ for tasks and files`} aria-label="Chat message"
          onChange={(e) => { setText(e.target.value); detect(e.target.value, e.target.selectionStart); }}
          onClick={(e) => detect(text, e.currentTarget.selectionStart)}
          onBlur={() => setPicker(null)}
          onKeyDown={onKeyDown} />
        <button className="hv-btn hv-btn--hot hv-composer__send" onClick={send} disabled={!text.trim() || disabled} aria-label="Send">
          <Icon name="send" />
        </button>
      </div>
      {hasMentions && (
        <div className="hv-composer__refs">
          {parseMentions(text, tasks).filter((s) => s.kind !== 'text').map((s, i) => (
            <span key={i} className={`hv-mention hv-mention--${s.kind}`}>{s.kind === 'task' ? `@${s.id} · ${s.title}` : s.kind === 'file' ? `@${s.path}` : ''}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Message text with @mentions turned into clickable chips.
export function RichText({ text, tasks, onTask, onFile }: {
  text: string; tasks: Record<string, Task>; onTask: (id: string) => void; onFile: (path: string) => void;
}) {
  return (
    <>
      {parseMentions(text, tasks).map((s, i) =>
        s.kind === 'text' ? <span key={i}>{s.text}</span>
          : s.kind === 'task'
            ? <button key={i} className="hv-mention hv-mention--task" onClick={() => onTask(s.id)} title={`Open ${s.title}`}>@{s.id}<em>{s.title}</em></button>
            : <button key={i} className="hv-mention hv-mention--file" onClick={() => onFile(s.path)} title="Show tasks that touch this file">@{s.path}</button>,
      )}
    </>
  );
}
