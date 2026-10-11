'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signIn, useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ApproveDemo, AskDemo, SessionDemo, TakeoverDemo } from '@/components/LandingDemos';
import { StatusSticker, type DisplayStatus } from '@/components/Status';
import { Avatar, Icon, tilt, type IconName } from '@/components/ui';

// "/" is the landing page. With ?name= (the demo URLs) it skips straight to the project list.
export default function Landing() {
  const router = useRouter();
  const auth = useAuth();
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('name')) {
      setSkipping(true);
      router.replace(`/projects${window.location.search}`);
    }
  }, [router]);

  // GitHub OAuth through Supabase, landing on the project list. Already signed in, or sign-in off: just go there.
  const connect = () => {
    if (auth.auth && !auth.login) signIn('/projects');
    else router.push('/projects');
  };

  if (skipping) return null;

  return (
    <div className="hv-land">
      <header className="hv-land__nav">
        <Link href="/" className="hv-logo" aria-label="Hive home">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
            <path d="M17 2.5l12.5 7.2v14.6L17 31.5 4.5 24.3V9.7z" fill="#ff5c1a" stroke="#14121a" strokeWidth="3" strokeLinejoin="round" />
            <path d="M17 11l6 3.5v7L17 25l-6-3.5v-7z" fill="#fffdf8" stroke="#14121a" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
          <span>Hive</span>
        </Link>
        <nav className="hv-land__links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">Try it</a>
          <a href="#projects">Projects</a>
          <a href="#under">Under the hood</a>
        </nav>
        <Link href="/tasks" className="hv-btn hv-btn--ink hv-btn--sm">Open workspace <Icon name="arrow" size={14} /></Link>
      </header>

      <main>
        <section className="hv-land__hero">
          <div className="hv-land__pitch">
            <span className="hv-sticker hv-sticker--hot" style={tilt('hero', 3)}>Humans + AI agents</span>
            <h1>One live task graph for your <span className="hv-wordbox hv-wordbox--xl">whole team</span></h1>
            <p>
              Describe what to build in chat. A Planner agent turns it into a task graph everyone edits live.
              Builder agents take each ready task, write the code on its own branch and let the tests decide.
              Change your mind halfway and only the affected task rebuilds.
            </p>
            <div className="hv-land__join">
              <button className="hv-btn hv-btn--hot hv-btn--lg" onClick={connect} disabled={!auth.ready}>
                <Icon name="github" /> {auth.login ? 'Open your projects' : 'Connect to GitHub'} <Icon name="arrow" />
              </button>
            </div>
            <p className="hv-land__hint">Anyone can sign up, but new accounts must be approved before they can use Hive.</p>
          </div>
          <DemoGraph />
        </section>

        <ul className="hv-land__strip" aria-label="Highlights">
          {['Watch agents live', 'Steer mid-run', 'Take over & hand back', 'Hand off with a summary', 'Answers cite steps', 'Push to GitHub'].map((t, i) => (
            <li key={t} className={`hv-sticker ${['hv-sticker--blue', 'hv-sticker--paper', 'hv-sticker--ink', 'hv-sticker--green', 'hv-sticker--hot', 'hv-sticker--paper'][i]}`} style={tilt(t, 4)}>{t}</li>
          ))}
        </ul>

        <section id="how" className="hv-land__section">
          <SectionHead kicker="How it works" title="From one message to a pushed repo" />
          <ol className="hv-land__steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`hv-card hv-land__step${i % 3 === 1 ? ' hv-card--blue' : ''}`} style={tilt(s.title, 1.4)}>
                <span className="hv-land__num">{i + 1}</span>
                <span className="hv-land__stepicon"><Icon name={s.icon} size={22} /></span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="hv-land__section">
          <SectionHead kicker="Try it here" title="The real workspace, in miniature" />
          <p className="hv-land__lede">Each card runs the same flow the app does, scripted so you can click through it without an account.</p>
          <div className="hv-land__demos">
            <Demo n="01" title="Watch an agent work, then redirect it"
              text="Every step streams to every screen: its plan, the file it's typing, tests going red then green. Type into its session and it picks up your message at its next step.">
              <SessionDemo />
            </Demo>
            <Demo n="02" title="Take over, edit, hand back" flip
              text="Pause the agent and the task is yours. Each save is a commit under your name. Hand it back and the agent continues from your edit, or hand it to a teammate with an auto-written summary.">
              <TakeoverDemo />
            </Demo>
            <Demo n="03" title="Ask what happened, get receipts"
              text="Late to the party? Ask the Planner in chat. It answers from the step history and cites the exact steps, so you can check the work instead of trusting it.">
              <AskDemo />
            </Demo>
            <Demo n="04" title="Approve and ship" flip
              text="When the graph is green, Approve runs the tests on main and pushes to the project's private GitHub repo, with commits from agents and people side by side.">
              <ApproveDemo />
            </Demo>
          </div>
        </section>

        <section id="projects" className="hv-land__section">
          <SectionHead kicker="Projects" title="Every project gets its own repo and room" />
          <div className="hv-land__grid">
            {PROJECT_FEATURES.map((f) => (
              <article key={f.title} className="hv-card hv-land__mini" style={tilt(f.title, 1)}>
                <span className="hv-land__stepicon"><Icon name={f.icon} size={20} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="under" className="hv-land__section">
          <SectionHead kicker="Under the hood" title="Simple parts, wired live" />
          <div className="hv-land__flow">
            {FLOW.map((f, i) => (
              <div key={f.title} className="hv-land__flowitem">
                <div className={`hv-card hv-land__node${f.tone ? ` hv-card--${f.tone}` : ''}`}>
                  <span className="hv-label">{f.kind}</span>
                  <b>{f.title}</b>
                  <span>{f.text}</span>
                </div>
                {i < FLOW.length - 1 && <span className="hv-land__wire" aria-hidden="true"><Icon name="arrow" size={22} /></span>}
              </div>
            ))}
          </div>
          <p className="hv-land__note">
            Locally everything lives in files under <code>data/</code>; hosted, MongoDB keeps the docs and history.
            Sign-in is GitHub through Supabase. API keys and GitHub tokens stay on the server, and agent test runs get no keys at all.
          </p>
        </section>

        <section className="hv-land__cta hv-card hv-card--blue">
          <h2>Try the demo in three windows</h2>
          <p>Open Hive as Ana, Ben and Cal. Start a project, steer an agent, take over a task, ask what happened, then approve and push.</p>
          <div className="hv-land__ctabtns">
            {['Ana', 'Ben', 'Cal'].map((n) => (
              <Link key={n} href={`/projects?name=${n}`} target="_blank" className="hv-btn hv-btn--paper">
                <Avatar name={n} size={26} /> Open as {n}
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="hv-land__foot">
        <span>Hive · humans and agents, one graph</span>
        <nav aria-label="App pages">
          <Link href="/projects">Projects</Link>
          <Link href="/overview">Overview</Link>
          <Link href="/tasks">Tasks</Link>
          <Link href="/architecture">Architecture</Link>
          <Link href="/environment">Environment</Link>
        </nav>
      </footer>
    </div>
  );
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'plus', title: 'Start a project', text: 'Name it and describe the goal. Hive drafts a stack and spec doc for you to review, and creates a private GitHub repo.' },
  { icon: 'bot', title: 'Chat a task graph', text: 'Tell the Planner what to build. Tasks with specs and dependencies appear on a canvas everyone edits live.' },
  { icon: 'bolt', title: 'Agents run ready tasks', text: 'Each ready task gets its own agent, git worktree and branch. Steps stream to every screen as they happen.' },
  { icon: 'send', title: 'Steer anytime', text: 'Type into any agent’s session, like “count unique visitors, not hits.” It acknowledges at its next step.' },
  { icon: 'users', title: 'Take over or hand off', text: 'Grab a task, edit files as yourself, then hand it back to the agent or reassign it to a teammate.' },
  { icon: 'push', title: 'Approve and push', text: 'Tests run on main. When they pass, one click pushes it to GitHub.' },
];

const PROJECT_FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'sparkle', title: 'AI stack doc', text: 'Before you create a project, Hive drafts its stack and spec. Edit it; the Planner and every agent read it.' },
  { icon: 'github', title: 'Private GitHub repo', text: 'Each new project gets its own repo. Approve pushes main there from your GitHub account.' },
  { icon: 'users', title: 'Share by username', text: 'Add teammates by their GitHub login. They see the project, its graph and every session.' },
  { icon: 'lock', title: 'Yours by default', text: 'You only see your projects and the ones shared with you. Rename, reshare or delete anytime.' },
];

const FLOW: { kind: string; title: string; text: string; tone?: string }[] = [
  { kind: 'Browser', title: 'Next.js app', text: 'Graph, chat, sessions. Writes only tasks.' },
  { kind: 'Sync', title: 'Yjs + Hocuspocus', text: 'One live doc per project over WebSocket.', tone: 'hot' },
  { kind: 'Server', title: 'Sessions', text: 'Scheduler, steer, takeover, handback, handoff.', tone: 'ink' },
  { kind: 'Agents', title: 'LLM loop', text: 'Plan, read, edit, test, finish. One action per step.', tone: 'blue' },
  { kind: 'Output', title: 'Git + tests', text: 'A worktree per task, merged to main, pushed to GitHub.', tone: 'green' },
];

function SectionHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="hv-land__head">
      <span className="hv-label">{kicker}</span>
      <h2>{title}</h2>
    </div>
  );
}

