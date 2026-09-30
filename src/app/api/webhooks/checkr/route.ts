import { applyEvent, verifySignature } from '@/lib/checkr';
import { captureError } from '@/lib/monitoring';

/** Checkr webhook (set https://<your-app>/api/webhooks/checkr in the Checkr dashboard). Signed with the API key. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get('x-checkr-signature'))) return Response.json({ error: 'Bad signature' }, { status: 401 });
  try {
    const r = await applyEvent(JSON.parse(raw));
    return Response.json({ ok: true, applied: !!r });
  } catch (e) {
    await captureError(e, { route: '/api/webhooks/checkr', method: 'POST' });
    return Response.json({ error: 'Failed' }, { status: 500 }); // Checkr retries
  }
}
