'use client';
import { usePathname, useSearchParams } from 'next/navigation';

/** Filters the app to one branch (or all). */
export default function BranchSwitcher({ branches, current }: { branches: { id: string; name: string }[]; current: string | null }) {
  const path = usePathname(), qs = useSearchParams().toString();
  return (
    <label className="branchsw"><span className="muted">Branch</span>
      <select value={current ?? 'all'} onChange={(e) => { window.location.href = `/api/branch?id=${encodeURIComponent(e.target.value)}&back=${encodeURIComponent(path + (qs ? `?${qs}` : ''))}`; }}>
        <option value="all">All branches</option>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}
