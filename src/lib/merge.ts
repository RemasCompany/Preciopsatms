// Merge fields for templates, messages and documents: {{first_name}}, {{job_title}}, {{my_company}} …
export const merge = (t: string, ctx: Record<string, string | undefined>) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => ctx[k] ?? m);

export function orgContext(org: { name: string; shortName: string | null; ownerName: string | null; ownerTitle: string | null; services: string | null; pitch: string | null }) {
  return {
    my_company: org.name, my_short: org.shortName ?? org.name, owner: org.ownerName ?? '', owner_title: org.ownerTitle ?? '',
    owner_first: (org.ownerName ?? '').split(' ')[0], services: org.services ?? '', pitch: org.pitch ?? '',
    signature: [org.ownerName, org.name].filter(Boolean).join('\n'),
  };
}
