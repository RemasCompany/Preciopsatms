import { z } from 'zod';
import type { TenantDb } from './tenant';
import { HttpError } from './tenant';

// What the API returns for each record. Money is a decimal string ("24.50"), dates are ISO. Never EEO data.
const money = (d: unknown) => (d === null || d === undefined ? null : String(d));
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

export const since = (u: URL) => {
  const s = u.searchParams.get('updatedSince');
  if (!s) return {};
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'updatedSince must be a date like 2026-11-01 or 2026-11-01T12:00:00Z.');
  return { updatedAt: { gte: d } };
};

type JobRow = { id: string; title: string; status: string; type: string; location: string | null; remote: boolean; openings: number; payRate: unknown; billRate: unknown; startDate: Date | null; skills: string[]; description: string | null; publish: boolean; createdAt: Date; updatedAt: Date; client?: { id: string; name: string } | null };
export const jobOut = (j: JobRow) => ({ id: j.id, title: j.title, status: j.status, type: j.type, location: j.location, remote: j.remote, openings: j.openings, payRate: money(j.payRate), billRate: money(j.billRate),
  startDate: day(j.startDate), skills: j.skills, description: j.description, published: j.publish, client: j.client ?? null, createdAt: j.createdAt.toISOString(), updatedAt: j.updatedAt.toISOString() });

type CandRow = { id: string; name: string; email: string | null; phone: string | null; title: string | null; location: string | null; source: string | null; status: string; skills: string[]; createdAt: Date; updatedAt: Date };
export const candidateOut = (c: CandRow) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, title: c.title, location: c.location, source: c.source, status: c.status, skills: c.skills, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() });

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
export const NewCandidate = z.object({
  name: z.string().trim().min(1, 'name is required.').max(120),
  email: z.string().trim().email('email must be a valid email address.').max(200).optional().nullable(),
  phone: z.string().trim().max(30).regex(/^[\d\s()+.-]*$/, 'phone may only contain digits and + ( ) . -').optional().nullable(),
  title: optText(120), location: optText(120), source: optText(60),
  skills: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});
export const NewJob = z.object({
  title: z.string().trim().min(2, 'title is required.').max(160),
  location: optText(120), remote: z.boolean().optional(),
  type: z.enum(['CONTRACT', 'CONTRACT_TO_HIRE', 'DIRECT_HIRE', 'TEMP', 'PER_DIEM', 'FULL_TIME', 'PART_TIME', 'SEASONAL']).optional(),
  openings: z.number().int().min(1).max(10000).optional(),
  payRate: z.number().min(0).max(100000).optional().nullable(), billRate: z.number().min(0).max(100000).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must look like 2026-12-01.').optional().nullable(),
  description: optText(20000), skills: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  publish: z.boolean().optional(),
});

export async function createCandidate(tdb: TenantDb, raw: unknown) {
  const b = NewCandidate.parse(raw);
  const email = b.email?.toLowerCase() || null;
  if (email) {
    const dup = await tdb.candidate.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (dup) throw new HttpError(409, `A candidate with that email already exists (id ${dup.id}).`);
  }
  return tdb.candidate.create({ data: { name: b.name, email, phone: b.phone || null, title: b.title || null, location: b.location || null, source: b.source || 'API', skills: b.skills ?? [] } as never });
}

export async function createJob(tdb: TenantDb, raw: unknown) {
  const b = NewJob.parse(raw);
  return tdb.job.create({
    data: { title: b.title, location: b.location || null, remote: b.remote ?? false, type: b.type ?? 'CONTRACT', openings: b.openings ?? 1, payRate: b.payRate ?? null, billRate: b.billRate ?? null,
      startDate: b.startDate ? new Date(`${b.startDate}T00:00:00Z`) : null, description: b.description || null, skills: b.skills ?? [], publish: b.publish ?? false } as never,
    include: { client: { select: { id: true, name: true } } },
  });
}
