import Link from 'next/link';
import { Logo } from '@/components/Logo';
import type { Metadata } from 'next';
import { securityContact } from '@/lib/security-contact';

export const metadata: Metadata = { title: 'Security · Preciops ATMS', description: 'How Preciops protects your company’s and your workers’ data, and what isn’t in place yet.' };

const SECTIONS: [string, string[]][] = [
  ['Each company’s data is kept apart', [
    'Every read and write of business data is scoped to the signed-in company by one shared layer. The company is never taken from the browser, and automated tests check that one company can’t read or change another’s records.',
    'The database enforces it too. Postgres row-level security checks every record a signed-in company reads or writes, including related records pulled in alongside the ones asked for.',
    'Public pages (careers, a worker’s private page, the client portal) find the company from the link itself and stay inside that company.',
  ]],
  ['Signing in', [
    'Passwords are stored only as bcrypt hashes. Sessions end after 12 hours.',
    'Sign-in attempts are limited per email address and per network address, so passwords can’t be guessed at speed. Failed sign-ins to real accounts are recorded in the company’s audit log.',
    'Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy and others). Each code works once. One-time recovery codes cover a lost phone. Admins can require it for their whole team.',
    'Email addresses are verified. Password reset links work once and expire after an hour.',
    'Each person has a role (owner, admin, recruiter or viewer). Payroll, invoices, EEO reports, sensitive documents and the audit log are limited to owners and admins.',
    'Workers and clients use private links instead of passwords. Links are stored only as hashes, expire, and can be revoked.',
  ]],
  ['Sensitive personal data', [
    'Social Security numbers and bank details for payroll are entered by each worker on Check’s own pages. Check is our payroll partner, and Preciops never receives or stores those details.',
    'Tax, bank and identity documents (I-9, W-4 and direct deposit forms) can be opened only by owners and admins, and each time one is opened it’s recorded in the audit log.',
    'Voluntary EEO self-identification is stored apart from candidate records. It’s never shown to recruiters, never used in hiring decisions, and only appears in aggregate reports for admins.',
    'AI features never receive names, email addresses, phone numbers or EEO data. Resumes and notes are redacted before they’re sent.',
    'Keys for connected services (QuickBooks, Xero and others) are encrypted with AES-256-GCM before they’re saved.',
  ]],
  ['Files and connections', [
    'Uploaded files are kept in private storage. They can be opened only through short-lived signed links handed out after checking the person may see them.',
    'Every page is served over HTTPS, and browsers are told to use HTTPS only. Signed-in and private pages can’t be framed by other sites.',
    'Webhooks from Checkr and Check are verified by signature. A Check webhook only prompts us to re-read the payroll or worker from Check, so its contents can’t change anything by themselves.',
  ]],
  ['Audit log and messages', [
    'Sign-ins, team and role changes, settings, payroll approvals, payments, data exports and document views are recorded with who, when and from where. Entries can’t be edited or deleted, even by owners.',
    'Every email and text we send is logged, and people who opt out of email or texts aren’t contacted that way again.',
  ]],
  ['Your data, your control', [
    'Owners can download all of their company’s data at any time from Settings & data, for their own records or to answer an access or portability request under GDPR or CCPA.',
    'To delete your company’s data, or to answer a deletion request from a worker or candidate, contact us at the address below.',
  ]],
];

const NOT_YET = [
  'A SOC 2 report or another independent audit.',
  'An outside penetration test.',
  'Single sign-on (SAML or OIDC).',
  'A published uptime history.',
];

export default function SecurityPage() {
  const contact = securityContact();
  return (
    <main className="public" style={{ maxWidth: 820 }}>
      <p className="muted" style={{ margin: 0 }}><Link href="/" aria-label="Preciops-ATMS home" style={{ textDecoration: 'none' }}><Logo size={28} /></Link></p>
      <h1>Security</h1>
      <p className="lede">Staffing firms hold sensitive information about thousands of workers. This page sets out how Preciops protects it, and what isn’t in place yet, so you can judge for yourself.</p>
      {SECTIONS.map(([title, items]) => (
        <section key={title} className="secblock">
          <h2>{title}</h2>
          <ul>{items.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      ))}
      <section className="secblock">
        <h2>Not in place yet</h2>
        <ul>{NOT_YET.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="muted">If your clients need any of these before you can sign, tell us. It helps us decide what comes first.</p>
      </section>
      <section className="secblock">
        <h2>Reporting a security problem</h2>
        <p>Email <a href={`mailto:${contact}`}>{contact}</a>. Please include steps to reproduce, and don’t access other people’s data or disrupt the service while testing. We’ll confirm we have it and keep you posted until it’s fixed.</p>
      </section>
    </main>
  );
}
