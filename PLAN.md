# Preciops — commercial launch plan

## 1. Product
Positioning: **the operating system for small and mid-size staffing firms** (5–50 recruiters) in light industrial, logistics, healthcare and IT — one platform instead of an ATS + CRM + spreadsheet timesheets + separate e-sign.

Differentiators: built by an operator; timesheets → payroll → invoicing in the same system as recruiting; compliance (vendor COI/W-9, EEO/OFCCP) built in; AI matching and outreach included; optional TempLink USA marketplace integration for candidate supply.

## 2. Packaging & pricing (validate with 5–10 staffing owners before launch)
| Plan | Price | For | Includes |
|---|---|---|---|
| Starter | ~$99/mo flat, up to 3 users | Small agencies | ATS, pipeline, careers page + job feed, CRM, leads, email/text |
| Growth | ~$79/user/mo | Growing desks | + vendors, timesheets, payroll export, invoicing, e-signatures, AI (2,000 credits/mo) |
| Enterprise / MSP | Custom, annual | Larger firms | + EEO/OFCCP reporting, API, SSO, white-label, onboarding |

Add-ons: AI credit packs, SMS bundles, paid onboarding & data migration ($500–$2,500), annual prepay discount (~2 months free). 14-day free trial, no card required.

Unit economics to track: MRR, net revenue retention, logo churn, CAC payback (target < 12 months), gross margin (target 80%+ after SMS/AI/infra costs).

## 3. Roadmap
**Phase 0 — Foundation (this repo).** Tenancy, auth, billing, core APIs, public careers, e-sign, timesheets, EEO.
**Phase 1 — MVP (≈8–12 weeks with 1–2 engineers + Claude Code).** Port full UI from prototype, tests, security hardening, password reset, invites, CSV import, onboarding checklist, help center. Migrate The Remas Company as customer #1.
**Phase 2 — Paid pilot (≈6 weeks).** 3–5 friendly firms at a founding-customer discount in exchange for feedback and a case study. Weekly releases.
**Phase 3 — Launch.** Public pricing page, self-serve signup, content + partner channels.
**Phase 4 — Expansion.** Native Indeed/ZipRecruiter partner APIs, QuickBooks/Gusto direct sync, background-check integrations (revenue share), VMS integrations, mobile app for workers (clock-in, timesheet submit), TempLink USA marketplace.

## 4. Go-to-market
- Founder-led sales to your own network first; every demo uses the Sales Demo workspace.
- Staffing associations and their state chapters, local SBDCs, staffing-owner Facebook/LinkedIn groups.
- Partner referrals: payroll providers, staffing accountants, background-check vendors, insurance brokers.
- Content: "How to run a staffing desk" guides, payroll/overtime calculators, compliance checklists (SEO).

## 5. Legal & compliance checklist (have counsel review)
- Terms of Service, Privacy Policy, Data Processing Agreement, Acceptable Use, SLA (Enterprise).
- Form a separate entity for Preciops (keeps the software business clean for investment or sale); register the "Preciops" trademark. Domain preciopsatms.com is registered; consider also securing preciops.com if available and common misspellings.
- E-signatures: ESIGN/UETA consent + audit trail (built); customers own their document language.
- Messaging: TCPA consent capture (built into apply form), 10DLC brand/campaign registration with Twilio, CAN-SPAM footer and unsubscribe for bulk email.
- EEO data: voluntary, separated, admin-only (built). Consider an employment-law review of the report language.
- Data: encryption at rest/in transit, backups, access logging, breach response plan, cyber liability insurance; SOC 2 Type I within ~12 months of launch (Vanta/Drata), Type II after.
- State privacy laws (CCPA/CPRA and others) — data export/deletion endpoints.

## 6. Monthly operating costs at launch (rough estimates, verify current pricing)
Hosting (Vercel/Render + managed Postgres) $50–$300 · Email $20–$90 · SMS pay-as-you-go + 10DLC fees · File storage < $20 · AI usage metered by credits · Error monitoring $0–$30 · Compliance automation (later) ~$7k–$15k/yr.
