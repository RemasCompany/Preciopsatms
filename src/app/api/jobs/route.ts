import { JobInput } from '@/lib/schemas';
import { requireApiContext, withApi, logActivity } from '@/lib/tenant';


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
  const job = await tdb.job.create({ data: { ...data, applyUrl: data.applyUrl || null } as never });
  await logActivity(org.id, `Added job ${job.title}`, user.id);
  return Response.json({ job }, { status: 201 });
});
