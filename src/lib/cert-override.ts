// Browser helper: when a placement or shift is stopped for a missing certification and the signed-in user is an
// owner or admin, ask for the override reason and send the request once more with it.

export async function withCertOverride(send: (override?: string) => Promise<Response>): Promise<Response> {
  const res = await send();
  if (res.status !== 409) return res;
  const j = await res.clone().json().catch(() => ({}));
  if (!j.certOverride || !j.canOverride) return res;
  const why = window.prompt(`${j.error}\n\nWhy is it OK to go ahead? This is saved in the audit log.`);
  return why?.trim() ? send(why.trim()) : res;
}

/** fetch() + JSON, with the override prompt. Throws an Error carrying the server's friendly message. */
export async function jsonWithOverride(url: string, method: string, body: Record<string, unknown>) {
  const res = await withCertOverride((override) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(override ? { ...body, override } : body) }));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}
