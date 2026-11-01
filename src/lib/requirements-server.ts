import type { Organization } from '@prisma/client';
import type { TenantDb } from './tenant';
import { assignmentWhere } from './schedule-server';
import { certGaps } from './training-server';
import { localDate } from './timeclock';
import { workState } from './requirements';

/**
 * Jobs with their required credentials, and whether each worker on assignment there is cleared today
 * (the facility's readiness). Capped so a huge account still loads.
 */
export async function jobReadiness(tdb: TenantDb, org: Pick<Organization, 'timezone'>) {
  const today = localDate(new Date(), org.timezone);
  const jobs = await tdb.job.findMany({
    where: { status: { in: ['OPEN', 'ON_HOLD', 'FILLED'] } },
    select: {
      id: true, title: true, location: true, requiredCerts: true, client: { select: { name: true } },
      applications: { where: assignmentWhere, select: { candidate: { select: { id: true, name: true } } }, take: 200 },
    },
    orderBy: [{ title: 'asc' }], take: 300,
  });
  return Promise.all(jobs.map(async (j) => {
    const state = workState(j.location);
    const workers = j.requiredCerts.length
      ? await Promise.all(j.applications.map(async (a) => ({ id: a.candidate.id, name: a.candidate.name, gaps: await certGaps(tdb, a.candidate.id, j.requiredCerts, today, today, state) })))
      : [];
    return { id: j.id, title: j.title, client: j.client?.name ?? null, location: j.location, state, requiredCerts: j.requiredCerts, workers };
  }));
}
export type JobReadiness = Awaited<ReturnType<typeof jobReadiness>>[number];
