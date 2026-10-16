import { requireApiContext, withApi } from '@/lib/tenant';

/** Current employees, for "Assign to an employee" pickers: [{ id, label }]. */
export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({});
  const rows = await tdb.employee.findMany({ where: { status: { not: 'TERMINATED' } }, select: { id: true, title: true, candidate: { select: { name: true } } }, take: 5000 });
  return Response.json(rows.map((e) => ({ id: e.id, label: `${e.candidate.name} — ${e.title}` })).sort((a, b) => a.label.localeCompare(b.label)));
});
