import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { threads } from '@/lib/sms-inbox';
import Inbox from '@/components/Inbox';
import Gate from '@/components/Gate';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'messaging')) return <Gate title="Inbox" feature="Two-way texting" />;
  return (
    <>
      <h1>Inbox</h1>
      <p className="lede">Texts from workers, candidates and clients, and your replies. STOP and START are handled automatically.</p>
      <Inbox initial={await threads(ctx.tdb)} canEdit={canEdit(ctx) && ctx.role !== 'VIEWER'} />
    </>
  );
}
