import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { DepartmentBody, parse } from '@/lib/people';

type Ctx = { params: { id: string } };

export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  const { name } = parse(DepartmentBody, await req.json().catch(() => null));
  const d = await tdb.department.findFirst({ where: { id: params.id } });
  if (!d) throw new HttpError(404, 'That department was deleted.');
  if (await tdb.department.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, id: { not: d.id } } })) throw new HttpError(409, `There’s already a ${name} department.`);
  await tdb.department.updateMany({ where: { id: d.id }, data: { name } });
  await audit(org.id, user, 'employee.department', `Renamed the ${d.name} department to ${name}`, { targetType: 'Department', targetId: d.id });
  return Response.json({ ok: true });
});

/** Deleting a department leaves its employees without one. */
export const DELETE = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  const d = await tdb.department.findFirst({ where: { id: params.id } });
  if (!d) throw new HttpError(404, 'That department was deleted.');
  const { count } = await tdb.employee.updateMany({ where: { departmentId: d.id }, data: { departmentId: null } });
  await tdb.department.deleteMany({ where: { id: d.id } });
  await audit(org.id, user, 'employee.department', `Deleted the ${d.name} department (${count} employee${count === 1 ? '' : 's'} moved to no department)`, { targetType: 'Department', targetId: d.id });
  return Response.json({ ok: true, moved: count });
});
