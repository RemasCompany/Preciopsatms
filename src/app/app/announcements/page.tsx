import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { redirect } from 'next/navigation';
import { audience, SHOW_DAYS } from '@/lib/announcements';
import Announcements from '@/components/Announcements';

export default async function AnnouncementsPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'messaging')) redirect('/app/billing');
  const [rows, branches, everyone] = await Promise.all([
    ctx.tdb.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { branch: { select: { name: true } } } }),
    ctx.tdb.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    audience(ctx.tdb, null),
  ]);
  const posted = rows.map((r) => ({
    id: r.id, title: r.title, body: r.body, date: r.createdAt.toISOString().slice(0, 10), location: r.branch?.name ?? null, emailed: r.emailed,
    live: r.createdAt.getTime() > Date.now() - SHOW_DAYS * 864e5, mine: r.createdById === ctx.user.id,
  }));
  return (
    <>
      <h1>Announcements</h1>
      <p className="lede">Updates for your whole team or one location. They show on each person’s own page in the employee app for {SHOW_DAYS} days, and you can email everyone a copy.</p>
      <Announcements posted={posted} branches={branches} everyone={everyone.length} canPost={canEdit(ctx) && ctx.role !== 'VIEWER'} isAdmin={ctx.role === 'OWNER' || ctx.role === 'ADMIN'} />
    </>
  );
}
