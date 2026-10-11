'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Project, UserSummary } from '@hive/shared/types';
import { Avatar, Icon } from '@/components/ui';
import { deleteProject, draftStack, renameProject, sameLogin, searchUsers, setShared } from '@/lib/projects';

// Dialogs for one project, used on the project list and on Overview: rename, delete, share, and the
// stack / spec review shown before a project is created.

export function Modal({ title, onClose, children, wide = false }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    d?.querySelector<HTMLElement>('input, textarea')?.focus();   // showModal() would focus the close button
  }, []);
  return (
    <dialog ref={ref} className={`hv-modal${wide ? ' hv-modal--wide' : ''}`} onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hv-modal__body">
        <header className="hv-modal__head">
          <h2>{title}</h2>
          <button type="button" className="hv-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try { await fn(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return { busy, err, go };
}

export function RenameDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name);
  const { busy, err, go } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === project.name) return onClose();
    void go(async () => { await renameProject(project.id, name.trim()); onClose(); });
  };
  return (
    <Modal title="Rename project" onClose={onClose}>
      <form className="hv-modal__form" onSubmit={submit}>
        <label className="hv-field">
          <span className="hv-label">Name</span>
          <input className="hv-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </label>
        {err && <p className="hv-projects__err">{err}</p>}
        <div className="hv-modal__actions">
          <button type="button" className="hv-btn hv-btn--paper hv-btn--sm" onClick={onClose}>Cancel</button>
          <button className="hv-btn hv-btn--ink hv-btn--sm" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Rename'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteDialog({ project, onClose, onDeleted }: { project: Project; onClose: () => void; onDeleted?: () => void }) {
  const [typed, setTyped] = useState('');
  const { busy, err, go } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void go(async () => { await deleteProject(project.id); onClose(); onDeleted?.(); });
  };
  return (
    <Modal title={<>Delete <em>{project.name}</em>?</>} onClose={onClose}>
      <form className="hv-modal__form" onSubmit={submit}>
        <p>This stops its agents and deletes its task graph, chat, history and workspace for everyone it is shared with. It can&apos;t be undone.</p>
        {project.repo && <p className="hv-modal__note"><Icon name="github" size={14} /> The GitHub repo <b>{project.repo}</b> is kept.</p>}
        <label className="hv-field">
          <span className="hv-label">Type the project name to confirm</span>
          <input className="hv-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={project.name} />
        </label>
        {err && <p className="hv-projects__err">{err}</p>}
        <div className="hv-modal__actions">
          <button type="button" className="hv-btn hv-btn--paper hv-btn--sm" onClick={onClose}>Cancel</button>
          <button className="hv-btn hv-btn--danger hv-btn--sm" disabled={busy || typed.trim() !== project.name}>
            <Icon name="trash" size={15} /> {busy ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Share by GitHub username: suggestions show as soon as the dialog opens and narrow as you type.
export function ShareDialog({ project, me, onClose }: { project: Project; me: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<UserSummary[]>([]);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(true);   // suggestions show right away
  const { busy, err, go } = useAction();
  const members = [project.createdBy, ...project.sharedWith];

  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      void searchUsers(q.trim()).then((u) => {
        if (stale) return;
        setFound(u.filter((x) => !members.some((m) => sameLogin(m, x.login))));
        setCursor(0);
      });
    }, 120);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, project.sharedWith.join()]);

  const add = (login: string) => go(async () => { await setShared(project.id, login, true); setQ(''); });
  const remove = (login: string) => go(() => setShared(project.id, login, false));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, found.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = found[cursor] ?? found.find((u) => sameLogin(u.login, q.trim()));
      if (pick) void add(pick.login);
    }
  };

  return (
    <Modal title={<>Share <em>{project.name}</em></>} onClose={onClose}>
      <div className="hv-modal__form">
        <div className="hv-share__search">
          <span className="hv-label">Add people by GitHub username</span>
          <div className="hv-searchbox">
            <Icon name="search" size={16} />
            <input className="hv-input" value={q} placeholder="octocat" role="combobox" aria-expanded={open && found.length > 0}
              aria-controls="hv-share-list" aria-autocomplete="list"
              onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
          </div>
          {open && (
            <ul id="hv-share-list" className="hv-share__results" role="listbox">
              {found.map((u, i) => (
                <li key={u.login} role="option" aria-selected={i === cursor}>
                  <button type="button" className={i === cursor ? 'is-on' : ''} onMouseEnter={() => setCursor(i)} onClick={() => void add(u.login)} disabled={busy}>
                    <UserFace user={u} />
                    <span><b>{u.login}</b>{u.name && u.name !== u.login && <em>{u.name}</em>}</span>
                    <span className="hv-share__add"><Icon name="plus" size={14} /> Add</span>
                  </button>
                </li>
              ))}
              {!found.length && (
                <li className="hv-share__empty">
                  {q.trim() ? <>No Hive account matches <b>{q.trim()}</b>. They need to sign in to Hive once first.</> : 'Everyone who has signed in is already on this project.'}
                </li>
              )}
            </ul>
          )}
        </div>
        {err && <p className="hv-projects__err">{err}</p>}
        <div>
          <span className="hv-label">People on this project</span>
          <ul className="hv-share__members">
            {members.map((m, i) => (
              <li key={m}>
                <Avatar name={m} size={28} />
                <b>{m}</b>{sameLogin(m, me) && <em>you</em>}
                {i === 0
                  ? <span className="hv-sticker hv-sticker--ink">Owner</span>
                  : <button type="button" className="hv-btn hv-btn--paper hv-btn--sm" disabled={busy} onClick={() => void remove(m)}>{sameLogin(m, me) ? 'Leave' : 'Remove'}</button>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function UserFace({ user }: { user: UserSummary }) {
  // eslint-disable-next-line @next/next/no-img-element
  return user.avatarUrl ? <img className="hv-avatar" src={user.avatarUrl} alt="" width={28} height={28} /> : <Avatar name={user.login} size={28} />;
}

// The AI's stack / spec draft: edit it, ask for changes, then approve to create the project.
export function StackReview({ name, goal, onApprove, onClose }: {
  name: string; goal: string; onApprove: (stack: string) => Promise<void>; onClose: () => void;
}) {
  const [doc, setDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [drafting, setDrafting] = useState(true);
  const { busy, err, go } = useAction();
  const [draftErr, setDraftErr] = useState('');

  const draft = async (n = '') => {
    setDrafting(true);
    setDraftErr('');
    try { setDoc(await draftStack(name, goal, n)); setNotes(''); } catch (x) { setDraftErr((x as Error).message); } finally { setDrafting(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void draft(); }, []);

  return (
    <Modal wide title={<><Icon name="sparkle" size={20} /> Stack and spec for <em>{name}</em></>} onClose={onClose}>
      <div className="hv-modal__form">
        <p>The planner and every agent will follow this. Edit anything, or tell the AI what to change. Nothing is created until you approve.</p>
        {drafting
          ? <div className="hv-stackdoc__wait"><i className="hv-spinner" /> Drafting a stack that fits your goal…</div>
          : <textarea className="hv-input hv-stackdoc" value={doc} onChange={(e) => setDoc(e.target.value)} spellCheck={false} aria-label="Stack and spec document" />}
        {draftErr && <p className="hv-projects__err">{draftErr}</p>}
        <form className="hv-stackdoc__redo" onSubmit={(e) => { e.preventDefault(); void draft(notes.trim()); }}>
          <input className="hv-input" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={drafting}
            placeholder="e.g. make it a command-line tool instead of a website" aria-label="What to change" />
          <button className="hv-btn hv-btn--paper hv-btn--sm" disabled={drafting}>Redraft</button>
        </form>
        {err && <p className="hv-projects__err">{err}</p>}
        <div className="hv-modal__actions">
          <button type="button" className="hv-btn hv-btn--paper hv-btn--sm" onClick={onClose}>Back</button>
          <button type="button" className="hv-btn hv-btn--hot hv-btn--sm" disabled={drafting || busy || !doc.trim()} onClick={() => void go(() => onApprove(doc.trim()))}>
            {busy ? <><i className="hv-spinner" /> Creating project and repo…</> : <><Icon name="check" size={16} /> Approve and create</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
