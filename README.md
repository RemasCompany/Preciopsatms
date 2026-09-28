# Preciops ATMS

**Advanced Talent Management System.** Multi-tenant SaaS for staffing firms: applicant tracking, CRM and leads, careers pages and job-board feeds, timesheets with payroll export and invoicing, remote e-signatures, vendor compliance and EEO/OFCCP reporting — sold by subscription.

This repository is the production foundation. `docs/prototype.html` is the working single-file prototype (every screen, interaction and business rule) that the production UI is being ported from.

## Stack
Next.js 14 (App Router, TypeScript) · PostgreSQL + Prisma · NextAuth (credentials, JWT) · Stripe Billing · Resend (email) · Twilio (SMS) · S3/R2 (files) · Anthropic API (AI) · pdf-lib (PDFs)

## Run locally
```bash
cp .env.example .env            # fill in keys; Stripe/Resend/Twilio/S3 can stay blank for first boot
docker compose up -d            # Postgres
npm install
npx prisma migrate dev --name init
npm run db:seed                 # owner@example.com / change-me-please
npm run dev                     # http://localhost:3000
npm run stripe:listen           # separate terminal, forwards webhooks (Stripe CLI)
```
In Stripe (test mode) create three recurring prices and put their IDs in `STRIPE_PRICE_*`. Enable Stripe Tax and the Customer Portal.

## Email (Resend)
1. In Resend, add and verify the sending domain `mail.preciopsatms.com` (the SPF, DKIM and DMARC records it shows go in DNS).
2. Set `RESEND_API_KEY` and `EMAIL_FROM` (an address on that domain). Emails go out as “<Company> <EMAIL_FROM address>” with replies going to the recruiter, company or applicant as appropriate.
3. Without `RESEND_API_KEY`, email is a no-op that prints each message (including signing and invite links) to the server log — handy for local development.

What sends email: team invites, e-signature links and signed/countersigned copies (PDF attached), careers-page application notices and applicant confirmations, and the **Email / text** button on candidate, lead, vendor and client-contact records. Every recruiter message is logged per recipient (sent, failed with the provider’s reason, or blocked by opt-out) and shown on the record. Messages that still contain an unfilled `{{field}}` are held back.

## Customer websites
Each company gets a hosted careers page (`/careers/<slug>`, one page per job with Google for Jobs markup), an embeddable widget (copy the snippet from **Settings & data**) and an XML job feed for Indeed, ZipRecruiter, Talent.com and other aggregators. The widget and job API allow cross-origin requests, so the snippet works on any domain.

## Job boards
**Settings & data → Job boards** lists one feed URL per board (`/api/public/<slug>/feed.xml?board=indeed|ziprecruiter|talent|jooble|careerjet|adzuna`). The feed follows Indeed's Job Sync XML format, which those boards and most aggregators read: unique `referencenumber`, city/state/country/postal code, HTML description, hourly salary, Indeed job types, and `remotetype` for fully remote jobs. Apply links carry `?src=<board>`, so applicants are tagged with the board they came from. The card also lists jobs that boards would hide (no "City, ST", very short descriptions).

**Indeed Apply:** enter the API token and secret from Indeed's partner console, then give Indeed the application URL shown (`/api/public/<slug>/indeed-apply`). The feed then carries `<indeed-apply-data>` for jobs that use the built-in apply form, and applications arrive signed (`X-Indeed-Signature`, HMAC-SHA1). Each one is verified, then creates the candidate (source "Indeed") with the resume attached, adds them to the job at Applied, and emails the apply inbox.

Google for Jobs reads the JobPosting markup on each job page (remote jobs use `TELECOMMUTE`). LinkedIn job slots and Limited Listings go through a LinkedIn partner, which can use the same feed.

## Tests
```bash
createdb -O preci preciops_test                                              # once (or via psql)
DATABASE_URL=postgresql://preci:preci@localhost:5432/preciops_test npx prisma migrate deploy
npm test                                                                     # Vitest; override the DB with TEST_DATABASE_URL
```
Covers tenant isolation and API gating (`tests/tenant.test.ts`, needs the test DB), plan feature gating, payroll/overtime math and the four-fifths rule.

## What's built
| Area | Where |
|---|---|
| Tenancy guard (every query forced to caller's org) | `src/lib/tenant.ts` |
| Plans, pricing, feature gating, AI credit metering | `src/lib/plans.ts`, `src/lib/ai.ts` |
| Signup → trial → Stripe Checkout → webhook sync → seats | `api/signup`, `api/stripe/*`, `src/lib/stripe.ts` |
| Jobs, candidates, pipeline moves (auto-fill, rejection reasons, max-stage tracking) | `api/jobs`, `api/candidates`, `api/applications/[id]` |
| Email + SMS sending with merge fields, logging, STOP opt-out | `api/messages/send`, `api/sms/inbound` |
| Remote e-signature: one-time links, locked text hash, IP/UA audit, signed PDF emailed | `api/esign*`, `api/sign/[token]`, `app/sign/[token]`, `src/lib/pdf.ts` |
| Timesheets, approvals, payroll CSV, client invoice PDF | `api/timesheets*`, `api/payroll/export`, `api/invoices/pdf` |
| Public careers pages (one page per job, JSON-LD), apply form with resume upload + voluntary self-ID | `app/careers/[slug]`, `api/public/[slug]/apply` |
| Live job API, embeddable widget, auto-updating XML feed for job boards | `api/public/[slug]/jobs`, `public/embed.js`, `api/public/[slug]/feed.xml` |
| AI candidate matching + resume parsing (protected traits excluded) | `api/ai/*` |
| EEO applicant flow + four-fifths report (admin, Enterprise) | `api/eeo/report` |
| Marketing page with pricing, signup, login, app shell, dashboard, jobs, candidates, billing, team | `src/app` |

See **PLAN.md** for the roadmap and launch checklist, and **CLAUDE.md** for the remaining build work.

> Status: written but not yet installed, compiled or tested — run `npm install && npm run typecheck` first and fix anything it flags.

## Domains (production)
| Host | Purpose |
|---|---|
| `preciopsatms.com` / `www` | Marketing site + pricing (same Next.js app, `/` route) |
| `app.preciopsatms.com` | Logged-in product, public careers pages, APIs, `embed.js`, job feeds (`APP_URL`) |
| `mail.preciopsatms.com` | Sending domain for Resend — add its SPF, DKIM and DMARC records |

Customer careers widget: `<div id="preci-careers" data-org="their-slug"></div><script src="https://app.preciopsatms.com/embed.js" async></script>`
Customer job-board feed: `https://app.preciopsatms.com/api/public/their-slug/feed.xml`
