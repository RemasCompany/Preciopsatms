import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { referralRows } from '@/lib/referrals';
import Referrals from '@/components/Referrals';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';

export default async function ReferralsPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'engagement')) return <Gate title="Referrals" feature="Worker referrals" />;
  const rows = await referralRows(ctx.tdb);
  const due = rows.filter((r) => r.due);
  const hired = rows.filter((r) => r.friendStatus === 'On assignment').length;
  return (
    <>
      <h1>Referrals</h1>
      <p className="lede">Your best workers know other good workers. They refer friends from their private link; you see who they brought in and when a bonus is due.</p>
      <div className="kpis" style={{ margin: '16px 0' }}>
        <div className="kpi"><b>{rows.length}</b><span>Referrals</span></div>
        <div className="kpi"><b>{hired}</b><span>On assignment now</span></div>
        <div className="kpi"><b className={due.length ? 'warnnum' : undefined}>{due.length}</b><span>Bonuses due</span><span className="sub">{due.length ? `$${due.reduce((s, r) => s + (r.bonus ?? 0), 0).toLocaleString()}` : ''}</span></div>
      </div>
      <Referrals rows={rows} bonus={ctx.org.referralBonus == null ? null : Number(ctx.org.referralBonus)} minHours={ctx.org.referralMinHours} isAdmin={ctx.role === 'OWNER' || ctx.role === 'ADMIN'} canEdit={canEdit(ctx)} />
    </>
  );
}
