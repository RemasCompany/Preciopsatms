// Field specs for every editable record type, ported from `F` in docs/prototype.html.
// Shared by the drawer form (client) and validation (server) — keep this file free of server imports.
import type { Feature } from './plans';

export const SECTORS = ['IT & Software', 'Healthcare', 'Manufacturing', 'Warehouse', 'Logistics', 'Security', 'Other'];

export type Opt = string | [value: string, label: string];
export type FieldType = 'text' | 'email' | 'tel' | 'url' | 'num' | 'date' | 'sel' | 'ref' | 'user' | 'chk' | 'tags' | 'area';
export type Field = { key: string; label: string; type: FieldType; options?: Opt[]; ref?: RecordKind; required?: boolean; notNull?: boolean; min?: number; max?: number; int?: boolean };
export type RecordKind = 'jobs' | 'candidates' | 'clients' | 'contacts' | 'deals' | 'leads' | 'vendors' | 'tasks';

const f = (key: string, label: string, type: FieldType = 'text', extra: Partial<Field> = {}): Field => ({ key, label, type, ...extra });

export const RECORDS: Record<RecordKind, { one: string; titleKey: string; feature?: Feature; fields: Field[] }> = {
  jobs: { one: 'job', titleKey: 'title', feature: 'ats', fields: [
    f('title', 'Job title', 'text', { required: true }), f('clientId', 'Client', 'ref', { ref: 'clients' }), f('sector', 'Sector', 'sel', { options: SECTORS }),
    f('location', 'Location (City, ST)'), f('postalCode', 'ZIP code'), f('remote', 'Fully remote', 'chk'),
    f('type', 'Employment type', 'sel', { notNull: true, options: [['CONTRACT', 'Contract'], ['CONTRACT_TO_HIRE', 'Contract-to-hire'], ['DIRECT_HIRE', 'Direct hire'], ['TEMP', 'Temp'], ['PER_DIEM', 'Per diem']] }),
    f('openings', 'Openings', 'num', { min: 1, max: 999, int: true }), f('payRate', 'Pay rate ($/hr)', 'num', { min: 0 }), f('billRate', 'Bill rate ($/hr)', 'num', { min: 0 }),
    f('status', 'Status', 'sel', { notNull: true, options: [['OPEN', 'Open'], ['ON_HOLD', 'On hold'], ['FILLED', 'Filled'], ['CLOSED', 'Closed']] }),
    f('hot', 'Hot job (highlighted on the careers page)', 'chk'), f('startDate', 'Target start', 'date'),
    f('applyUrl', 'Apply link (leave blank to apply on your careers page)', 'url'), f('publish', 'Show on careers page', 'chk'),
    f('skills', 'Required skills (comma separated)', 'tags'), f('description', 'Description', 'area'),
  ] },
  candidates: { one: 'candidate', titleKey: 'name', feature: 'ats', fields: [
    f('name', 'Full name', 'text', { required: true }), f('title', 'Current title'), f('email', 'Email', 'email'), f('phone', 'Phone', 'tel'), f('location', 'Location'),
    f('sector', 'Sector', 'sel', { options: SECTORS }), f('yearsExp', 'Years of experience', 'num', { min: 0, max: 80, int: true }), f('desiredRate', 'Desired rate ($/hr)', 'num', { min: 0 }),
    f('availability', 'Availability', 'sel', { options: ['Immediately', '2 weeks', '30 days', 'Passive'] }),
    f('source', 'Source', 'sel', { options: ['Job board', 'Referral', 'LinkedIn', 'Vendor', 'Walk-in', 'Website', 'Careers page', 'Other'] }),
    f('vendorId', 'Supplied by vendor', 'ref', { ref: 'vendors' }), f('payrollId', 'Payroll employee ID'),
    f('status', 'Status', 'sel', { notNull: true, options: ['Active', 'On assignment', 'Placed', 'Inactive', 'Do not use'] }),
    f('skills', 'Skills (comma separated)', 'tags'), f('certs', 'Licenses & certifications', 'tags'), f('summary', 'Summary / resume notes', 'area'),
  ] },
  clients: { one: 'client', titleKey: 'name', feature: 'crm', fields: [
    f('name', 'Company name', 'text', { required: true }), f('industry', 'Industry', 'sel', { options: SECTORS }), f('status', 'Status', 'sel', { notNull: true, options: ['Active', 'Prospect', 'Inactive'] }),
    f('city', 'City / region'), f('website', 'Website', 'url'), f('markupPct', 'Standard markup (%)', 'num', { min: 0, max: 999 }), f('msaSignedAt', 'MSA signed', 'date'),
    f('paymentTerms', 'Payment terms', 'sel', { notNull: true, options: ['Net 30', 'Net 15', 'Net 45', 'Net 60'] }), f('notes', 'Notes', 'area'),
  ] },
  contacts: { one: 'contact', titleKey: 'name', feature: 'crm', fields: [
    f('name', 'Name', 'text', { required: true }), f('title', 'Title'), f('email', 'Email', 'email'), f('phone', 'Phone', 'tel'),
  ] },
  deals: { one: 'deal', titleKey: 'title', feature: 'crm', fields: [
    f('title', 'Deal name', 'text', { required: true }), f('clientId', 'Client', 'ref', { ref: 'clients' }), f('ownerId', 'Owner', 'user'), f('value', 'Annual value ($)', 'num', { min: 0 }),
    f('stage', 'Stage', 'sel', { notNull: true, options: ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] }), f('closeDate', 'Expected close', 'date'),
    f('service', 'Service line', 'sel', { options: ['Contract staffing', 'Direct hire', 'MSP / VMS', 'Managed IT', 'Security services', 'Other'] }), f('notes', 'Notes', 'area'),
  ] },
  leads: { one: 'lead', titleKey: 'company', feature: 'leads', fields: [
    f('company', 'Company', 'text', { required: true }), f('ownerId', 'Owner', 'user'), f('contact', 'Contact name'), f('role', 'Contact title'), f('email', 'Email', 'email'), f('phone', 'Phone', 'tel'),
    f('industry', 'Industry', 'sel', { options: SECTORS }), f('size', 'Company size', 'sel', { options: ['1-50', '51-200', '201-1000', '1000+'] }), f('city', 'City / region'),
    f('source', 'Source', 'sel', { options: ['Referral', 'LinkedIn', 'Cold outreach', 'Website', 'Event', 'RFP / bid', 'Inbound call', 'Other'] }),
    f('status', 'Status', 'sel', { notNull: true, options: ['New', 'Contacted', 'Qualified', 'Converted', 'Disqualified'] }),
    f('score', 'Score (0–100)', 'num', { min: 0, max: 100, int: true }), f('nextStepAt', 'Next follow-up', 'date'), f('notes', 'Notes', 'area'),
  ] },
  vendors: { one: 'vendor', titleKey: 'name', feature: 'vendors', fields: [
    f('name', 'Vendor name', 'text', { required: true }),
    f('category', 'Category', 'sel', { options: ['Sub-vendor / supplier', 'Background & drug screening', 'Job board', 'Payroll / EOR', 'Software', 'Other'] }),
    f('status', 'Status', 'sel', { notNull: true, options: ['Pending', 'Approved', 'Suspended'] }), f('contact', 'Contact'), f('email', 'Email', 'email'), f('phone', 'Phone', 'tel'),
    f('sectors', 'Sectors covered', 'tags'), f('feePct', 'Fee / markup share (%)', 'num', { min: 0, max: 100 }), f('rating', 'Rating (1–5)', 'num', { min: 1, max: 5 }),
    f('coiExpiresAt', 'Insurance (COI) expires', 'date'), f('w9ReceivedAt', 'W-9 received', 'date'), f('agreementExpiresAt', 'Agreement expires', 'date'), f('notes', 'Notes', 'area'),
  ] },
  tasks: { one: 'task', titleKey: 'title', fields: [
    f('title', 'Task', 'text', { required: true }), f('dueAt', 'Due date', 'date'), f('priority', 'Priority', 'sel', { notNull: true, options: ['Normal', 'High', 'Low'] }),
    f('related', 'Related to'), f('done', 'Done', 'chk'),
  ] },
};

