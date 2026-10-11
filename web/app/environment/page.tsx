'use client';

import { useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';
import { Icon } from '@/components/ui';
import { allVars, ENV_GROUPS, envTemplate, needed, type EnvKind, type EnvVar } from '@/lib/env';
import { authHeaders } from '@/lib/auth';
import { apiUrl, useUserName } from '@/lib/hive';
import { isSet, serverIsLocal, useSystem } from '@/lib/system';

type Filter = 'all' | EnvKind;
type State = 'set' | 'needed' | 'default' | 'blank' | 'unknown';

const LABEL: Record<State, string> = { set: 'Set', needed: 'Needed', default: 'Default', blank: 'Blank', unknown: '…' };

export default function EnvironmentPage() {
  const me = useUserName();
  const sys = useSystem();
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState(false);
  const [local, setLocal] = useState(true);
  useEffect(() => setLocal(serverIsLocal()), []);

  const vars = allVars(sys.env);
  const stateOf = (v: EnvVar): State =>
    !sys.env ? 'unknown' : isSet(sys.env, v.name) ? 'set' : needed(v, sys.health) ? 'needed' : v.example ? 'default' : 'blank';
  const count = (s: State) => vars.filter((v) => stateOf(v) === s).length;
  const shown = vars.filter((v) => filter === 'all' || v.kind === filter);
  const groups = [...ENV_GROUPS, ...new Set(vars.map((v) => v.group))].filter((g, i, a) => a.indexOf(g) === i);

  const copyTemplate = () => {
    navigator.clipboard?.writeText(envTemplate(vars)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }, () => {});
  };

  return (
    <div className="hv-app">
      <TopBar me={me} />
      <main className="hv-page">
        <div className="hv-env">
          <header className="hv-env__head">
            <div>
              <h1>Environment <span className="hv-wordbox">&amp; secrets</span></h1>
              <p>Read live from the server’s <code>.env</code>. Values are write-only: this page only ever sees names and whether each is set.</p>
            </div>
            <div className="hv-env__stats">
              <span className="is-set"><b>{sys.env ? count('set') : '—'}</b> set</span>
              <span className={count('needed') ? 'is-needed' : ''}><b>{sys.env ? count('needed') : '—'}</b> needed</span>
              <span><b>{sys.health?.provider ?? '—'}</b> provider</span>
            </div>
          </header>

          <section className="hv-env__main hv-card">
            <div className="hv-env__bar">
              <div className="hv-seg" role="radiogroup" aria-label="Filter">
                {(['all', 'secret', 'config'] as Filter[]).map((f) => (
                  <button key={f} role="radio" aria-checked={filter === f} className={`hv-seg__opt${filter === f ? ' is-on' : ''}`} onClick={() => setFilter(f)}>
                    {f === 'all' ? 'All' : f === 'secret' ? <><Icon name="lock" size={14} /> Secrets</> : 'Config'}
                  </button>
                ))}
              </div>
              <span className={`hv-env__server${sys.reachable ? ' is-ok' : sys.reachable === false ? ' is-down' : ''}`}>
                <i /> {sys.reachable === null ? 'Checking server…' : sys.reachable ? `Live from ${new URL(apiUrl('/')).host}` : 'Server not reachable'}
                <button className="hv-linkbtn" onClick={sys.refresh}>Refresh</button>
              </span>
            </div>
            {!local && <p className="hv-env__note"><Icon name="lock" size={13} /> Values can only be changed from the machine running the server.</p>}

            {groups.map((g) => {
              const rows = shown.filter((v) => v.group === g);
              if (!rows.length) return null;
              return (
                <div key={g} className="hv-envgroup">
                  <h3>{g}</h3>
                  <ul className="hv-envlist">
                    {rows.map((v) => <EnvRow key={v.name} v={v} me={me} state={stateOf(v)} canEdit={local} onSaved={sys.refresh} />)}
                  </ul>
                </div>
              );
            })}
          </section>

          <aside className="hv-env__side">
            <section className="hv-card">
              <header className="hv-ov__head"><h2>Rules</h2></header>
              <ul className="hv-rules">
                <li><Icon name="check" size={16} /><span>Only <code>server/</code> reads <code>.env</code>; it is gitignored.</span></li>
                <li><Icon name="check" size={16} /><span>Values never go to <code>web/</code>, logs, the Y.Doc or chat.</span></li>
                <li><Icon name="check" size={16} /><span>Agent tests run with only <code>PATH</code> and <code>HOME</code>.</span></li>
                <li><Icon name="check" size={16} /><span>Writes are accepted only from the server machine; most need a restart.</span></li>
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

function EnvRow({ v, me, state, canEdit, onSaved }: { v: EnvVar; me: string; state: State; canEdit: boolean; onSaved: () => void }) {
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
      setMsg({ ok: true, text: j.restartNeeded ? 'Saved. Restart the server to apply.' : 'Saved.' });
      setEditing(false);
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: `${(e as Error).message}. Nothing was stored.` });
    }
  };

  return (
    <li id={v.name} className={`hv-envrow${secret ? ' is-secret' : ''}${editing ? ' is-editing' : ''}`}>
      <code className="hv-envrow__name">{v.name}</code>
      <span className={`hv-envrow__kind is-${v.kind}`}>{secret ? <><Icon name="lock" size={11} /> Secret</> : 'Config'}</span>
      {!editing ? (
        <span className="hv-envrow__about" title={v.about}>{msg ? <em className={msg.ok ? 'is-ok' : ''}>{msg.text}</em> : v.about}</span>
      ) : (
        <span className="hv-envrow__form">
          <input className="hv-input" type={secret && !reveal ? 'password' : 'text'} autoComplete="off" spellCheck={false} autoFocus
            value={value} placeholder={secret ? 'Paste new value' : v.example ?? ''} aria-label={`Value for ${v.name}`}
            onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && value) save(); if (e.key === 'Escape') setEditing(false); }} />
          {secret && <button className="hv-linkbtn" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Show'}</button>}
          <button className="hv-linkbtn" onClick={() => { setEditing(false); setValue(''); }}>Cancel</button>
          <button className="hv-btn hv-btn--hot hv-btn--xs" onClick={save} disabled={!value}>Save</button>
        </span>
      )}
      <span className={`hv-envrow__status is-${state}`} title={state === 'default' ? `Unset: uses ${v.example}` : undefined}>
        {state === 'default' ? v.example : LABEL[state]}
      </span>
      {!editing && (
        <button className="hv-envrow__edit" disabled={!canEdit} onClick={() => { setEditing(true); setMsg(null); }}
          title={canEdit ? undefined : 'Only from the machine running the server'} aria-label={`Change ${v.name}`}>
          <Icon name="pencil" size={13} /> {secret ? (state === 'set' ? 'Rotate' : 'Set') : 'Edit'}
        </button>
      )}
    </li>
  );
}
