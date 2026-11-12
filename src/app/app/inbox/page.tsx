import { requirePageContext, canEdit } from '@/lib/tenant';
import { hasFeature } from '@/lib/plans';
import { threads } from '@/lib/sms-inbox';
import Inbox from '@/components/Inbox';
import Gate from '@/components/Gate';
import NewMessage from '@/components/NewMessage';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const ctx = await requirePageContext();
  if (!hasFeature(ctx.org, 'messaging')) return <Gate title="Inbox" feature="Two-way texting" />;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
        <h1 style={{ margin: 0 }}>Inbox</h1>
        {canEdit(ctx) && ctx.role !== 'VIEWER' && <NewMessage />}
      </div>
      <p className="lede">Texts from workers, candidates and clients, and your replies. STOP and START are handled automatically. Use New message to email or text anyone.</p>
      <Inbox initial={await threads(ctx.tdb)} canEdit={canEdit(ctx) && ctx.role !== 'VIEWER'} />
    </>
  );
}