export const RECORD_KINDS = Object.keys(RECORDS) as RecordKind[];
export const isRecordKind = (k: string): k is RecordKind => k in RECORDS;
export const optValue = (o: Opt) => (Array.isArray(o) ? o[0] : o);
export const optLabel = (o: Opt) => (Array.isArray(o) ? o[1] : o);
export const labelFor = (kind: RecordKind, key: string, value: unknown) => {
  const o = RECORDS[kind].fields.find((x) => x.key === key)?.options?.find((x) => optValue(x) === value);
  return o ? optLabel(o) : String(value ?? '');
};

/** Form values as the drawer holds them: dates are YYYY-MM-DD, money/decimals are numbers, empty is null. */
export type RecordValues = Record<string, string | number | boolean | string[] | null>;

/** Defaults for a new record: first option of each select, publish on, plus any preset. */
export function defaultsFor(kind: RecordKind, preset: RecordValues = {}): RecordValues {
  const r: RecordValues = {};
  for (const fl of RECORDS[kind].fields) {
    if (fl.type === 'user') continue; // left out: the server makes the creator the owner
    if (fl.type === 'sel' && fl.options?.length) r[fl.key] = optValue(fl.options[0]);
    else if (fl.type === 'chk') r[fl.key] = fl.key === 'publish';
    else if (fl.type === 'tags') r[fl.key] = [];
    else r[fl.key] = kind === 'jobs' && fl.key === 'openings' ? 1 : null;
  }
  return { ...r, ...preset };
}

// ---- vendor compliance (prototype: vendorStatus) ----
export type ComplianceIssue = { level: 'warn' | 'soon'; text: string };
const daysUntil = (d: string | null | undefined, now = Date.now()) => (d ? Math.ceil((new Date(`${d}T00:00:00Z`).getTime() - now) / 864e5) : null);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function vendorCompliance(v: { coiExpiresAt?: string | null; agreementExpiresAt?: string | null; w9ReceivedAt?: string | null }, now = Date.now()): ComplianceIssue[] {
  const out: ComplianceIssue[] = [];
  for (const [k, label] of [['coiExpiresAt', 'Insurance'], ['agreementExpiresAt', 'Agreement']] as const) {
    const d = daysUntil(v[k], now);
    if (d === null) out.push({ level: 'warn', text: `${label} date missing` });
    else if (d < 0) out.push({ level: 'warn', text: `${label} expired ${fmt(v[k]!)}` });
    else if (d <= 30) out.push({ level: 'soon', text: `${label} expires in ${d}d` });
  }
  if (!v.w9ReceivedAt) out.push({ level: 'warn', text: 'W-9 missing' });
  return out;
}

export const HOURS_PER_WEEK = 40;

/** Record kinds that belong to a sales rep; new ones default to the person creating them. */
export const OWNED_KINDS: RecordKind[] = ['deals', 'leads'];