function Demo({ n, title, text, flip = false, children }: { n: string; title: string; text: string; flip?: boolean; children: React.ReactNode }) {
  return (
    <article className={`hv-land__demorow${flip ? ' is-flip' : ''}`}>
      <div className="hv-land__demotext">
        <span className="hv-land__demonum">{n}</span>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      {children}
    </article>
  );
}

// ---- hero illustration: a looping, scripted run of a four-task graph ----

type DemoTask = { id: string; title: string; x: number; y: number };
const DEMO_TASKS: DemoTask[] = [
  { id: 'T1', title: 'Create short link', x: 0, y: 0 },
  { id: 'T2', title: 'Redirect', x: 290, y: 0 },
  { id: 'T3', title: 'Click stats', x: 0, y: 220 },
  { id: 'T4', title: 'README', x: 290, y: 220 },
];
const DEMO_EDGES = [['T1', 'T3'], ['T1', 'T4'], ['T2', 'T3'], ['T2', 'T4']];
const NODE_W = 240;
const NODE_H = 118;

const FRAMES: { st: DisplayStatus[]; caption: string; why?: boolean; pushed?: boolean }[] = [
  { st: ['ready', 'ready', 'todo', 'todo'], caption: 'Planner turned one message into four tasks' },
  { st: ['running', 'running', 'todo', 'todo'], caption: 'Two builders start on the tasks that are ready' },
  { st: ['done', 'running', 'todo', 'todo'], caption: 'Create short link passes its tests and merges' },
  { st: ['done', 'done', 'running', 'running'], caption: 'Dependencies done, so stats and README start' },
  { st: ['done', 'done', 'stale', 'done'], caption: 'Maya changes the stats spec mid-build', why: true },
  { st: ['done', 'done', 'running', 'done'], caption: 'Only Click stats rebuilds. The rest stays green' },
  { st: ['done', 'done', 'done', 'done'], caption: 'All tests pass on main. Pushed to GitHub', pushed: true },
];

