import Link from 'next/link';

/** Shown in place of a page whose feature isn't in the org's plan, or that the company switched off. */
export default function Gate({ title, feature, off }: { title: string; feature: string; off?: boolean }) {
  return (
    <>
      <h1>{title}</h1>
      {off
        ? <div className="card empty"><b>{feature} is turned off for your company</b>An admin can turn it on in <Link href="/app/settings">Settings & data</Link>. Your earlier records are kept.</div>
        : <div className="card empty"><b>{feature} isn’t included in your plan</b>Upgrade to unlock it. <Link href="/app/billing">See plans</Link></div>}
    </>
  );
}
