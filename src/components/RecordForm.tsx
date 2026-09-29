'use client';
import { useEffect, useState } from 'react';
import { RECORDS, optLabel, optValue, type Field, type RecordKind, type RecordValues } from '@/lib/records';

const refCache = new Map<RecordKind, Promise<{ id: string; label: string }[]>>();
function loadRefs(kind: RecordKind) {
  if (!refCache.has(kind)) refCache.set(kind, fetch(`/api/records/${kind}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return refCache.get(kind)!;
}
/** Forget cached ref options (after a client/vendor is created, renamed or deleted). */
export const invalidateRefs = (kind?: RecordKind) => (kind ? refCache.delete(kind) : refCache.clear());

function RefSelect({ fl, value, onChange, disabled }: { fl: Field; value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const [opts, setOpts] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => { let on = true; loadRefs(fl.ref!).then((o) => on && setOpts(o)); return () => { on = false; }; }, [fl.ref]);
  return (
    <select name={fl.key} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
      <option value="">— None —</option>
      {opts?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      {value && opts && !opts.some((o) => o.id === value) && <option value={value}>(loading…)</option>}
    </select>
  );
}

export default function RecordForm({ kind, values, onChange, readOnly }: {
  kind: RecordKind; values: RecordValues; onChange: (v: RecordValues) => void; readOnly?: boolean;
}) {
  const set = (k: string, v: RecordValues[string]) => onChange({ ...values, [k]: v });
  return (
    <div className="form">
      {RECORDS[kind].fields.map((fl) => {
        const v = values[fl.key];
        const full = fl.type === 'area' || fl.key === 'skills' || fl.key === RECORDS[kind].titleKey || fl.type === 'url';
        const label = <span>{fl.label}{fl.required && <span aria-hidden="true"> *</span>}</span>;
        if (fl.type === 'chk') return (
          <label key={fl.key} className="check full"><input type="checkbox" name={fl.key} checked={Boolean(v)} disabled={readOnly} onChange={(e) => set(fl.key, e.target.checked)} /> {fl.label}</label>
        );
        let input: React.ReactNode;
        if (fl.type === 'sel') input = (
          <select name={fl.key} value={String(v ?? '')} disabled={readOnly} onChange={(e) => set(fl.key, e.target.value || null)}>
            {(v == null || !fl.notNull) && <option value="">—</option>}
            {fl.options!.map((o) => <option key={optValue(o)} value={optValue(o)}>{optLabel(o)}</option>)}
          </select>
        );
        else if (fl.type === 'ref') input = <RefSelect fl={fl} value={(v as string) ?? null} onChange={(x) => set(fl.key, x)} disabled={readOnly} />;
        else if (fl.type === 'area') input = <textarea name={fl.key} rows={4} value={String(v ?? '')} readOnly={readOnly} onChange={(e) => set(fl.key, e.target.value)} />;
        else if (fl.type === 'tags') input = (
          <input name={fl.key} defaultValue={((v as string[]) ?? []).join(', ')} readOnly={readOnly}
            onChange={(e) => set(fl.key, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        );
        else {
          const type = { num: 'number', date: 'date', email: 'email', tel: 'tel', url: 'url' }[fl.type as string] ?? 'text';
          input = (
            <input name={fl.key} type={type} step={fl.type === 'num' ? (fl.int ? 1 : 'any') : undefined} min={fl.min} max={fl.max}
              inputMode={fl.type === 'num' ? (fl.int ? 'numeric' : 'decimal') : undefined}
              autoComplete={fl.type === 'email' ? 'email' : fl.type === 'tel' ? 'tel' : undefined}
              value={v == null ? '' : String(v)} readOnly={readOnly} required={fl.required}
              onChange={(e) => set(fl.key, fl.type === 'num' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />
          );
        }
        return <label key={fl.key} className={full ? 'full' : undefined}>{label}{input}</label>;
      })}
    </div>
  );
}
