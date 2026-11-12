import { z } from 'zod';
import { requireApiContext, withApi } from '@/lib/tenant';
import { RuleBody, saveRule, setRuleActive } from '@/lib/differentials-server';

type Ctx = { params: { id: string } };

/** Change a differential, or just turn it on or off. Timesheets already entered keep the amounts they were saved with. */
export const PATCH = withApi(async (req: Request, { params }: Ctx) => {
  const ctx = await requireApiContext({ minRole: 'ADMIN', feature: 'timesheets', write: true });
  const raw = await req.json().catch(() => null);
  const toggle = z.object({ active: z.boolean() }).strict().safeParse(raw);
  if (toggle.success) { await setRuleActive(ctx, params.id, toggle.data.active); return Response.json({ ok: true }); }
  const b = RuleBody.safeParse(raw);
  if (!b.success) return Response.json({ error: b.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  await saveRule(ctx, b.data, params.id);
  return Response.json({ ok: true });
});
