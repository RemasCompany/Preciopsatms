// Node-only startup checks (kept out of the edge bundle).
import { rlsReport } from './lib/config-check';
import { db } from './lib/db';
import { TENANT_MODELS } from './lib/tenant';

export async function checkRls() {
  try {
    for (const p of await rlsReport((sql) => db.$queryRawUnsafe(sql), [...TENANT_MODELS])) console.error(`[security] ${p}`);
  } catch (e) {
    console.warn('[security] Couldn’t check row-level security:', (e as Error).message);
  }
}
