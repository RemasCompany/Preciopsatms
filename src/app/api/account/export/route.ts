import { requireApiContext, withApi, logActivity } from '@/lib/tenant';
import { db } from '@/lib/db';
import { publicDoc } from '@/lib/esign';

/**
 * Full data export for the organization (GDPR / CCPA access and portability requests). Owner only.
 * Secrets are left out: password hashes, signing and invite token hashes, and stored-file keys.
 */
export const GET = withApi(async () => {
  const { tdb, org, user } = await requireApiContext({ minRole: 'OWNER' });
  const [members, jobs, candidates, applications, eeoSelfIds, clients, contacts, deals, leads, vendors, tasks, timesheets, documents, messages, activity, files, invites] = await Promise.all([
    db.membership.findMany({ where: { organizationId: org.id }, select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true, createdAt: true } } } }),
    tdb.job.findMany(), tdb.candidate.findMany(), tdb.application.findMany(), tdb.eeoSelfId.findMany(), tdb.client.findMany(), tdb.contact.findMany(),
    tdb.deal.findMany(), tdb.lead.findMany(), tdb.vendor.findMany(), tdb.task.findMany(), tdb.timesheet.findMany(),
    tdb.signDocument.findMany().then((ds) => ds.map(publicDoc)), tdb.message.findMany(), tdb.activity.findMany(),
    tdb.storedFile.findMany({ select: { id: true, filename: true, contentType: true, size: true, createdAt: true } }),
    tdb.invite.findMany({ select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true } }),
  ]);
  const { stripeCustomerId: _c, stripeSubscriptionId: _s, ...organization } = org;
  await logActivity(org.id, 'Exported all company data', user.id);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), organization, members, jobs, candidates, applications, eeoSelfIds, clients, contacts, deals, leads, vendors, tasks, timesheets, documents, messages, activity, files, invites }, null, 2);
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="preciops-export-${org.slug}-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'private, no-store' } });
});
