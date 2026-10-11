'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/TopBar';
import { Avatar, Icon, tilt } from '@/components/ui';
import { usePeers, useUserName } from '@/lib/hive';
import { useHive } from '@/lib/mock';
import type { Decision } from '@/lib/types';
import { connectRepo, PROJECT, STACK, timeAgo, useRepo, type Commit } from '@/lib/project';

const BASE_NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

function useNow() {
  const [now, setNow] = useState(BASE_NOW);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Overview() {
  const me = useUserName();
  const s = useHive();
  const now = useNow();
  const q = me !== 'Guest' ? `?name=${encodeURIComponent(me)}` : '';

  const tasks = Object.values(s.tasks);
  const done = tasks.filter((t) => s.runs[t.id]?.status === 'done');
  const liveCommits: Commit[] = s.decisions
    .filter((d) => d.commit)
    .map((d) => ({
      sha: d.commit!, at: Date.parse(d.at),
      message: d.kind === 'push' ? 'Push main to GitHub' : d.summary,
      author: d.who === 'builder' ? 'builder' : d.who,
      branch: d.kind === 'push' ? 'origin/main' : d.taskId ? `task/${d.taskId}` : 'main',
    }))
    .reverse();
  const commits = liveCommits;
  const testsPassing = done.reduce((n, t) => n + t.acceptance.length, 0);
  const agentRuns = s.decisions.filter((d) => d.kind === 'agent-result' || d.kind === 'merge').length;

  return (
    <div className="hv-app">
      <TopBar me={me}>
        <Link href={`/tasks${q}`} className="hv-btn hv-btn--hot">Open tasks <Icon name="arrow" size={16} /></Link>
      </TopBar>
      <main className="hv-page">
        <div className="hv-ov">
          <section className="hv-ov__goal hv-card hv-card--blue">
            <span className="hv-sticker hv-sticker--paper" style={tilt('goal')}>Project goal</span>
            <h1>Ship a <span className="hv-wordbox hv-wordbox--xl">URL shortener</span> together</h1>
            <p>{PROJECT.goal}</p>
            <div className="hv-ov__goalmeta">
              <span>{PROJECT.deadline}</span>
            </div>
          </section>

          <section className="hv-ov__stats">
            <Stat label="Tasks done" value={`${done.length}/${tasks.length}`} tone="green" id="s1" />
            <Stat label="Commits" value={String(commits.length)} tone="blue" id="s2" />
            <Stat label="Tests passing" value={String(testsPassing)} tone="hot" id="s3" />
            <Stat label="Agent runs" value={String(agentRuns)} tone="ink" id="s4" />
          </section>

          <GitHistory commits={commits} now={now} pushed={s.pushedUrl} />

          <aside className="hv-ov__side">
            <AgentsNow />
            <People me={me} decisions={s.decisions} now={now} />
          </aside>

          <Calendar now={now} decisions={s.decisions} />
          <Stack />
          <Checkpoints />
          <RecentDecisions q={q} />
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, tone, id }: { label: string; value: string; tone: string; id: string }) {
  return (
    <div className={`hv-stat hv-card hv-card--${tone}`} style={tilt(id, 2.4)}>
      <span className="hv-stat__label">{label}</span>
      <span key={value} className="hv-stat__value">{value}</span>
    </div>
  );
}

function GitHistory({ commits, now, pushed }: { commits: Commit[]; now: number; pushed?: string }) {
  const repo = useRepo();
  const [draft, setDraft] = useState('');
  const valid = /^[\w.-]+\/[\w.-]+$/.test(draft.trim());
  const connect = () => { if (valid) connectRepo(draft.trim()); };

  return (
    <section className="hv-ov__git hv-card">
      <header className="hv-ov__head">
        <h2><Icon name="branch" size={22} /> Git history</h2>
        {repo ? (
          <div className="hv-ov__repo">
            <a className="hv-sticker hv-sticker--ink" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">
              <Icon name="link" size={13} /> {repo}
            </a>
            <button className="hv-linkbtn" onClick={() => connectRepo(null)}>Disconnect</button>
          </div>
        ) : <span className="hv-sticker hv-sticker--cream">local only · workspace/</span>}
      </header>

      {!repo && (
        <div className="hv-connect">
          <div>
            <b>Connect a GitHub repo</b>
            <p>Agents commit locally on one branch per task. Connect a repo so “Approve &amp; push” has somewhere to go.</p>
          </div>
          <div className="hv-connect__row">
            <input className="hv-input" value={draft} placeholder="owner/repo" onChange={(e) => setDraft(e.target.value)} aria-label="owner/repo"
              onKeyDown={(e) => { if (e.key === 'Enter') connect(); }} />
            <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={connect} disabled={!valid}>
              Connect <Icon name="arrow" size={14} />
            </button>
          </div>
        </div>
      )}

      {!commits.length && <p className="hv-ov__empty">No commits yet. Agent commits show up here as tasks finish.</p>}
      <ol className="hv-commits">
        {commits.slice(0, 9).map((c, i) => (
          <li key={`${c.sha}-${i}`} className="hv-commit">
            <span className={`hv-commit__dot${c.branch === 'main' || c.branch === 'origin/main' ? ' is-main' : ''}`} />
            <div className="hv-commit__body">
              <div className="hv-commit__msg">{c.message}</div>
              <div className="hv-commit__meta">
                <Avatar name={c.author} agent={c.author === 'builder' || c.author === 'planner'} size={20} />
                <span>{c.author}</span>
                <span className={`hv-branch${c.branch.startsWith('task/') ? ' is-task' : c.branch === 'origin/main' ? ' is-origin' : ''}`}>{c.branch}</span>
                <span className="hv-commit__ago">{timeAgo(c.at, now)}</span>
              </div>
            </div>
            <code className="hv-commit__sha">{c.sha}</code>
          </li>
        ))}
      </ol>
      {pushed && repo && <p className="hv-ov__foot">Latest push is on GitHub: <a href={pushed} target="_blank" rel="noreferrer">{pushed.slice(-7)}</a></p>}
    </section>
  );
}

function AgentsNow() {
  const s = useHive();
  const running = Object.values(s.runs).filter((r) => r.status === 'running');
  const slots = [0, 1].map((i) => running[i]);
  return (
    <section className="hv-card hv-ov__agents">
      <header className="hv-ov__head"><h2><Icon name="bot" size={22} /> Agents now</h2></header>
      <ul className="hv-agentlist">
        <li>
          <Avatar name="planner" agent busy={s.thinking} size={38} />
          <div><b>Planner</b><span>{s.thinking ? 'Reading the chat…' : 'Waiting for a message'}</span></div>
          <AgentState busy={s.thinking} />
        </li>
        {slots.map((r, i) => (
          <li key={i}>
            <Avatar name="builder" agent busy={!!r} size={38} />
            <div><b>Builder {i + 1}</b><span>{r ? `${s.tasks[r.taskId]?.title ?? r.taskId} · ${r.branch}` : 'Idle'}</span></div>
            <AgentState busy={!!r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgentState({ busy }: { busy: boolean }) {
  return (
    <span className={`hv-sticker hv-status hv-status--sm hv-s-${busy ? 'running' : 'todo'}`}>
      <i className="hv-status__dot" />{busy ? 'Working' : 'Idle'}
    </span>
  );
}

interface Contributor { name: string; online: boolean; actions: number; last?: number; openTaskId?: string }

// Online = connected right now (Hocuspocus awareness). Past = appear in the decision log but aren't connected.
function People({ me, decisions, now }: { me: string; decisions: Decision[]; now: number }) {
  const s = useHive();
  const peers = usePeers();
  const byName = new Map<string, Contributor>();
  const get = (name: string) => byName.get(name) ?? byName.set(name, { name, online: false, actions: 0 }).get(name)!;
  if (me !== 'Guest') get(me).online = true;
  for (const p of peers) Object.assign(get(p.name), { online: true, openTaskId: p.openTaskId });
  for (const d of decisions) {
    if (d.who === 'planner' || d.who === 'builder') continue;
    const c = get(d.who);
    c.actions++;
    c.last = Math.max(c.last ?? 0, Date.parse(d.at));
  }
  const all = [...byName.values()];
  const online = all.filter((c) => c.online).sort((a, b) => (a.name === me ? -1 : b.name === me ? 1 : a.name.localeCompare(b.name)));
  const past = all.filter((c) => !c.online).sort((a, b) => (b.last ?? 0) - (a.last ?? 0));

  return (
    <section className="hv-card hv-ov__people">
      <header className="hv-ov__head"><h2>Collaborators</h2><span className="hv-sticker hv-sticker--green">{online.length} online</span></header>
      {online.length ? (
        <ul className="hv-people">
          {online.map((c) => (
            <PersonRow key={c.name} c={c} me={me} now={now}
              detail={c.openTaskId ? `Viewing ${s.tasks[c.openTaskId]?.title ?? c.openTaskId}` : c.name === me ? 'You' : 'Online'} />
          ))}
        </ul>
      ) : <p className="hv-ov__empty">Open this page with ?name=YourName to show up here.</p>}
      {past.length > 0 && (
        <>
          <span className="hv-label">Past collaborators</span>
          <ul className="hv-people is-past">
            {past.map((c) => <PersonRow key={c.name} c={c} me={me} now={now} detail="Not connected" />)}
          </ul>
        </>
      )}
    </section>
  );
}

function PersonRow({ c, me, now, detail }: { c: Contributor; me: string; now: number; detail: string }) {
  return (
    <li>
      <span className="hv-people__av"><Avatar name={c.name} size={34} />{c.online && <i />}</span>
      <div><b>{c.name}{c.name === me ? ' (you)' : ''}</b><span>{detail}</span></div>
      <div className="hv-people__num"><b>{c.actions}</b><span>{c.last ? timeAgo(c.last, now) : 'decisions'}</span></div>
    </li>
  );
}

const WEEKS = 24;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const levelFor = (n: number) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);

// Activity per day = decisions logged that day (spec changes, graph edits, agent results, merges, pushes).
function Calendar({ now, decisions }: { now: number; decisions: Decision[] }) {
  const { cols, worked, streak } = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const d of decisions) { const k = dayKey(new Date(d.at)); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));        // finish the current week
    const cols: { key: string; level: number; label: string; isToday: boolean; future: boolean; month?: string }[][] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(end);
        day.setDate(end.getDate() - w * 7 - (6 - d));
        const key = dayKey(day);
        const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000);
        const n = perDay.get(key) ?? 0;
        const future = daysAgo < 0;
        col.push({ key, level: levelFor(n), isToday: daysAgo === 0, future,
          label: `${day.toDateString()}${future ? '' : ` · ${n} ${n === 1 ? 'decision' : 'decisions'}`}`,
          month: day.getDate() <= 7 && d === 0 ? MONTHS[day.getMonth()] : undefined });
      }
      cols.push(col);
    }
    let streak = 0;
    for (const day = new Date(today); perDay.get(dayKey(day)); day.setDate(day.getDate() - 1)) streak++;
    return { cols, worked: perDay.size, streak };
  }, [now, decisions]);

  return (
    <section className="hv-card hv-ov__cal">
      <header className="hv-ov__head">
        <h2>Days worked</h2>
        <div className="hv-chips">
          <span className="hv-sticker hv-sticker--hot">{worked} days</span>
          <span className="hv-sticker hv-sticker--ink">{streak}-day streak</span>
        </div>
      </header>
      <div className="hv-cal">
        <div className="hv-cal__days"><span /><span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /></div>
        {cols.map((col, i) => (
          <div key={i} className="hv-cal__col">
            <span className="hv-cal__month">{col[0].month ?? ''}</span>
            {col.map((c) => (
              <span key={c.key} title={c.label} className={`hv-cal__cell l${c.level}${c.isToday ? ' is-today' : ''}${c.future ? ' is-future' : ''}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="hv-cal__legend">Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`hv-cal__cell l${l}`} />)} More</div>
    </section>
  );
}

function Stack() {
  return (
    <section className="hv-card hv-ov__stack">
      <header className="hv-ov__head"><h2>Stack</h2></header>
      <div className="hv-stack">
        {STACK.map((g) => (
          <div key={g.group} className="hv-stack__group">
            <span className="hv-label">{g.group}</span>
            <div className="hv-chips">
              {g.items.map((it) => (
                <span key={it.name} className="hv-stackchip" title={it.note}><b>{it.name}</b><em>{it.note}</em></span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Checkpoints() {
  const s = useHive();
  const anyTasks = Object.keys(s.tasks).length > 0;
  const rebuilt = s.decisions.some((d) => d.kind === 'spec-change')
    && s.decisions.some((d, i) => d.kind === 'agent-result' && s.decisions.findIndex((x) => x.kind === 'spec-change') < i);
  const pushed = s.decisions.some((d) => d.kind === 'push');
  const items = [
    { id: 'CP1', text: 'A chat request builds a graph both windows see and edit', ok: anyTasks },
    { id: 'CP2', text: 'Tasks build in dependency order; a spec change stales only its part', ok: rebuilt },
    { id: 'CP3', text: 'All six stages run end to end, through the push', ok: pushed },
  ];
  const pct = Math.round((items.filter((i) => i.ok).length / items.length) * 100);
  return (
    <section className="hv-card hv-ov__cps">
      <header className="hv-ov__head"><h2>Checkpoints</h2><span className="hv-sticker hv-sticker--cream">{pct}%</span></header>
      <div className="hv-progress"><span style={{ width: `${pct}%` }} /></div>
      <ul className="hv-cps">
        {items.map((it) => (
          <li key={it.id} className={it.ok ? 'is-ok' : ''}>
            <span className="hv-cps__box">{it.ok ? <Icon name="check" size={16} /> : null}</span>
            <b>{it.id}</b><span>{it.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentDecisions({ q }: { q: string }) {
  const s = useHive();
  const recent = [...s.decisions].reverse().slice(0, 4);
  return (
    <section className="hv-card hv-ov__recent">
      <header className="hv-ov__head"><h2>Recent decisions</h2><Link className="hv-linkbtn" href={`/tasks${q}`}>Open tasks</Link></header>
      {recent.length ? (
        <ul className="hv-recent">
          {recent.map((d) => (
            <li key={d.id}>
              <span className="hv-cite">#{d.id}</span>
              <div><b>{d.summary}</b>{d.why && <em>“{d.why}”</em>}</div>
            </li>
          ))}
        </ul>
      ) : <p className="hv-ov__empty">Nothing yet. Send the demo request on the Tasks page and decisions will show up here.</p>}
    </section>
  );
}
