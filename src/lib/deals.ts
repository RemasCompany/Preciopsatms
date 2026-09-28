// Sales pipeline math, from the prototype's Deals view.
export const DEAL_STAGES = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const DEAL_PROBABILITY: Record<DealStage, number> = { Prospect: 0.1, Qualified: 0.25, Proposal: 0.5, Negotiation: 0.75, Won: 1, Lost: 0 };

const prob = (stage: string) => DEAL_PROBABILITY[stage as DealStage] ?? 0;
const isOpen = (stage: string) => stage !== 'Won' && stage !== 'Lost';

export function dealKpis(deals: { stage: string; value: number | null }[]) {
  const open = deals.filter((d) => isOpen(d.stage));
  const won = deals.filter((d) => d.stage === 'Won'), lost = deals.filter((d) => d.stage === 'Lost');
  const sum = (xs: { value: number | null }[]) => xs.reduce((s, d) => s + (d.value ?? 0), 0);
  return {
    open: sum(open),
    weighted: open.reduce((s, d) => s + (d.value ?? 0) * prob(d.stage), 0),
    won: sum(won),
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
  };
}
