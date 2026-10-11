'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { StatusSticker, type DisplayStatus } from '@/components/Status';
import { Avatar, Icon, tilt, type IconName } from '@/components/ui';

// "/" is the landing page. With ?name= (the demo URLs) it skips straight to the workspace.
export default function Landing() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('name')) {
      setSkipping(true);
      router.replace(`/overview${window.location.search}`);
    }
  }, [router]);

  const join = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/tasks?name=${encodeURIComponent(name.trim() || 'Guest')}`);
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
          <a href="#features">Features</a>
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
            <form className="hv-land__join" onSubmit={join}>
              <input className="hv-input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Your name" aria-label="Your name" maxLength={24} />
              <button className="hv-btn hv-btn--hot hv-btn--lg">Join the workspace <Icon name="arrow" /></button>
            </form>
            <p className="hv-land__hint">Open it in two windows with different names to watch edits sync.</p>
          </div>
          <DemoGraph />
        </section>

        <ul className="hv-land__strip" aria-label="Highlights">
          {['Planner agent', '2 builds at once', 'Real git commits', 'Tests decide', 'Every decision logged'].map((t, i) => (
            <li key={t} className={`hv-sticker ${['hv-sticker--blue', 'hv-sticker--paper', 'hv-sticker--ink', 'hv-sticker--green', 'hv-sticker--hot'][i]}`} style={tilt(t, 4)}>{t}</li>
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
          <SectionHead kicker="Features" title="Built for people and agents working at once" />
          <div className="hv-land__features">
            <Feature title="Change the spec mid-build" text="Edit a task while it's building and Hive marks it stale, stops the run and rebuilds just that task. Everything that already passed stays put. Hive asks why, and the answer goes into the log.">
              <div className="hv-land__mock">
                <StatusSticker status="stale" size="lg" />
                <p className="hv-why" style={tilt('why', 2)}>“Stats should count clicks per day, not total.”</p>
                <span className="hv-land__mockmeta"><Avatar name="Maya" size={22} /> Maya changed <b>#T3 Click stats</b></span>
              </div>
            </Feature>

            <Feature title="Conflicts, settled by tests" text="When two builders touch the same file, Hive opens a conflict card with both sides. An AI merge is proposed and applied only if the tests pass. Otherwise a person picks A or B.">
              <div className="hv-land__mock hv-land__mock--conflict">
                <div className="hv-land__sides">
                  <pre><b>A · #T1</b>{'\n'}app.post(&apos;/links&apos;, create)</pre>
                  <pre><b>B · #T2</b>{'\n'}app.get(&apos;/:code&apos;, go)</pre>
                </div>
                <pre className="hv-land__merged"><b>Merged · tests pass ✓</b>{'\n'}app.post(&apos;/links&apos;, create){'\n'}app.get(&apos;/:code&apos;, go)</pre>
              </div>
            </Feature>

            <Feature title="Ask why, get receipts" text="Every spec change, graph edit, agent result, merge and push is recorded. Ask the Planner why something is the way it is and it answers from that log, citing decision ids you can click.">
              <div className="hv-land__mock hv-land__mock--ink">
                <div className="hv-bubble"><b>Why are codes 6 characters?</b></div>
                <div className="hv-bubble hv-land__answer">
                  Sam set base62 codes to keep links short while leaving room for 56B links.
                  <span className="hv-cites"><span>Sources</span><span className="hv-cite">#D4</span><span className="hv-cite">#D9</span></span>
                </div>
              </div>
            </Feature>

            <Feature title="See everything live" text="Everyone shares one document. You see who is online, which task they have open, what each agent is doing, the commit history and when work happened.">
              <div className="hv-land__mock">
                <div className="hv-land__presence">
                  <Avatar name="planner" agent busy size={40} />
                  <Avatar name="builder" agent busy size={40} />
                  <span className="hv-presence__gap" />
                  <Avatar name="Maya" size={40} /><Avatar name="Sam" size={40} /><Avatar name="Priya" size={40} />
                </div>
                <span className="hv-land__mockmeta"><span className="hv-node__commit">a3f9c21</span> task/T2 · Redirect: tests pass</span>
              </div>
            </Feature>
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
            No database: the server keeps a single Y.Doc in memory and saves it to disk every two seconds.
            Only the server holds the API key, and agent output is checked before it is written.
          </p>
        </section>

        <section className="hv-land__cta hv-card hv-card--blue">
          <h2>Try the demo in three windows</h2>
          <p>Open the workspace as Maya, Sam and Priya. Send the demo request, change a spec while it builds, and push when every test is green.</p>
          <div className="hv-land__ctabtns">
            {['Maya', 'Sam', 'Priya'].map((n) => (
              <Link key={n} href={`/tasks?name=${n}`} target="_blank" className="hv-btn hv-btn--paper">
                <Avatar name={n} size={26} /> Open as {n}
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="hv-land__foot">
        <span>Hive · humans and agents, one graph</span>
        <nav aria-label="App pages">
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
  { icon: 'send', title: 'Say what you want', text: 'Type a request in chat, like “Build a URL shortener API with tests.” Mention a task with @ to point at it.' },
  { icon: 'bot', title: 'The Planner draws the graph', text: 'Tasks with a spec, acceptance tests, files and dependencies appear on a canvas every collaborator can edit live.' },
  { icon: 'bolt', title: 'Builders run in order', text: 'Builder agents pick up tasks whose dependencies are done, two at a time, each on its own git branch.' },
  { icon: 'pencil', title: 'Change your mind anytime', text: 'Edit a spec mid-build and only that task goes stale and rebuilds. Hive asks why and logs the answer.' },
  { icon: 'branch', title: 'Conflicts get resolved', text: 'Overlapping changes open a conflict card. An AI merge is applied if the tests pass, otherwise a human picks.' },
  { icon: 'push', title: 'Approve and push', text: 'When everything is green on main, one click pushes it to your connected GitHub repo.' },
];

const FLOW: { kind: string; title: string; text: string; tone?: string }[] = [
  { kind: 'Browser', title: 'Next.js app', text: 'Graph, chat, task panel. Writes only tasks.' },
  { kind: 'Sync', title: 'Yjs + Hocuspocus', text: 'One shared doc over WebSocket.', tone: 'hot' },
  { kind: 'Server', title: 'Orchestrator', text: 'Versions, staleness, runs, conflicts, log.', tone: 'ink' },
  { kind: 'Agents', title: 'Claude', text: 'Planner, Builder, Merge and Ask, each output validated.', tone: 'blue' },
  { kind: 'Output', title: 'Git + tests', text: 'A branch per task, merged when tests pass.', tone: 'green' },
];

function SectionHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="hv-land__head">
      <span className="hv-label">{kicker}</span>
      <h2>{title}</h2>
    </div>
  );
}

function Feature({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <article className="hv-card hv-land__feature">
      <div>
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
