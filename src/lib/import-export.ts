import { HttpError, type TenantDb } from './tenant';
import { RECORDS, optLabel, optValue, type Field, type RecordKind } from './records';
import { delegate, parseRecord, toValues } from './records-server';
import { parseCsv } from './csv';

export const IMPORT_KINDS = ['candidates', 'leads', 'clients', 'vendors'] as const;
export const EXPORT_KINDS = ['candidates', 'jobs', 'clients', 'deals', 'leads', 'vendors', 'tasks'] as const;
export const MAX_IMPORT_ROWS = 2000;

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string[]> = {
  name: ['fullname', 'candidate', 'candidatename', 'vendorname', 'companyname', 'clientname'],
  company: ['companyname', 'organization', 'account', 'business'],
  contact: ['contactname', 'contactperson'], role: ['contacttitle', 'jobtitle', 'position'],
  title: ['currenttitle', 'jobtitle', 'position'], phone: ['mobile', 'cell', 'phonenumber'], email: ['emailaddress', 'mail'],
  skills: ['skill', 'skillset'], city: ['location', 'cityregion', 'region'], location: ['city', 'citystate'],
  score: ['leadscore'], notes: ['note', 'comments'], vendorId: ['vendor', 'suppliedby', 'suppliedbyvendor'], clientId: ['client'],
};

/** Maps each CSV column to a field (or null to ignore it). */
export function mapColumns(kind: RecordKind, header: string[]) {
  const fields = RECORDS[kind].fields;
  const used = new Set<string>();
  const map = header.map((h) => {
    const n = norm(h);
    const f = fields.find((fl) => !used.has(fl.key) && (norm(fl.key) === n || norm(fl.label) === n))
      ?? fields.find((fl) => !used.has(fl.key) && (ALIASES[fl.key] ?? []).includes(n));
    if (f) used.add(f.key);
    return f ?? null;
  });
  return { map, first: header.findIndex((h) => norm(h) === 'firstname'), last: header.findIndex((h) => norm(h) === 'lastname') };
}

function coerce(fl: Field, raw: string, refs: Map<string, Map<string, string>>) {
  const v = raw.trim();
  if (v === '') return fl.type === 'tags' ? [] : fl.type === 'chk' ? false : null;
  switch (fl.type) {
    case 'sel': return fl.options!.map(optValue).find((o, i) => o.toLowerCase() === v.toLowerCase() || optLabel(fl.options![i]).toLowerCase() === v.toLowerCase()) ?? v;
    case 'chk': return /^(y|yes|true|1|x)$/i.test(v);
    case 'tags': return v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    case 'num': return v.replace(/[$,%\s]/g, '');
    case 'date': { const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : v; }
    case 'ref': return refs.get(fl.ref!)?.get(v.toLowerCase()) ?? `__missing:${v}`;
    default: return v;
  }
}

/** Validates and creates records from CSV. Each row is checked like a drawer save; bad rows are skipped and reported. */
export async function importCsv(tdb: TenantDb, kind: RecordKind, text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new HttpError(400, 'Paste a CSV with a header row and at least one record.');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new HttpError(400, `Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time.`);
  const { map, first, last } = mapColumns(kind, rows[0]);
  const titleKey = RECORDS[kind].titleKey;
  if (!map.some((f) => f?.key === titleKey) && !(titleKey === 'name' && first >= 0)) {
    throw new HttpError(400, `Add a “${RECORDS[kind].fields.find((f) => f.key === titleKey)!.label}” column.`);
  }
  const refs = new Map<string, Map<string, string>>();
  for (const fl of RECORDS[kind].fields.filter((f) => f.type === 'ref')) {
    const key = RECORDS[fl.ref!].titleKey;
    const list = await delegate(tdb, fl.ref!).findMany({ select: { id: true, [key]: true } });
    refs.set(fl.ref!, new Map(list.map((r) => [String(r[key]).toLowerCase(), String(r.id)])));
  }
  let created = 0; const skipped: { row: number; error: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const body: Record<string, unknown> = {};
    rows[i].forEach((cell, c) => { const fl = map[c]; if (fl) body[fl.key] = coerce(fl, cell, refs); });
    if (titleKey === 'name' && !body.name && first >= 0) body.name = [rows[i][first], last >= 0 ? rows[i][last] : ''].map((s) => s?.trim()).filter(Boolean).join(' ');
    const missingRef = Object.entries(body).find(([, v]) => typeof v === 'string' && v.startsWith('__missing:'));
    if (missingRef) { skipped.push({ row: i + 1, error: `No ${RECORDS[RECORDS[kind].fields.find((f) => f.key === missingRef[0])!.ref!].one} named “${String(missingRef[1]).slice(10)}”.` }); continue; }
    try {
      const data = await parseRecord(tdb, kind, body, 'create');
      await delegate(tdb, kind).create({ data });
      created++;
    } catch (e) {
      skipped.push({ row: i + 1, error: e instanceof HttpError ? e.message : 'Could not import this row.' });
    }
  }
  return { created, skipped, columns: rows[0].map((h, c) => ({ column: h, field: map[c]?.label ?? (c === first || c === last ? 'Full name' : null) })) };
}

/** Rows for a CSV export: a header of field labels, then one row per record, with linked records shown by name. */
export async function exportRows(tdb: TenantDb, kind: RecordKind) {
  const fields = RECORDS[kind].fields;
  const names = new Map<string, string>();
  for (const fl of fields.filter((f) => f.type === 'ref')) {
    const key = RECORDS[fl.ref!].titleKey;
    for (const r of await delegate(tdb, fl.ref!).findMany({ select: { id: true, [key]: true } })) names.set(String(r.id), String(r[key]));
  }
  const rows = await delegate(tdb, kind).findMany({ orderBy: { createdAt: 'asc' } });
  return [
    ['ID', ...fields.map((f) => f.label.replace(/ \(comma separated\)/, ''))],
    ...rows.map((row) => {
      const v = toValues(kind, row);
      return [v.id, ...fields.map((f) => {
        const x = v[f.key];
        if (f.type === 'ref') return x ? names.get(String(x)) ?? '' : '';
        if (f.type === 'sel') return x == null ? '' : optLabel(f.options!.find((o) => optValue(o) === x) ?? String(x));
        if (f.type === 'tags') return ((x as string[]) ?? []).join('; ');
        if (f.type === 'chk') return x ? 'Yes' : 'No';
        return x ?? '';
      })];
    }),
  ];
}
