'use client';
import { useEffect } from 'react';

/**
 * On phones, list tables are shown as stacked cards (see .tablewrap in globals.css). Each cell needs its column
 * name to label it, so this copies header text into data-label on every cell, and keeps doing so as rows change.
 */
export default function ResponsiveTables() {
  useEffect(() => {
    const label = () => {
      for (const table of document.querySelectorAll<HTMLTableElement>('.tablewrap table')) {
        const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
        for (const row of table.querySelectorAll('tbody tr')) {
          [...row.children].forEach((td, i) => { if (td.getAttribute('data-label') !== heads[i]) td.setAttribute('data-label', heads[i] ?? ''); });
        }
      }
    };
    label();
    const root = document.querySelector('.main') ?? document.body;
    const obs = new MutationObserver(label);
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return null;
}
