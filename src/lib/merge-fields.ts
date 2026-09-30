import type { Client, Job } from '@prisma/client';

/** Merge fields for documents about a job (offer letters, assignment confirmations). */
export function jobMergeFields(job: (Job & { client: Client | null }) | null, startDate?: Date | null) {
  const start = startDate ?? job?.startDate ?? null;
  return {
    job_title: job?.title, client: job?.client?.name, job_location: job?.location ?? undefined,
    start_date: start ? start.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }) : undefined,
    pay_rate: job?.payRate ? `$${job.payRate} per hour` : undefined, job_type: job?.type.toLowerCase().replace(/_/g, '-'),
  };
}
