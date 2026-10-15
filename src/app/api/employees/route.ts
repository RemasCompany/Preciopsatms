import { requireApiContext, withApi } from '@/lib/tenant';
import { createEmployee, employeeList } from '@/lib/people';

/** Employees, with filters. Pay is included for owners and admins only. */
export const GET = withApi(async (req: Request) => {
  const { tdb, role } = await requireApiContext({ feature: 'people' });
  const u = new URL(req.url).searchParams;
  return Response.json(await employeeList(tdb, role, { status: u.get('status') ?? undefined, department: u.get('department') ?? undefined, branch: u.get('branch') ?? undefined, q: u.get('q')?.slice(0, 80) ?? undefined }));
});

/** Add an employee: a new person, or an existing candidate. Setting pay needs an owner or admin. */
export const POST = withApi(async (req: Request) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'people', write: true });
  const e = await createEmployee(ctx, await req.json().catch(() => null));
  return Response.json({ id: e.id }, { status: 201 });
});
