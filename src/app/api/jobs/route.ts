import { JobInput } from '@/lib/schemas';
import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { suggestRequirements } from '@/lib/requirements';


export const GET = withApi(async (req: Request) => {
  const { tdb } = await requireApiContext();
  const status = new URL(req.url).searchParams.get('status') ?? undefined;
  const jobs = await tdb.job.findMany({
    where: status ? { status: status as never } : {},
    include: { client: { select: { name: true } }, _count: { select: { applications: true } } },
    orderBy: [{ hot: 'desc' }, { createdAt: 'desc' }],
  });
  return Response.json({ jobs });
});

export const POST = withApi(async (req: Request) => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'RECRUITER', write: true });
  const data = JobInput.parse(await req.json());
  if (data.clientId && !(await tdb.client.findFirst({ where: { id: data.clientId } }))) return Response.json({ error: 'Unknown client' }, { status: 400 });
  // Healthcare companies start nursing jobs with the usual requirements (license, BLS, TB test, screenings).
  const requiredCerts = org.industry === 'HEALTHCARE' && hasFeature(org, 'credentials') ? suggestRequirements(data.title) : [];
  const job = await tdb.job.create({ data: { ...data, applyUrl: data.applyUrl || null, ...(requiredCerts.length ? { requiredCerts } : {}) } as never });
  await logActivity(org.id, `Added job ${job.title}${requiredCerts.length ? ` (requires ${requiredCerts.join(', ')})` : ''}`, user.id);
  return Response.json({ job }, { status: 201 });
});
