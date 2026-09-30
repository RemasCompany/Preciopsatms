'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRecords } from './Records';
import type { Thread } from '@/lib/sms-inbox';

type Msg = { id: string; direction: string; body: string; createdAt: string; status: string; error: string | null };
const when = (s: string) => { const d = new Date(s); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

/** Two-way texting: conversations on the left, the open one on the right. Refreshes every 20 seconds. */
export default function Inbox({ initial, canEdit }: { initial: Thread[]; canEdit: boolean }) {
  const { toast, open: openRecord } = useRecords();
  const [list, setList] = useState(initial);
  const [cur, setCur] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => { const r = await fetch('/api/inbox'); if (r.ok) setList((await r.json()).threads); }, []);
  const load = useCallback(async (t: Thread) => {
    const r = await fetch('/api/inbox/thread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: t.type, id: t.id, phone: t.phone }) });
    if (r.ok) { setMsgs((await r.json()).messages); setList((l) => l.map((x) => (x.key === t.key ? { ...x, unread: 0 } : x))); }
  }, []);
  useEffect(() => { const i = setInterval(() => { refresh(); if (cur) load(cur); }, 20000); return () => clearInterval(i); }, [refresh, load, cur]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  async function send() {
    if (!cur || !text.trim()) return;
    setBusy(true);
    const r = await fetch('/api/inbox/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: cur.type, id: cur.id, phone: cur.phone, body: text }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? 'Could not send.', true);
    setText(''); load(cur); refresh();
  }

  return (
    <div className="inbox">
      <aside className="card inbox-list" aria-label="Conversations">
        {list.length ? list.map((t) => (
          <button key={t.key} className={`inbox-item${cur?.key === t.key ? ' on' : ''}`} onClick={() => { setCur(t); load(t); }}>
            <span className="row" style={{ justifyContent: 'space-between', margin: 0 }}><b>{t.name}</b><span className="muted" style={{ fontSize: 12 }}>{when(t.lastAt)}</span></span>
            <span className="muted inbox-snip">{t.lastIn ? '' : 'You: '}{t.last}</span>
            {t.unread > 0 && <span className="pill a">{t.unread} new</span>}{t.optedOut && <span className="pill r">Opted out</span>}
          </button>
        )) : <p className="muted">No texts yet. Replies to your schedule notices, reminders and messages show up here.</p>}
      </aside>
      <section className="card inbox-thread" aria-live="polite">
        {!cur ? <p className="muted">Choose a conversation.</p> : (
          <>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{cur.name}</h2>
              {cur.type && cur.id && cur.type !== 'lead' && <button className="btn ghost sm" onClick={() => openRecord(cur.type === 'candidate' ? 'candidates' : 'clients', cur.type === 'candidate' ? cur.id! : undefined)}>Open record</button>}
            </div>
            <div className="bubbles">
              {msgs.map((m) => <div key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : 'out'}${m.status === 'failed' ? ' failed' : ''}`} title={m.error ?? undefined}>{m.body}<span>{when(m.createdAt)}{m.status === 'failed' ? ' · not delivered' : ''}</span></div>)}
              <div ref={end} />
            </div>
            {canEdit && (cur.optedOut ? <p className="warn">They replied STOP. You can text them again after they reply START.</p> : (
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <textarea rows={2} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Type a reply…" style={{ flex: 1 }} aria-label="Reply" />
                <button className="btn" disabled={busy || !text.trim()} onClick={send}>Send</button>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
