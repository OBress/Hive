'use client';

import { useEffect, useRef, useState } from 'react';
import { handback, listFiles, readFile, saveFile, steer, takeover, toast, useHive } from '@/lib/mock';
import { Icon } from './ui';

// The agent's session for one task: watch it type, redirect it, take over, edit a file, hand back.
export default function LiveSession({ id, me }: { id: string; me: string }) {
  const s = useHive();
  const st = s.taskState[id];
  const sid = st?.sessionId;
  const session = sid ? s.sessions[sid] : undefined;
  const live = sid ? s.live[sid] : undefined;
  const feed = s.steps.filter((x) => x.taskId === id).slice(-8);
  const mine = st?.owner.kind === 'human' && st.owner.name.toLowerCase() === me.toLowerCase();
  const running = st?.status === 'running';
  const [msg, setMsg] = useState('');
  const liveRef = useRef<HTMLPreElement>(null);

  useEffect(() => { liveRef.current?.scrollTo({ top: liveRef.current.scrollHeight }); }, [live]);

  const send = () => {
    if (!sid || !msg.trim()) return;
    void steer(sid, msg.trim(), me);
    setMsg('');
  };

  return (
    <section className="hv-field">
      <span className="hv-label">Agent session{session ? ` · ${session.stepCount} steps` : ''}</span>

      {live && <pre ref={liveRef} className="hv-code hv-code--ink" style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{live}</pre>}

      {feed.length > 0 && (
        <ol className="hv-log" style={{ maxHeight: 200, overflow: 'auto' }}>
          {feed.map((x) => (
            <li key={x.id} className="hv-log__row">
              <div className="hv-log__top"><span className="hv-cite">#{x.id}</span><span className="hv-kind">{x.kind}</span><time>{x.by}</time></div>
              <div className="hv-log__summary">{x.text}</div>
            </li>
          ))}
        </ol>
      )}

      {running && sid && (
        <div className="hv-savebar">
          <input className="hv-input" value={msg} placeholder="Redirect the agent…" aria-label="Message the agent"
            onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
          <button className="hv-btn hv-btn--blue hv-btn--sm" onClick={send} disabled={!msg.trim()}><Icon name="send" size={14} /> Send</button>
        </div>
      )}

      {st && st.status !== 'done' && !mine && (
        <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={() => void takeover(id, me)}>
          <Icon name="lock" size={14} /> Take over
        </button>
      )}

      {mine && <Editor id={id} me={me} />}

      {session?.summary && (
        <details className="hv-code">
          <summary>Summary</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{session.summary}</pre>
        </details>
      )}
    </section>
  );
}

// While a person owns the task: pick a file, edit it, save (a commit under their name), then hand back.
function Editor({ id, me }: { id: string; me: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { listFiles(id).then(setFiles, () => {}); }, [id]);
  useEffect(() => {
    if (!path) return;
    readFile(id, path).then(setContent, () => setContent(''));
  }, [id, path]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveFile(id, path, content, me);
      toast(r.commit ? `Committed ${r.commit} as ${me}` : 'No changes to save');
      if (!files.includes(path)) setFiles([...files, path].sort());
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hv-whyprompt">
      <label className="hv-label" htmlFor="file">You have this task. Edit a file</label>
      <input id="file" className="hv-input" list={`files-${id}`} value={path} placeholder="src/stats.js"
        onChange={(e) => setPath(e.target.value)} />
      <datalist id={`files-${id}`}>{files.map((f) => <option key={f} value={f} />)}</datalist>
      {path && (
        <>
          <textarea className="hv-input hv-input--area" rows={10} value={content} spellCheck={false}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} onChange={(e) => setContent(e.target.value)} />
          <button className="hv-btn hv-btn--paper hv-btn--sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save file'}</button>
        </>
      )}
      <input className="hv-input" value={note} placeholder="Note for the agent (optional)" onChange={(e) => setNote(e.target.value)} />
      <button className="hv-btn hv-btn--hot hv-btn--sm" onClick={() => void handback(id, me, note)}>
        <Icon name="bot" size={14} /> Hand back to the agent
      </button>
    </div>
  );
}
