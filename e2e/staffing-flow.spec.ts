import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';

// Loads DATABASE_URL etc. when run locally (CI sets them directly).
if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

/**
 * The core loop of a staffing desk, through the browser:
 * sign up → (checkout) → create a job → a candidate applies on the careers page → move to Placed → enter hours → export payroll.
 */
const run = Date.now().toString(36);
const company = `E2E Staffing ${run}`;
const owner = { name: 'Erin Owner', email: `owner-${run}@e2e.example.com`, password: 'e2e-password-123' };
const applicant = { name: `Casey Applicant ${run}`, email: `casey-${run}@e2e.example.com` };
const jobTitle = `Forklift Operator ${run}`;

test.describe.configure({ mode: 'serial' });
let page: Page;
const db = new PrismaClient();

test.beforeAll(async ({ browser }) => { page = await browser.newPage(); });
test.afterAll(async () => {
  // Clean up everything this run created.
  await db.organization.deleteMany({ where: { name: company } });
  await db.user.deleteMany({ where: { email: owner.email } });
  await db.$disconnect();
});

test('sign up and land in the app', async () => {
  await page.goto('/signup');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Company name').fill(company);
  await page.getByLabel('Your name').fill(owner.name);
  await page.getByLabel('Work email').fill(owner.email);
  await page.getByLabel('Password (10+ characters)').fill(owner.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/app/billing?welcome=1');
  await expect(page.getByText('Please confirm your email address')).toBeVisible();
});

test('choose a plan', async () => {
  const org = await db.organization.findFirstOrThrow({ where: { name: company } });
  if (/^sk_test_\w{20,}$/.test(process.env.STRIPE_SECRET_KEY ?? '') && /^price_\w{8,}$/.test(process.env.STRIPE_PRICE_GROWTH ?? '')) {
    // Stripe test mode: the plan button goes to Stripe Checkout.
    await page.getByRole('button', { name: 'Choose Growth' }).click();
    await page.waitForURL(/checkout\.stripe\.com/);
    await page.goto('/app/billing');
  }
  // Stand in for Stripe's webhook (completing hosted checkout isn't automatable): the company is now on Growth.
  await db.organization.update({ where: { id: org.id }, data: { plan: 'growth', subscriptionStatus: 'active' } });
});

test('create a temp job that shows on the careers page', async () => {
  await page.goto('/app/jobs');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ Add job' }).click();
  const d = page.locator('dialog[open]');
  await d.getByLabel('Job title').fill(jobTitle);
  await d.getByLabel('Location (City, ST)').fill('Orlando, FL');
  await d.getByLabel('Employment type').selectOption('TEMP');
  await d.getByLabel('Pay rate ($/hr)').fill('20');
  await d.getByLabel('Bill rate ($/hr)').fill('30');
  await d.getByRole('button', { name: 'Add job' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(jobTitle)).toBeVisible();
});

test('a candidate applies on the careers page', async ({ browser }) => {
  const org = await db.organization.findFirstOrThrow({ where: { name: company } });
  const visitor = await browser.newPage(); // not signed in
  await visitor.goto(`/careers/${org.slug}`);
  await visitor.getByRole('link', { name: new RegExp(jobTitle) }).click();
  await visitor.waitForLoadState('networkidle');
  await visitor.getByLabel('Full name').fill(applicant.name);
  await visitor.getByLabel('Email').fill(applicant.email);
  await visitor.getByLabel('Phone').fill('4075550199');
  await visitor.getByRole('button', { name: 'Submit application' }).click();
  await expect(visitor.getByText('Application received')).toBeVisible();
  await visitor.close();
});

test('move the applicant to Placed on the pipeline', async () => {
  await page.goto('/app/pipeline');
  await page.waitForLoadState('networkidle');
  // Keyboard moves: each → arrow moves the card one stage right (Applied → … → Placed).
  const card = () => page.getByLabel(new RegExp(`^${applicant.name}, ${jobTitle}`));
  const stages = ['Sourced', 'Screened', 'Submitted', 'Interview', 'Offer', 'Placed'];
  for (const s of stages) {
    await card().press('ArrowRight');
    await expect(page.getByRole('listitem', { name: new RegExp(`^${s}, 1`) })).toContainText(applicant.name);
  }
  await expect(page.locator('.toast')).toBeVisible(); // "placed", or a heads-up about onboarding or credentials
  await expect(page.getByRole('listitem', { name: /^Placed, 1/ })).toContainText(applicant.name);
  await page.reload();
  await expect(page.getByRole('listitem', { name: /^Placed, 1/ })).toContainText(applicant.name);
});

test('enter hours, approve, and export payroll', async () => {
  await page.goto('/app/timesheets');
  await page.waitForLoadState('networkidle');
  const reg = page.getByLabel(`Regular hours for ${applicant.name}`);
  await reg.fill('40');
  await page.getByLabel(`Overtime hours for ${applicant.name}`).fill('5');
  await page.getByLabel(`Overtime hours for ${applicant.name}`).press('Enter');
  // 40 × $20 + 5 × $20 × 1.5 = $950 gross; 40 × $30 + 5 × $30 × 1.5 = $1,425 billable.
  const row = page.getByRole('row', { name: new RegExp(applicant.name) });
  await expect(row).toContainText('$950.00');
  await expect(row).toContainText('$1,425.00');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(row).toContainText('Approved');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export payroll' }).click();
  const file = await download;
  const csv = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  const line = csv.split(/\r?\n/).find((l) => l.includes(applicant.name));
  expect(line, 'the worker is in the payroll export').toBeTruthy();
  expect(line).toContain('40');
  expect(line).toContain('950');
});
