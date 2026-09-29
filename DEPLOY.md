# Deploying Preciops

The recommended setup is **Vercel** (app) + **Neon** or **Supabase** (Postgres). Both have free tiers, and Vercel builds straight from this GitHub repo.
A `Dockerfile` is included for container hosts (Render, Fly.io, Railway, Cloud Run, ECS).

Everything except the database and three core settings is optional. The app starts without Stripe, email, file storage, AI or SMS, and the server log says what each missing piece turns off.

---

## 1. Database (about 5 minutes)

1. Create a project at [neon.tech](https://neon.tech) (or Supabase → Project → Database).
2. Copy the **pooled** connection string and add `?sslmode=require` if it isn't there. This is `DATABASE_URL`.

Migrations run automatically on every Vercel deploy (`vercel-build` runs `prisma migrate deploy`), so the tables are created for you.

## 2. App on Vercel (about 10 minutes)

1. [vercel.com/new](https://vercel.com/new) → **Import** `RemasCompany/Preciopsatms` → Framework: Next.js (detected).
2. Add these **Environment Variables** before the first deploy:

| Variable | Value | Needed for |
|---|---|---|
| `DATABASE_URL` | from step 1 | **required** |
| `NEXTAUTH_SECRET` | output of `openssl rand -base64 32` | **required** |
| `NEXTAUTH_URL` | `https://app.preciopsatms.com` (or the `*.vercel.app` URL at first) | **required** |
| `APP_URL` | same as `NEXTAUTH_URL` | **required** (links in emails, feeds, Indeed Apply) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_ENTERPRISE`, `TRIAL_DAYS` | Stripe dashboard (step 4) | buying plans |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend (step 5) | all email |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | AWS S3 or Cloudflare R2 (step 6) | resumes, signed PDFs |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | console.anthropic.com | resume parsing, lead scoring |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` | Twilio | text messages |
| `CRON_SECRET` | output of `openssl rand -base64 32` | daily credential-expiration emails and shift reminders |

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

Create a Messaging Service, then set its **incoming message webhook** to `https://app.preciopsatms.com/api/sms/inbound` so STOP replies opt people out automatically.

## 8. Daily jobs: credential alerts and shift reminders

`vercel.json` schedules `/api/cron/credential-alerts` every day at 13:00 UTC. Vercel sends `CRON_SECRET` with the request automatically; without it the job refuses to run.
Each recruiter, admin and owner gets one email listing credentials that reached 60, 30 or 7 days before expiring, or expired. Each credential is reported once per window, and every email is logged under Messages.
`/api/cron/shift-reminders` runs every day at 22:00 UTC (late afternoon in the US): each worker with a published shift tomorrow gets one text, or an email if they can't be texted. Declined and cancelled shifts are skipped.
On other hosts, call both daily yourself: `curl -H "Authorization: Bearer $CRON_SECRET" https://app.preciopsatms.com/api/cron/credential-alerts` (and the same for `/api/cron/shift-reminders`).

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
