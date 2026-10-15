// Labels and formatting for employee screens (safe to import in the browser).
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'SEASONAL', 'TEMP', 'PER_DIEM', 'CONTRACT'] as const;
export const TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', SEASONAL: 'Seasonal', TEMP: 'Temp', PER_DIEM: 'Per diem', CONTRACT: 'Contract', CONTRACT_TO_HIRE: 'Contract-to-hire', DIRECT_HIRE: 'Full-time' };
export const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', ON_LEAVE: 'On leave', TERMINATED: 'Former' };
export const money = (n: number, t: 'HOURLY' | 'SALARY') => (t === 'SALARY' ? `$${Math.round(n).toLocaleString('en-US')}/yr` : `$${n.toFixed(2)}/hr`);
export const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