function DemoGraph() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF((n) => (n + 1) % FRAMES.length), 2200);
    return () => clearInterval(t);
  }, []);
  const frame = FRAMES[f];
  const status = (id: string) => frame.st[DEMO_TASKS.findIndex((t) => t.id === id)];
  const pos = (id: string) => DEMO_TASKS.find((t) => t.id === id)!;

  return (
    <div className="hv-land__demo" aria-label="Animated example of a task graph being built">
      <div className="hv-land__stage">
        <svg className="hv-land__edges" viewBox={`0 0 ${290 + NODE_W} ${220 + NODE_H}`} aria-hidden="true">
          {DEMO_EDGES.map(([a, b]) => {
            const s = pos(a), t = pos(b);
            const x1 = s.x + NODE_W / 2, y1 = s.y + NODE_H, x2 = t.x + NODE_W / 2, y2 = t.y;
            const st = status(b);
            return <path key={a + b} className={st === 'running' ? 'is-running' : st === 'stale' ? 'is-stale' : ''}
              d={`M${x1} ${y1} C${x1} ${y1 + 60}, ${x2} ${y2 - 60}, ${x2} ${y2}`} />;
          })}
        </svg>
        {DEMO_TASKS.map((t, i) => {
          const st = frame.st[i];
          return (
            <div key={t.id} className={`hv-node hv-s-${st}`} style={{ left: t.x, top: t.y }}>
              {t.id === 'T3' && frame.why && <div className="hv-node__viewers"><Avatar name="Maya" size={26} /></div>}
              <div key={st} className="hv-node__body">
                <div className="hv-node__top">
                  <span className="hv-node__id">#{t.id}</span>
                  <span className="hv-node__who"><Icon name="bot" size={16} />agent</span>
                </div>
                <div className="hv-node__title">{t.title}</div>
                <div className="hv-node__foot"><StatusSticker status={st} size="sm" /></div>
              </div>
              {(st === 'running' || st === 'stale') && <div className="hv-node__bar" />}
            </div>
          );
        })}
        {frame.why && <p className="hv-why hv-land__why">“Count clicks per day”</p>}
        {frame.pushed && <span className="hv-sticker hv-sticker--green hv-land__pushed"><Icon name="push" size={14} /> Pushed</span>}
      </div>
      <p key={f} className="hv-land__caption"><span>{f + 1}/{FRAMES.length}</span>{frame.caption}</p>
    </div>
  );
}
