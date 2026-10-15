import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { DepartmentBody, parse } from '@/lib/people';

export const GET = withApi(async () => {
  const { tdb } = await requireApiContext({ feature: 'people' });
  return Response.json(await tdb.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, _count: { select: { employees: { where: { status: { not: 'TERMINATED' } } } } } } }));
});

export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  const { name } = parse(DepartmentBody, await req.json().catch(() => null));
  if (await tdb.department.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) throw new HttpError(409, `There’s already a ${name} department.`);
  const d = await tdb.department.create({ data: { name } as never });
  await audit(org.id, user, 'employee.department', `Added the ${name} department`, { targetType: 'Department', targetId: d.id });
  return Response.json({ id: d.id }, { status: 201 });
});
