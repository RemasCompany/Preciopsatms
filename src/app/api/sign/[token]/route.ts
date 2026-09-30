import { z } from 'zod';
import { db } from '@/lib/db';
import { sha256 } from '@/lib/tokens';
import { renderSignedPdf } from '@/lib/pdf';
import { putFile } from '@/lib/storage';
import { sendEmail } from '@/lib/email';
import { markSigned } from '@/lib/onboarding-server';

const Body = z.object({
  name: z.string().min(2).max(120),
  signature: z.string().startsWith('data:image/png;base64,').max(300_000),
  consent: z.literal(true),
});

async function findDoc(token: string) {
  const doc = await db.signDocument.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: true } });
  if (!doc || doc.status !== 'SENT' || !doc.tokenExpiresAt || doc.tokenExpiresAt < new Date()) return null;
  if (doc.bodySha256 && doc.bodySha256 !== sha256(doc.body)) return null; // text changed after sending: refuse
  return doc;
}

/** Public: fetch the document for the signing page. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const doc = await findDoc(params.token);
  if (!doc) return Response.json({ error: 'This signing link is invalid, expired or already used.' }, { status: 404 });
  const audit = [...(doc.audit as object[]), { at: new Date().toISOString(), event: 'viewed' }];
  await db.signDocument.update({ where: { id: doc.id }, data: { audit } });
  return Response.json({ title: doc.title, body: doc.body, signerName: doc.signerName, company: doc.organization.name, brandColor: doc.organization.brandColor });
}

/** Public: sign. Records name, drawn signature, consent, IP, user agent, time and the SHA-256 of the exact text. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const doc = await findDoc(params.token);
  if (!doc) return Response.json({ error: 'This signing link is invalid, expired or already used.' }, { status: 404 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Type your full name, draw your signature and check the consent box.' }, { status: 400 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const ua = req.headers.get('user-agent')?.slice(0, 300) ?? null;
  const at = new Date();
  const audit = [...(doc.audit as object[]), { at: at.toISOString(), event: 'signed', name: parsed.data.name, ip, ua, consent: 'Agreed to use electronic records and signatures (ESIGN/UETA)' }];
  const signed = { ...doc, status: 'SIGNED' as const, signerName: parsed.data.name, signerSignature: parsed.data.signature, signedAt: at, signerIp: ip, signerUserAgent: ua, audit };
  const pdf = await renderSignedPdf(signed);
  const file = await putFile(doc.organizationId, `${doc.title}.pdf`, 'application/pdf', Buffer.from(pdf));

  await db.signDocument.update({
    where: { id: doc.id },
    data: { status: 'SIGNED', tokenHash: null, signerName: parsed.data.name, signerSignature: parsed.data.signature, signedAt: at, signerIp: ip, signerUserAgent: ua, audit, pdfFileId: file.id },
  });
  await db.activity.create({ data: { organizationId: doc.organizationId, text: `${parsed.data.name} signed ${doc.title}` } });
  await markSigned(doc.organizationId, doc.id);
  // The signature is recorded; the copies below are courtesy emails, so a delivery failure must not fail the signing.
  const attach = [{ filename: `${doc.title}.pdf`, content: Buffer.from(pdf) }];
  await sendEmail({ to: doc.signerEmail, fromName: doc.organization.shortName ?? doc.organization.name, replyTo: doc.organization.applyEmail ?? undefined, subject: `Signed copy: ${doc.title}`, text: `Thank you for signing. Your copy is attached.\n\n${doc.organization.name}`, attachments: attach })
    .catch((e) => console.error('[sign] signer copy email failed', e));
  if (doc.organization.applyEmail) await sendEmail({ to: doc.organization.applyEmail, subject: `Signed: ${doc.title}`, text: `${parsed.data.name} signed "${doc.title}". The signed PDF with audit trail is attached. Countersign it in Preciops if required.`, attachments: attach })
    .catch((e) => console.error('[sign] company copy email failed', e));
  return Response.json({ ok: true });
}
