import Link from 'next/link';

const TABS = [
  ['/app/credentials', 'Credentials'],
  ['/app/credentials/requirements', 'Job requirements'],
  ['/app/credentials/exclusions', 'Exclusion screening'],
  ['/app/credentials/checklists', 'Skills checklists'],
] as const;

/** Tabs across the credential pages. */
export default function CredentialTabs({ at }: { at: (typeof TABS)[number][0] }) {
  return <nav className="tabs" aria-label="Credentials" style={{ margin: '4px 0 14px' }}>{TABS.map(([href, label]) => <Link key={href} href={href} className={`btn sm ${href === at ? 'on' : 'ghost'}`} aria-current={href === at ? 'page' : undefined}>{label}</Link>)}</nav>;
}
