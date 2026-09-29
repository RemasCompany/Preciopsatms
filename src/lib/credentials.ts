// Candidate credentials for healthcare staffing: licenses, certifications, health records and screenings.
// Shared by the UI and the server — keep this file free of server imports.

export type CredentialGroup = 'License' | 'Certification' | 'Health' | 'Screening' | 'Other';
type TypeSpec = { group: CredentialGroup; number?: boolean; state?: boolean; expires?: boolean };

/** Credential types. `number`/`state` mark what a verifier needs; `expires` marks ones that must carry an expiration date. */
export const CREDENTIAL_TYPES: Record<string, TypeSpec> = {
  'RN license': { group: 'License', number: true, state: true, expires: true },
  'LPN / LVN license': { group: 'License', number: true, state: true, expires: true },
  'APRN / NP license': { group: 'License', number: true, state: true, expires: true },
  'PA license': { group: 'License', number: true, state: true, expires: true },
  'MD / DO license': { group: 'License', number: true, state: true, expires: true },
  'Pharmacist license': { group: 'License', number: true, state: true, expires: true },
  'Respiratory therapist license': { group: 'License', number: true, state: true, expires: true },
  'Physical therapist license': { group: 'License', number: true, state: true, expires: true },
  'CNA certification': { group: 'Certification', number: true, state: true, expires: true },
  'Compact (multistate) nursing license': { group: 'License', number: true, state: true, expires: true },
  NPI: { group: 'License', number: true },
  'DEA registration': { group: 'License', number: true, expires: true },
  BLS: { group: 'Certification', expires: true },
  ACLS: { group: 'Certification', expires: true },
  PALS: { group: 'Certification', expires: true },
  NRP: { group: 'Certification', expires: true },
  TNCC: { group: 'Certification', expires: true },
  'Specialty certification': { group: 'Certification', number: true, expires: true },
  'TB test': { group: 'Health', expires: true },
  'Flu vaccine': { group: 'Health', expires: true },
  'COVID-19 vaccine': { group: 'Health' },
  'Hepatitis B': { group: 'Health' },
  'MMR / varicella titers': { group: 'Health' },
  'Physical exam': { group: 'Health', expires: true },
  'Drug screen': { group: 'Screening', expires: true },
  'Background check': { group: 'Screening', expires: true },
  'OIG / SAM exclusion check': { group: 'Screening', expires: true },
  Other: { group: 'Other' },
};
export const CREDENTIAL_TYPE_NAMES = Object.keys(CREDENTIAL_TYPES);
export const typeSpec = (t: string): TypeSpec => CREDENTIAL_TYPES[t] ?? CREDENTIAL_TYPES.Other;

export const VERIFY_METHODS = [
  'State board website (primary source)', 'Nursys QuickConfirm', 'NPPES NPI registry', 'Issuing organization (e.g. AHA eCard)',
  'Original document reviewed', 'Lab or vendor report', 'Other',
] as const;

/** Where a recruiter can check a credential at the primary source. */
export function lookupLinks(type: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if (/RN|LPN|APRN|Compact|CNA/.test(type)) out.push({ label: 'Nursys QuickConfirm', url: 'https://www.nursys.com/LQC/LQCTerms.aspx' });
  if (type === 'NPI') out.push({ label: 'NPPES NPI registry', url: 'https://npiregistry.cms.hhs.gov/search' });
  if (['BLS', 'ACLS', 'PALS'].includes(type)) out.push({ label: 'AHA eCard lookup', url: 'https://ecards.heart.org/student/myecards' });
  if (type === 'OIG / SAM exclusion check') out.push({ label: 'OIG exclusions', url: 'https://exclusions.oig.hhs.gov/' }, { label: 'SAM.gov', url: 'https://sam.gov/search/?index=ex' });
  return out;
}

/** Days before expiration when recruiters are alerted; 0 means "has expired". */
export const ALERT_WINDOWS = [60, 30, 7] as const;
export const SOON_DAYS = 30;

export type CredentialLike = {
  type: string; number?: string | null; state?: string | null; expiresAt: string | null; verifiedAt: string | null;
};
export type CredentialState = 'expired' | 'expiring' | 'unverified' | 'incomplete' | 'current';

const DAY = 864e5;
export const todayUtc = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
export const daysUntil = (ymd: string | null, now = new Date()) =>
  ymd ? Math.round((Date.parse(`${ymd}T00:00:00Z`) - todayUtc(now)) / DAY) : null;
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Where a credential stands, worst problem first, with the text recruiters see. */
export function credentialStatus(c: CredentialLike, now = new Date()): { state: CredentialState; days: number | null; text: string; level: 'warn' | 'soon' | 'ok' } {
  const days = daysUntil(c.expiresAt, now);
  const spec = typeSpec(c.type);
  if (days !== null && days < 0) return { state: 'expired', days, text: `Expired ${fmt(c.expiresAt!)}`, level: 'warn' };
  if (days !== null && days <= SOON_DAYS) return { state: 'expiring', days, text: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`, level: 'soon' };
  const missing = [spec.number && !c.number && 'number', spec.state && !c.state && 'state', spec.expires && !c.expiresAt && 'expiration date'].filter(Boolean);
  if (missing.length) return { state: 'incomplete', days, text: `Add ${missing.join(', ')}`, level: 'warn' };
  if (!c.verifiedAt) return { state: 'unverified', days, text: 'Not verified', level: 'soon' };
  return { state: 'current', days, text: c.expiresAt ? `Verified · expires ${fmt(c.expiresAt)}` : 'Verified', level: 'ok' };
}

/** The alert window a credential is in now: 60/30/7 days out, 0 once expired, null when not yet due. */
export function alertWindow(expiresAt: string | null, now = new Date()): number | null {
  const d = daysUntil(expiresAt, now);
  if (d === null) return null;
  if (d < 0) return 0;
  const w = [...ALERT_WINDOWS].sort((a, b) => a - b).find((x) => d <= x);
  return w ?? null;
}

/** Whether a credential crossed into a new (smaller) alert window since the last email. */
export function alertDue(c: { expiresAt: string | null; alertedLevel: number | null }, now = new Date()) {
  const w = alertWindow(c.expiresAt, now);
  return w !== null && (c.alertedLevel === null || w < c.alertedLevel) ? w : null;
}

/** Problems that should stop (or at least flag) a placement. */
export function placementIssues(creds: (CredentialLike & { label: string })[], now = new Date()) {
  return creds.map((c) => ({ c, s: credentialStatus(c, now) })).filter(({ s }) => s.state === 'expired' || s.state === 'unverified' || s.state === 'incomplete')
    .map(({ c, s }) => `${c.label}: ${s.text[0].toLowerCase()}${s.text.slice(1)}`);
}

export const credentialLabel = (c: { type: string; name?: string | null; state?: string | null }) =>
  [c.type === 'Other' || c.type === 'Specialty certification' ? c.name || c.type : c.name ? `${c.type} (${c.name})` : c.type, c.state].filter(Boolean).join(' · ');
