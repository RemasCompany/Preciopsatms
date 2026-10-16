import { requireApiContext, withApi, HttpError } from '@/lib/tenant';
import { employeeList, payHistory, isAdmin, updateEmployee } from '@/lib/people';

type Ctx = { params: { id: string } };

/** One employee, their own profile, their direct reports and (owners and admins) their pay history. */
export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { tdb, role } = await requireApiContext({ feature: 'people' });
  const all = await employeeList(tdb, role, { status: 'all' });
  const e = all.find((x) => x.id === params.id);
  if (!e) throw new HttpError(404, 'That employee was deleted.');
  // What they filled in on their employee page. Home address and emergency contact are for HR (recruiter role and up).
  const row = await tdb.employee.findFirst({ where: { id: e.id }, select: { preferredName: true, pronouns: true, bio: true, homeAddress: true, emergencyName: true, emergencyRelation: true, emergencyPhone: true, profileCompletedAt: true, candidate: { select: { photoFileId: true, skills: true } } } });
  const hr = role !== 'VIEWER';
  const profile = row && { preferredName: row.preferredName, pronouns: row.pronouns, bio: row.bio, skills: row.candidate.skills, photo: !!row.candidate.photoFileId, complete: !!row.profileCompletedAt,
    ...(hr ? { homeAddress: row.homeAddress, emergencyName: row.emergencyName, emergencyRelation: row.emergencyRelation, emergencyPhone: row.emergencyPhone } : {}) };
  return Response.json({ employee: e, profile, reports: all.filter((x) => x.managerId === e.id && x.status !== 'TERMINATED').map((x) => ({ id: x.id, name: x.name, title: x.title })),
    pay: isAdmin(role) ? await payHistory(tdb, e.id) : null });
});

/** Profile, job, department, location, manager, or leave status. HR (recruiter role and up) can edit; pay has its own route. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ minRole: 'RECRUITER', feature: 'people', write: true });
  return Response.json(await updateEmployee(ctx, params.id, await req.json().catch(() => null)));
});
