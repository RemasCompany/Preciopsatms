# Instructions for Claude Code

You are continuing the build of Preciops, a multi-tenant SaaS for staffing firms. Read README.md and PLAN.md first.

## Source of truth for UX and business rules
`docs/prototype.html` is a complete working prototype. When porting a screen, match its behavior, copy, empty states and calculations (overtime 1.5x, spread/margin, weighted pipeline, vendor compliance windows, four-fifths rule, archive rules). Do not invent new behavior without asking.

## Non-negotiable rules
1. **Tenant isolation.** Business data is only ever read/written through `tenantDb(orgId)` from `requireApiContext()` / `requirePageContext()`. Never accept `organizationId` from the client. Unique-key ops (`update`, `delete`, `findUnique`) are blocked on tenantDb by design — use `findFirst` / `updateMany` / `deleteMany`. Public routes resolve the org from the slug and then use `tenantDb(org.id)`.
2. **Gating.** Every write route passes `write: true`; paid features pass `feature:`. EEO endpoints require `minRole: 'ADMIN'` and `feature: 'eeo'`.
3. **EEO data** lives only in `EeoSelfId`. Never join it into recruiter-facing responses and never send it (or names/contact details) to the AI model.
4. **Messaging** sends one merged message per recipient, logs every attempt to `Message`, and honors `emailOptOut` / `smsOptOut`.
5. **Money** uses Decimal in the DB; convert with `Number()` only for display/CSV. Timesheets snapshot pay/bill rates.
6. Validate every input with zod. Return friendly error strings (they're shown to users).

## Next tasks (in order)
1. `npm install`, `npx prisma migrate dev`, `npm run typecheck`, `npm run lint`; fix all errors.
2. Tests: Vitest for `tenant.ts` (cross-tenant access must fail), plans gating, payroll math, four-fifths math; Playwright for signup → checkout (test mode) → create job → apply on careers page → move to placed → enter hours → export payroll.
3. Port remaining UI from the prototype: pipeline board (drag and drop, rejection-reason picker), candidate/job/client/lead/vendor drawers, CRM deals board, leads with AI scoring, vendors with compliance, tasks, timesheets grid, documents list + in-app countersign, EEO report screen, careers settings (branding, embed code, feed URL), company profile/white-label settings, team invites + `/invite/[token]` acceptance (call `syncSeats`), CSV import/export.
4. Missing APIs: CRUD for clients/contacts/deals/leads/vendors/tasks; countersign; resume download via `fileUrl` after ownership check; invite acceptance; org settings update; account/data export and deletion (GDPR/CCPA requests).
5. Production hardening: replace in-memory rate limit with Upstash; add Sentry; audit log for admin actions; password reset + email verification; optional SSO (Enterprise) via SAML/OIDC (e.g. WorkOS); background jobs (Inngest or a queue) for bulk messaging and feed regeneration; S3 lifecycle rules; nightly Postgres backups with point-in-time recovery.
6. Add Postgres row-level security as a second isolation layer once the app is stable.
