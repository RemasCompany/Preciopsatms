'use client';
import { useEffect } from 'react';

/** The home page's phone menu and its agency/employer pricing tabs. */
export function LandingControls() {
  useEffect(() => {
    const toggle = document.getElementById('navToggle');
    const menu = document.getElementById('headerMenu');
    const offs: (() => void)[] = [];
    const on = (el: Element | null, fn: (e: Event) => void) => { if (!el) return; el.addEventListener('click', fn); offs.push(() => el.removeEventListener('click', fn)); };

    on(toggle, () => { const open = !!menu?.classList.toggle('lp-open'); toggle?.setAttribute('aria-expanded', String(open)); });
    on(menu, (e) => { if ((e.target as Element).closest('a')) { menu?.classList.remove('lp-open'); toggle?.setAttribute('aria-expanded', 'false'); } });

    const tabs = Array.from(document.querySelectorAll('.lp-pricing-toggle button'));
    const panels: Record<string, HTMLElement | null> = { agencies: document.getElementById('plans-agencies'), employers: document.getElementById('plans-employers') };
    const setAudience = (which: string | null) => {
      if (!which || !(which in panels)) return;
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.getAttribute('data-audience') === which)));
      Object.entries(panels).forEach(([k, p]) => { if (p) p.hidden = k !== which; });
    };
    tabs.forEach((t) => on(t, () => setAudience(t.getAttribute('data-audience'))));
    document.querySelectorAll('[data-goto-pricing]').forEach((el) => on(el, () => setAudience(el.getAttribute('data-goto-pricing'))));
    return () => offs.forEach((off) => off());
  }, []);
  return null;
}
