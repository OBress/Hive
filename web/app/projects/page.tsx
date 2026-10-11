'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { DeleteDialog, RenameDialog, ShareDialog, StackReview } from '@/components/ProjectDialogs';
import { Avatar, Icon, tilt } from '@/components/ui';
import { signIn, useAuth } from '@/lib/auth';
import { useUserName } from '@/lib/hive';
import { appQuery, createProject, githubStatus, lastProject, sameLogin, useProjects } from '@/lib/projects';
import type { Project } from '@hive/shared/types';

type Tab = 'mine' | 'shared';
type Sort = 'recent' | 'newest' | 'oldest' | 'name';
type When = 'any' | 'week' | 'month' | 'older';
type Kind = 'all' | 'stack' | 'repo' | 'team';
type Dialog = { kind: 'rename' | 'delete' | 'share'; project: Project } | null;

const DAY = 24 * 60 * 60 * 1000;
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'stack', label: 'AI stack' }, { id: 'repo', label: 'GitHub repo' }, { id: 'team', label: 'Shared with others' },
];

// The project list: my projects and the ones shared with me, each searchable and filterable; start a new one,
// or rename, share and delete. Opening a project is a full page load (one doc per tab).
export default function ProjectsPage() {
  const me = useUserName();
  const { projects, error } = useProjects();
  const [last, setLast] = useState('');
  const [tab, setTab] = useState<Tab>('mine');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [when, setWhen] = useState<When>('any');
  const [kind, setKind] = useState<Kind>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  useEffect(() => setLast(lastProject()), []);

  const mine = (projects ?? []).filter((p) => sameLogin(p.createdBy, me));
  const shared = (projects ?? []).filter((p) => !sameLogin(p.createdBy, me));
  const q = query.trim().toLowerCase();
  const age = (p: Project) => Date.now() - Date.parse(p.createdAt);
  const shown = (tab === 'mine' ? mine : shared)
    .filter((p) => !q || [p.name, p.goal, p.createdBy, p.repo ?? '', ...p.sharedWith].some((s) => s.toLowerCase().includes(q)))
    .filter((p) => when === 'any' || (when === 'week' ? age(p) <= 7 * DAY : when === 'month' ? age(p) <= 30 * DAY : age(p) > 30 * DAY))
    .filter((p) => kind === 'all' || (kind === 'stack' ? !!p.stack : kind === 'repo' ? !!p.repo : p.sharedWith.length > 0))
    .sort((a, b) => {
      if (sort === 'recent' && (a.id === last || b.id === last)) return a.id === last ? -1 : 1;
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      return b.createdAt.localeCompare(a.createdAt);
    });
  const filtering = !!q || when !== 'any' || kind !== 'all';
  const clear = () => { setQuery(''); setWhen('any'); setKind('all'); };

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

          <div className="hv-projects__bar">
            <div className="hv-tabs hv-projects__tabs" role="tablist" aria-label="Which projects"
              style={{ '--i': tab === 'mine' ? 0 : 1, '--n': 2 } as CSSProperties}>
              <span className="hv-tabs__pill" />
              <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'is-on' : ''} onClick={() => setTab('mine')}>
                My projects <span className="hv-projects__count">{mine.length}</span>
              </button>
              <button role="tab" aria-selected={tab === 'shared'} className={tab === 'shared' ? 'is-on' : ''} onClick={() => setTab('shared')}>
                Shared with me <span className="hv-projects__count">{shared.length}</span>
              </button>
            </div>
            <label className="hv-searchbox hv-projects__search">
              <Icon name="search" size={16} />
              <input className="hv-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search names, goals, people, repos" aria-label="Search projects" />
            </label>
            <select className="hv-input hv-select" value={when} onChange={(e) => setWhen(e.target.value as When)} aria-label="Created">
              <option value="any">Any date</option>
              <option value="week">Past 7 days</option>
              <option value="month">Past 30 days</option>
              <option value="older">Older than 30 days</option>
            </select>
            <select className="hv-input hv-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
              <option value="recent">Last opened first</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
          <div className="hv-seg hv-projects__kinds" role="group" aria-label="Filter by type">
            {KINDS.map((k) => (
              <button key={k.id} type="button" className={`hv-seg__opt${kind === k.id ? ' is-on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
            {filtering && <button type="button" className="hv-projects__clear" onClick={clear}>Clear filters</button>}
          </div>

          {error && <p className="hv-projects__msg">{error}</p>}
          {!projects && !error && <p className="hv-projects__msg">Loading projects…</p>}
          <div className="hv-projects__grid">
            {tab === 'mine' && <NewProject me={me} first={projects?.length === 0} />}
            {shown.map((p) => (
              <ProjectCard key={p.id} p={p} me={me} recent={p.id === last} onAction={(kind) => setDialog({ kind, project: p })} />
            ))}
          </div>
          {projects && !shown.length && (
            <p className="hv-projects__msg">
              {filtering ? <>No projects match. <button type="button" className="hv-projects__clear" onClick={clear}>Clear filters</button></>
                : tab === 'shared' ? 'Nothing is shared with you yet. When a teammate shares a project with your GitHub username, it shows up here.'
                : null}
            </p>
          )}
        </div>
      </main>
      {dialog?.kind === 'rename' && <RenameDialog project={dialog.project} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteDialog project={dialog.project} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'share' && (
        <ShareDialog project={projects?.find((p) => p.id === dialog.project.id) ?? dialog.project} me={me} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function ProjectCard({ p, me, recent, onAction }: { p: Project; me: string; recent: boolean; onAction: (k: 'rename' | 'delete' | 'share') => void }) {
  const owner = sameLogin(p.createdBy, me);
  return (
    <article className="hv-card hv-projects__card" style={tilt(p.id, 1.2)}>
      <div className="hv-projects__cardtop">
        {/* A plain link, not <Link>: the page must reload to connect to this project's doc. It covers the card. */}
        <h2><a className="hv-projects__link" href={`/tasks${appQuery(me, p.id)}`}>{p.name}</a></h2>
        {recent && <span className="hv-sticker hv-sticker--blue" style={tilt(`${p.id}r`)}>Last opened</span>}
      </div>
      <p>{p.goal || 'No goal yet.'}</p>
      <div className="hv-projects__meta">
        <Avatar name={p.createdBy} size={22} />
        <span>{owner ? 'you' : p.createdBy} · {new Date(p.createdAt).toLocaleDateString()}</span>
        {p.stack && <span className="hv-sticker hv-sticker--paper"><Icon name="sparkle" size={12} /> AI stack</span>}
        {p.repo && <span className="hv-sticker hv-sticker--ink"><Icon name="github" size={12} /> {p.repo}</span>}
      </div>
      {p.sharedWith.length > 0 && (
        <div className="hv-projects__people" title={`Shared with ${p.sharedWith.join(', ')}`}>
          {p.sharedWith.slice(0, 5).map((l) => <Avatar key={l} name={l} size={22} />)}
          <span>{p.sharedWith.length > 5 ? `+${p.sharedWith.length - 5} more` : `shared with ${p.sharedWith.length}`}</span>
        </div>
      )}
      <div className="hv-projects__actions">
        <button type="button" className="hv-iconbtn" onClick={() => onAction('share')} aria-label={`Share ${p.name}`} title="Share"><Icon name="users" size={17} /></button>
        <button type="button" className="hv-iconbtn" onClick={() => onAction('rename')} aria-label={`Rename ${p.name}`} title="Rename"><Icon name="pencil" size={17} /></button>
        {owner && <button type="button" className="hv-iconbtn hv-iconbtn--danger" onClick={() => onAction('delete')} aria-label={`Delete ${p.name}`} title="Delete"><Icon name="trash" size={17} /></button>}
        <span className="hv-projects__open">Open <Icon name="arrow" size={16} /></span>
      </div>
    </article>
  );
}

const slug = (s: string) => s.trim().replace(/[^\w.-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 100);

function NewProject({ me, first }: { me: string; first: boolean }) {
  const auth = useAuth();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [repoName, setRepoName] = useState('');
  const [repoEdited, setRepoEdited] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [withStack, setWithStack] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [github, setGithub] = useState<boolean | null>(null);

  // With sign-in on, the repo is made with the person's GitHub token, which the server keeps in memory only.
  useEffect(() => {
    if (!auth.ready) return;
    if (!auth.auth) return setGithub(true);
    void githubStatus().then((s) => setGithub(s.githubConnected), () => setGithub(false));
  }, [auth.ready, auth.auth, auth.login]);

  const repo = repoEdited ? repoName : slug(name);
  const create = async (stack?: string) => {
    const p = await createProject({ name: name.trim(), goal: goal.trim(), by: me, repoName: repo, private: isPrivate, stack });
    window.location.href = `/tasks${appQuery(me, p.id)}`;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !github) return;
    if (withStack) return setReviewing(true);
    setBusy(true);
    setErr('');
    try { await create(); } catch (x) { setErr((x as Error).message); setBusy(false); }
  };

  return (
    <>
    <form className="hv-card hv-card--hot hv-projects__new" onSubmit={submit}>
      <h2><Icon name="plus" size={20} /> {first ? 'Start your first project' : 'New project'}</h2>
      <label>
        <span>Name</span>
        <input className="hv-input" value={name} maxLength={60} placeholder="To-do app" onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        <span>Goal</span>
        <textarea className="hv-input hv-input--area" value={goal} maxLength={500} rows={3}
          placeholder="What are you building? The planner reads this when you plan in chat."
          onChange={(e) => setGoal(e.target.value)} />
      </label>
      <label>
        <span>GitHub repo</span>
        <div className="hv-projects__repo">
          <Icon name="github" size={16} />
          <input className="hv-input" value={repo} maxLength={100} placeholder="todo-app" aria-label="New GitHub repo name"
            onChange={(e) => { setRepoEdited(true); setRepoName(e.target.value.replace(/[^\w.-]/g, '-')); }} />
        </div>
      </label>
      <label className="hv-projects__check">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        <span>Private repo</span>
      </label>
      <label className="hv-projects__check hv-projects__check--ai">
        <input type="checkbox" checked={withStack} onChange={(e) => setWithStack(e.target.checked)} />
        <span><b><Icon name="sparkle" size={14} /> Let AI pick the tech stack</b><em>Not technical? Hive drafts a stack and spec doc from your goal. You review and approve it before anything is created.</em></span>
      </label>
      {github === false && (
        <div className="hv-projects__gh">
          <p>Hive creates a GitHub repo for every project. Connect GitHub so it can do that for you.</p>
          <button type="button" className="hv-btn hv-btn--ink hv-btn--sm" onClick={signIn}><Icon name="github" size={15} /> Connect GitHub</button>
        </div>
      )}
      {err && <p className="hv-projects__err">{err}</p>}
      <button className="hv-btn hv-btn--ink" disabled={!name.trim() || busy || !github || !repo}>
        {busy ? <><i className="hv-spinner" /> Creating project and repo…</>
          : withStack ? <>Draft the stack <Icon name="arrow" size={16} /></>
          : <>Create project <Icon name="arrow" size={16} /></>}
      </button>
    </form>
    {reviewing && <StackReview name={name.trim()} goal={goal.trim()} onApprove={create} onClose={() => setReviewing(false)} />}
    </>
  );
}
