// Vendor management systems (SAP Fieldglass, Beeline, Workday VNDLY). None of them offers suppliers a public API, so the
// dependable connection is their own files: requisition exports in, approved time out in the program's upload layout,
// remittance advice in. Presets cover the usual column names; each client program can override them because every
// program configures its own templates. Pure functions (no DB) so they're shared with the UI and tested.
import { parseCsv, toCsv } from './csv';
import { OT_MULTIPLIER } from './weeks';

export const REQ_FIELDS = {
  reqId: { label: 'Requisition ID', required: true },
  title: { label: 'Job title', required: true },
  location: { label: 'Location', required: false },
  startDate: { label: 'Start date', required: false },
  endDate: { label: 'End date', required: false },
  openings: { label: 'Positions', required: false },
  billRate: { label: 'Bill rate', required: false },
  payRate: { label: 'Pay rate', required: false },
  status: { label: 'Status', required: false },
  manager: { label: 'Hiring manager', required: false },
  description: { label: 'Description', required: false },
} as const;
export type ReqField = keyof typeof REQ_FIELDS;

export const REMIT_FIELDS = {
  invoice: { label: 'Invoice number', required: true },
  amount: { label: 'Amount paid', required: true },
  paidOn: { label: 'Payment date', required: false },
  reference: { label: 'Payment reference', required: false },
  fee: { label: 'VMS fee', required: false },
} as const;
export type RemitField = keyof typeof REMIT_FIELDS;

export const TIME_FIELDS = {
  supplierCode: 'Our supplier ID', reqId: 'Requisition ID', workOrderId: 'Work order ID', workerId: 'Worker ID', worker: 'Worker name',
  weekStart: 'Week start', weekEnd: 'Week ending', rateCode: 'Rate code', hours: 'Hours', billRate: 'Bill rate', amount: 'Amount',
} as const;
export type TimeField = keyof typeof TIME_FIELDS;

type Preset = {
  label: string; idLabel: string; workerIdLabel: string;
  req: Record<ReqField, string[]>; remit: Record<RemitField, string[]>;
  time: [TimeField, string][]; rateCodes: { regular: string; overtime: string };
  hint: string;
};

const COMMON_REQ: Record<ReqField, string[]> = {
  reqId: ['Requisition ID', 'Req ID', 'Job ID', 'Job Posting ID', 'Request ID'], title: ['Job Title', 'Title', 'Position Title', 'Job Posting Title'],
  location: ['Location', 'Work Location', 'Site', 'Work Site'], startDate: ['Start Date', 'Requested Start Date'], endDate: ['End Date', 'Requested End Date'],
  openings: ['Positions', 'Openings', 'Number of Positions', 'Quantity'], billRate: ['Bill Rate', 'Max Bill Rate', 'ST Bill Rate', 'Bill Rate (ST)'],
  payRate: ['Pay Rate', 'ST Pay Rate'], status: ['Status', 'Job Status', 'Posting Status'], manager: ['Hiring Manager', 'Manager', 'Requester'],
  description: ['Description', 'Job Description', 'Comments'],
};
const COMMON_REMIT: Record<RemitField, string[]> = {
  invoice: ['Supplier Invoice Number', 'Invoice Number', 'Invoice #', 'Invoice ID', 'Supplier Invoice ID'], amount: ['Amount Paid', 'Payment Amount', 'Net Amount', 'Paid Amount'],
  paidOn: ['Payment Date', 'Paid Date', 'Remittance Date', 'Check Date'], reference: ['Payment Reference', 'Payment ID', 'Remittance ID', 'Check Number', 'Payment Number'],
  fee: ['VMS Fee', 'MSP Fee', 'Program Fee', 'Fee Amount', 'Admin Fee'],
};
const pre = (r: Partial<Record<ReqField, string[]>>, m: Partial<Record<RemitField, string[]>> = {}) => ({
  req: Object.fromEntries(Object.entries(COMMON_REQ).map(([k, v]) => [k, [...(r[k as ReqField] ?? []), ...v]])) as Record<ReqField, string[]>,
  remit: Object.fromEntries(Object.entries(COMMON_REMIT).map(([k, v]) => [k, [...(m[k as RemitField] ?? []), ...v]])) as Record<RemitField, string[]>,
});

