'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

const IMPORTS = [['candidates', 'Candidates', 'Name (or First name + Last name), Email, Phone, Title, Skills, Location, Source'], ['leads', 'Leads', 'Company, Contact, Email, Phone, Industry, City, Source'], ['clients', 'Clients', 'Company name, Industry, City, Website, Payment terms'], ['vendors', 'Vendors', 'Vendor name, Category, Contact, Email, Phone']] as const;
const EXPORTS = ['candidates', 'jobs', 'clients', 'deals', 'leads', 'vendors', 'tasks'];
type Result = { created: number; skipped: { row: number; error: string }[]; columns: { column: string; field: string | null }[] };

export default function DataTools({ canImport, owner }: { canImport: boolean; owner: boolean }) {
  const router = useRouter();
  const { toast } = useRecords();
  const [kind, setKind] = useState<(typeof IMPORTS)[number][0]>('candidates');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5_000_000) return setError('That file is too large. Split it into smaller files.');
    setCsv(await f.text()); setResult(null); setError('');
  }
  async function run() {
    setBusy(true); setError(''); setResult(null);
    const res = await fetch(`/api/import/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? 'Import failed.');
    setResult(j);
    if (j.created) { toast(`Imported ${j.created} ${kind}.`); router.refresh(); }
  }

  return (
    <div className="grid2">
      {canImport && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Import from a spreadsheet</h2>
          <p className="muted">Upload or paste CSV with a header row. Columns are matched by name — for example {IMPORTS.find((i) => i[0] === kind)![2]}.</p>
          <label><span>Import into</span><select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setResult(null); }}>{IMPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={(e) => pickFile(e.target.files?.[0])} /></label>
          <label><span>…or paste CSV</span><textarea rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} placeholder={'Name,Email,Phone,Skills\nMaria Lopez,maria@example.com,555-0100,"Forklift, RF scanner"'} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" onClick={run} disabled={busy || !csv.trim()}>{busy ? 'Importing…' : `Import ${kind}`}</button>
          {result && (
            <div className="aiout">
              <p style={{ marginTop: 0 }}><b>{result.created} imported{result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</b></p>
              <p className="muted">Columns: {result.columns.map((c) => `${c.column} → ${c.field ?? 'ignored'}`).join(' · ')}</p>
              {result.skipped.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{result.skipped.slice(0, 20).map((s) => <li key={s.row}>Row {s.row}: {s.error}</li>)}{result.skipped.length > 20 && <li>…and {result.skipped.length - 20} more</li>}</ul>}
            </div>
          )}
        </section>
      )}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Export</h2>
        <p className="muted">Download any list as CSV. It opens in Excel, Google Sheets and Numbers.</p>
        <div className="row">{EXPORTS.map((k) => <a key={k} className="btn ghost" href={`/api/export/${k}`}>{k[0].toUpperCase() + k.slice(1)}</a>)}</div>
        {owner && <>
          <h3 style={{ marginTop: 22 }}>Your company’s data</h3>
          <p className="muted">A complete JSON export of every record, for backups or a data access request (GDPR / CCPA).</p>
          <a className="btn ghost" href="/api/account/export">Download everything</a>
        </>}
      </section>
    </div>
  );
}
