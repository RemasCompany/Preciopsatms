import { resolveWorkerLink } from '@/lib/schedule-server';
import { employeeAction } from '@/lib/self-service';
import { limited } from '@/lib/rate-limit';
import { HttpError } from '@/lib/tenant';

const gone = () => Response.json({ error: 'This link has expired. Ask your manager to send it again.' }, { status: 404 });

/** An employee's own actions: ask for or withdraw time off, update contact details. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await limited('me', params.token.slice(0, 20), 30, 600e3)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const link = await resolveWorkerLink(params.token);
  if (!link) return gone();
  try { return Response.json(await employeeAction(link, await req.json().catch(() => null))); }
  catch (e) { if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
}
