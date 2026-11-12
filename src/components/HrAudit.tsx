'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OpenRecord, useRecords } from './Records';
import type { Answers, ChecklistItem, Finding, Reviews, Severity } from '@/lib/hr-audit';

export type AuditView = { id: string; title: string; status: string; findings: Finding[]; answers: Answers; reviews: Reviews; notes: string | null; checklist: ChecklistItem[]; startedAt: string; completedAt: string | null; score: number };
type Summary = { id: string; title: string; status: string; score: number | null; startedAt: string; completedAt: string | null };

const SEV: Record<Severity, [string, string]> = { high: ['High', 'r'], medium: ['Medium', 'a'], low: ['Low', ''], info: ['For information', ''] };
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const ANSWERS: [Answers[string]['answer'], string][] = [['yes', 'Yes'], ['no', 'No'], ['na', 'Not applicable']];

async function send(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Something went wrong.');
  return j;
}

function FindingRow({ f, review, open: isOpen, onReview, onTask }: { f: Finding; review?: Reviews[string]; open: boolean; onReview: (note: string | null) => Promise<void>; onTask: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [writing, setWriting] = useState(false);
  const pass = !f.items.length;
  const [sev, pill] = SEV[f.severity];
  return (
    <div className={`audit-row${pass ? ' pass' : ''}`}>
      <button className="audit-head" onClick={() => !pass && setExpanded(!expanded)} aria-expanded={pass ? undefined : expanded} disabled={pass}>
        <span className="x"><b>{f.title}</b><span className="muted">{pass ? 'Nothing found' : `${f.items.length} ${f.items.length === 1 ? 'person' : 'people'}`}{review ? ' · reviewed' : ''}</span></span>
        {pass ? <span className="pill g">Pass</span> : review ? <span className="pill">Reviewed</span> : <span className={`pill ${pill}`}>{sev}</span>}
      </button>
      {expanded && (
        <div className="audit-body">
          <p><b>Why it matters:</b> {f.why}</p>
          <p><b>How to fix:</b> {f.fix}</p>
          <div className="list">{f.items.slice(0, 100).map((i) => (
            <div key={`${i.id}-${i.detail}`} className="li"><span className="x">
              {f.key === 'admin_no_two_step' ? <b>{i.name}</b> : <OpenRecord kind="candidates" id={i.id} className="link x"><b>{i.name}</b></OpenRecord>}
              <span className="muted">{i.detail}</span></span></div>
          ))}{f.items.length > 100 && <p className="muted">…and {f.items.length - 100} more (all are in the export).</p>}</div>
          {review && <p className="okc" style={{ fontWeight: 400 }}>Reviewed by {review.by} on {date(review.at)}: “{review.note}”</p>}
          {isOpen && (
            <div className="row" style={{ marginTop: 10 }}>
              <Link className="btn ghost sm" href={f.href}>Open the page</Link>
              <button className="btn ghost sm" onClick={onTask}>Add a follow-up task</button>
              {review ? <button className="btn ghost sm" onClick={() => onReview(null)}>Undo review</button>
                : writing ? <><input aria-label="Review note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked or decided" style={{ flex: 1, minWidth: 220 }} maxLength={1000} autoFocus />
                  <button className="btn sm" disabled={!note.trim()} onClick={async () => { await onReview(note.trim()); setWriting(false); setNote(''); }}>Save</button></>
                : <button className="btn ghost sm" onClick={() => setWriting(true)}>Mark reviewed…</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HrAudit({ audits, current }: { audits: Summary[]; current: AuditView | null }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [a, setA] = useState(current);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } };
  const start = () => run(async () => { const j = await send('POST', '/api/hr-audits', {}); router.push(`/app/hr-audit?id=${j.id}`); router.refresh(); });
  const patch = (body: unknown) => run(async () => setA(await send('PATCH', `/api/hr-audits/${a!.id}`, body)));
  const hasOpen = audits.some((x) => x.status === 'OPEN');

  if (!a) return (
    <section className="card empty">
      <b>No audits yet</b>
      <p>An audit checks your records for gaps (I-9s, pay, credentials, reviews, offboarding and more) and walks you through the practices records can’t show. Plan on one a year, and before any big change.</p>
      <button className="btn" onClick={start} disabled={busy}>Start your first audit</button>
    </section>
  );

  const isOpen = a.status === 'OPEN';
  const counted = a.findings.filter((f) => f.severity !== 'info');
  const open = counted.filter((f) => f.items.length && !a.reviews[f.key]);
  const answered = a.checklist.filter((c) => a.answers[c.key]).length;
  const bySev = (s: Severity) => open.filter((f) => f.severity === s).length;
  return (
    <>
      <section className="card audit-summary">
        <div>
          <h2 style={{ margin: 0 }}>{a.title}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>{isOpen ? <>Started {date(a.startedAt)} · <span className="pill a">Open</span> · results update as you fix things</> : <>Completed {date(a.completedAt!)} · <span className="pill g">Completed</span></>}</p>
        </div>
        <div className="kpis" style={{ margin: '14px 0' }}>
          <div className="kpi"><b className={a.score < 70 ? 'warnnum' : ''}>{a.score}</b><span>Score out of 100{isOpen ? ' (so far)' : ''}</span></div>
          <div className="kpi"><b className={bySev('high') ? 'warnnum' : ''}>{bySev('high')}</b><span>High-risk findings open</span></div>
          <div className="kpi"><b>{bySev('medium') + bySev('low')}</b><span>Other findings open</span></div>
          <div className="kpi"><b>{answered}/{a.checklist.length}</b><span>Checklist answered</span></div>
        </div>
        <div className="row">
          <a className="btn ghost" href={`/api/hr-audits/${a.id}/export`}>Download as spreadsheet</a>
          {isOpen && <button className="btn" disabled={busy} onClick={() => run(async () => { if (!confirm('Complete this audit? The findings and score are saved as they are now and can’t be changed.')) return; setA(await send('POST', `/api/hr-audits/${a.id}/complete`)); toast('Audit completed.'); router.refresh(); })}>Complete audit</button>}
          {!isOpen && !hasOpen && <button className="btn" disabled={busy} onClick={start}>Start a new audit</button>}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Checked automatically</h2>
        <p className="muted" style={{ marginTop: 0 }}>From your records in Preciops. Open a finding to see who’s affected and how to fix it. If something is handled outside Preciops, mark it reviewed with a note so the audit shows why.</p>
        <div className="audit-list">{[...a.findings].sort((x, y) => Number(!x.items.length) - Number(!y.items.length)).map((f) => (
          <FindingRow key={f.key} f={f} review={a.reviews[f.key]} open={isOpen}
            onReview={(note) => patch({ review: { key: f.key, note } })}
            onTask={() => run(async () => { await send('POST', `/api/hr-audits/${a.id}/task`, { key: f.key }); toast('Task added to your Tasks page, due in two weeks.'); })} />
        ))}</div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Checklist</h2>
        <p className="muted" style={{ marginTop: 0 }}>Practices your records can’t show. Answer each one; add a note with where the evidence is kept.</p>
        <ol className="audit-checklist">{a.checklist.map((c) => {
          const ans = a.answers[c.key];
          return (
            <li key={c.key}>
              <p style={{ margin: '0 0 4px' }}>{c.text}</p>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>{c.why}</p>
              <div className="row" role="radiogroup" aria-label={c.text}>
                {ANSWERS.map(([v, label]) => (
                  <button key={v} role="radio" aria-checked={ans?.answer === v} className={`btn sm ${ans?.answer === v ? (v === 'no' ? 'danger' : '') : 'ghost'}`} disabled={!isOpen || busy}
                    onClick={() => patch({ answer: { key: c.key, answer: ans?.answer === v ? null : v, note: ans?.note } })}>{label}</button>
                ))}
                {ans && <input aria-label="Note" defaultValue={ans.note ?? ''} placeholder="Note (where the evidence is)" disabled={!isOpen} maxLength={1000} style={{ flex: 1, minWidth: 200 }}
                  onBlur={(e) => { if ((ans.note ?? '') !== e.target.value.trim()) patch({ answer: { key: c.key, answer: ans.answer, note: e.target.value.trim() } }); }} />}
              </div>
            </li>
          );
        })}</ol>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Notes</h2>
        <textarea rows={4} defaultValue={a.notes ?? ''} disabled={!isOpen} placeholder="Scope, who took part, anything to follow up next time" style={{ width: '100%' }} maxLength={5000}
          onBlur={(e) => { if ((a.notes ?? '') !== e.target.value.trim()) patch({ notes: e.target.value.trim() || null }); }} />
      </section>

      {audits.length > 1 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Past audits</h2>
          <div className="list">{audits.map((x) => (
            <Link key={x.id} className="li" href={`/app/hr-audit?id=${x.id}`} aria-current={x.id === a.id ? 'true' : undefined}>
              <span className="x"><b>{x.title}</b><span className="muted">{x.completedAt ? `Completed ${date(x.completedAt)}` : `Started ${date(x.startedAt)} · open`}</span></span>
              {x.score !== null && <span className={`pill ${x.score >= 80 ? 'g' : x.score >= 60 ? 'a' : 'r'}`}>{x.score}</span>}
            </Link>
          ))}</div>
        </section>
      )}
      <p className="muted" style={{ fontSize: 13 }}>These checks flag likely problems for review; they aren’t legal advice. Federal figures are current as of October 2026, and state and local rules can be stricter. Review findings with your HR or employment counsel.</p>
    </>
  );
}
