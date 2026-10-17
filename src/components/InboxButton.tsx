'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The inbox, always in reach at the top of the screen, with a badge for unread replies. While it's on screen it checks
 * for new ones every minute and when the tab comes back into focus, and shows the count in the browser tab's title.
 */
export default function InboxButton({ unread: initial, className = '' }: { unread: number; className?: string }) {
  const [unread, setUnread] = useState(initial);
  const ref = useRef<HTMLAnchorElement>(null);
  const path = usePathname();
  useEffect(() => setUnread(initial), [initial]);
  useEffect(() => {
    // The desktop and phone buttons share one count: whichever is on screen checks, and tells the other.
    const share = (e: Event) => setUnread((e as CustomEvent<number>).detail);
    const check = () => {
      if (!ref.current?.offsetParent || document.visibilityState !== 'visible') return; // hidden (other screen size) or tab in the background
      fetch('/api/inbox/unread').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && typeof j.unread === 'number') window.dispatchEvent(new CustomEvent('inbox-unread', { detail: j.unread })); }).catch(() => {});
    };
    const t = setInterval(check, 60_000);
    window.addEventListener('inbox-unread', share);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(t); window.removeEventListener('inbox-unread', share); document.removeEventListener('visibilitychange', check); };
  }, []);
  useEffect(() => {
    if (!ref.current?.offsetParent) return;
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = unread ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
  }, [unread, path]);
  const label = unread ? `Inbox, ${unread} unread` : 'Inbox';
  return (
    <Link ref={ref} href="/app/inbox" className={`inboxbtn ${className}`} aria-label={label} title={label} aria-current={path.startsWith('/app/inbox') ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13l2.5-7h11L20 13v6H4zM4 13h4.5l1 2h5l1-2H20" /></svg>
      <span className="inboxbtn-label">Inbox</span>
      {unread > 0 && <span className="inboxbadge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
