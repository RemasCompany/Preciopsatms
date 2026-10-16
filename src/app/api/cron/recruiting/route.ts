import { cronRoute } from '@/lib/cron';
import { db } from '@/lib/db';
import { hasFeature } from '@/lib/plans';
import { runInterviewReminders } from '@/lib/interviews-server';
import { runRedeployTasks } from '@/lib/redeploy';
import { captureError } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: interview reminders to candidates, scorecard nudges to interviewers, and redeployment tasks. Needs CRON_SECRET. */
export const GET = cronRoute('recruiting', async () => {
  const orgs = await db.organization.findMany({ where: { subscriptionStatus: { in: ['trialing', 'active'] } } });
  let reminded = 0, nudged = 0, redeploy = 0;
  for (const org of orgs) {
    if (!hasFeature(org, 'ats')) continue;
    try {
      const r = await runInterviewReminders(org); reminded += r.reminded; nudged += r.nudged;
      if (org.kind !== 'EMPLOYER') redeploy += await runRedeployTasks(org);
    } catch (e) { await captureError(e, { tags: { cron: 'recruiting' }, orgId: org.id }); }
  }
  return { orgs: orgs.length, reminded, nudged, redeploy };
});
