import { z } from 'zod';
import { requireApiContext, withApi, logActivity } from '@/lib/tenant';

const CandidateInput = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  title: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  sector: z.string().max(60).optional(),
  yearsExp: z.coerce.number().int().min(0).max(70).optional(),
  desiredRate: z.coerce.number().min(0).optional(),
  availability: z.string().max(40).optional(),
  source: z.string().max(40).optional(),
  vendorId: z.string().optional().nullable(),
  skills: z.array(z.string().max(60)).max(60).default([]),
  certs: z.array(z.string().max(80)).max(40).default([]),
  summary: z.string().max(10000).optional(),
});

export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext();
  const q = new URL(req.url).searchParams.get('q')?.trim();
  const candidates = await tdb.candidate.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { skills: { has: q } }] } : {},
    orderBy: { updatedAt: 'desc' }, take: 200,
  });
  return Response.json({ candidates });
});

export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  const d = CandidateInput.parse(await req.json());
  if (d.vendorId && !(await tdb.vendor.findFirst({ where: { id: d.vendorId } }))) return Response.json({ error: 'Unknown vendor' }, { status: 400 });
  const candidate = await tdb.candidate.create({ data: { ...d, email: d.email || null } as never });
  await logActivity(org.id, `Added candidate ${candidate.name}`, user.id);
  return Response.json({ candidate }, { status: 201 });
});