export const VMS: Record<'fieldglass' | 'beeline' | 'vndly' | 'other', Preset> = {
  fieldglass: {
    label: 'SAP Fieldglass', idLabel: 'Work Order ID', workerIdLabel: 'Worker ID',
    ...pre({ reqId: ['Job Posting ID'], title: ['Job Posting Title'], location: ['Site'], billRate: ['Bill Rate'] }, { invoice: ['Invoice ID'], reference: ['Payment ID'] }),
    time: [['workOrderId', 'Work Order ID'], ['workerId', 'Worker ID'], ['worker', 'Worker Name'], ['weekStart', 'Time Sheet Start Date'], ['weekEnd', 'Time Sheet End Date'], ['rateCode', 'Rate Category'], ['hours', 'Units'], ['billRate', 'Rate'], ['amount', 'Amount']],
    rateCodes: { regular: 'ST/Hr', overtime: 'OT/Hr' },
    hint: 'In Fieldglass: Job Postings → export the list for requisitions; Time Sheets → Upload Data → “Time Sheet Upload” template for time; Payments → Remittance for remittances.',
  },
  beeline: {
    label: 'Beeline', idLabel: 'Assignment ID', workerIdLabel: 'Contractor ID',
    ...pre({ reqId: ['Request ID'], openings: ['Number of Positions'], billRate: ['Max Bill Rate'] }),
    time: [['workOrderId', 'Assignment ID'], ['workerId', 'Contractor ID'], ['worker', 'Contractor Name'], ['weekEnd', 'Week Ending Date'], ['rateCode', 'Pay Code'], ['hours', 'Hours'], ['billRate', 'Bill Rate'], ['amount', 'Total']],
    rateCodes: { regular: 'REG', overtime: 'OT' },
    hint: 'In Beeline: export Requests to CSV for requisitions; use the program’s timesheet import template for time; download the remittance advice for payments.',
  },
  vndly: {
    label: 'Workday VNDLY', idLabel: 'Work Order ID', workerIdLabel: 'Worker ID',
    ...pre({ reqId: ['Job ID'], location: ['Work Location'], openings: ['Openings'], description: ['Job Description'] }),
    time: [['workOrderId', 'Work Order ID'], ['workerId', 'Worker ID'], ['worker', 'Worker Name'], ['weekStart', 'Start Date'], ['weekEnd', 'End Date'], ['rateCode', 'Time Type'], ['hours', 'Hours'], ['billRate', 'Bill Rate'], ['amount', 'Amount']],
    rateCodes: { regular: 'Regular', overtime: 'Overtime' },
    hint: 'In VNDLY: export Jobs to CSV for requisitions; Timesheets → bulk upload template for time; Payments → export remittance for payments.',
  },
  other: {
    label: 'Other VMS / MSP', idLabel: 'Work order ID', workerIdLabel: 'Worker ID',
    ...pre({}),
    time: [['reqId', 'Requisition ID'], ['workOrderId', 'Work Order ID'], ['worker', 'Worker Name'], ['weekEnd', 'Week Ending'], ['rateCode', 'Rate Code'], ['hours', 'Hours'], ['billRate', 'Bill Rate'], ['amount', 'Amount']],
    rateCodes: { regular: 'REG', overtime: 'OT' },
    hint: 'Match the columns to the program’s templates once; they’re saved for next time.',
  },
};
export type VmsKind = keyof typeof VMS;
export const isVms = (v: string): v is VmsKind => v in VMS;

export type Mappings = { requisitions?: Partial<Record<ReqField, string>>; remittance?: Partial<Record<RemitField, string>>; time?: Partial<Record<TimeField, string>> };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Which column each field comes from: the program's saved choice if that column is in the file, else the preset's first match. */
export function detect<F extends string>(headers: string[], synonyms: Record<F, string[]>, saved: Partial<Record<F, string>> = {}) {
  const by = new Map(headers.map((h) => [norm(h), h]));
  const out = {} as Record<F, string | null>;
  for (const f of Object.keys(synonyms) as F[]) {
    const s = saved[f];
    out[f] = s !== undefined ? (s === '' ? null : by.get(norm(s)) ?? null) : synonyms[f].map((x) => by.get(norm(x))).find(Boolean) ?? null;
  }
  return out;
}

