import type { SignDocument } from '@prisma/client';

export type AuditEntry = { at: string; event: string; [k: string]: unknown };

/** What the documents UI may see: never the signing token hash. */
export function publicDoc(d: SignDocument) {
  const { tokenHash: _t, ...rest } = d;
  return { ...rest, audit: (d.audit as AuditEntry[]) ?? [] };
}

export const DOC_TYPES = { offer: 'Offer letter', assignment: 'Assignment confirmation', vendor: 'Vendor subcontractor agreement', client: 'Staffing services agreement', custom: 'Custom document' } as const;
export type DocType = keyof typeof DOC_TYPES;
/** Which kind of record each template is written for. */
export const DOC_RELATED: Record<DocType, 'candidate' | 'vendor' | 'client' | null> = { offer: 'candidate', assignment: 'candidate', vendor: 'vendor', client: 'client', custom: null };
