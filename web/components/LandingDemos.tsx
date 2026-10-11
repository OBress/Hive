'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StatusSticker } from './Status';
import { Avatar, Icon } from './ui';

// Interactive, self-contained replicas of the real workspace features for the landing page.
// Nothing here talks to the server: each demo scripts the same steps the app streams through the Y.Doc.

type Row = { id: string; kind: string; by: string; text: string };

function Feed({ rows, hot }: { rows: Row[]; hot?: string[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [rows.length]);
  return (
    <ol className="hv-demo__feed" ref={ref}>
      {rows.map((r) => (
        <li key={r.id} className={`hv-demo__row hv-demo__row--${r.kind}${hot?.includes(r.id) ? ' is-hot' : ''}`}>
          <span className="hv-cite">#{r.id}</span>
          <span className="hv-demo__kind">{r.kind}</span>
          <span className="hv-demo__text">{r.text}</span>
          <span className="hv-demo__by">{r.by}</span>
        </li>
      ))}
    </ol>
  );
}

function Window({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="hv-demo">
      <div className="hv-demo__bar">
        <i /><i /><i />
        <span>{title}</span>
        {status}
      </div>
      <div className="hv-demo__body">{children}</div>
    </div>
  );
}

// ---- 1. Watch + steer: the Stats agent streams steps; type into its session to change course ----

const STATS_CODE = `export function stats(hits) {
  const byCode = {};
  for (const h of hits) {
    byCode[h.code] = (byCode[h.code] ?? 0) + 1;
  }
  return byCode;
}`;
const UNIQUE_CODE = `export function stats(hits) {
  const byCode = {};
  for (const h of hits) {
    (byCode[h.code] ??= new Set()).add(h.visitor);
  }
  return Object.fromEntries(
    Object.entries(byCode).map(([c, s]) => [c, s.size]));
}`;

const RUN: Row[] = [
  { id: 's1', kind: 'plan', by: 'agent', text: 'Plan: count hits per code in src/stats.js, then test' },
  { id: 's2', kind: 'read', by: 'agent', text: 'Read src/store.js' },
  { id: 's3', kind: 'edit', by: 'agent', text: 'Write src/stats.js' },
  { id: 's4', kind: 'test', by: 'agent', text: 'Tests: 2 passed, 1 failed' },
  { id: 's5', kind: 'edit', by: 'agent', text: 'Fix empty-list case in src/stats.js' },
  { id: 's6', kind: 'test', by: 'agent', text: 'Tests: 3 passed, 0 failed' },
];
const STEERED: Row[] = [
  { id: 's8', kind: 'plan', by: 'agent', text: 'Got it: switching to a Set of visitors per code' },
  { id: 's9', kind: 'edit', by: 'agent', text: 'Rewrite src/stats.js to count unique visitors' },
  { id: 's10', kind: 'test', by: 'agent', text: 'Tests: 4 passed, 0 failed' },
  { id: 's11', kind: 'finish', by: 'agent', text: 'Done: stats counts unique visitors · 9c1e4b2' },
];

export function SessionDemo() {
  const [rows, setRows] = useState<Row[]>([]);
  const [queue, setQueue] = useState<Row[]>(RUN);
  const [code, setCode] = useState('');
  const [target, setTarget] = useState(STATS_CODE);
  const [msg, setMsg] = useState('count unique visitors, not hits');
  const [steered, setSteered] = useState(false);
  const done = rows.at(-1)?.kind === 'finish' || (!queue.length && !steered && rows.length === RUN.length);

  // Type the file out a few characters at a time, like the live map does.
  useEffect(() => {
    if (code === target) return;
    const t = setTimeout(() => setCode(target.startsWith(code) ? target.slice(0, code.length + 3) : ''), 18);
    return () => clearTimeout(t);
  }, [code, target]);

  useEffect(() => {
    if (!queue.length) return;
    const t = setTimeout(() => {
      const [next, ...rest] = queue;
      setRows((r) => [...r, next]);
      setQueue(rest);
      if (next.id === 's9') { setCode(''); setTarget(UNIQUE_CODE); }
    }, rows.length ? 1500 : 500);
    return () => clearTimeout(t);
  }, [queue, rows.length]);

  const send = () => {
    if (!msg.trim() || steered) return;
    setSteered(true);
    setRows((r) => [...r, { id: 's7', kind: 'steer', by: 'Ben', text: `“${msg.trim()}”` }]);
    setQueue(STEERED);
  };
  const replay = () => { setRows([]); setQueue(RUN); setCode(''); setTarget(STATS_CODE); setSteered(false); };
  const status = rows.at(-1)?.kind === 'finish' ? 'done' : 'running';

  return (
    <Window title="#T3 Click stats · agent session" status={<StatusSticker status={status} size="sm" short />}>
      <pre className="hv-demo__live"><span className="hv-demo__path">src/stats.js</span>{code}<i className="hv-demo__caret" /></pre>
      <Feed rows={rows} />
      {!done ? (
        <div className="hv-demo__steer">
          <Avatar name="Ben" size={30} />
          <input className="hv-input" value={msg} onChange={(e) => setMsg(e.target.value)} disabled={steered}
            placeholder="Redirect the agent…" aria-label="Message the agent"
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
          <button className="hv-btn hv-btn--blue hv-btn--sm" onClick={send} disabled={steered || !msg.trim()}>
            <Icon name="send" size={14} /> {steered ? 'Sent' : 'Send'}
          </button>
        </div>
      ) : (
        <div className="hv-demo__steer">
          <span className="hv-demo__hint">{steered ? 'The agent picked up Ben’s message at its next step.' : 'Finished without a redirect. Try steering it this time.'}</span>
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={replay}><Icon name="play" size={14} /> Replay</button>
        </div>
      )}
    </Window>
  );
}

// ---- 2. Take over, edit, hand back (or hand off to a teammate with a summary) ----

const README = `# Link shortener

POST /links  { url }  → { code }
GET  /:code           → 302 to url`;

type Phase = 'agent' | 'mine' | 'resumed' | 'handed';

export function TakeoverDemo() {
  const [phase, setPhase] = useState<Phase>('agent');
  const [text, setText] = useState(README);
  const [commits, setCommits] = useState<{ sha: string; by: string; text: string }[]>([
    { sha: '4be01d7', by: 'agent', text: 'README: endpoints' },
  ]);
  const [to, setTo] = useState('Cal');

  const save = () => setCommits((c) => [...c, { sha: Math.random().toString(16).slice(2, 9), by: 'Ana', text: 'README: edited by hand' }]);
  const handback = () => {
    setPhase('resumed');
    setTimeout(() => setCommits((c) => [...c, { sha: 'e71a03c', by: 'agent', text: 'README: add examples below Ana’s edit' }]), 900);
  };
  const reset = () => { setPhase('agent'); setText(README); setCommits(commits.slice(0, 1)); };

  const owner = phase === 'mine' ? 'Ana' : phase === 'handed' ? to : 'agent';
  return (
    <Window title="#T4 README" status={
      <span className="hv-demo__owner">
        {owner === 'agent' ? <><Icon name="bot" size={14} /> agent</> : <><Avatar name={owner} size={20} /> {owner}</>}
      </span>
    }>
      {phase === 'agent' && (
        <div className="hv-demo__center">
          <p>The agent owns this task. Pause it and the file is yours.</p>
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={() => setPhase('mine')}><Icon name="lock" size={14} /> Take over as Ana</button>
        </div>
      )}
      {phase === 'mine' && (
        <>
          <textarea className="hv-input hv-input--area hv-demo__editor" rows={6} value={text} spellCheck={false}
            aria-label="README.md" onChange={(e) => setText(e.target.value)} />
          <div className="hv-demo__actions">
            <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={save} disabled={text === README}>Save file</button>
            <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={handback}><Icon name="bot" size={14} /> Hand back</button>
            <span className="hv-demo__or">or hand off to</span>
            <div className="hv-seg">
              {['Ben', 'Cal'].map((n) => (
                <button key={n} className={`hv-seg__opt${to === n ? ' is-on' : ''}`} onClick={() => setTo(n)}><Avatar name={n} size={20} /> {n}</button>
              ))}
            </div>
            <button className="hv-btn hv-btn--ink hv-btn--sm" onClick={() => setPhase('handed')}>Hand off <Icon name="arrow" size={14} /></button>
          </div>
        </>
      )}
      {phase === 'handed' && (
        <div className="hv-demo__summary">
          <span className="hv-label">Auto-written for {to}</span>
          <p><b>Done:</b> endpoints documented. <b>Left:</b> usage examples, stats route. <b>Tried:</b> generating from tests (too noisy). <b>Open:</b> mention the 6-char codes?</p>
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={reset}>Reset</button>
        </div>
      )}
      <ol className="hv-demo__commits">
        {commits.map((c) => (
          <li key={c.sha}>
            <code>{c.sha}</code>
            {c.by === 'agent' ? <Icon name="bot" size={16} /> : <Avatar name={c.by} size={20} />}
            <span>{c.text}</span>
          </li>
        ))}
      </ol>
      {phase === 'resumed' && <button className="hv-linkbtn hv-demo__again" onClick={reset}>Run it again</button>}
    </Window>
  );
}

// ---- 3. Ask what happened and get an answer citing exact steps ----

const QUESTIONS = [
  { q: 'What happened on stats?', a: 'The agent first counted every hit. Ben asked for unique visitors, so it switched to a Set per code and all four tests pass.', cites: ['s4', 's7', 's10'] },
  { q: 'Who edited the README?', a: 'Ana took over #T4, saved one edit under her name, then handed it back. The agent added examples below her edit.', cites: ['s12', 's13', 's14'] },
];
const HISTORY: Row[] = [
  { id: 's4', kind: 'test', by: 'agent', text: 'Stats tests: 2 passed, 1 failed' },
  { id: 's7', kind: 'steer', by: 'Ben', text: '“count unique visitors, not hits”' },
  { id: 's10', kind: 'test', by: 'agent', text: 'Stats tests: 4 passed, 0 failed' },
  { id: 's12', kind: 'takeover', by: 'Ana', text: 'Took over #T4 README' },
  { id: 's13', kind: 'human-edit', by: 'Ana', text: 'Edited README.md' },
  { id: 's14', kind: 'handback', by: 'Ana', text: 'Handed #T4 back to the agent' },
];

export function AskDemo() {
  const [asked, setAsked] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hot, setHot] = useState<string[]>([]);
  const ask = (i: number) => {
    setAsked(i); setThinking(true); setHot([]);
    setTimeout(() => setThinking(false), 1100);
  };
  const qa = asked === null ? null : QUESTIONS[asked];

  return (
    <Window title="Chat · Planner">
      <div className="hv-demo__chat">
        {qa ? (
          <>
            <div className="hv-msg is-me">
              <div className="hv-msg__meta"><Avatar name="Cal" size={26} /> <b>Cal</b></div>
              <div className="hv-bubble">{qa.q}</div>
            </div>
            <div className="hv-msg hv-msg--agent hv-msg--planner">
              <div className="hv-msg__meta"><Avatar name="planner" agent size={26} /> <b>Planner</b></div>
              {thinking ? <div className="hv-bubble hv-typing"><i /><i /><i /></div> : (
                <div className="hv-bubble">
                  {qa.a}
                  <div className="hv-cites"><span>cites</span>
                    {qa.cites.map((c) => <button key={c} className="hv-cite" onMouseEnter={() => setHot([c])} onFocus={() => setHot([c])} onClick={() => setHot([c])}>#{c}</button>)}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : <p className="hv-demo__hint">Cal just joined. Ask the Planner to catch up.</p>}
      </div>
      <div className="hv-demo__chips">
        {QUESTIONS.map((x, i) => (
          <button key={x.q} className="hv-sticker hv-sticker--paper hv-suggest__chip" onClick={() => ask(i)} disabled={thinking}>
            <Icon name="bolt" size={13} /> {x.q}
          </button>
        ))}
      </div>
      {qa && !thinking && <Feed rows={HISTORY.filter((r) => qa.cites.includes(r.id))} hot={hot} />}
    </Window>
  );
}

// ---- 4. Approve: test main, push to GitHub with commits from agents and people ----

const MAIN_TESTS = ['create returns a 6-char code', 'redirect sends 302', 'unknown code is 404', 'stats counts unique visitors', 'README lists every route'];

export function ApproveDemo() {
  const [passed, setPassed] = useState(-1);
  const [pushed, setPushed] = useState(false);
  const running = passed >= 0 && passed < MAIN_TESTS.length;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setPassed((n) => n + 1), 380);
    return () => clearTimeout(t);
  }, [passed, running]);
  useEffect(() => {
    if (passed !== MAIN_TESTS.length || pushed) return;
    const t = setTimeout(() => setPushed(true), 700);
    return () => clearTimeout(t);
  }, [passed, pushed]);

  return (
    <Window title="main · ana/link-shortener">
      <ul className="hv-demo__tests">
        {MAIN_TESTS.map((t, i) => (
          <li key={t} className={i < passed ? 'is-pass' : i === passed ? 'is-run' : ''}>
            <span className="hv-demo__tick">{i < passed ? <Icon name="check" size={13} /> : i === passed ? <i className="hv-spinner" /> : null}</span>
            {t}
          </li>
        ))}
      </ul>
      <div className="hv-demo__actions">
        {pushed ? (
          <>
            <span className="hv-btn hv-btn--ink hv-btn--sm"><Icon name="github" size={15} /> Pushed 7 commits to GitHub</span>
            <span className="hv-demo__authors">
              <Avatar name="agent" agent size={24} /><Avatar name="Ana" size={24} /><Avatar name="Ben" size={24} />
            </span>
            <button className="hv-linkbtn" onClick={() => { setPassed(-1); setPushed(false); }}>Reset</button>
          </>
        ) : (
          <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={() => setPassed(0)} disabled={passed >= 0}>
            {passed >= 0 ? <><i className="hv-spinner" /> Testing main…</> : <><Icon name="push" size={15} /> Approve &amp; push</>}
          </button>
        )}
      </div>
    </Window>
  );
}
