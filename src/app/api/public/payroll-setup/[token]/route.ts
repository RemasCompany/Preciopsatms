import { workerSetupUrl } from '@/lib/payroll-provider';
import { captureError } from '@/lib/monitoring';

type Ctx = { params: { token: string } };
const page = (title: string, text: string, status: number) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.3rem">${title}</h1><p>${text}</p></body>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
);

/** A worker's payroll setup link: sends them on to a fresh, one-time Check onboarding page. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const url = await workerSetupUrl(params.token);
    if (!url) return page('This link has expired', 'Ask the office to send you a new payroll setup link.', 404);
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (e) {
    await captureError(e, { route: '/api/public/payroll-setup', method: 'GET' });
    return page('Payroll setup isn’t available right now', 'Please try the link again in a few minutes.', 502);
  }
}
