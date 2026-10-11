'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Avatar, Icon, tilt } from '@/components/ui';
import { useUserName } from '@/lib/hive';
import { appQuery, createProject, lastProject, useProjects } from '@/lib/projects';
import type { Project } from '@hive/shared/types';

// The project list: open one, or start a new one. Each project has its own task graph, chat,
// agents, git workspace and GitHub repo. Opening a project is a full page load (one doc per tab).
export default function ProjectsPage() {
  const me = useUserName();
  const { projects, error } = useProjects();
  const [last, setLast] = useState('');
  useEffect(() => setLast(lastProject()), []);
  const sorted = [...(projects ?? [])].sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : b.createdAt.localeCompare(a.createdAt)));

  return (
    <div className="hv-app">
      <header className="hv-top">
        <Link href={`/${appQuery(me, '')}`} className="hv-logo" aria-label="Hive home">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
            <path d="M17 2.5l12.5 7.2v14.6L17 31.5 4.5 24.3V9.7z" fill="#ff5c1a" stroke="#14121a" strokeWidth="3" strokeLinejoin="round" />
            <path d="M17 11l6 3.5v7L17 25l-6-3.5v-7z" fill="#fffdf8" stroke="#14121a" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
          <span>Hive</span>
        </Link>
        <span className="hv-wordbox">projects</span>
        <div className="hv-top__spacer" />
        <span className="hv-presence__me"><Avatar name={me} size={36} /><em>you</em></span>
      </header>
      <main className="hv-page">
        <div className="hv-projects">
          <h1>Your <span className="hv-wordbox hv-wordbox--xl">projects</span></h1>
          {error && <p className="hv-projects__msg">{error}</p>}
          {!projects && !error && <p className="hv-projects__msg">Loading projects…</p>}
          <div className="hv-projects__grid">
            <NewProject me={me} first={projects?.length === 0} />
            {sorted.map((p) => <ProjectCard key={p.id} p={p} me={me} recent={p.id === last} />)}
          </div>
        </div>
      </main>
    </div>
  );
}

function ProjectCard({ p, me, recent }: { p: Project; me: string; recent: boolean }) {
  return (
    // A plain link, not <Link>: the page must reload to connect to this project's doc.
    <a className="hv-card hv-projects__card" href={`/tasks${appQuery(me, p.id)}`} style={tilt(p.id, 1.2)}>
      <div className="hv-projects__cardtop">
        <h2>{p.name}</h2>
        {recent && <span className="hv-sticker hv-sticker--blue" style={tilt(`${p.id}r`)}>Last opened</span>}
      </div>
      <p>{p.goal || 'No goal yet.'}</p>
      <div className="hv-projects__meta">
        <Avatar name={p.createdBy} size={22} />
        <span>{p.createdBy} · {new Date(p.createdAt).toLocaleDateString()}</span>
        {p.repo && <span className="hv-sticker hv-sticker--ink"><Icon name="link" size={12} /> {p.repo}</span>}
      </div>
      <span className="hv-projects__open">Open <Icon name="arrow" size={16} /></span>
    </a>
  );
}

function NewProject({ me, first }: { me: string; first: boolean }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [repo, setRepo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState<Project | null>(null);   // created, but its GitHub repo was not
  const open = (p: Project) => { window.location.href = `/tasks${appQuery(me, p.id)}`; };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const p = await createProject(name.trim(), goal.trim(), me, repo);
      if (!p.repoError) return open(p);
      setMade(p);
      setErr(p.repoError);
      setBusy(false);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="hv-card hv-card--hot hv-projects__new" onSubmit={submit}>
      <h2><Icon name="plus" size={20} /> {first ? 'Start your first project' : 'New project'}</h2>
      <label>
        <span>Name</span>
        <input className="hv-input" value={name} maxLength={60} placeholder="To-do app" onChange={(e) => setName(e.target.value)} required disabled={!!made} />
      </label>
      <label>
        <span>Goal</span>
        <textarea className="hv-input hv-input--area" value={goal} maxLength={500} rows={3}
          placeholder="What are you building? The planner reads this when you plan in chat."
          onChange={(e) => setGoal(e.target.value)} />
      </label>
      <label className="hv-projects__check">
        <input type="checkbox" checked={repo} onChange={(e) => setRepo(e.target.checked)} disabled={!!made} />
        <span>Create a private GitHub repo for it</span>
      </label>
      {err && <p className="hv-projects__err">{made ? `${made.name} was created. ` : ''}{err}</p>}
      {made ? (
        <button type="button" className="hv-btn hv-btn--ink" onClick={() => open(made)}>Open {made.name} <Icon name="arrow" size={16} /></button>
      ) : (
        <button className="hv-btn hv-btn--ink" disabled={!name.trim() || busy}>
          {busy ? <><i className="hv-spinner" /> {repo ? 'Creating project and repo…' : 'Creating…'}</> : <>Create project <Icon name="arrow" size={16} /></>}
        </button>
      )}
    </form>
  );
}
