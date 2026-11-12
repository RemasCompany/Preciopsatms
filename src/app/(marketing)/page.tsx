import Link from 'next/link';
import { LandingControls } from './LandingControls';
import './home.css';

/** The public home page. Its styles are scoped under .lp (home.css); the menu and pricing tabs live in LandingControls. */
export default function Home({ searchParams }: { searchParams?: { deleted?: string } }) {
  const deleted = !!searchParams?.deleted;
  return (
    <div className="lp">
      <header className="lp-site">
        <div className="lp-wrap lp-header-in">
          <a className="lp-brand" href="#top" aria-label="Preciops-ATMS home">
            <span className="lp-brand-mark">P</span>
            <span className="lp-brand-name">Preciops-ATMS<small>Advanced Talent Management Systems</small></span>
          </a>
          <button className="lp-nav-toggle" id="navToggle" aria-label="Open navigation" aria-expanded="false" aria-controls="headerMenu">☰</button>
          <div className="lp-header-menu" id="headerMenu">
            <span className="lp-menu-label" aria-hidden="true">Explore</span>
            <nav className="lp-main" id="mainNav" aria-label="Main">
              <a className="lp-navlink" href="#platform">Platform</a>
              <a className="lp-navlink" href="#training">Training &amp; AI</a>
              <a className="lp-navlink" href="#tasks">Tasks &amp; Reviews</a>
              <a className="lp-navlink" href="#healthcare">Healthcare</a>
              <a className="lp-navlink" href="#who">Who it&apos;s for</a>
              <a className="lp-navlink" href="#pricing">Pricing</a>
              <a className="lp-navlink" href="#faq">FAQ</a>
            </nav>
            <div className="lp-header-actions" aria-label="Account">
              <span className="lp-menu-label" aria-hidden="true">Account</span>
              <Link className="lp-navlink lp-health-link" href="/login?for=healthcare">Healthcare sign in</Link>
              <Link className="lp-navlink" href="/login">Sign in</Link>
              <Link className="lp-btn lp-btn-primary lp-btn-sm" href="/signup">Start free trial</Link>
            </div>
          </div>
        </div>
      </header>

      <main id="top">
        {deleted && <p className="lp-banner" role="status">Your company and its data have been deleted. Thank you for using Preciops.</p>}
        {/* Hero */}
        <div className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <span className="lp-eyebrow">Advanced Talent Management Systems</span>
              <h1>One workforce platform to <span className="lp-hl">recruit, schedule, pay</span> and stay compliant.</h1>
              <p className="lp-hero-tagline">Advance Talent Management Software</p>
              <p className="lp-hero-sub">Preciops-ATMS unifies applicant tracking, CRM, scheduling, timesheets, payroll, and compliance in a single platform — built for staffing agencies, healthcare employers, and companies managing their own teams.</p>
              <div className="lp-hero-ctas">
                <Link className="lp-btn lp-btn-primary" href="/signup">Start your 14-day free trial</Link>
                <Link className="lp-btn lp-btn-ghost" href="/login">Sign in</Link>
                <Link className="lp-btn lp-btn-ghost" href="/login?for=healthcare">Healthcare sign in</Link>
              </div>
              <p className="lp-hero-note"><strong>14 days free</strong> on every plan — explore the full platform before you commit.</p>
              <div className="lp-hero-audiences">
                <span className="lp-aud-chip">For <b>light industrial</b></span>
                <span className="lp-aud-chip">For <b>staffing companies</b></span>
                <span className="lp-aud-chip">For <b>healthcare companies</b></span>
                <span className="lp-aud-chip"><b>Employee app</b> included</span>
              </div>
            </div>

            <div className="lp-preview" aria-label="Preview of the Preciops-ATMS applicant tracking pipeline">
              <div className="lp-preview-bar">
                <span className="lp-dot"></span><span className="lp-dot"></span><span className="lp-dot"></span>
                <span className="lp-addr">preciopsatms.com/pipeline</span>
              </div>
              <div className="lp-preview-body">
                <div className="lp-preview-head">
                  <h3>Forklift Operator — Client: Distribution Co.</h3>
                  <span>ATS PIPELINE</span>
                </div>
                <div className="lp-board">
                  <div className="lp-col">
                    <h4>Applied <span>12</span></h4>
                    <div className="lp-cand"><b>M. Carter</b><span className="lp-role">Forklift Operator · 4 yrs</span><span className="lp-match">AI match 94%</span></div>
                    <div className="lp-cand"><b>J. Nguyen</b><span className="lp-role">Warehouse Associate</span><span className="lp-match">AI match 88%</span></div>
                  </div>
                  <div className="lp-col">
                    <h4>Interview <span>5</span></h4>
                    <div className="lp-cand"><b>R. Alvarez</b><span className="lp-role">Forklift Operator · OSHA cert</span><span className="lp-match lp-gold">Credential verified</span></div>
                    <div className="lp-cand"><b>T. Okafor</b><span className="lp-role">Shift Lead</span><span className="lp-match">AI match 91%</span></div>
                  </div>
                  <div className="lp-col">
                    <h4>Placed <span>3</span></h4>
                    <div className="lp-cand"><b>D. Smith</b><span className="lp-role">Starts Mon · Night shift</span><span className="lp-match">Offer signed</span></div>
                    <div className="lp-cand"><b>K. Patel</b><span className="lp-role">Timesheet approved</span><span className="lp-match">Payroll ready</span></div>
                  </div>
                </div>
                <div className="lp-preview-foot">
                  <span>Resume parsed by AI</span>
                  <span>Shift scheduled</span>
                  <span>Invoice in one click</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Workflow */}
        <div className="lp-flow">
          <div className="lp-wrap lp-flow-grid">
            <div className="lp-flow-step">
              <span className="lp-flow-num">1</span>
              <div><h3>Recruit</h3><p>Your jobs are posted on major job boards such as Indeed, LinkedIn, Glassdoor, Dice, ZipRecruiter and much more — plus your careers page. Parse resumes with AI and move candidates through a drag-and-drop pipeline.</p></div>
            </div>
            <div className="lp-flow-step">
              <span className="lp-flow-num">2</span>
              <div><h3>Schedule</h3><p>Fill shifts and assignments, and let your team clock in from mobile — hours flow straight into timesheets.</p></div>
            </div>
            <div className="lp-flow-step">
              <span className="lp-flow-num">3</span>
              <div><h3>Pay</h3><p>Approve weekly hours with overtime, export payroll to Gusto, ADP or QuickBooks, and invoice clients in one click.</p></div>
            </div>
            <div className="lp-flow-step">
              <span className="lp-flow-num">4</span>
              <div><h3>Stay compliant</h3><p>Rejection reasons, credential and vendor tracking, e-signature audit trails and EEO reporting — built in, not bolted on.</p></div>
            </div>
          </div>
        </div>

        {/* Platform modules */}
        <section id="platform">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">The Platform</p>
              <h2>Every part of the workforce workflow, in one system</h2>
              <p className="lp-section-sub">Stop stitching together a job board tool, a spreadsheet schedule, a payroll export and a filing cabinet. Preciops-ATMS covers the full cycle from first application to final invoice.</p>
            </div>
            <div className="lp-modules">
              <article className="lp-module lp-wide">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg></div>
                <h3>Applicant tracking</h3>
                <p>Drag-and-drop pipeline, AI resume parsing and candidate matching, with rejection reasons recorded for compliance on every decision.</p>
                <span className="lp-tag">Agencies &amp; Employers</span>
              </article>
              <article className="lp-module lp-wide">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3z"/></svg></div>
                <h3>Careers page &amp; job boards</h3>
                <p>Your jobs are posted on major job boards such as Indeed, LinkedIn, Glassdoor, Dice, ZipRecruiter and much more. Plus hosted careers pages, an embeddable widget for your own site, Google for Jobs markup and an auto-updating Indeed feed.</p>
                <span className="lp-tag">Agencies &amp; Employers</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
                <h3>CRM &amp; lead generation</h3>
                <p>Clients, contacts, deals and leads with AI scoring and outreach drafts.</p>
                <span className="lp-tag">Agencies</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
                <h3>Timesheets, payroll &amp; invoicing</h3>
                <p>Weekly hours with overtime, payroll export for Gusto, ADP and QuickBooks, and client invoices in one click.</p>
                <span className="lp-tag">Agencies &amp; Employers</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>
                <h3>E-signatures</h3>
                <p>Offer letters, assignment confirmations and agreements signed remotely with a full audit trail.</p>
                <span className="lp-tag">Agencies &amp; Employers</span>
              </article>
              <article className="lp-module lp-wide">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></div>
                <h3>Vendors &amp; EEO compliance</h3>
                <p>Vendor COI/W-9 tracking, voluntary self-ID and four-fifths adverse impact reporting.</p>
                <span className="lp-tag">Compliance</span>
              </article>
              <article className="lp-module lp-wide">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 4v6M16 4v6"/></svg></div>
                <h3>People &amp; HR for employers</h3>
                <p>Employee directory, departments, an org chart, pay history, scheduling and a mobile time clock for your own team — plus task reminders, semi-annual and annual reviews, and internal communication.</p>
                <span className="lp-tag">Employers</span>
              </article>
            </div>
          </div>
        </section>

        {/* Training, AI Agent, Audits & Employee App */}
        <section id="training" style={{ paddingTop: '8px' }}>
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">Training · AI Agent · Audits · Employee App</p>
              <h2>Certify operators, automate the busywork, and keep every record audit-ready</h2>
              <p className="lp-section-sub">Beyond recruiting and payroll, Preciops-ATMS trains and certifies your workforce, runs HR and compliance audits, and puts scheduling and time in every employee&apos;s pocket.</p>
            </div>
            <div className="lp-modules">
              <article className="lp-module lp-wide">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg></div>
                <h3>Machinery training videos &amp; courses — with tests</h3>
                <p>Training videos and courses with built-in tests to <b>certify and recertify</b> employees and candidates on most forklifts, cranes and other machinery — with every result kept on file for your records.</p>
                <ul className="lp-mini-list">
                  <li><b>Forklifts &amp; cranes</b> — courses for most equipment types</li>
                  <li><b>Test to certify</b> — pass the test, earn the certification</li>
                  <li><b>Recertification</b> — renew before credentials expire</li>
                  <li><b>Records kept</b> — certificates stored on the worker&apos;s profile</li>
                </ul>
                <span className="lp-tag">Training &amp; Certification</span>
              </article>
              <article className="lp-module lp-wide">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/><path d="M9 17h6"/></svg></div>
                <h3>AI agent to automate most work</h3>
                <p>An AI agent that automates most of the repetitive work across the platform — so your team spends time on people, not paperwork.</p>
                <ul className="lp-mini-list">
                  <li><b>Resume parsing &amp; matching</b> and lead scoring</li>
                  <li><b>Outreach drafts</b> and follow-ups</li>
                  <li><b>Reminders &amp; routine tasks</b> handled automatically</li>
                  <li><b>Scheduling help</b> — flag gaps and suggest fills</li>
                </ul>
                <span className="lp-tag">AI Automation</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg></div>
                <h3>HR audits &amp; compliance audits</h3>
                <p>Structured HR audits and compliance audits that surface gaps in files, credentials, policies and hiring records — before a client or regulator finds them.</p>
                <span className="lp-tag">Audits</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/></svg></div>
                <h3>Employee app — remote clocking &amp; access</h3>
                <p>An employee app for remote clocking and access from anywhere: clock in and out, view schedules and access your information on the go.</p>
                <span className="lp-tag">Employee App</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/></svg></div>
                <h3>Shift requests</h3>
                <p>Employees and candidates can request shifts, pick up open shifts and request changes right from the app — managers approve in one place and schedules update instantly.</p>
                <span className="lp-tag">Scheduling</span>
              </article>
            </div>
          </div>
        </section>

        {/* Tasks, Reviews & Communication */}
        <section id="tasks" style={{ paddingTop: '8px' }}>
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">Tasks · Reviews · Communication</p>
              <h2>Nothing slips — tasks, follow-ups, reviews and team updates in one place</h2>
              <p className="lp-section-sub">Set reminders for tasks and activities, prioritize what matters most, and get follow-ups automatically so you won&apos;t forget. Reviews run on schedule, feedback arrives on time, and your team stays in the loop without chasing email threads.</p>
            </div>
            <div className="lp-modules">
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.2 1.2L6.5 5M3 12l1.2 1.2L6.5 11M3 18l1.2 1.2L6.5 17"/></svg></div>
                <h3>Task &amp; activity reminders — prioritize and follow up</h3>
                <p>Create tasks and activities, assign an owner and a due date, and set the priority so the most important work comes first.</p>
                <ul className="lp-mini-list">
                  <li><b>Reminders</b> — nudges before tasks and activities are due</li>
                  <li><b>Prioritize</b> — rank work so nothing urgent gets buried</li>
                  <li><b>Follow-ups</b> — overdue and unfinished items resurface automatically, so you won&apos;t forget</li>
                </ul>
                <span className="lp-tag">Tasks &amp; Reminders</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg></div>
                <h3>Semi-annual &amp; annual employee reviews</h3>
                <p>Run employee reviews on a consistent cycle — semi-annual and annual reviews scheduled in advance, with goals and past feedback carried into every conversation.</p>
                <ul className="lp-mini-list">
                  <li><b>Semi-annual reviews</b> — mid-year check-ins that keep goals on track</li>
                  <li><b>Annual reviews</b> — full-year performance, documented on the employee record</li>
                  <li><b>Feedback reminders</b> — managers and employees are reminded to submit feedback before each review is due</li>
                </ul>
                <span className="lp-tag">Performance Reviews</span>
              </article>
              <article className="lp-module">
                <div className="lp-module-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg></div>
                <h3>Internal communication</h3>
                <p>Keep internal communication inside the platform — announcements, team updates and messages tied to the people, shifts and tasks they are about.</p>
                <ul className="lp-mini-list">
                  <li><b>Announcements &amp; updates</b> — reach the whole team or just one location</li>
                  <li><b>Feedback in context</b> — comments and feedback stay with the review or task</li>
                  <li><b>One place to check</b> — no more hunting through inboxes and group chats</li>
                </ul>
                <span className="lp-tag">Team Communication</span>
              </article>
            </div>
          </div>
        </section>

        {/* Healthcare */}
        <section className="lp-healthcare" id="healthcare">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">For Healthcare</p>
              <h2>Credential, compliance and pay tools built for healthcare workers</h2>
              <p className="lp-section-sub">Healthcare staffing runs on credentials and shift coverage. Preciops-ATMS keeps healthcare workers compliant, reminds them before anything lapses, and pays shift differentials correctly.</p>
            </div>
            <div className="lp-health-grid">
              <article className="lp-health-card">
                <h3>Credential reminders</h3>
                <p>Automatic credential reminders for healthcare workers — licenses, certifications and required documents — so renewals happen before expiry, not after a shift is at risk.</p>
              </article>
              <article className="lp-health-card">
                <h3>Healthcare compliance</h3>
                <p>Compliance tracking for healthcare workers in one record: credentials, training and audit history together, ready for client, facility and internal audits.</p>
              </article>
              <article className="lp-health-card">
                <h3>Shift differentials for healthcare workers</h3>
                <p>Shift differentials for healthcare workers — nights, weekends and holidays paid at the right differential rate, flowing from the schedule through timesheets to payroll.</p>
              </article>
            </div>
            <div className="lp-health-signin">
              <div>
                <h3>Healthcare sign in</h3>
                <p>Healthcare workers and healthcare clients sign in here to access schedules, credentials, shift requests, timesheets and the employee app.</p>
              </div>
              <Link className="lp-btn lp-btn-gold" href="/login?for=healthcare">Healthcare sign in →</Link>
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section className="lp-audiences" id="who">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">Who It&apos;s For</p>
              <h2>Who is Preciops-ATMS good for?</h2>
              <p className="lp-section-sub">Preciops-ATMS is good for light industrial, staffing and healthcare companies — teams that hire, schedule and pay shift-based workers and need training, credentials and compliance handled in one place.</p>
            </div>
            <div className="lp-goodfor-grid">
              <article className="lp-goodfor-card">
                <p className="lp-goodfor-label">Good for</p>
                <h3>Light industrial companies</h3>
                <p>Warehouses, distribution and light manufacturing operations that run shift-based teams — with forklift and crane training, certification and recertification, scheduling, mobile time clocking and timesheets built in.</p>
              </article>
              <article className="lp-goodfor-card">
                <p className="lp-goodfor-label">Good for</p>
                <h3>Staffing companies</h3>
                <p>Staffing agencies placing workers with clients — applicant tracking, CRM and lead generation, shift filling, payroll export and one-click client invoicing from a single desk.</p>
              </article>
              <article className="lp-goodfor-card">
                <p className="lp-goodfor-label">Good for</p>
                <h3>Healthcare companies</h3>
                <p>Healthcare employers and healthcare staffing teams that need credential reminders, healthcare compliance tracking and shift differentials for healthcare workers — plus a dedicated healthcare sign in.</p>
              </article>
            </div>
            <div className="lp-aud-grid">
              <article className="lp-aud-card">
                <h3>For staffing agencies</h3>
                <p className="lp-aud-sub">Place workers with clients and run the whole desk — recruiting, scheduling, time, billing — from one login.</p>
                <ul className="lp-check-list">
                  <li><span><b>Fill roles faster</b> — AI resume parsing and candidate matching on a drag-and-drop pipeline.</span></li>
                  <li><span><b>Win more clients</b> — CRM with leads, deals, AI scoring and outreach drafts.</span></li>
                  <li><span><b>Bill without the chase</b> — approved timesheets become client invoices in one click.</span></li>
                  <li><span><b>Certify operators in-platform</b> — forklift and crane training videos, courses and tests for certification and recertification.</span></li>
                  <li><span><b>Stay audit-ready</b> — HR audits, credential tracking, vendor COI/W-9s and EEO reporting.</span></li>
                  <li><span><b>Healthcare-ready</b> — credential reminders, healthcare compliance and shift differentials.</span></li>
                </ul>
                <a className="lp-btn lp-btn-primary" href="#pricing" data-goto-pricing="agencies">See agency pricing</a>
              </article>
              <article className="lp-aud-card">
                <h3>For employers</h3>
                <p className="lp-aud-sub">Hire and manage your own employees — from the careers page to the org chart to payday.</p>
                <ul className="lp-check-list">
                  <li><span><b>Hire on your own site</b> — hosted careers page and embeddable widget with Google for Jobs markup.</span></li>
                  <li><span><b>Know your team</b> — employee directory, departments, org chart and pay history.</span></li>
                  <li><span><b>Schedule and track time</b> — shift scheduling, a mobile time clock and timesheets with overtime.</span></li>
                  <li><span><b>Give staff the employee app</b> — remote clocking, access, schedules and shift requests from their phone.</span></li>
                  <li><span><b>Let AI do the busywork</b> — an AI agent automates most routine recruiting and HR tasks.</span></li>
                  <li><span><b>Grow people, not paperwork</b> — onboarding, semi-annual and annual reviews with feedback reminders, goals and engagement on Growth.</span></li>
                  <li><span><b>Never miss a follow-up</b> — task and activity reminders with priorities and automatic follow-ups, plus internal communication for your whole team.</span></li>
                </ul>
                <a className="lp-btn lp-btn-primary" href="#pricing" data-goto-pricing="employers">See employer pricing</a>
              </article>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing">
          <div className="lp-wrap">
            <div className="lp-section-head lp-center">
              <p className="lp-kicker">Pricing</p>
              <h2>Pricing that matches how you hire</h2>
              <p className="lp-section-sub">Agencies pay per desk, employers pay per employee. Every plan starts with a 14-day free trial.</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="lp-pricing-toggle" role="tablist" aria-label="Pricing audience">
                <button role="tab" id="tab-agencies" aria-selected="true" aria-controls="plans-agencies" data-audience="agencies">For staffing agencies</button>
                <button role="tab" id="tab-employers" aria-selected="false" aria-controls="plans-employers" data-audience="employers">For employers</button>
              </div>
            </div>

            <div className="lp-plans" id="plans-agencies" role="tabpanel" aria-labelledby="tab-agencies">
              <article className="lp-plan">
                <h3>Starter</h3>
                <p className="lp-price">$99<small>/mo</small></p>
                <p className="lp-per">UP TO 3 USERS</p>
                <p className="lp-plan-desc">Applicant tracking, CRM, lead tracking, shift scheduling and a careers page for small agencies.</p>
                <Link className="lp-btn lp-btn-ghost" href="/signup">Start free trial</Link>
              </article>
              <article className="lp-plan lp-featured">
                <span className="lp-plan-badge">Most popular</span>
                <h3>Growth</h3>
                <p className="lp-price">$79<small>/user/mo</small></p>
                <p className="lp-per">2-USER MINIMUM</p>
                <p className="lp-plan-desc">Everything to run a staffing desk: timesheets, payroll export, invoicing, e-signatures, credential tracking, shift scheduling, a mobile time clock, new-hire onboarding, HR audits, vendors and AI.</p>
                <Link className="lp-btn lp-btn-primary" href="/signup">Start free trial</Link>
              </article>
              <article className="lp-plan">
                <h3>Enterprise / MSP</h3>
                <p className="lp-price">Custom</p>
                <p className="lp-per">TAILORED PRICING</p>
                <p className="lp-plan-desc">Payroll runs with provider exports, equipment operator training and certification, EEO/OFCCP reporting, API, SSO, white-label and dedicated onboarding.</p>
                <a className="lp-btn lp-btn-ghost" href="mailto:sales@preciopsatms.com">Talk to sales</a>
              </article>
            </div>

            <div className="lp-plans" id="plans-employers" role="tabpanel" aria-labelledby="tab-employers" hidden>
              <article className="lp-plan">
                <h3>Starter</h3>
                <p className="lp-price">$4<small>/employee/mo</small></p>
                <p className="lp-per">UP TO 3 ADMINS</p>
                <p className="lp-plan-desc">Hiring, a careers page, shift scheduling and an employee directory with departments, an org chart and pay history.</p>
                <Link className="lp-btn lp-btn-ghost" href="/signup?type=employer">Start free trial</Link>
              </article>
              <article className="lp-plan lp-featured">
                <span className="lp-plan-badge">Most popular</span>
                <h3>Growth</h3>
                <p className="lp-price">$8<small>/employee/mo</small></p>
                <p className="lp-per">PER ACTIVE EMPLOYEE</p>
                <p className="lp-plan-desc">Everything to run your workforce: time off and balances, semi-annual and annual performance reviews with feedback reminders and goals, task and activity reminders with follow-ups, internal communication, scheduling, a mobile time clock, timesheets and payroll export, onboarding, e-signatures, credentials, HR audits, engagement and AI.</p>
                <Link className="lp-btn lp-btn-primary" href="/signup?type=employer">Start free trial</Link>
              </article>
              <article className="lp-plan">
                <h3>Enterprise</h3>
                <p className="lp-price">Custom</p>
                <p className="lp-per">TAILORED PRICING</p>
                <p className="lp-plan-desc">Payroll runs with provider exports, equipment operator training and certification, EEO reporting, API, SSO and dedicated onboarding.</p>
                <a className="lp-btn lp-btn-ghost" href="mailto:sales@preciopsatms.com">Talk to sales</a>
              </article>
            </div>

            <p className="lp-pricing-note">Not sure which side fits? If you place workers with clients, start with agency pricing; if you hire your own team, start with employer pricing.</p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq">
          <div className="lp-wrap">
            <div className="lp-section-head lp-center">
              <p className="lp-kicker">FAQ</p>
              <h2>Questions, answered</h2>
            </div>
            <div className="lp-faq-list">
              <details className="lp-faq">
                <summary>Who is Preciops-ATMS good for?</summary>
                <div className="lp-faq-body"><p>Preciops-ATMS is good for light industrial, staffing and healthcare companies. Light industrial teams use it for shift scheduling, operator training and certification; staffing companies use it to place workers with clients — ATS, CRM and invoicing in one desk; and healthcare companies use it for credential reminders, compliance and shift differentials. It also serves employers managing their own employees with hiring, directory, org chart and pay history tools.</p></div>
              </details>
              <details className="lp-faq">
                <summary>How does the 14-day free trial work?</summary>
                <div className="lp-faq-body"><p>Every plan starts with a 14-day free trial. Pick the audience and plan that fits, start the trial, and explore the platform before paid billing begins.</p></div>
              </details>
              <details className="lp-faq">
                <summary>Does Preciops-ATMS replace my payroll provider?</summary>
                <div className="lp-faq-body"><p>No — it feeds it. Timesheets track weekly hours with overtime, and payroll exports to Gusto, ADP and QuickBooks. Enterprise plans add full payroll runs with provider exports.</p></div>
              </details>
              <details className="lp-faq">
                <summary>Can candidates apply from my own website?</summary>
                <div className="lp-faq-body"><p>Yes. Your jobs are posted on major job boards such as Indeed, LinkedIn, Glassdoor, Dice, ZipRecruiter and much more. You also get a hosted careers page plus an embeddable widget for your own site, Google for Jobs markup, and an auto-updating Indeed feed.</p></div>
              </details>
              <details className="lp-faq">
                <summary>How does it help with EEO compliance?</summary>
                <div className="lp-faq-body"><p>The platform records rejection reasons, supports voluntary self-ID, and provides four-fifths adverse impact reporting. Enterprise plans add EEO/OFCCP reporting, and vendor COI/W-9 tracking covers your third parties.</p></div>
              </details>
              <details className="lp-faq">
                <summary>How does machinery training and certification work?</summary>
                <div className="lp-faq-body"><p>Employees and candidates take machinery training videos and courses inside the platform — covering most forklifts, cranes and other equipment — then pass a test to certify or recertify. Results and certificates are kept on the worker&apos;s record for your files and audits.</p></div>
              </details>
              <details className="lp-faq">
                <summary>What does the AI agent automate?</summary>
                <div className="lp-faq-body"><p>The AI agent automates most repetitive work: resume parsing and candidate matching, lead scoring, outreach drafts, reminders, and routine scheduling and follow-up tasks — with your team approving the decisions that matter.</p></div>
              </details>
              <details className="lp-faq">
                <summary>How do credential reminders and shift differentials work for healthcare?</summary>
                <div className="lp-faq-body"><p>Healthcare workers get automatic credential reminders before licenses and certifications expire, with compliance status tracked on their record. Shift differentials for healthcare workers — nights, weekends and holidays — are applied from the schedule through timesheets to payroll.</p></div>
              </details>
              <details className="lp-faq">
                <summary>What can employees do in the employee app?</summary>
                <div className="lp-faq-body"><p>Clock in and out remotely, access schedules and personal information, and submit shift requests — request, pick up or change shifts — for manager approval.</p></div>
              </details>
              <details className="lp-faq">
                <summary>How do task reminders, priorities and follow-ups work?</summary>
                <div className="lp-faq-body"><p>You create tasks and activities with an owner, a due date and a priority. Preciops-ATMS sends reminders before work is due and automatically resurfaces follow-ups for anything unfinished or overdue — so you won&apos;t forget to close the loop on candidates, clients or employees.</p></div>
              </details>
              <details className="lp-faq">
                <summary>Does Preciops-ATMS handle semi-annual and annual reviews?</summary>
                <div className="lp-faq-body"><p>Yes. Semi-annual and annual employee reviews are scheduled on a recurring cycle, with feedback reminders prompting managers and employees to submit their input before each review is due. Goals, feedback and completed reviews are kept on the employee&apos;s record.</p></div>
              </details>
              <details className="lp-faq">
                <summary>How does internal communication work?</summary>
                <div className="lp-faq-body"><p>Internal communication lives inside the platform: announcements and team updates, plus feedback and messages tied to the task, shift or review they belong to — so your team checks one place instead of scattered inboxes and group chats.</p></div>
              </details>
              <details className="lp-faq">
                <summary>Where do healthcare workers sign in?</summary>
                <div className="lp-faq-body"><p>Use the <Link href="/login?for=healthcare">Healthcare sign in</Link> link at the top of this page or in the Healthcare section to access schedules, credentials, shift requests and timesheets.</p></div>
              </details>
              <details className="lp-faq">
                <summary>What&apos;s the difference between agency and employer pricing?</summary>
                <div className="lp-faq-body"><p>Agencies are priced per user on the desk — Starter is $99/mo for up to 3 users and Growth is $79/user/mo with a 2-user minimum. Employers are priced per employee — $4/employee/mo on Starter and $8/employee/mo on Growth. Both sides offer a custom Enterprise plan.</p></div>
              </details>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <div className="lp-cta-band">
          <div className="lp-wrap">
            <div className="lp-cta-card">
              <h2>Run your whole workforce from one platform</h2>
              <p>Recruit, schedule, pay and stay compliant — whether you place workers with clients or manage your own team. Start today and see it with your own roles, shifts and people.</p>
              <div className="lp-hero-ctas">
                <Link className="lp-btn lp-btn-gold" href="/signup">Start your 14-day free trial</Link>
                <Link className="lp-btn lp-btn-ghost" href="/login">Sign in</Link>
                <Link className="lp-btn lp-btn-ghost" href="/login?for=healthcare">Healthcare sign in</Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="lp-site">
        <div className="lp-wrap">
          <div className="lp-footer-grid">
            <div className="lp-footer-col" style={{ maxWidth: '300px' }}>
              <a className="lp-brand" href="#top" style={{ marginBottom: '12px' }}>
                <span className="lp-brand-mark">P</span>
                <span className="lp-brand-name">Preciops-ATMS</span>
              </a>
              <p style={{ margin: '10px 0 0', fontSize: '14px', color: 'var(--ink-soft)' }}>Advanced Talent Management Systems — one workforce platform to recruit, schedule, pay and stay compliant.</p>
            </div>
            <div className="lp-footer-col">
              <h4>Platform</h4>
              <a href="#platform">Applicant tracking</a>
              <a href="#platform">Careers page &amp; job boards</a>
              <a href="#platform">CRM &amp; lead generation</a>
              <a href="#platform">Timesheets &amp; payroll</a>
              <a href="#platform">E-signatures</a>
              <a href="#training">Machinery training &amp; certification</a>
              <a href="#training">AI agent &amp; HR audits</a>
              <a href="#training">Employee app &amp; shift requests</a>
              <a href="#tasks">Tasks, reviews &amp; communication</a>
              <a href="#healthcare">Healthcare compliance</a>
            </div>
            <div className="lp-footer-col">
              <h4>Company</h4>
              <a href="#who">For staffing agencies</a>
              <a href="#who">For employers</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
              <Link href="/security">Security</Link>
            </div>
            <div className="lp-footer-col">
              <h4>Get started</h4>
              <Link href="/signup">Start free trial</Link>
              <Link href="/login">Sign in</Link>
              <Link href="/login?for=healthcare">Healthcare sign in</Link>
              <a href="mailto:sales@preciopsatms.com">Talk to sales</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© {new Date().getFullYear()} Preciops-ATMS · Advanced Talent Management Systems</span>
            <span className="lp-mono">preciopsatms.com</span>
          </div>
        </div>
      </footer>

    
      <LandingControls />
    </div>
  );
}
