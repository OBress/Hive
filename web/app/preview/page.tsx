'use client';

import { useEffect, useMemo, useState } from 'react';
import { MAPS, type Preview, type TerminalView } from '@hive/shared/types';
import TopBar from '@/components/TopBar';
import { Icon } from '@/components/ui';
import { authHeaders } from '@/lib/auth';
import { apiUrl, useUserName, useYMap } from '@/lib/hive';
import { useHive } from '@/lib/mock';
import { projectId } from '@/lib/projects';

const MAIN = '';
type Loaded = Preview | { kind: 'loading' } | { kind: 'error'; why: string };

// Preview: what main (or one task's folder) builds right now. A web app shows in an iframe, a CLI as a
// terminal you can run, anything else as a placeholder. It refreshes after every edit or merge.
export default function PreviewPage() {
  const me = useUserName();
  const s = useHive();
  const terminals = useYMap<TerminalView>(MAPS.terminal);
  const [target, setTarget] = useState(MAIN);
  const [preview, setPreview] = useState<Loaded>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  // The last step that changed the code we're looking at: main changes on merges, a task's folder on its edits.
  const changedAt = useMemo(() => [...s.steps].reverse().find((st) => target === MAIN
    ? st.kind === 'merge' && !!st.commit
    : st.taskId === target && (st.kind === 'edit' || st.kind === 'human-edit' || st.kind === 'merge'))?.id ?? '', [s.steps, target]);

  useEffect(() => {
    let live = true;
    setPreview((p) => (p.kind === 'web' ? p : { kind: 'loading' }));
    const t = setTimeout(() => {
      const path = target === MAIN ? '/preview' : `/tasks/${encodeURIComponent(target)}/preview`;
      fetch(apiUrl(`/api/projects/${projectId()}${path}`), { headers: authHeaders() })
        .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j as Preview; })
        .then((p) => { if (live) setPreview(p); })
        .catch((e) => { if (live) setPreview({ kind: 'error', why: (e as Error).message }); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [target, changedAt, nonce]);

  const tasks = Object.values(s.tasks).sort((a, b) => a.title.localeCompare(b.title));
  // For main, show the most recent command run in any task.
  const term = target === MAIN
    ? Object.values(terminals).sort((a, b) => b.at.localeCompare(a.at))[0]
    : terminals[target];

  return (
    <div className="hv-app">
      <TopBar me={me} />
      <main className="hv-page">
        <div className="hv-pv">
          <header className="hv-pv__head">
            <div>
              <h1>Preview</h1>
              <p>{target === MAIN ? 'What main builds right now, with every merged task.' : 'What this task’s branch builds right now, while the agent works on it.'}</p>
            </div>
            <div className="hv-pv__tools">
              <select className="hv-input hv-pv__select" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="What to preview">
                <option value={MAIN}>main</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <button className="hv-btn hv-btn--sm" onClick={() => setNonce((n) => n + 1)}>Reload</button>
              {preview.kind === 'web' && <a className="hv-btn hv-btn--sm hv-btn--ink" href={preview.url} target="_blank" rel="noreferrer">Open <Icon name="arrow" size={14} /></a>}
            </div>
          </header>

          {preview.kind === 'web' ? <WebView preview={preview} nonce={`${changedAt}/${nonce}`} />
            : preview.kind === 'cli' ? <Terminal term={term} taskId={target} me={me} />
            : <Placeholder loading={preview.kind === 'loading'} why={preview.kind === 'none' || preview.kind === 'error' ? preview.why : ''} />}
        </div>
      </main>
    </div>
  );
}

function WebView({ preview, nonce }: { preview: Extract<Preview, { kind: 'web' }>; nonce: string }) {
  // A static page is served from Hive's own origin, so it must stay origin-less; a running server has its own origin.
  const sandbox = `allow-scripts allow-forms allow-modals${preview.how === 'static' ? '' : ' allow-same-origin'}`;
  const how = preview.how === 'static' ? 'static page' : preview.how === 'sandbox' ? 'running in the sandbox' : 'running on the Hive server';
  return (
    <section className="hv-pv__frame hv-card">
      <div className="hv-pv__bar">
        <span className="hv-pv__dots"><i /><i /><i /></span>
        <code className="hv-pv__url">{preview.url}</code>
        <span className="hv-pv__how">{how}</span>
      </div>
      <iframe key={nonce} src={preview.url} sandbox={sandbox} title="App preview" />
    </section>
  );
}

function Terminal({ term, taskId, me }: { term?: TerminalView; taskId: string; me: string }) {
  const [args, setArgs] = useState('');
  const [error, setError] = useState('');
  const run = async () => {
    setError('');
    const r = await fetch(apiUrl(`/api/projects/${projectId()}/tasks/${encodeURIComponent(taskId)}/cli`), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ by: me, args }),
    }).catch((e: Error) => ({ ok: false, json: async () => ({ error: e.message }) }));
    if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error || 'Run failed');
  };
  return (
    <section className="hv-pv__term hv-card hv-card--ink">
      <div className="hv-pv__bar">
        <span className="hv-pv__dots"><i /><i /><i /></span>
        <code className="hv-pv__url">{term ? `$ ${term.cmd}` : 'node src/cli.js'}</code>
        <span className="hv-pv__how">{term ? (term.running ? 'running…' : `${term.by} · exit ${term.exitCode ?? '?'}`) : 'command-line tool'}</span>
      </div>
      <pre className="hv-pv__out">{term?.output || (term?.running ? '' : 'No output yet. Run it below, or wait for an agent to try it.')}</pre>
      {taskId === MAIN ? (
        <p className="hv-pv__hint">Pick a task above to run the CLI in its folder.</p>
      ) : (
        <form className="hv-pv__run" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <span>$ node src/cli.js</span>
          <input className="hv-input" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="arguments, e.g. add 'buy milk'" aria-label="Arguments" />
          <button className="hv-btn hv-btn--sm hv-btn--hot" disabled={term?.running}><Icon name="play" size={14} /> Run</button>
        </form>
      )}
      {error && <p className="hv-pv__err">{error}</p>}
    </section>
  );
}

function Placeholder({ loading, why }: { loading: boolean; why: string }) {
  return (
    <section className="hv-pv__empty hv-card">
      <div className="hv-pv__screen" aria-hidden="true"><Icon name={loading ? 'sparkle' : 'bolt'} size={40} /></div>
      <h2>{loading ? 'Starting the preview…' : 'Nothing to preview yet'}</h2>
      {!loading && (
        <>
          <p>When the agents build something you can open, it shows up here: a web page (<code>src/index.html</code>), an app with its own server (<code>src/server.js</code>), or a command-line tool (<code>src/cli.js</code>).</p>
          {why && !why.startsWith('nothing to preview') && <pre className="hv-pv__why">{why}</pre>}
        </>
      )}
    </section>
  );
}
