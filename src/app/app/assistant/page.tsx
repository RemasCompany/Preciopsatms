import Link from 'next/link';
import { requirePageContext } from '@/lib/tenant';
import { hasFeature, PLANS } from '@/lib/plans';
import Assistant from '@/components/Assistant';
import { ASSISTANT_NAME } from '@/lib/assistant-name';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const ctx = await requirePageContext();
  const { org, role } = ctx;
  const admin = role === 'OWNER' || role === 'ADMIN';
  return (
    <>
      <h1>{ASSISTANT_NAME}</h1>
      <p className="lede">Ask about your jobs, pipeline, placements, hours, schedules and deadlines. Answers come from your company’s data; workers are shown as “Worker 1”, and names, contact details and EEO data are never sent to the AI.</p>
      {!hasFeature(org, 'ai') ? <p className="card">{ASSISTANT_NAME} is included in the Growth and Enterprise plans. <Link href="/app/billing">See plans</Link></p>
        : role === 'VIEWER' ? <p className="card">Viewers can’t use {ASSISTANT_NAME}. Ask an admin to change your role.</p>
        : <Assistant admin={admin} credits={Math.max(0, PLANS[org.plan].monthlyAiCredits - org.aiCreditsUsed)} />}
    </>
  );
}
