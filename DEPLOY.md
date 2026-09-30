# Deploying Preciops

The recommended setup is **Vercel** (app) + **Neon** or **Supabase** (Postgres). Both have free tiers, and Vercel builds straight from this GitHub repo.
A `Dockerfile` is included for container hosts (Render, Fly.io, Railway, Cloud Run, ECS).

Everything except the database and three core settings is optional. The app starts without Stripe, email, file storage, AI or SMS, and the server log says what each missing piece turns off.

---

## 1. Database (about 5 minutes)

1. Create a project at [neon.tech](https://neon.tech) (or Supabase → Project → Database).
2. Copy **two** connection strings from the dashboard's *Connect* dialog:
   - the **pooled** one (Neon: host contains `-pooler`; Supabase: port 6543). Add `?sslmode=require&pgbouncer=true` (join with `&` if it already has a `?`). This is `DATABASE_URL`, used by the app.
   - the **direct** one (pooling switched off; Supabase: port 5432). Add `?sslmode=require`. This is `DIRECT_URL`, used only to run migrations, which don't work through a pooler.

Migrations run automatically on every Vercel deploy (`vercel-build` runs `prisma migrate deploy` over `DIRECT_URL`), so the tables are created for you. Without `DIRECT_URL`, migrations use `DATABASE_URL`, which works only when that is a direct connection.

## 2. App on Vercel (about 10 minutes)

1. [vercel.com/new](https://vercel.com/new) → **Import** `RemasCompany/Preciopsatms` → Framework: Next.js (detected).
2. Add these **Environment Variables** before the first deploy:

| Variable | Value | Needed for |
|---|---|---|
| `DATABASE_URL` | pooled string from step 1 | **required** |
| `DIRECT_URL` | direct string from step 1 | **required** with a pooled `DATABASE_URL` (migrations) |
| `NEXTAUTH_SECRET` | output of `openssl rand -base64 32` | **required** |
| `NEXTAUTH_URL` | `https://app.preciopsatms.com` (or the `*.vercel.app` URL at first) | **required** |
| `APP_URL` | same as `NEXTAUTH_URL` | **required** (links in emails, feeds, Indeed Apply) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_ENTERPRISE`, `TRIAL_DAYS` | Stripe dashboard (step 4) | buying plans |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend (step 5) | all email |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | AWS S3 or Cloudflare R2 (step 6) | resumes, signed PDFs |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_ASSISTANT_MODEL` | console.anthropic.com | resume parsing, lead scoring, the in-app assistant (defaults to `claude-opus-5-5`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` | Twilio | text messages |
| `CRON_SECRET` | output of `openssl rand -base64 32` | daily credential alerts, shift reminders, birthday greetings and the background queue |
| `SENTRY_DSN` (optional) | sentry.io → Project settings → Client keys | error reports from the server and browsers |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (optional) | upstash.com → Redis → REST API | rate limits shared by every server instance |

Do **not** set `STORAGE_DRIVER=local` on Vercel: its disk is wiped between requests.

3. **Deploy.** When it's up, open `https://<your-app>/api/health` → `{"ok":true}` means the app reached the database.
4. Open `/signup` and create your company account. Without Stripe it starts on the free trial.

## 3. Domain

Vercel → Project → **Settings → Domains** → add `app.preciopsatms.com` (and `preciopsatms.com` / `www` for the marketing page) and create the DNS records it shows. Then set `NEXTAUTH_URL` and `APP_URL` to `https://app.preciopsatms.com` and **redeploy**.

## 4. Stripe (billing)

1. In Stripe (start in **test mode**), create three recurring prices: Starter (flat monthly), Growth (per seat), Enterprise (per seat). Put their IDs in `STRIPE_PRICE_*`.
2. Turn on **Stripe Tax** and the **Customer Portal**.
3. **Developers → Webhooks → Add endpoint**: `https://app.preciopsatms.com/api/stripe/webhook`, with events
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`.
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`, then redeploy.

## 5. Email (Resend)

Verify the sending domain `mail.preciopsatms.com` in Resend (add the SPF, DKIM and DMARC records it shows), set `RESEND_API_KEY` and `EMAIL_FROM="Preciops <notifications@mail.preciopsatms.com>"`, and redeploy. Test by inviting yourself from **Team**.

## 6. File storage

**Cloudflare R2** (cheapest): create a bucket and an API token with read/write on it. Set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, and the token's key ID and secret.
**AWS S3**: create a private bucket and an IAM user limited to it; leave `S3_ENDPOINT` blank.
Files are only ever read by the server after an ownership check; the bucket must **not** be public.

## 7. Texting (Twilio, optional)

Create a Messaging Service, then set its **incoming message webhook** to `https://app.preciopsatms.com/api/sms/inbound`. STOP and START replies opt candidates, client contacts and leads out and back in automatically, and every other reply lands in the company's **Inbox** (matched to the candidate, contact or lead). With one shared number, a reply goes to the company that last texted that phone; a company can instead enter its own Twilio number under Settings → Careers page settings so replies to it always land in its inbox.

## 8. Daily jobs: credential alerts, shift reminders and birthday greetings

`vercel.json` schedules `/api/cron/credential-alerts` every day at 13:00 UTC. Vercel sends `CRON_SECRET` with the request automatically; without it the job refuses to run.
Each recruiter, admin and owner gets one email listing credentials that reached 60, 30 or 7 days before expiring, or expired. Each credential is reported once per window, and every email is logged under Messages.
`/api/cron/shift-reminders` runs every day at 22:00 UTC (late afternoon in the US): each worker with a published shift tomorrow gets one text, or an email if they can't be texted. Declined and cancelled shifts are skipped.
`/api/cron/engagement` runs every day at 14:00 UTC and sends birthday greetings for companies that turned them on (Engagement page), once a year per worker, honoring opt-outs.
`/api/cron/reports` runs every day at 12:00 UTC and emails scheduled reports: weekly ones on Mondays (last week) and monthly ones on the 1st (last month), in each company's time zone.
`/api/cron/tasks` works through the background queue. Large sends (more than 25 people from “Message this list”) are queued; the browser that queued them starts them right away and shows progress, so the scheduled run only finishes work whose browser went away and retries failures (1, 4 and 16 minutes apart, then it gives up and reports the error). Vercel's Hobby plan allows one run a day (`30 3 * * *` in `vercel.json`); on Pro, change it to `*/5 * * * *` so leftovers finish within minutes.
On other hosts, call these yourself: `curl -H "Authorization: Bearer $CRON_SECRET" https://app.preciopsatms.com/api/cron/credential-alerts` daily (and the same for `/api/cron/shift-reminders`, `/api/cron/engagement` and `/api/cron/reports`), and `/api/cron/tasks` every 5 minutes.

## Background checks (Checkr, optional)

Set `CHECKR_API_KEY` (and `CHECKR_ENV=production` when you go live; anything else uses Checkr's staging sandbox). In the Checkr dashboard, add the webhook URL `https://<your-app>/api/webhooks/checkr`. Recruiters then order checks from the candidate drawer: Checkr emails the candidate to consent and enter SSN and date of birth on Checkr's site (that information never passes through Preciops), status updates arrive by webhook, and a clear report is saved as a verified background-check credential for a year. “Consider” results are flagged for review with a reminder to follow the FCRA adverse-action process.

## Accounting: QuickBooks Online and Xero (optional)

Create an app with Intuit (developer.intuit.com) and/or Xero (developer.xero.com), register the redirect URIs `https://<your-app>/api/integrations/quickbooks/callback` and `.../xero/callback`, and set `QUICKBOOKS_CLIENT_ID`/`QUICKBOOKS_CLIENT_SECRET` (`QUICKBOOKS_ENV=production` for live companies) and/or `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET`. Set `INTEGRATIONS_KEY` (`openssl rand -base64 32`) so stored tokens are encrypted with their own key. An admin then connects from Settings → Accounting and sends invoices from the Invoices page: each worker's regular and overtime hours become separate lines, QuickBooks customers are matched by name (or created), and a "Staffing services" item is created once. Recorded client payments are sent too (for Xero, only when `XERO_BANK_ACCOUNT` is set; invoice lines post to account code `XERO_SALES_ACCOUNT`, default `200`). Nothing is sent twice.

## E-Verify

Companies enrolled in E-Verify turn on tracking on the E-Verify page. Placing someone then opens a case with its deadline (the third business day after they start work; federal holidays aren't counted out, so the date errs early). Cases are created in E-Verify itself and the case number and result recorded here. Submitting cases directly would require enrolling as an E-Verify Web Services employer agent with DHS.

## Error monitoring and rate limits (optional)

With `SENTRY_DSN` set, server errors (API 500s, failed scheduled jobs, background tasks that gave up) and browser crashes are sent to Sentry. Emails, phone numbers and private-link tokens are masked, query strings are dropped, and only the user's internal id is attached. Without it, errors go to the server log only.
Sign-in, password reset, careers applications and worker links are rate-limited. With the two `UPSTASH_*` variables set, the counts are shared across all server instances; without them (or if Upstash is unreachable) each instance counts on its own.

## 9. Job boards and Indeed Apply

In the app: **Settings & data → Job boards**. Give each board its feed URL; for Indeed Apply, paste the API token and secret from Indeed's partner console and give Indeed the application URL shown there.

---

## After each deploy: 5-minute check

- `/api/health` returns `ok: true`
- Sign in → Dashboard loads; the Vercel **Logs** show no `[config]` errors
- Add a job → it appears at `/careers/<your-slug>` and in the feed
- Apply to it from a private window → the applicant shows up in the Pipeline
- Invite a teammate → the email arrives
- Open the app on your phone → add it to your home screen

## Backups

Neon and Supabase keep point-in-time backups on paid plans; turn them on before real customers use it. For an extra copy, owners can download everything from **Settings & data → Your company's data**.

---

## Container hosts (alternative)

```bash
docker build -t preciops .
docker run -p 3000:3000 --env-file production.env preciops
```

The container applies pending migrations and then starts. It has a health check on `/api/health`. The image never contains `.env` (see `.dockerignore`); pass settings at run time.
The standalone server this image runs has been tested; the image build itself couldn't be run in the development environment (no registry access), so build it once locally or in CI before relying on it.

## The assistant (AI)

On Growth and Enterprise, the **Assistant** page answers questions about the company's jobs, pipeline, placements, hours, schedules, deadlines and (for owners and admins) margin and receivables. It looks things up with read-only tools over that company's data only. Workers appear as "Worker 1", client contacts' names, all contact details and EEO data are never sent to Anthropic, and emails and phone numbers typed into a question are masked. Each question uses one AI credit, refunded if the request fails. It requests Anthropic's server-side fallback beta (`server-side-fallback-2026-07-01`); if your account rejects it, remove `betas` and `fallbacks` from `src/lib/assistant.ts`.
