'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecords } from './Records';
import { DEAL_STAGES, type DealStage } from '@/lib/deals';

export type BoardDeal = { id: string; title: string; client: string | null; value: number | null; stage: string; closeDate: string | null };
// Column colours follow the prototype: prospect → negotiation run cool to amber, won teal, lost red.
const COLOR: Record<DealStage, string> = { Prospect: 'var(--s1)', Qualified: 'var(--s3)', Proposal: 'var(--s4)', Negotiation: 'var(--s5)', Won: 'var(--s6)', Lost: 'var(--s7)' };
const money = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function DealsBoard({ deals: initial }: { deals: BoardDeal[] }) {
  const router = useRouter();
  const { open, toast, canEdit } = useRecords();
  const [deals, setDeals] = useState(initial);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => setDeals(initial), [initial]);

  async function move(d: BoardDeal, stage: DealStage) {
    if (!canEdit || d.stage === stage) return;
    const before = deals;
    setDeals((xs) => xs.map((x) => (x.id === d.id ? { ...x, stage } : x)));
    const res = await fetch(`/api/records/deals/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
    if (!res.ok) { setDeals(before); toast((await res.json().catch(() => ({}))).error ?? 'Could not move this deal. Try again.', true); return; }
    if (stage === 'Won') toast('Deal won — client marked active.');
    router.refresh();
  }
  function onKey(e: React.KeyboardEvent, d: BoardDeal) {
    if (e.key === 'Enter') { open('deals', d.id); return; }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = DEAL_STAGES.indexOf(d.stage as DealStage) + (e.key === 'ArrowRight' ? 1 : -1);
    if (i >= 0 && i < DEAL_STAGES.length) move(d, DEAL_STAGES[i]);
  }

  return (
    <div className="board" role="list" aria-label="Deal stages">
      {DEAL_STAGES.map((s) => {
        const items = deals.filter((d) => d.stage === s);
        return (
          <section key={s} role="listitem" aria-label={`${s}, ${items.length}`} className={`col${over === s ? ' over' : ''}`} style={{ '--c': COLOR[s] } as React.CSSProperties}
            onDragOver={(e) => { if (!canEdit) return; e.preventDefault(); setOver(s); }}
            onDragLeave={() => setOver((o) => (o === s ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const d = deals.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (d) move(d, s); }}>
            <h3><span>{s}</span><small>{items.length}</small></h3>
            {items.map((d) => (
              <div key={d.id} className="cardk" tabIndex={0} draggable={canEdit}
                aria-label={`${d.title}, ${money(d.value)}. Enter opens the deal${canEdit ? '; left and right arrow keys change stage' : ''}.`}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; }}
                onKeyDown={(e) => onKey(e, d)} onClick={() => open('deals', d.id)}>
                <b>{d.title}</b>
                <span className="muted">{d.client ?? 'No client'}</span>
                <div className="meta"><span>{money(d.value)}</span><span>{d.closeDate ? fmt(d.closeDate) : ''}</span></div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
