'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

type Settings = {
  name: string; shortName: string | null; ownerName: string | null; ownerTitle: string | null; city: string | null; website: string | null;
  services: string | null; pitch: string | null; logoUrl: string | null; brandColor: string; applyEmail: string | null; smsNumber: string | null;
  careersHeadline: string; careersIntro: string | null; showPayOnCareers: boolean; showClientOnCareers: boolean;
};
type TextKey = { [K in keyof Settings]: Settings[K] extends boolean ? never : K }[keyof Settings];

const PROFILE: [TextKey, string, string?][] = [
  ['name', 'Legal company name'], ['shortName', 'Short name'], ['ownerName', 'Owner / signer name'], ['ownerTitle', 'Owner title'],
  ['city', 'City, state'], ['website', 'Website', 'url'], ['services', 'Industries you staff'], ['pitch', 'One-line extra pitch (optional)'], ['logoUrl', 'Logo URL (https, PNG or JPG)', 'url'],
];

export default function SettingsForm({ initial, readOnly }: { initial: Settings; readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setV((x) => ({ ...x, [k]: val }));
  const input = (k: TextKey, label: string, type = 'text') => (
    <label key={k}><span>{label}</span><input type={type} value={(v[k] as string | null) ?? ''} readOnly={readOnly} onChange={(e) => set(k, e.target.value as never)} /></label>
  );

  async function save() {
    setBusy(true); setError('');
    const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== saved[k as keyof Settings]));
    const res = await fetch('/api/org', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changed) });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? 'Could not save settings.');
    setSaved(v); toast('Settings saved.'); router.refresh();
  }

  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Company profile</h2>
        <p className="muted" style={{ marginTop: 0 }}>Used in the sidebar, email signatures and templates, offer letters and agreements, invoices, job postings, the careers page, and what AI writes on your behalf.</p>
        <div className="form wide">{PROFILE.map(([k, l, t]) => input(k, l, t))}</div>
        {v.logoUrl && /^https:\/\//.test(v.logoUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.logoUrl} alt="Logo preview" style={{ height: 40, background: '#fff', borderRadius: 6, padding: 4, marginTop: 8 }} />
        )}
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Careers page settings</h2>
        <div className="form wide">
          {input('careersHeadline', 'Headline')}
          {input('applyEmail', 'Apply-by-email address', 'email')}
          {input('smsNumber', 'Your texting number (optional, your own Twilio number)', 'tel')}
          <label className="full"><span>Introduction</span><textarea rows={3} value={v.careersIntro ?? ''} readOnly={readOnly} onChange={(e) => set('careersIntro', e.target.value)} /></label>
          <label><span>Button color</span><input type="color" value={v.brandColor} disabled={readOnly} onChange={(e) => set('brandColor', e.target.value)} style={{ height: 40, padding: 4 }} /></label>
          <span />
          <label className="check"><input type="checkbox" checked={v.showPayOnCareers} disabled={readOnly} onChange={(e) => set('showPayOnCareers', e.target.checked)} /> Show pay rates</label>
          <label className="check"><input type="checkbox" checked={v.showClientOnCareers} disabled={readOnly} onChange={(e) => set('showClientOnCareers', e.target.checked)} /> Show client names</label>
        </div>
        {!v.applyEmail && <p className="warn">Add an apply email so you’re notified of new applicants.</p>}
        <p className="muted">Client names are hidden by default, as most staffing firms keep them confidential.</p>
      </section>
      {!readOnly && (
        <div className="savebar">
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button className="btn" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}</button>
        </div>
      )}
      {readOnly && <p className="muted">Only owners and admins can change company settings.</p>}
    </>
  );
}
