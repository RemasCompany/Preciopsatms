'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

type SiteJob = { id: string; label: string; address: string | null; lat: number | null; lng: number | null; radius: number | null };
const MODES = { off: 'Off — don’t check', flag: 'Flag punches away from the site', block: 'Block clock-in away from the site' } as const;

/** Job sites for the time clock geofence, and the company's off/flag/block choice. */
export default function JobSites({ jobs, mode, canEdit, isAdmin, defaultRadius }: { jobs: SiteJob[]; mode: string; canEdit: boolean; isAdmin: boolean; defaultRadius: number }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [editing, setEditing] = useState<string | null>(null);
  const [coords, setCoords] = useState(''), [radius, setRadius] = useState(String(defaultRadius));
  const [busy, setBusy] = useState(false);

  async function save(jobId: string, body: object) {
    setBusy(true);
    const r = await fetch('/api/timeclock/sites', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, ...body }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? 'Could not save the site.', true);
    toast('Job site saved.'); setEditing(null); router.refresh();
  }
  async function setMode(m: string) {
    const r = await fetch('/api/timeclock/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geofenceMode: m }) });
    if (!r.ok) return toast((await r.json().catch(() => ({}))).error ?? 'Could not save.', true);
    toast('Saved.'); router.refresh();
  }
  const here = () => navigator.geolocation?.getCurrentPosition(
    (p) => setCoords(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`),
    () => toast('Couldn’t get this device’s location. Paste the coordinates from Google Maps instead.', true), { enableHighAccuracy: true, timeout: 15000 });

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Job sites</h2>
      <p className="muted">Set where each job is, and punches are checked against it. A phone’s accuracy is taken into account, and clocking out is never blocked.</p>
      <label style={{ maxWidth: 420 }}><span>When someone punches away from the site</span>
        <select value={mode} disabled={!isAdmin || !canEdit} onChange={(e) => setMode(e.target.value)}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {jobs.length ? <div className="list">{jobs.map((j) => (
        <div key={j.id} className="li" style={{ flexWrap: 'wrap' }}>
          <div className="x"><b>{j.label}</b><span className="muted">{j.lat != null ? <>Site set · {j.radius ?? defaultRadius} m radius · <a href={`https://www.google.com/maps?q=${j.lat},${j.lng}`} target="_blank" rel="noopener noreferrer">map</a></> : `No site yet${j.address ? ` (${j.address})` : ''}`}</span></div>
          {canEdit && editing !== j.id && <span className="row"><button className="btn ghost sm" onClick={() => { setEditing(j.id); setCoords(j.lat != null ? `${j.lat}, ${j.lng}` : ''); setRadius(String(j.radius ?? defaultRadius)); }}>{j.lat != null ? 'Change' : 'Set site'}</button>
            {j.lat != null && <button className="btn ghost sm" disabled={busy} onClick={() => save(j.id, { clear: true })}>Remove</button>}</span>}
          {editing === j.id && (
            <div className="subform" style={{ width: '100%' }}>
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label><span>Coordinates or Google Maps link</span><input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="28.538336, -81.379234" style={{ minWidth: 260 }} /></label>
                <button type="button" className="btn ghost sm" onClick={here}>Use my location</button>
                <label><span>Radius (m)</span><input type="number" min={50} max={5000} step={50} value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: 100 }} /></label>
              </div>
              <div className="row"><button className="btn sm" disabled={busy} onClick={() => save(j.id, { coords, radius: Number(radius) })}>Save site</button><button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button></div>
            </div>
          )}
        </div>
      ))}</div> : <p className="muted" style={{ margin: 0 }}>Jobs with workers on assignment show up here.</p>}
    </section>
  );
}
