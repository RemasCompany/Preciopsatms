import type { Invoice, Organization } from '@prisma/client';
import { stripeEnabled } from './stripe';
import { newToken } from './tokens';
import type { TenantDb } from './tenant';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';
/** An invoice's private Pay online page. Anyone with the link can see the invoice summary and pay it, nothing else. */
export const payUrl = (token: string) => `${appUrl()}/pay/${token}`;

type PayOrg = Pick<Organization, 'stripeConnectAccountId' | 'stripeConnectReady' | 'onlinePayments'>;
/** Online payment is switched on and the firm's Stripe account can take it. */
export const acceptsOnline = (org: PayOrg) => stripeEnabled() && !!org.stripeConnectAccountId && org.stripeConnectReady && org.onlinePayments;

/** The invoice's payment link token, made the first time it's needed. */
export async function ensurePayToken(tdb: TenantDb, inv: Pick<Invoice, 'id' | 'payToken'>) {
  if (inv.payToken) return inv.payToken;
  await tdb.invoice.updateMany({ where: { id: inv.id, payToken: null }, data: { payToken: newToken() } });
  const now = await tdb.invoice.findFirst({ where: { id: inv.id }, select: { payToken: true } });
  if (!now?.payToken) throw new Error('payment link was not saved');
  return now.payToken;
}
