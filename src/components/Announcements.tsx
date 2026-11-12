'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Posted = { id: string; title: string; body: string; date: string; location: string | null; emailed: number; live: boolean; mine: boolean };
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Post an announcement to everyone or one location, and the list of what's been posted. */
export default function Announcements({ posted, branches, everyone, canPost, isAdmin }: { posted: Posted[]; branches: { id: string; name: string }[]; everyone: number; canPost: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [branchId, setBranchId] = useState(''); const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [note, setNote] = useState('');

  async function post(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setNote('');
    const r = await fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body, branchId: branchId || null, email }) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r?.ok) { setErr(j.error ?? 'That didn’t post. Try again.'); return; }
    const sent = j.emailed ? ('queued' in j.emailed ? ` Emailing ${j.emailed.total} people now.` : ` Emailed ${j.emailed.sent}${j.emailed.skipped ? `, skipped ${j.emailed.skipped} (no email or opted out)` : ''}${j.emailed.failed ? `, ${j.emailed.failed} failed` : ''}.`) : '';
    setNote(`Posted to ${j.reach} ${j.reach === 1 ? 'person' : 'people'}.${sent}`);
    setTitle(''); setBody(''); setEmail(false); router.refresh();
  }
  async function takeDown(a: Posted) {
    setErr(''); setNote('');
    const r = await fetch(`/api/announcements/${a.id}`, { method: 'DELETE' }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    if (!r?.ok) { setErr(j.error ?? 'That didn’t go through. Try again.'); return; }
    router.refresh();
  }

  return (
    <>
      {canPost && (
        <form className="card" onSubmit={post} aria-label="New announcement">
          <h2 style={{ marginTop: 0 }}>New announcement</h2>
          <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="e.g. Holiday schedule for next week" /></label>
          <label>Message<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={5} required /></label>
          <label>Who it’s for
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Everyone ({everyone} {everyone === 1 ? 'person' : 'people'})</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} only</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> <span>Also email each person a copy <span className="muted">(skips anyone without an email or who opted out)</span></span></label>
          {err && <p className="error" role="alert">{err}</p>}
          {note && <p className="banner" role="status">{note}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Posting…' : 'Post announcement'}</button>
        </form>
      )}
      {!canPost && err && <p className="error" role="alert">{err}</p>}
      <h2>Posted</h2>
      {!posted.length ? <p className="muted">Nothing posted yet. Announcements show on each person’s own page in the employee app.</p> : (
        <ul className="plainlist">{posted.map((a) => (
          <li key={a.id} style={{ alignItems: 'flex-start' }}>
            <div>
              <b>{a.title}</b>
              <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{a.body}</p>
              <span className="muted">{fmt(a.date)} · {a.location ? `${a.location} only` : 'Everyone'}{a.emailed ? ` · emailed to ${a.emailed}` : ''}{a.live ? '' : ' · no longer shown'}</span>
            </div>
            {canPost && (a.mine || isAdmin) && <button className="btn ghost sm" onClick={() => takeDown(a)}>Take down</button>}
          </li>
        ))}</ul>
      )}
    </>
  );
}
