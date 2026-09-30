import { cookies } from 'next/headers';
import { db } from './db';
import type { TenantDb } from './tenant';

export const BRANCH_COOKIE = 'preci_branch';

/**
 * The branch the app is filtered to: the switcher's choice (cookie), else the person's home branch.
 * "all" (or no branches) means no filter. Always validated against the company's own branches.
 */
export async function currentBranch(ctx: { tdb: TenantDb; org: { id: string }; user: { id: string } }) {
  const branches = await ctx.tdb.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  if (!branches.length) return { branches, branch: null };
  let pick: string | null | undefined;
  try { pick = cookies().get(BRANCH_COOKIE)?.value; } catch { pick = undefined; } // outside a request (tests)
  if (pick === undefined) pick = (await db.membership.findFirst({ where: { userId: ctx.user.id, organizationId: ctx.org.id }, select: { branchId: true } }))?.branchId ?? 'all';
  return { branches, branch: branches.find((b) => b.id === pick) ?? null };
}

/** Prisma filters for "in this branch". */
export const jobInBranch = (b: { id: string } | null) => (b ? { branchId: b.id } : {});
export const appInBranch = (b: { id: string } | null) => (b ? { job: { branchId: b.id } } : {});
/** A candidate is in a branch if they belong to it or are in the pipeline of one of its jobs. */
export const candidateInBranch = (b: { id: string } | null) => (b ? { OR: [{ branchId: b.id }, { applications: { some: { job: { branchId: b.id } } } }] } : {});