/** "03/09/2026", "3/9/26", "2026-03-09" or "09-Mar-2026" → "2026-03-09"; anything else → null. */
export function parseDate(v: string | undefined | null): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/))) [mo, d, y] = [+m[1], +m[2], m[3].length === 2 ? 2000 + +m[3] : +m[3]];
  else if ((m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})$/))) {
    mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()) + 1; d = +m[1]; y = +m[3];
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return mo >= 1 && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

/** "$1,234.50", "(12.00)", "45" → number; blank or junk → null. */
export function parseMoney(v: string | undefined | null): number | null {
  let s = (v ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()$,\s-]|USD/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return (neg ? -1 : 1) * Number(s);
}

const JOB_STATUS: [RegExp, 'OPEN' | 'ON_HOLD' | 'FILLED' | 'CLOSED'][] = [[/fill/i, 'FILLED'], [/hold|pend/i, 'ON_HOLD'], [/clos|cancel|withdr|expir|complete/i, 'CLOSED'], [/open|active|approv|sourc|releas/i, 'OPEN']];
export const jobStatusFrom = (s: string | null) => (s ? JOB_STATUS.find(([re]) => re.test(s))?.[1] ?? null : null);

export type ReqRow = { line: number; reqId: string; title: string; location: string | null; startDate: string | null; endDate: string | null; openings: number | null; billRate: number | null; payRate: number | null; status: 'OPEN' | 'ON_HOLD' | 'FILLED' | 'CLOSED' | null; manager: string | null; description: string | null; problems: string[] };

const MAX_ROWS = 2000;
function table(text: string) {
  const rows = parseCsv(text.replace(/^﻿/, '')).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return { headers: [] as string[], body: [] as string[][] };
  return { headers: rows[0].map((h) => h.trim()), body: rows.slice(1, MAX_ROWS + 1) };
}

/** Reads a requisition export. Rows without an ID or title are reported, not imported. */
export function readRequisitions(text: string, kind: VmsKind, saved: Mappings['requisitions'] = {}) {
  const { headers, body } = table(text);
  const cols = detect(headers, VMS[kind].req, saved);
  const at = (r: string[], f: ReqField) => { const c = cols[f]; const i = c ? headers.indexOf(c) : -1; return i >= 0 ? (r[i] ?? '').trim() : ''; };
  const rows: ReqRow[] = body.map((r, n) => {
    const problems: string[] = [];
    const reqId = at(r, 'reqId').slice(0, 60), title = at(r, 'title').slice(0, 120);
    if (!reqId) problems.push('No requisition ID.');
    if (!title) problems.push('No job title.');
    const money = (f: ReqField) => { const raw = at(r, f); const v = parseMoney(raw); if (raw && (v === null || v < 0)) problems.push(`${REQ_FIELDS[f].label} “${raw}” isn’t an amount.`); return v !== null && v >= 0 ? v : null; };
    const date = (f: ReqField) => { const raw = at(r, f); const v = parseDate(raw); if (raw && !v) problems.push(`${REQ_FIELDS[f].label} “${raw}” isn’t a date.`); return v; };
    const openRaw = at(r, 'openings'), openings = /^\d{1,4}$/.test(openRaw) ? Math.max(1, +openRaw) : null;
    return {
      line: n + 2, reqId, title, location: at(r, 'location').slice(0, 120) || null, startDate: date('startDate'), endDate: date('endDate'), openings,
      billRate: money('billRate'), payRate: money('payRate'), status: jobStatusFrom(at(r, 'status')), manager: at(r, 'manager').slice(0, 120) || null,
      description: at(r, 'description').slice(0, 5000) || null, problems,
    };
  });
  const missing = (Object.keys(REQ_FIELDS) as ReqField[]).filter((f) => REQ_FIELDS[f].required && !cols[f]);
  return { headers, columns: cols, missing: missing.map((f) => REQ_FIELDS[f].label), rows, truncated: body.length >= MAX_ROWS };
}

export type RemitRow = { line: number; invoice: string; amount: number | null; paidOn: string | null; reference: string | null; fee: number | null; problems: string[] };

