import { PrismaClient } from '@prisma/client';
import { pickDatabaseUrls } from '../../scripts/db-url.mjs';

// The connection string may come under the host's own variable names or with stray quotes (see scripts/db-url.mjs).
const { runtime } = pickDatabaseUrls();
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'], ...(runtime ? { datasourceUrl: runtime } : {}) });
if (process.env.NODE_ENV !== 'production') g.prisma = db;
