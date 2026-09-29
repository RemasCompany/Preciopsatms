'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export type NavGroup = [group: string, items: [href: string, label: string][]];

// Bottom tab bar on phones: the screens recruiters use most, then "Menu" for everything else.
const TABS: [string, string, string][] = [
  ['/app', 'Home', 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  ['/app/pipeline', 'Pipeline', 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z'],
  ['/app/candidates', 'Candidates', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0'],
  ['/app/jobs', 'Jobs', 'M4 8h16v11H4zM9 8V5h6v3'],
  ['/app/tasks', 'Tasks', 'M5 12l4 4 10-10'],
];

const isActive = (path: string, href: string) => (href === '/app' ? path === '/app' : path === href || path.startsWith(`${href}/`));

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

/** Sidebar on desktop; top bar + full-screen menu + bottom tabs on phones. */
export default function AppNav({ groups, company }: { groups: NavGroup[]; company: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.classList.toggle('menu-open', open);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const current = groups.flatMap(([, items]) => items).find(([href]) => isActive(path, href))?.[1] ?? 'Preciops';
  const links = groups.map(([group, items]) => (
    <div key={group} className="navgroup"><span>{group}</span>
      {items.map(([href, label]) => <Link key={href} href={href} aria-current={isActive(path, href) ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</Link>)}
    </div>
  ));
  const tabs = TABS.filter(([href]) => groups.some(([, items]) => items.some(([h]) => h === href)));

  return (
    <>
      <nav className="side" aria-label="Main">
        <b>Preciops ATMS<small>{company}</small></b>
        {links}
      </nav>
      <header className="topbar">
        <button className="iconbtn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="mobile-menu">
          <Icon d="M4 7h16M4 12h16M4 17h16" />
        </button>
        <span className="topbar-title"><b>{current}</b><small>{company}</small></span>
      </header>
      {open && (
        <div id="mobile-menu" className="mobilemenu" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="mobilemenu-head"><b>Preciops ATMS<small>{company}</small></b>
            <button className="iconbtn" onClick={() => setOpen(false)} aria-label="Close menu"><Icon d="M6 6l12 12M18 6L6 18" /></button></div>
          {links}
        </div>
      )}
      <nav className="tabbar" aria-label="Quick">
        {tabs.map(([href, label, d]) => (
          <Link key={href} href={href} aria-current={isActive(path, href) ? 'page' : undefined}><Icon d={d} /><span>{label}</span></Link>
        ))}
        <button onClick={() => setOpen(true)} aria-label="More"><Icon d="M5 12h.01M12 12h.01M19 12h.01" /><span>More</span></button>
      </nav>
    </>
  );
}
