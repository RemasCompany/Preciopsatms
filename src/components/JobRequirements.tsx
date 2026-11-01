'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CREDENTIAL_TYPES, CREDENTIAL_TYPE_NAMES, type CredentialGroup } from '@/lib/credentials';
import { isStateLicense } from '@/lib/requirements';
import type { JobReadiness } from '@/lib/requirements-server';
import { OpenRecord } from './Records';

const GROUPS: [CredentialGroup, string][] = [['License', 'Licenses'], ['Certification', 'Certifications'], ['Health', 'Health records'], ['Screening', 'Screenings'], ['Equipment', 'Equipment']];
const SCREENS = ['Background check', 'Drug screen', 'OIG / SAM exclusion check'];
/** Common starting points; they add to what's ticked. */
const PRESETS: [string, string[]][] = [
  ['RN – Med-Surg / Tele', ['RN license', 'BLS', 'TB test', ...SCREENS]],
  ['RN – ICU / ER', ['RN license', 'BLS', 'ACLS', 'TB test', ...SCREENS]],
  ['RN – L&D', ['RN license', 'BLS', 'ACLS', 'NRP', 'TB test', ...SCREENS]],
  ['RN – Pediatrics', ['RN license', 'BLS', 'PALS', 'TB test', ...SCREENS]],
  ['LPN / LVN', ['LPN / LVN license', 'BLS', 'TB test', ...SCREENS]],
  ['CNA', ['CNA certification', 'BLS', 'TB test', ...SCREENS]],
  ['Health records', ['TB test', 'Flu vaccine', 'Hepatitis B', 'MMR / varicella titers', 'Physical exam']],
];

/** Which credentials each job needs, and who on assignment there is cleared. */
export default function JobRequirements({ jobs, canEdit }: { jobs: JobReadiness[]; canEdit: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ id: string; certs: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [only, setOnly] = useState(false);

  async function save(id: string, certs: string[]) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/credentials/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requiredCerts: certs }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Something went wrong. Try again.');
      setEdit(null); setMsg({ ok: true, text: 'Saved.' }); router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  if (!jobs.length) return <div className="card empty"><b>No open jobs</b>Add a job, then come back to set the credentials it needs.</div>;
  const list = only ? jobs.filter((j) => j.requiredCerts.length) : jobs;
  const withReq = jobs.filter((j) => j.requiredCerts.length);
  const workers = withReq.flatMap((j) => j.workers);
  const cleared = workers.filter((w) => !w.gaps.length).length;

  return (
    <>
      <div className="kpis" style={{ margin: '0 0 16px' }}>
        <div className="kpi"><b>{withReq.length}</b><span>Jobs with requirements</span></div>
        <div className="kpi"><b>{workers.length ? `${Math.round((cleared / workers.length) * 100)}%` : '—'}</b><span>Workers cleared</span><span className="sub">{cleared} of {workers.length} on assignment</span></div>
        <div className="kpi"><b className={workers.length - cleared ? 'warnnum' : undefined}>{workers.length - cleared}</b><span>Missing something</span></div>
      </div>
      <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only jobs with requirements</label>
      {msg && <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p>}
      <div className="list">{list.map((j) => {
        const licenses = j.requiredCerts.filter(isStateLicense);
        const ready = j.workers.filter((w) => !w.gaps.length).length;
        return (
          <div key={j.id} className="li card" style={{ display: 'block' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
              <span>
                <b>{j.title}</b>{j.client && <span className="muted"> · {j.client}</span>}{j.location && <span className="muted"> · {j.location}</span>}
                <div className="muted">{j.requiredCerts.length ? j.requiredCerts.join(', ') : 'Nothing required'}</div>
                {licenses.length > 0 && !j.state && <div className="error" style={{ fontSize: 13 }}>Add the job’s location as “City, ST” so licenses are checked against the right state.</div>}
              </span>
              <span className="row" style={{ marginTop: 0 }}>
                {j.requiredCerts.length > 0 && j.workers.length > 0 && <span className={`pill ${ready === j.workers.length ? 'g' : 'a'}`}>{ready} of {j.workers.length} cleared</span>}
                {canEdit && edit?.id !== j.id && <button className="btn ghost sm" onClick={() => setEdit({ id: j.id, certs: j.requiredCerts })}>Change</button>}
              </span>
            </div>
            {edit?.id === j.id && (
              <div className="subform">
                <div className="row" style={{ flexWrap: 'wrap' }}><span className="muted">Start from:</span>{PRESETS.map(([label, certs]) => <button key={label} type="button" className="btn ghost sm" onClick={() => setEdit({ ...edit, certs: [...new Set([...edit.certs, ...certs])] })}>{label}</button>)}</div>
                {GROUPS.map(([g, label]) => (
                  <fieldset key={g} style={{ border: 0, padding: 0, margin: '8px 0' }}><legend className="muted">{label}</legend>
                    {CREDENTIAL_TYPE_NAMES.filter((t) => CREDENTIAL_TYPES[t].group === g).map((t) => (
                      <label key={t} className="check" style={{ display: 'inline-flex', marginRight: 14 }}><input type="checkbox" checked={edit.certs.includes(t)} onChange={(e) => setEdit({ ...edit, certs: e.target.checked ? [...edit.certs, t] : edit.certs.filter((x) => x !== t) })} /> {t}{isStateLicense(t) && j.state ? ` (${j.state})` : ''}</label>
                    ))}
                  </fieldset>
                ))}
                <div className="row"><button className="btn sm" disabled={busy} onClick={() => save(j.id, edit.certs)}>Save</button><button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button></div>
              </div>
            )}
            {j.requiredCerts.length > 0 && j.workers.some((w) => w.gaps.length) && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{j.workers.filter((w) => w.gaps.length).map((w) => (
                <li key={w.id}><OpenRecord kind="candidates" id={w.id}><b>{w.name}</b></OpenRecord>: <span className="muted">{w.gaps.join('; ')}</span></li>
              ))}</ul>
            )}
          </div>
        );
      })}</div>
    </>
  );
}
