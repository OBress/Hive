'use client';

import { useEffect, useRef, useState } from 'react';
import { DEMO_REQUEST, sendChat, useHive } from '@/lib/mock';
import type { ChatMessage, Decision, Task } from '@/lib/types';
import Composer, { RichText } from './Composer';
import { Avatar, clock, Icon, isAgent, nameColor, tilt } from './ui';

export default function Chat({ me, onFocusTask, onSearch }: { me: string; onFocusTask: (id: string) => void; onSearch: (q: string) => void }) {
  const s = useHive();
  const [tab, setTab] = useState<'chat' | 'log'>('chat');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Chat is oldest-first (scroll to bottom); the decision log is newest-first (scroll to top).
    listRef.current?.scrollTo({ top: tab === 'chat' ? listRef.current.scrollHeight : 0, behavior: 'smooth' });
  }, [s.chat.length, s.thinking, s.decisions.length, tab]);

  const send = (t: string) => {
    if (!t.trim() || s.thinking) return;
    sendChat(t.trim(), me);
    setTab('chat');
  };
  const citeTask = (id: string) => {
    const d = s.decisions.find((x) => x.id === id);
    if (d?.taskId) onFocusTask(d.taskId);
  };

  const specChange = [...s.decisions].reverse().find((d) => d.kind === 'spec-change' && d.taskId);
  const suggestions = !Object.keys(s.tasks).length ? [DEMO_REQUEST]
    : specChange ? [`Why did @${specChange.taskId} change?`] : [];

  return (
    <aside className="hv-chat">
      <header className="hv-chat__head">
        <div className="hv-toggle" data-on={tab}>
          <span className="hv-toggle__pill" />
          <button className={tab === 'chat' ? 'is-on' : ''} onClick={() => setTab('chat')}>Chat</button>
          <button className={tab === 'log' ? 'is-on' : ''} onClick={() => setTab('log')}>
            Decisions <span className="hv-toggle__count">{s.decisions.length}</span>
          </button>
        </div>
      </header>

      <div className="hv-chat__list" ref={listRef}>
        {tab === 'chat' ? (
          <>
            {!s.chat.length && (
              <div className="hv-chat__empty">
                <span className="hv-sticker hv-sticker--hot" style={tilt('e1')}>One thread</span>
                <p>Ask for changes to the plan or ask why something happened. The Planner answers both.</p>
              </div>
            )}
            {s.chat.map((m) => <Message key={m.id} m={m} me={me} tasks={s.tasks} onFocusTask={onFocusTask} onCite={citeTask} onSearch={onSearch} />)}
            {s.thinking && (
              <div className="hv-msg hv-msg--agent hv-msg--planner">
                <div className="hv-msg__meta"><Avatar name="planner" agent size={28} /> <b>Planner</b></div>
                <div className="hv-bubble hv-typing"><i /><i /><i /></div>
              </div>
            )}
          </>
        ) : (
          <DecisionLog decisions={s.decisions} onFocusTask={onFocusTask} />
        )}
      </div>

      <footer className="hv-chat__compose">
        {suggestions.length > 0 && (
          <div className="hv-suggest">
            {suggestions.map((q) => (
              <button key={q} className="hv-sticker hv-sticker--paper hv-suggest__chip" onClick={() => send(q)}>
                <Icon name="bolt" size={13} /> {q}
              </button>
            ))}
          </div>
        )}
        <Composer me={me} tasks={s.tasks} disabled={s.thinking} onSend={send} />
      </footer>
    </aside>
  );
}

function Message({ m, me, tasks, onFocusTask, onCite, onSearch }: {
  m: ChatMessage; me: string; tasks: Record<string, Task>; onFocusTask: (id: string) => void; onCite: (id: string) => void; onSearch: (q: string) => void;
}) {
  const agent = isAgent(m.from);
  const added = (m.ops ?? []).flatMap((o) => (o.op === 'addTask' && o.task.id ? [{ id: o.task.id, title: o.task.title ?? o.task.id }] : []));
  const edgeCount = (m.ops ?? []).filter((o) => o.op === 'addEdge').length;

  return (
    <div className={`hv-msg${agent ? ` hv-msg--agent hv-msg--${m.from}` : ''}${m.from === me ? ' is-me' : ''}`}>
      <div className="hv-msg__meta">
        <Avatar name={m.from} agent={agent} size={28} />
        <b>{agent ? m.from[0].toUpperCase() + m.from.slice(1) : m.from}</b>
        <time>{clock(m.at)}</time>
      </div>
      <div className="hv-bubble" style={agent ? undefined : { borderLeftColor: nameColor(m.from) }}>
        <RichText text={m.text} tasks={tasks} onTask={onFocusTask} onFile={onSearch} />
        {(added.length > 0 || edgeCount > 0) && (
          <div className="hv-ops">
            {added.map((t) => (
              <button key={t.id} className="hv-sticker hv-sticker--op" onClick={() => onFocusTask(t.id)}>+ {t.title}</button>
            ))}
            {edgeCount > 0 && <span className="hv-sticker hv-sticker--op is-muted">+{edgeCount} edges</span>}
          </div>
        )}
        {m.cites && m.cites.length > 0 && (
          <div className="hv-cites">
            <span>cites</span>
            {m.cites.map((c) => (
              <button key={c} className="hv-cite" onClick={() => onCite(c)}>#{c}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<Decision['kind'], string> = {
  'spec-change': 'spec', 'graph-change': 'graph', 'agent-result': 'result', conflict: 'conflict', merge: 'merge', push: 'push',
};

function DecisionLog({ decisions, onFocusTask }: { decisions: Decision[]; onFocusTask: (id: string) => void }) {
  if (!decisions.length) {
    return (
      <div className="hv-chat__empty">
        <span className="hv-sticker hv-sticker--blue" style={tilt('e2')}>Shared memory</span>
        <p>Every spec change, graph edit, agent result, conflict and push lands here with its reason.</p>
      </div>
    );
  }
  return (
    <ol className="hv-log">
      {[...decisions].reverse().map((d) => (
        <li key={d.id} className="hv-log__row">
          <button className="hv-log__btn" onClick={() => d.taskId && onFocusTask(d.taskId)} disabled={!d.taskId}>
            <div className="hv-log__top">
              <span className="hv-cite">#{d.id}</span>
              <span className={`hv-kind hv-kind--${d.kind}`}>{KIND_LABEL[d.kind]}</span>
              <time>{clock(d.at)} · {d.who}</time>
            </div>
            <div className="hv-log__summary">{d.summary}</div>
            {d.why && <blockquote className="hv-why hv-why--sm">“{d.why}”</blockquote>}
            {d.commit && <code className="hv-log__commit">{d.commit}</code>}
          </button>
        </li>
      ))}
    </ol>
  );
}
