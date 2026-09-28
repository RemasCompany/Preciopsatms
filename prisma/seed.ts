import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();

async function main() {
  const org = await db.organization.upsert({ where: { slug: 'demo-staffing' }, update: {}, create: {
    name: 'Demo Staffing, LLC', shortName: 'Demo Staffing', slug: 'demo-staffing', ownerName: 'Demo Owner', ownerTitle: 'President', city: 'Orlando, FL',
    services: 'light industrial, logistics and healthcare', plan: 'growth', subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 864e5), applyEmail: 'jobs@example.com' } });
  const user = await db.user.upsert({ where: { email: 'owner@example.com' }, update: {}, create: { email: 'owner@example.com', name: 'Demo Owner', passwordHash: await bcrypt.hash('change-me-please', 12) } });
  await db.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } }, update: {}, create: { userId: user.id, organizationId: org.id, role: 'OWNER' } });
  const client = await db.client.create({ data: { organizationId: org.id, name: 'Harbor Point Distribution', industry: 'Warehouse', city: 'Orlando, FL' } });
  await db.job.create({ data: { organizationId: org.id, clientId: client.id, title: 'Forklift Operator — 2nd shift', location: 'Orlando, FL', type: 'TEMP', openings: 4, payRate: 18.5, billRate: 27, hot: true, skills: ['Sit-down forklift', 'RF scanner'], description: 'Load and unload trailers, put-away and cycle counts.' } });
  console.log('Seeded. Sign in as owner@example.com / change-me-please');
}
main().finally(() => db.$disconnect());
