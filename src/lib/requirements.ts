// Which credential satisfies a job's requirement, accounting for where the work is. Pure (shared by the UI and server; tested).
import { typeSpec } from './credentials';

/** The two-letter state of a job's "City, ST" location, or null when it isn't given that way. */
export function workState(location: string | null | undefined) {
  const m = location?.trim().match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Nurse Licensure Compact states where a multistate RN or LPN/VN license lets someone work. Held conservatively to
 * states that have fully implemented the compact; a state that has only passed the law (e.g. Massachusetts, pending
 * implementation in 2027) isn't listed, so a compact license there needs a state license or an override.
 * Check https://www.nursys.com or ncsbn.org/compacts when a state's status changes.
 */
export const NLC_STATES = new Set([
  'AL', 'AZ', 'AR', 'CO', 'CT', 'DE', 'FL', 'GA', 'ID', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MS', 'MO', 'MT', 'NE', 'NH', 'NJ', 'NM',
  'NC', 'ND', 'OH', 'OK', 'PA', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'GU', 'VI',
]);
export const COMPACT_TYPE = 'Compact (multistate) nursing license';
/** License types a multistate nursing license can stand in for (the compact covers RNs and LPN/VNs, not APRNs). */
export const COMPACT_COVERS = new Set(['RN license', 'LPN / LVN license']);

/** Whether a credential type is issued per state (so it must match where the job is). */
export const isStateLicense = (type: string) => !!typeSpec(type).state && typeSpec(type).group === 'License';

type Held = { type: string; state: string | null };

/**
 * The credentials that can meet one requirement in `state`: the same type issued by that state, or for an RN or LPN
 * requirement in a compact state, a multistate license issued by a compact (home) state. With no state known, any
 * credential of the type counts.
 */
export function candidatesFor<T extends Held>(required: string, held: T[], state: string | null): T[] {
  const same = held.filter((c) => c.type === required);
  if (!state || !isStateLicense(required)) return same;
  const local = same.filter((c) => c.state === state);
  const compact = COMPACT_COVERS.has(required) && NLC_STATES.has(state)
    ? held.filter((c) => c.type === COMPACT_TYPE && !!c.state && NLC_STATES.has(c.state)) : [];
  return [...local, ...compact];
}

/** The gap text when nothing on file is valid where the job is. */
export function wrongStateText(required: string, held: Held[], state: string) {
  const other = [...new Set(held.filter((c) => c.type === required && c.state && c.state !== state).map((c) => c.state))];
  const compactOk = COMPACT_COVERS.has(required) && NLC_STATES.has(state);
  const compactHeld = COMPACT_COVERS.has(required) && held.some((c) => c.type === COMPACT_TYPE);
  const need = `needs a ${state} license${compactOk ? ' or a multistate (compact) license' : ''}`;
  if (other.length) return `${need} — only ${other.join(', ')} on file`;
  if (compactHeld && !compactOk) return `${need} — ${state} doesn’t accept multistate licenses`;
  return `${need}; none on file`;
}
