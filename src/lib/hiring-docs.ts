// Hiring documents a candidate sends back: what can be asked for, which are sensitive, and the help shown to them.
// Shared by the UI and the server — keep this file free of server imports.

export type HiringDocDef = { label: string; hint: string; sensitive: boolean; maxFiles: number; link?: { href: string; text: string } };

/**
 * The Form I-9 entry deliberately lets the person choose their documents from the official lists: asking for specific
 * ones (say, a Social Security card) is "document abuse" under federal law. Copies help HR prepare; the originals are
 * still examined in person (or by an approved remote procedure).
 */
export const HIRING_DOCS = {
  i9_docs: {
    label: 'Identity and work authorization (Form I-9)', sensitive: true, maxFiles: 4,
    hint: 'Your choice of documents from the official lists: one from List A (such as a U.S. passport), or one from List B (such as a driver’s license) and one from List C (such as a birth certificate or Social Security card). Photos of the front and back are fine. Bring the originals on your first day.',
    link: { href: 'https://www.uscis.gov/i-9-central/form-i-9-acceptable-documents', text: 'See the lists of acceptable documents' },
  },
  w4: {
    label: 'Form W-4 (federal tax withholding)', sensitive: true, maxFiles: 2,
    hint: 'Fill in and sign the form, then send a PDF or a clear photo of each page.',
    link: { href: 'https://www.irs.gov/pub/irs-pdf/fw4.pdf', text: 'Download a blank Form W-4 from the IRS' },
  },
  state_tax: { label: 'State tax withholding form', sensitive: true, maxFiles: 2, hint: 'Your state’s withholding form, filled in and signed. Your recruiter can tell you which one.' },
  direct_deposit: { label: 'Direct deposit (voided check or bank letter)', sensitive: true, maxFiles: 2, hint: 'A voided check, or a letter or screenshot from your bank showing the routing and account numbers.' },
  certifications: { label: 'Licenses and certifications', sensitive: false, maxFiles: 5, hint: 'Any license or certificate the job needs (for example a forklift card or CPR card). Front and back if there’s anything on the back.' },
  diploma: { label: 'Diploma or transcript', sensitive: false, maxFiles: 3, hint: 'A copy is fine.' },
  references: { label: 'References', sensitive: false, maxFiles: 2, hint: 'Names and phone numbers or emails of two or three people who can speak to your work.' },
  resume: { label: 'Updated resume', sensitive: false, maxFiles: 1, hint: 'Your latest resume.' },
  other: { label: 'Other document', sensitive: false, maxFiles: 5, hint: '' },
} satisfies Record<string, HiringDocDef>;
export type HiringDocKind = keyof typeof HIRING_DOCS;
export const HIRING_DOC_KINDS = Object.keys(HIRING_DOCS) as HiringDocKind[];
export const isHiringDocKind = (k: unknown): k is HiringDocKind => typeof k === 'string' && k in HIRING_DOCS;

/** What's usually asked for with an offer letter. */
export const OFFER_DEFAULTS: HiringDocKind[] = ['i9_docs', 'w4', 'direct_deposit'];

export type DocStatus = 'REQUESTED' | 'RECEIVED' | 'ACCEPTED' | 'REJECTED';
export const DOC_STATUS: Record<DocStatus, { text: string; pill: '' | 'a' | 'g' | 'r' }> = {
  REQUESTED: { text: 'Waiting for it', pill: 'a' }, RECEIVED: { text: 'Received — review it', pill: 'a' }, ACCEPTED: { text: 'Accepted', pill: 'g' }, REJECTED: { text: 'Sent back', pill: 'r' },
};
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
