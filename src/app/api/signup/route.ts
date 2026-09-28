import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import { withApi, HttpError } from '@/lib/tenant';

const Body = z.object({
  company: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10, 'Use at least 10 characters'),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'company';

export const POST = withApi(async (req: Request) => {
  const b = Body.parse(await req.json());
  const email = b.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new HttpError(409, 'An account with that email already exists');

  let slug = slugify(b.company);
  for (let i = 2; await db.organization.findUnique({ where: { slug } }); i++) slug = `${slugify(b.company)}-${i}`;

  const trialDays = Number(process.env.TRIAL_DAYS ?? 14);
  const customer = await stripe.customers.create({ email, name: b.company, metadata: { slug } });

  const org = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: b.company, shortName: b.company.replace(/,?\s*(LLC|Inc\.?|Corp\.?)$/i, ''), slug, ownerName: b.name, applyEmail: email,
        stripeCustomerId: customer.id, subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + trialDays * 864e5) },
    });
    const user = await tx.user.create({ data: { email, name: b.name, passwordHash: await bcrypt.hash(b.password, 12) } });
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'OWNER' } });
    return org;
  });
  return Response.json({ ok: true, slug: org.slug });
});