/** Reads a remittance advice: one row per invoice paid (amounts in dollars). */
export function readRemittance(text: string, kind: VmsKind, saved: Mappings['remittance'] = {}) {
  const { headers, body } = table(text);
  const cols = detect(headers, VMS[kind].remit, saved);
  const at = (r: string[], f: RemitField) => { const c = cols[f]; const i = c ? headers.indexOf(c) : -1; return i >= 0 ? (r[i] ?? '').trim() : ''; };
  const rows: RemitRow[] = body.map((r, n) => {
    const problems: string[] = [];
    const invoice = at(r, 'invoice').slice(0, 60), amount = parseMoney(at(r, 'amount')), paidRaw = at(r, 'paidOn'), paidOn = parseDate(paidRaw), fee = parseMoney(at(r, 'fee'));
    if (!invoice) problems.push('No invoice number.');
    if (amount === null || amount <= 0) problems.push('No amount paid.');
    if (paidRaw && !paidOn) problems.push(`Payment date “${paidRaw}” isn’t a date.`);
    return { line: n + 2, invoice, amount, paidOn, reference: at(r, 'reference').slice(0, 100) || null, fee: fee !== null && fee > 0 ? fee : null, problems };
  });
  const missing = (Object.keys(REMIT_FIELDS) as RemitField[]).filter((f) => REMIT_FIELDS[f].required && !cols[f]);
  return { headers, columns: cols, missing: missing.map((f) => REMIT_FIELDS[f].label), rows, truncated: body.length >= MAX_ROWS };
}

export type TimeRow = { timesheetId: string; reqId: string | null; workOrderId: string | null; workerId: string | null; worker: string; weekEnding: string; regularHours: number; overtimeHours: number; billRate: number };

const mdy = (s: string) => `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}`;
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

/**
 * Approved time in the program's upload layout: a row per rate (straight time, overtime at 1.5× the bill rate).
 * Placements without a work order ID are left out and listed, because the VMS would reject them.
 */
export function timeFile(rows: TimeRow[], kind: VmsKind, opts: { supplierCode?: string | null; headers?: Mappings['time']; rateCodes?: { regular?: string; overtime?: string } | null } = {}) {
  const p = VMS[kind], codes = { ...p.rateCodes, ...(opts.rateCodes ?? {}) };
  const cols = p.time.map(([f, h]) => [f, opts.headers?.[f] || h] as const);
  const left: string[] = [];
  const lines: string[][] = [];
  let hours = 0, amount = 0;
  for (const r of [...rows].sort((a, b) => a.worker.localeCompare(b.worker) || a.weekEnding.localeCompare(b.weekEnding))) {
    if (!r.workOrderId) { left.push(`${r.worker} (week ending ${r.weekEnding}): add the ${p.idLabel} on their placement.`); continue; }
    for (const [h, rate, code] of [[r.regularHours, r.billRate, codes.regular], [r.overtimeHours, r.billRate * OT_MULTIPLIER, codes.overtime]] as const) {
      if (!h) continue;
      const amt = cents(h * rate);
      hours += h; amount += amt;
      const v: Record<TimeField, string> = {
        supplierCode: opts.supplierCode ?? '', reqId: r.reqId ?? '', workOrderId: r.workOrderId, workerId: r.workerId ?? '', worker: r.worker,
        weekStart: mdy(addDays(r.weekEnding, -6)), weekEnd: mdy(r.weekEnding), rateCode: code, hours: h.toFixed(2), billRate: rate.toFixed(2), amount: (amt / 100).toFixed(2),
      };
      lines.push(cols.map(([f]) => v[f]));
    }
  }
  return { csv: toCsv([cols.map(([, h]) => h), ...lines]) + '\r\n', rows: lines.length, hours, amount, left };
}

/**
 * The part of a remittance that's the VMS fee: the file's fee column if it has one; otherwise, when the shortfall
 * matches the program's fee on this invoice (to the cent, either rounding), that shortfall.
 */
export function feeFor(balanceCents: number, paidCents: number, feeCents: number | null, feePct: number) {
  if (feeCents !== null) return Math.min(feeCents, Math.max(0, balanceCents - paidCents));
  const short = balanceCents - paidCents;
  if (short <= 0 || feePct <= 0) return 0;
  const expected = balanceCents * feePct / 100;
  return Math.abs(short - expected) <= 1 ? short : 0;
}
