'use client';

import { useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';
import { Icon, tilt } from '@/components/ui';
import { ENV_VARS, envTemplate, type EnvKind, type EnvStatus, type EnvVar } from '@/lib/env';
import { authHeaders } from '@/lib/auth';
import { apiUrl, useUserName } from '@/lib/hive';

type Filter = 'all' | EnvKind;

export default function EnvironmentPage() {
  const me = useUserName();
  const [filter, setFilter] = useState<Filter>('all');
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [extra, setExtra] = useState<EnvVar[]>([]);
  const [newName, setNewName] = useState('');
  const [copied, setCopied] = useState(false);

  // Ask the server which variables are set (names + booleans only, never values).
  const refresh = () => {
    fetch(apiUrl('/api/env'))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: EnvStatus) => { setStatus(j); setReachable(true); })
      .catch(() => { setStatus(null); setReachable(false); });
  };
  useEffect(refresh, []);

  const vars = [...ENV_VARS, ...extra];
  const shown = vars.filter((v) => filter === 'all' || v.kind === filter);
  const secrets = vars.filter((v) => v.kind === 'secret').length;
  const missing = status ? vars.filter((v) => !status[v.name]?.set).length : null;

  const addVar = () => {
    const name = newName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!name || vars.some((v) => v.name === name)) return;
    setExtra((e) => [...e, { name, kind: 'secret', usedBy: ['Custom'], about: 'Added here. Mark as config if it is not sensitive.', source: 'spec' }]);
    setNewName('');
  };

  const copyTemplate = () => {
    navigator.clipboard?.writeText(envTemplate(vars)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }, () => {});
  };

  return (
    <div className="hv-app">
      <TopBar me={me} />
      <main className="hv-page">
        <div className="hv-env">
          <section className="hv-env__hero hv-card hv-card--ink">
            <span className="hv-sticker hv-sticker--hot" style={tilt('env')}><Icon name="lock" size={13} /> Write-only</span>
            <h1>Environment <span className="hv-wordbox hv-wordbox--xl">&amp; secrets</span></h1>
            <p>Secrets live only in the server’s <code>.env</code>. This page can set or rotate a value, but never reads one back: the browser only ever sees names and whether each one is set.</p>
            <div className="hv-env__stats">
              <span><b>{vars.length}</b> variables</span>
              <span><b>{secrets}</b> secrets</span>
              <span><b>{missing ?? '—'}</b> missing</span>
            </div>
          </section>

          <section className="hv-env__main">
            <div className="hv-env__bar">
              <div className="hv-seg" role="radiogroup" aria-label="Filter">
                {(['all', 'secret', 'config'] as Filter[]).map((f) => (
                  <button key={f} role="radio" aria-checked={filter === f} className={`hv-seg__opt${filter === f ? ' is-on' : ''}`} onClick={() => setFilter(f)}>
                    {f === 'all' ? 'All' : f === 'secret' ? <><Icon name="lock" size={14} /> Secrets</> : 'Config'}
                  </button>
                ))}
              </div>
              <span className={`hv-env__server${reachable ? ' is-ok' : ''}`}>
                <i /> {reachable === null ? 'Checking server…' : reachable ? 'Server reporting status' : 'Server not reporting yet (GET /api/env)'}
                <button className="hv-linkbtn" onClick={refresh}>Retry</button>
              </span>
            </div>

            <ul className="hv-envlist">
              {shown.map((v) => <EnvRow key={v.name} v={v} me={me} set={status?.[v.name]?.set} onSaved={refresh} />)}
            </ul>

            <div className="hv-env__add">
              <input className="hv-input" value={newName} placeholder="NEW_VARIABLE_NAME" aria-label="New variable name"
                onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addVar(); }} />
              <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={addVar} disabled={!newName.trim()}><Icon name="plus" size={14} /> Add variable</button>
            </div>
          </section>

          <aside className="hv-env__side">
            <section className="hv-card">
              <header className="hv-ov__head"><h2>Rules</h2></header>
              <ul className="hv-rules">
                <li><Icon name="check" size={16} /><span>Only <code>server/</code> reads <code>.env</code>; it is gitignored.</span></li>
                <li><Icon name="check" size={16} /><span>Values never go to <code>web/</code>, logs, the Y.Doc or chat.</span></li>
                <li><Icon name="check" size={16} /><span>Tests run with only <code>PATH</code> and <code>HOME</code>, so generated code can’t read secrets.</span></li>
                <li><Icon name="check" size={16} /><span><code>.env.example</code> holds names and safe defaults only.</span></li>
                <li><Icon name="check" size={16} /><span>Rotate a key here; the old value is overwritten, not shown.</span></li>
              </ul>
            </section>
            <section className="hv-card">
              <header className="hv-ov__head">
                <h2>.env template</h2>
                <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={copyTemplate}><Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy'}</button>
              </header>
              <pre className="hv-env__template">{envTemplate(vars)}</pre>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function EnvRow({ v, me, set, onSaved }: { v: EnvVar; me: string; set?: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const secret = v.kind === 'secret';

  const save = async () => {
    const body = { name: v.name, value, by: me };
    setValue('');                      // don't keep the value around in the page
    setReveal(false);
    try {
      const r = await fetch(apiUrl('/api/env'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      const after = j.restartNeeded ? ' Restart the server to apply it.' : '';
      setMsg({ ok: true, text: (secret ? 'Saved on the server. It won’t be shown again.' : 'Saved.') + after });
      setEditing(false);
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: `${(e as Error).message}. Nothing was stored.` });
    }
  };

  return (
    <li className={`hv-envrow${secret ? ' is-secret' : ''}`}>
      <div className="hv-envrow__main">
        <div className="hv-envrow__top">
          <code className="hv-envrow__name">{v.name}</code>
          <span className={`hv-envrow__kind is-${v.kind}`}>{secret ? <><Icon name="lock" size={12} /> Secret</> : 'Config'}</span>
          {v.source === 'spec' && <span className="hv-envrow__note" title="Needed by the task-graph spec but not in .env.example yet">not in .env.example</span>}
          <span className={`hv-envrow__status${set === true ? ' is-set' : set === false ? ' is-missing' : ''}`}>
            {set === true ? 'Set' : set === false ? 'Missing' : 'Unknown'}
          </span>
        </div>
        <p>{v.about}</p>
        <div className="hv-chips">{v.usedBy.map((u) => <span key={u} className="hv-envrow__use">{u}</span>)}</div>
      </div>

      <div className="hv-envrow__value">
        {!editing ? (
          <>
            <span className="hv-envrow__shown">{secret ? '•••••••••• write-only' : v.example ?? '(empty)'}</span>
            <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={() => { setEditing(true); setMsg(null); }}>
              <Icon name="pencil" size={14} /> {secret ? (set ? 'Rotate' : 'Set') : 'Edit'}
            </button>
          </>
        ) : (
          <div className="hv-envrow__form">
            <input className="hv-input" type={secret && !reveal ? 'password' : 'text'} autoComplete="off" spellCheck={false} autoFocus
              value={value} placeholder={secret ? 'Paste new value' : v.example ?? ''} aria-label={`Value for ${v.name}`}
              onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && value) save(); if (e.key === 'Escape') setEditing(false); }} />
            {secret && <button className="hv-linkbtn" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Show'}</button>}
            <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={() => { setEditing(false); setValue(''); }}>Cancel</button>
            <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={save} disabled={!value}>Save</button>
          </div>
        )}
        {msg && <span className={`hv-envrow__msg${msg.ok ? ' is-ok' : ''}`}>{msg.text}</span>}
      </div>
    </li>
  );
}
