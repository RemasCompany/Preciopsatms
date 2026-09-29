'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';

type Row = { id: string; label: string };

/** Admins set each rep's monthly revenue target. Saves when a field loses focus. */
export default function SalesTargets({ reps, months, targets, canEdit }: {
  reps: Row[]; months: string[]; targets: { userId: string; month: string; amount: number }[]; canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useRecords();
  const [month, setMonth] = useState(months[1] ?? months[0]);
  const [saving, setSaving] = useState<string | null>(null);
  const current = (userId: string) => targets.find((t) => t.userId === userId && t.month === month)?.amount ?? null;

  async function save(userId: string, raw: string) {
    const amount = raw.trim() === '' ? null : Number(raw.replace(/[$,\s]/g, ''));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { toast('Enter a target of $0 or more.', true); return; }
    if (amount === current(userId)) return;
    setSaving(userId);
    const res = await fetch('/api/sales/targets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, month, amount }) });
    const json = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) { toast(json.error ?? 'Could not save the target.', true); return; }
    toast('Target saved');
    router.refresh();
  }

  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="targets">
      <label style={{ maxWidth: 240 }}>Month
        <select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>
      </label>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Rep</th><th>Revenue target ($)</th></tr></thead>
          <tbody>{reps.map((r) => (
            <tr key={`${r.id}-${month}`}>
              <td><b>{r.label}</b></td>
              <td>
                <input type="number" min={0} step={1000} inputMode="decimal" aria-label={`${r.label} target for ${label(month)}`}
                  defaultValue={current(r.id) ?? ''} placeholder="No target" disabled={!canEdit || saving === r.id}
                  onBlur={(e) => save(r.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
