'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/TopBar';
import { Avatar, Icon, tilt } from '@/components/ui';
import { useUserName } from '@/lib/hive';
import { useHive } from '@/lib/mock';
import {
  activityOn, connectRepo, PAST_PEOPLE, PEOPLE_INFO, PROJECT, SEED_COMMITS, STACK, timeAgo, useRepo, type Commit,
} from '@/lib/project';

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
  const commits = [...liveCommits, ...SEED_COMMITS];
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
              <span><Icon name="bolt" size={14} /> Day {PROJECT.started + 1}</span>
              <span>{PROJECT.deadline}</span>
            </div>
          </section>

          <section className="hv-ov__stats">
            <Stat label="Tasks done" value={`${done.length}/${tasks.length || 5}`} tone="green" id="s1" />
            <Stat label="Commits" value={String(commits.length)} tone="blue" id="s2" />
            <Stat label="Tests passing" value={String(testsPassing)} tone="hot" id="s3" />
            <Stat label="Agent runs" value={String(agentRuns)} tone="ink" id="s4" />
          </section>

          <GitHistory commits={commits} now={now} pushed={s.pushedUrl} />

          <aside className="hv-ov__side">
            <AgentsNow />
            <People />
          </aside>

          <Calendar now={now} todayCount={s.decisions.length} />
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
  const [draft, setDraft] = useState('hive-demo/url-shortener');
  const [connecting, setConnecting] = useState(false);
  const connect = () => {
    if (!draft.trim()) return;
    setConnecting(true);
    setTimeout(() => { connectRepo(draft.trim()); setConnecting(false); }, 900);
  };

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
            <input className="hv-input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="owner/repo"
              onKeyDown={(e) => { if (e.key === 'Enter') connect(); }} />
            <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={connect} disabled={connecting}>
              {connecting ? <><i className="hv-spinner" /> Connecting…</> : <>Connect <Icon name="arrow" size={14} /></>}
            </button>
          </div>
        </div>
      )}

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

function People() {
  return (
    <section className="hv-card hv-ov__people">
      <header className="hv-ov__head"><h2>Collaborators</h2><span className="hv-sticker hv-sticker--green">{PEOPLE_INFO.length} online</span></header>
      <ul className="hv-people">
        {PEOPLE_INFO.map((p) => <PersonRow key={p.name} p={p} />)}
      </ul>
      <span className="hv-label">Past collaborators</span>
      <ul className="hv-people is-past">
        {PAST_PEOPLE.map((p) => <PersonRow key={p.name} p={p} />)}
      </ul>
    </section>
  );
}

function PersonRow({ p }: { p: (typeof PEOPLE_INFO)[number] }) {
  return (
    <li>
      <span className="hv-people__av"><Avatar name={p.name} size={34} />{p.online && <i />}</span>
      <div><b>{p.name}</b><span>{p.role}</span></div>
      <div className="hv-people__num"><b>{p.commits}</b><span>{p.lastActive}</span></div>
    </li>
  );
}

const WEEKS = 24;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Calendar({ now, todayCount }: { now: number; todayCount: number }) {
  const { cols, worked, streak } = useMemo(() => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));        // finish the current week
    const cols: { key: string; level: number; label: string; isToday: boolean; future: boolean; month?: string }[][] = [];
    let worked = 0;
    for (let w = WEEKS - 1; w >= 0; w--) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(end);
        day.setDate(end.getDate() - w * 7 - (6 - d));
        const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000);
        const key = day.toISOString().slice(0, 10);
        const isToday = daysAgo === 0;
        const future = daysAgo < 0;
        let level = future ? 0 : activityOn(key, daysAgo);
        if (isToday) level = Math.max(level, Math.min(4, 1 + Math.floor(todayCount / 4)));
        if (level > 0) worked++;
        col.push({ key, level, isToday, future, label: `${day.toDateString()}${future ? '' : ` · ${level ? `${level * 3} edits` : 'no activity'}`}`,
          month: day.getDate() <= 7 && d === 0 ? MONTHS[day.getMonth()] : undefined });
      }
      cols.push(col);
    }
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      const day = new Date(today); day.setDate(today.getDate() - i);
      const lvl = i === 0 ? 1 : activityOn(day.toISOString().slice(0, 10), i);
      if (!lvl) break;
      streak++;
    }
    return { cols, worked, streak };
  }, [now, todayCount]);

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
