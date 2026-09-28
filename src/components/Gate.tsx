import Link from 'next/link';

/** Shown in place of a page whose feature isn't in the org's plan. */
export default function Gate({ title, feature }: { title: string; feature: string }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="card empty"><b>{feature} isn’t included in your plan</b>Upgrade to unlock it. <Link href="/app/billing">See plans</Link></div>
    </>
  );
}
