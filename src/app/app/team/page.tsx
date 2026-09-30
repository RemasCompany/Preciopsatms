import { db } from '@/lib/db';
import { requirePageContext, canEdit } from '@/lib/tenant';
import { PLANS } from '@/lib/plans';
import Team from '@/components/Team';
import { OpenRecord } from '@/components/Records';

export default async function TeamPage() {
  const ctx = await requirePageContext();
  const { org, tdb, user, role } = ctx;
  const [members, invites, branches] = await Promise.all([
    db.membership.findMany({ where: { organizationId: org.id }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
    tdb.invite.findMany({ where: { acceptedAt: null }, orderBy: { expiresAt: 'desc' } }),
    tdb.branch.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { jobs: true, members: true } } } }),
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
        members={members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, since: m.createdAt.toISOString(), branchId: m.branchId }))}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expired: i.expiresAt < new Date(), expiresAt: i.expiresAt.toISOString() }))}
        full={max !== null && members.length >= max}
      />
      <section className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Branches</h2>
          {admin && <OpenRecord kind="branches" className="btn sm">+ Add branch</OpenRecord>}
        </div>
        <p className="muted">For companies with more than one office. Put jobs (and optionally candidates) in a branch, give people a home branch, and use the branch switcher at the top of every page to see one office at a time.</p>
        {branches.length ? <div className="list">{branches.map((b) => (
          <div key={b.id} className="li"><span className="x">{admin ? <OpenRecord kind="branches" id={b.id}><b>{b.name}</b></OpenRecord> : <b>{b.name}</b>}<span className="muted">{[b.city, b.phone].filter(Boolean).join(' · ')}</span></span>
            <span className="muted">{b._count.jobs} job{b._count.jobs === 1 ? '' : 's'} · {b._count.members} teammate{b._count.members === 1 ? '' : 's'}</span></div>
        ))}</div> : <p className="muted" style={{ margin: 0 }}>One office? You don’t need branches.</p>}
      </section>
    </>
  );
}
