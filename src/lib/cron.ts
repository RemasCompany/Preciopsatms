import { timingSafeEqual } from 'crypto';
import { captureError } from './monitoring';

/** A scheduled job endpoint: checks CRON_SECRET (Vercel Cron sends it as a Bearer token) and reports failures. */
export function cronRoute(name: string, run: () => Promise<unknown>) {
  return async function GET(req: Request) {
    const secret = process.env.CRON_SECRET;
    const given = Buffer.from(req.headers.get('authorization') ?? '');
    const want = Buffer.from(`Bearer ${secret ?? ''}`);
    if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    try {
      return Response.json(await run());
    } catch (e) {
      await captureError(e, { route: `/api/cron/${name}`, method: 'GET', tags: { cron: name } });
      return Response.json({ error: 'The job failed. It has been reported.' }, { status: 500 });
    }
  };
}
