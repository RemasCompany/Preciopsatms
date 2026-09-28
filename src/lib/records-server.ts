import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError, type TenantDb } from './tenant';
import { RECORDS, optValue, type Field, type RecordKind, type RecordValues } from './records';

export const MODEL: Record<RecordKind, 'job' | 'candidate' | 'client' | 'contact' | 'deal' | 'lead' | 'vendor' | 'task'> = {
  jobs: 'job', candidates: 'candidate', clients: 'client', contacts: 'contact', deals: 'deal', leads: 'lead', vendors: 'vendor', tasks: 'task',
};

type Delegate = {
  findMany(a?: object): Promise<Record<string, unknown>[]>;
  findFirst(a: object): Promise<Record<string, unknown> | null>;
  create(a: object): Promise<Record<string, unknown>>;
  updateMany(a: object): Promise<{ count: number }>;
  deleteMany(a: object): Promise<{ count: number }>;
};
/** The tenant-scoped Prisma delegate for a record kind. */
export const delegate = (tdb: TenantDb, kind: RecordKind) => (tdb as unknown as Record<string, Delegate>)[MODEL[kind]];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** DB row → form values (Decimal → number, Date → YYYY-MM-DD). */
export function toValues(kind: RecordKind, row: Record<string, unknown>): RecordValues & { id: string } {
  const out: RecordValues & { id: string } = { id: String(row.id) };
  for (const fl of RECORDS[kind].fields) {
    const v = row[fl.key];
    out[fl.key] = v == null ? (fl.type === 'tags' ? [] : fl.type === 'chk' ? false : null)
      : v instanceof Prisma.Decimal ? Number(v) : v instanceof Date ? ymd(v) : (v as RecordValues[string]);
  }
  return out;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function fieldSchema(fl: Field) {
  switch (fl.type) {
    case 'num':
      return z.union([z.number(), z.string(), z.null()]).transform((v, ctx) => {
        if (blank(v)) return null;
        const n = Number(v);
        if (!Number.isFinite(n)) { ctx.addIssue({ code: 'custom', message: `${fl.label} must be a number.` }); return z.NEVER; }
        if (fl.int && !Number.isInteger(n)) { ctx.addIssue({ code: 'custom', message: `${fl.label} must be a whole number.` }); return z.NEVER; }
        if ((fl.min !== undefined && n < fl.min) || (fl.max !== undefined && n > fl.max)) {
          ctx.addIssue({ code: 'custom', message: `${fl.label} must be between ${fl.min ?? '−∞'} and ${fl.max ?? '∞'}.` }); return z.NEVER;
        }
        return n;
      });
    case 'date':
      return z.union([z.string(), z.null()]).transform((v, ctx) => {
        if (blank(v)) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v!) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) { ctx.addIssue({ code: 'custom', message: `${fl.label} must be a valid date.` }); return z.NEVER; }
        return new Date(`${v}T00:00:00Z`);
      });
    case 'chk':
      return z.boolean();
    case 'tags':
      return z.union([z.array(z.string()), z.string()]).transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean).slice(0, 40).map((s) => s.slice(0, 60)));
    case 'sel': {
      const values = (fl.options ?? []).map(optValue);
      return z.union([z.string(), z.null()]).transform((v, ctx) => {
        if (blank(v)) return null;
        if (!values.includes(v!)) { ctx.addIssue({ code: 'custom', message: `Choose a valid ${fl.label.toLowerCase()}.` }); return z.NEVER; }
        return v;
      });
    }
    case 'ref':
      return z.union([z.string(), z.null()]).transform((v) => (blank(v) ? null : v!.trim()));
    default: {
      const max = fl.type === 'area' ? 20000 : 300;
      return z.union([z.string(), z.null()]).transform((v, ctx) => {
        if (blank(v)) return null;
        const s = v!.trim();
        if (s.length > max) { ctx.addIssue({ code: 'custom', message: `${fl.label} is too long.` }); return z.NEVER; }
        if (fl.type === 'email' && !z.string().email().safeParse(s).success) { ctx.addIssue({ code: 'custom', message: 'Enter a valid email address.' }); return z.NEVER; }
        if (fl.type === 'url' && !/^https?:\/\/\S+\.\S+/.test(s)) { ctx.addIssue({ code: 'custom', message: `${fl.label.split(' (')[0]} must start with http:// or https://` }); return z.NEVER; }
        return s;
      });
    }
  }
}

