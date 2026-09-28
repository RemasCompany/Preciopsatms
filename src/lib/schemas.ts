import { z } from 'zod';

export const JobInput = z.object({
  title: z.string().min(2).max(160),
  clientId: z.string().optional().nullable(),
  sector: z.string().max(60).optional(),
  location: z.string().max(120).optional(),
  type: z.enum(['CONTRACT', 'CONTRACT_TO_HIRE', 'DIRECT_HIRE', 'TEMP', 'PER_DIEM']).default('CONTRACT'),
  openings: z.coerce.number().int().min(1).max(999).default(1),
  payRate: z.coerce.number().min(0).optional(),
  billRate: z.coerce.number().min(0).optional(),
  hot: z.boolean().optional(),
  startDate: z.coerce.date().optional(),
  skills: z.array(z.string().max(60)).max(40).default([]),
  description: z.string().max(20000).optional(),
  applyUrl: z.string().url().optional().or(z.literal('')),
  publish: z.boolean().default(true),
});
