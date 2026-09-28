import { db } from '@/lib/db';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { PLANS } from '@/lib/plans';
import Team from '@/components/Team';

export default async function TeamPage() {
  const ctx = await requirePageContext();
  const { org, tdb, user, role } = ctx;
  const [members, invites] = await Promise.all([
    db.membership.findMany({ where: { organizationId: org.id }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
    tdb.invite.findMany({ where: { acceptedAt: null }, orderBy: { expiresAt: 'desc' } }),
  ]);
  const admin = (role === 'OWNER' || role === 'ADMIN') && canEdit(ctx);
  const max = PLANS[org.plan].maxSeats;
  return (
    <>
      <h1>Team</h1>
      <p className="lede">Owners manage billing and everything else. Admins invite people, approve timesheets and see EEO reports. Recruiters work jobs, candidates and clients. Viewers can look but not change anything.</p>
      <p className="muted">{members.length} {members.length === 1 ? 'user' : 'users'}{max ? ` of ${max} on the ${PLANS[org.plan].name} plan` : ''}{PLANS[org.plan].perSeat ? ' · billed per user' : ''}</p>
      <Team
        me={{ id: user.id, role }}
        admin={admin}
        members={members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, since: m.createdAt.toISOString() }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expired: i.expiresAt < new Date(), expiresAt: i.expiresAt.toISOString() }))}
        full={max !== null && members.length >= max}
      />
    </>
  );
}