/**
 * Validates a create/update body against the kind's field spec. Unknown keys (including organizationId) are dropped.
 * Linked records (clientId, vendorId) must belong to the caller's org.
 */
export async function parseRecord(tdb: TenantDb, kind: RecordKind, body: unknown, mode: 'create' | 'update') {
  const fields = RECORDS[kind].fields;
  const shape = Object.fromEntries(fields.map((fl) => [fl.key, fieldSchema(fl).optional()]));
  const res = z.object(shape).strip().safeParse(body ?? {});
  if (!res.success) throw new HttpError(400, res.error.issues[0]?.message ?? 'Invalid input');
  const data = res.data as Record<string, unknown>;
  for (const fl of fields) {
    if (fl.required && (mode === 'create' || fl.key in data) && blank(data[fl.key])) throw new HttpError(400, `${fl.label} is required.`);
    if (fl.type === 'tags' && mode === 'create' && data[fl.key] === undefined) data[fl.key] = [];
    if (fl.notNull && data[fl.key] === null) delete data[fl.key]; // keep the DB default / current value
    if (fl.type === 'ref' && data[fl.key]) {
      const ok = await delegate(tdb, fl.ref!).findFirst({ where: { id: data[fl.key] }, select: { id: true } });
      if (!ok) throw new HttpError(400, `That ${RECORDS[fl.ref!].one} was not found.`);
    }
  }
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  return data;
}

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));
const jobLabel = (j: { title: string; client?: { name: string } | null }) => (j.client ? `${j.title} — ${j.client.name}` : j.title);

/** Related data shown under the form in each drawer. */
export async function loadExtras(tdb: TenantDb, kind: RecordKind, id: string) {
  switch (kind) {
    case 'jobs': {
      const apps = await tdb.application.findMany({ where: { jobId: id }, include: { candidate: { select: { name: true, title: true } } }, orderBy: { stageChangedAt: 'desc' } });
      return { applications: apps.map((a) => ({ id: a.id, candidateId: a.candidateId, name: a.candidate.name, title: a.candidate.title, stage: a.stage, matchScore: a.matchScore })) };
    }
    case 'candidates': {
      const apps = await tdb.application.findMany({ where: { candidateId: id }, include: { job: { select: { title: true, billRate: true, client: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' } });
      const taken = apps.map((a) => a.jobId);
      const open = await tdb.job.findMany({ where: { status: 'OPEN', id: { notIn: taken } }, select: { id: true, title: true, client: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
      return {
        applications: apps.map((a) => ({ id: a.id, jobId: a.jobId, job: a.job.title, client: a.job.client?.name ?? null, billRate: num(a.job.billRate), stage: a.stage })),
        openJobs: open.map((j) => ({ id: j.id, label: jobLabel(j) })),
      };
    }
    case 'clients': {
      const [contacts, jobs, deals] = await Promise.all([
        tdb.contact.findMany({ where: { clientId: id }, orderBy: { name: 'asc' } }),
        tdb.job.findMany({ where: { clientId: id }, select: { id: true, title: true, location: true, status: true }, orderBy: { createdAt: 'desc' } }),
        tdb.deal.findMany({ where: { clientId: id }, select: { id: true, title: true, value: true, stage: true }, orderBy: { createdAt: 'desc' } }),
      ]);
      return { contacts: contacts.map((c) => toValues('contacts', c)), jobs, deals: deals.map((d) => ({ ...d, value: num(d.value) })) };
    }
    case 'vendors': {
      const cands = await tdb.candidate.findMany({ where: { vendorId: id }, select: { id: true, name: true, title: true, status: true }, orderBy: { name: 'asc' } });
      return { candidates: cands };
    }
    default:
      return {};
  }
}
