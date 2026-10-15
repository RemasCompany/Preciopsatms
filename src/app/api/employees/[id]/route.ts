import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { employeeList, payHistory, isAdmin, updateEmployee } from '@/lib/people';

type Ctx = { params: { id: string } };

/** One employee, their direct reports and (owners and admins) their pay history. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, role } = await requireApiContext({ feature: 'people' });
  const all = await employeeList(tdb, role, { status: 'all' });
  const e = all.find((x) => x.id === params.id);
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  return Response.json({ employee: e, reports: all.filter((x) => x.managerId === e.id && x.status !== 'TERMINATED').map((x) => ({ id: x.id, name: x.name, title: x.title })),
    pay: isAdmin(role) ? await payHistory(tdb, e.id) : null });
});

/** Profile, job, department, location, manager, or leave status. HR (recruiter role and up) can edit; pay has its own route. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'people', write: true });
  return Response.json(await updateEmployee(ctx, params.id, await req.json().catch(() => null)));
});
