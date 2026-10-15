import Link from 'next/link';

/** Shown in place of a page whose feature isn't in the org's plan, or that the company switched off. */
export default function Gate({ title, feature, off, employer }: { title: string; feature: string; off?: boolean; employer?: boolean }) {
  return (
    <>
      <h1>{title}</h1>
      {employer
        ? <div className="card empty"><b>{feature} is for staffing agencies</b>Your company is set up as an employer, so client and sales tools are hidden. An owner can change the company type in <Link href="/app/settings">Settings & data</Link>.</div>
        : off
        ? <div className="card empty"><b>{feature} is turned off for your company</b>An admin can turn it on in <Link href="/app/settings">Settings & data</Link>. Your earlier records are kept.</div>
        : <div className="card empty"><b>{feature} isn’t included in your plan</b>Upgrade to unlock it. <Link href="/app/billing">See plans</Link></div>}
    </>
  );
}
