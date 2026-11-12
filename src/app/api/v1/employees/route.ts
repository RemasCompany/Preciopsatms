import { apiRoute, page, paged } from '@/lib/api-keys';
import { since } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

/** GET /api/v1/employees?status=ACTIVE&updatedSince=…&limit=&cursor= (no pay, tax, bank or EEO details). */
export const GET = apiRoute(async (req, { tdb }) => {
  const { limit, after, args, u } = page(req);
  const status = u.searchParams.get('status')?.toUpperCase();
  const rows = await tdb.employee.findMany({ ...args, where: { ...after, ...since(u), ...(status ? { status: status as never } : {}) },
    include: { candidate: { select: { name: true, email: true, phone: true } }, department: { select: { name: true } }, branch: { select: { name: true } } } });
  const { data, nextCursor } = paged(rows, limit);
  return Response.json({ data: data.map((e) => ({ id: e.id, candidateId: e.candidateId, employeeNumber: e.employeeNumber, name: e.candidate.name, email: e.candidate.email, phone: e.candidate.phone, title: e.title,
    department: e.department?.name ?? null, location: e.branch?.name ?? null, managerId: e.managerId, employmentType: e.employmentType, status: e.status, startDate: e.startDate.toISOString().slice(0, 10),
    updatedAt: e.updatedAt.toISOString() })), nextCursor });
});
