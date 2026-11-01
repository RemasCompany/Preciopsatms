// Screening workers against the OIG List of Excluded Individuals/Entities (LEIE). Pure: parsing and matching (tested).
// Health care providers that bill Medicare or Medicaid can't be paid for work by an excluded person, so clients expect
// staff to be checked before they start and every month after. A name match is only a *possible* match: OIG asks that
// it be confirmed on its online search (which checks the SSN) before anyone acts on it.
import { parseCsv } from './csv';

export const LEIE_URL = 'https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv';
export const OIG_SEARCH_URL = 'https://exclusions.oig.hhs.gov/';
export const AUTO_TYPE = 'OIG exclusion screening (monthly)';
/** A clean screening stays current this long, so a monthly run renews it with room to spare. */
export const VALID_DAYS = 45;
/** Screen again once the last run is this old. */
export const RESCREEN_DAYS = 28;

export type Listed = {
  key: string; name: string; last: string; first: string; middle: string; npi: string | null; dob: string | null;
  place: string | null; specialty: string | null; exclType: string | null; exclDate: string | null;
};

/** Upper-case letters only, accents dropped: "Ruiz-García" → "RUIZGARCIA". */
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

/** The individuals on the list (entities, which have only a business name, are skipped). Columns are found by header. */
export function parseLeie(csv: string): Listed[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const h = rows[0].map((x) => x.trim().toUpperCase());
  const at = (r: string[], col: string) => { const i = h.indexOf(col); return i < 0 ? '' : (r[i] ?? '').trim(); };
  if (!h.includes('LASTNAME') || !h.includes('FIRSTNAME')) throw new Error('The OIG exclusion file has an unexpected layout.');
  const out: Listed[] = [];
  for (const r of rows.slice(1)) {
    const last = at(r, 'LASTNAME'), first = at(r, 'FIRSTNAME');
    if (!last || !first) continue;
    const middle = at(r, 'MIDNAME'), npi = at(r, 'NPI').replace(/\D/g, ''), dob = at(r, 'DOB'), exclDate = at(r, 'EXCLDATE');
    out.push({
      key: [norm(last), norm(first), norm(middle), dob, exclDate].join('|'),
      name: [first, middle, last].filter(Boolean).join(' '), last: norm(last), first: norm(first), middle: norm(middle),
      npi: /^\d{10}$/.test(npi) && !/^0+$/.test(npi) ? npi : null, dob: /^\d{8}$/.test(dob) && dob !== '00000000' ? dob : null,
      place: [at(r, 'CITY'), at(r, 'STATE')].filter(Boolean).join(', ') || null, specialty: at(r, 'SPECIALTY') || at(r, 'GENERAL') || null,
      exclType: at(r, 'EXCLTYPE') || null, exclDate: /^\d{8}$/.test(exclDate) ? exclDate : null,
    });
  }
  return out;
}

export type LeieIndex = { byName: Map<string, Listed[]>; byNpi: Map<string, Listed> };
export function indexLeie(list: Listed[]): LeieIndex {
  const byName = new Map<string, Listed[]>(), byNpi = new Map<string, Listed>();
  for (const l of list) {
    const k = `${l.last}|${l.first}`;
    byName.set(k, [...(byName.get(k) ?? []), l]);
    if (l.npi) byNpi.set(l.npi, l);
  }
  return { byName, byNpi };
}

/** Last-name readings of a full name: the last word, and everything after the first name (for two-part surnames). */
function nameKeys(full: string) {
  const words = full.trim().split(/\s+/).map(norm).filter(Boolean);
  if (words.length < 2) return [];
  const first = words[0];
  return [...new Set([words[words.length - 1], words.slice(1).join('')])].map((last) => `${last}|${first}`);
}

export type Hit = { listed: Listed; on: 'npi' | 'name' };
/** Everyone on the list who could be this worker: the same NPI, or the same first and last name. */
export function matchWorker(w: { name: string; npis: string[] }, idx: LeieIndex): Hit[] {
  const hits = new Map<string, Hit>();
  for (const n of w.npis) { const l = idx.byNpi.get(n); if (l) hits.set(l.key, { listed: l, on: 'npi' }); }
  for (const k of nameKeys(w.name)) for (const l of idx.byName.get(k) ?? []) if (!hits.has(l.key)) hits.set(l.key, { listed: l, on: 'name' });
  return [...hits.values()];
}

/** "19650312" → "Mar 12, 1965". */
export const listDate = (s: string | null) => (s && /^\d{8}$/.test(s)
  ? new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null);
