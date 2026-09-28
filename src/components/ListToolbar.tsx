import { OpenRecord } from './Records';
import { RECORDS, optLabel, optValue, type RecordKind } from '@/lib/records';

/** Search box + field filters (plain GET form, so filters live in the URL) and an "Add" button. */
export default function ListToolbar({ kind, q, filters, active, canEdit, placeholder }: {
  kind: RecordKind; q?: string; filters: string[]; active: Record<string, string | undefined>; canEdit: boolean; placeholder: string;
}) {
  const spec = RECORDS[kind];
  return (
    <form className="bar" role="search">
      <input className="grow" name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} />
      {filters.map((k) => {
        const fl = spec.fields.find((f) => f.key === k)!;
        return (
          <select key={k} name={k} defaultValue={active[k] ?? ''} aria-label={fl.label}>
            <option value="">All {fl.label.toLowerCase().replace(/ \(.*/, '')}</option>
            {fl.options!.map((o) => <option key={optValue(o)} value={optValue(o)}>{optLabel(o)}</option>)}
          </select>
        );
      })}
      <button className="btn ghost">Filter</button>
      {canEdit && <OpenRecord kind={kind} className="btn">+ Add {spec.one}</OpenRecord>}
    </form>
  );
}

/** Keeps only filter values that are valid options for the field. */
export function pickFilters(kind: RecordKind, keys: string[], sp: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = sp[k];
    if (v && RECORDS[kind].fields.find((f) => f.key === k)?.options?.some((o) => optValue(o) === v)) out[k] = v;
  }
  return out;
}
