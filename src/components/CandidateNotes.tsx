'use client';
import { useCallback, useEffect, useState } from 'react';

type Note = { id: string; body: string; author: string; at: string; applicationId: string | null; job: string | null; canDelete: boolean };
export type NoteApp = { id: string; job: string; canAct?: boolean };

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Internal notes on a candidate: who wrote what, when, and about which job. Recruiters can add a general note or one
 * about a job; a hiring manager adds notes about their own job's application. Never shown to the candidate.
 */
export default function CandidateNotes({ candidateId, applications, recruiter, focusApp, onCount }: {
  candidateId: string; applications: NoteApp[]; recruiter: boolean; focusApp?: string; onCount?: (n: number) => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const writable = applications.filter((a) => recruiter || a.canAct);
  const [app, setApp] = useState<string>(focusApp ?? (recruiter ? '' : writable[0]?.id ?? ''));
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await fetch(`/api/candidates/${candidateId}/notes`).catch(() => null);
    const j = r?.ok ? await r.json() : { notes: [] };
    setNotes(j.notes); onCount?.(j.notes.length);
  }, [candidateId, onCount]);
  useEffect(() => { load(); }, [load]);
  const canAdd = recruiter || writable.length > 0;

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch(`/api/candidates/${candidateId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, applicationId: app || null }) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r?.ok) { setErr(j.error ?? 'The note wasn’t saved. Try again.'); return; }
    setBody(''); load();
  }
  async function remove(id: string) {
    const r = await fetch(`/api/candidates/${candidateId}/notes?note=${id}`, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) { setErr((await r?.json().catch(() => ({})))?.error ?? 'Couldn’t delete that note.'); return; }
    load();
  }
  const shown = focusApp && notes ? [...notes].sort((a, b) => Number(b.applicationId === focusApp) - Number(a.applicationId === focusApp)) : notes;

  return (
    <section className="sec" aria-label="Notes">
      <h3>Notes {notes && <span className="muted">{notes.length}</span>}</h3>
      {canAdd && (
        <form onSubmit={add} style={{ marginBottom: 10 }}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} aria-label="New note" placeholder="Impressions, answers, follow-ups… Keep it factual and job-related." style={{ width: '100%' }} />
          <div className="row" style={{ marginTop: 6 }}>
            {(writable.length > 1 || recruiter) && writable.length > 0 && (
              <select value={app} onChange={(e) => setApp(e.target.value)} aria-label="About which job">
                {recruiter && <option value="">General (not about one job)</option>}
                {writable.map((a) => <option key={a.id} value={a.id}>About: {a.job}</option>)}
              </select>
            )}
            <button className="btn sm" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Add note'}</button>
          </div>
          {err && <p className="error" role="alert">{err}</p>}
        </form>
      )}
      {!notes ? <p className="muted">Loading…</p> : !shown!.length ? <p className="muted">No notes yet.</p> : (
        <ul className="thread">{shown!.map((n) => (
          <li key={n.id} className={n.applicationId && n.applicationId === focusApp ? 'mine' : ''}>
            <b>{n.author}</b> <span className="muted">{when(n.at)}{n.job ? ` · ${n.job}` : ''}</span>
            {n.canDelete && <button type="button" className="linkish muted" style={{ float: 'right', fontSize: 12 }} onClick={() => remove(n.id)} aria-label={`Delete note from ${when(n.at)}`}>Delete</button>}
            <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
