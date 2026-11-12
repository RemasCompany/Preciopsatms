'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRecords } from './Records';
import { CHECKLIST_KEYS, SKILLS_CHECKLISTS } from '@/lib/skills-checklists';

type Row = {
  id: string; specialty: string; title: string; status: 'SENT' | 'COMPLETED'; sentAt: string; completedAt: string | null; expiresAt: string | null;
  expired: boolean; signedName: string | null; average: number | null; needsSupport: string[];
};
const fmt = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Skills checklists on a candidate's record: send one, see results, open the printable copy for a submittal. */
export default function SkillsChecklists({ candidateId, canEdit, contact }: { candidateId: string; canEdit: boolean; contact: { email: boolean; phone: boolean } }) {
  const { toast } = useRecords();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<{ specialty: string; channels: ('sms' | 'email')[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/checklists?candidateId=${candidateId}`);
    if (r.ok) setRows((await r.json()).checklists);
  }, [candidateId]);
  useEffect(() => { load(); }, [load]);

  async function send() {
    if (!form) return;
    setBusy(true);
    const r = await fetch('/api/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId, ...form }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? 'Couldn’t send the checklist.', true);
    toast(j.problems?.length ? `Sent, but: ${j.problems.join('; ')}` : 'Sent. You’ll see the results here when they’re done.'); setForm(null); load();
  }
  async function cancel(id: string) {
    const r = await fetch(`/api/checklists/${id}`, { method: 'DELETE' });
    if (!r.ok) return toast((await r.json().catch(() => ({}))).error ?? 'Couldn’t cancel it.', true);
    load();
  }
  const channels = [...(contact.phone ? ['sms' as const] : []), ...(contact.email ? ['email' as const] : [])];

  return (
    <section className="sec"><h3>Skills checklists {canEdit && !form && <button className="btn ghost sm" onClick={() => setForm({ specialty: 'medsurg', channels })}>+ Send checklist</button>}</h3>
      {form && (
        <div className="subform">
          <label>Specialty<select value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })}>{CHECKLIST_KEYS.map((k) => <option key={k} value={k}>{SKILLS_CHECKLISTS[k].title}</option>)}</select></label>
          {channels.length ? <div className="row">{channels.map((ch) => <label key={ch} className="check"><input type="checkbox" checked={form.channels.includes(ch)} onChange={(e) => setForm({ ...form, channels: e.target.checked ? [...form.channels, ch] : form.channels.filter((x) => x !== ch) })} /> {ch === 'sms' ? 'Text' : 'Email'}</label>)}</div>
            : <p className="error">Add an email address or mobile number (and make sure they haven’t opted out) to send it.</p>}
          <div className="row"><button className="btn sm" disabled={busy || !form.channels.length} onClick={send}>{busy ? 'Sending…' : 'Send'}</button><button className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      )}
      {rows?.length ? <div className="list">{rows.map((c) => (
        <div key={c.id} className="li" style={{ display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
            <span><b>{c.title}</b><div className="muted">{c.status === 'SENT' ? `Sent ${fmt(c.sentAt)} · waiting for them` : `Completed ${fmt(c.completedAt!)}${c.average !== null ? ` · average ${c.average} of 4` : ''}`}</div></span>
            <span className="row" style={{ marginTop: 0 }}>
              {c.status === 'COMPLETED' ? <><span className={`pill ${c.expired ? 'r' : 'g'}`}>{c.expired ? `Expired ${fmt(c.expiresAt!)}` : `Good until ${fmt(c.expiresAt!)}`}</span><a className="btn ghost sm" href={`/app/credentials/checklists/${c.id}`} target="_blank" rel="noreferrer">Open / print</a></>
                : canEdit && <button className="btn ghost sm" onClick={() => cancel(c.id)}>Cancel</button>}
            </span>
          </div>
          {c.needsSupport.length > 0 && <p className="muted" style={{ margin: '4px 0 0' }}>Rated 1–2 (plan orientation): {c.needsSupport.slice(0, 6).join('; ')}{c.needsSupport.length > 6 ? ` and ${c.needsSupport.length - 6} more` : ''}</p>}
        </div>
      ))}</div> : rows && !form ? <p className="muted">None sent.</p> : null}
    </section>
  );
}
