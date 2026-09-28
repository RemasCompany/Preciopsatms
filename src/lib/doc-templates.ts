// Starting-point templates. Customers should have their own counsel review before use.
export const TEMPLATES: Record<'offer' | 'assignment' | 'vendor' | 'client', { name: string; body: string }> = {
  offer: { name: 'Offer letter', body: `{{date}}

Dear {{name}},

{{my_company}} is pleased to offer you the position of {{job_title}}, on assignment with our client {{client}} in {{job_location}}, beginning {{start_date}}.

Compensation: {{pay_rate}}
Employment type: {{job_type}}

This offer is contingent on a satisfactory background check, a drug screen where the client requires one, and verification of your eligibility to work in the United States (Form I-9). Your employment with {{my_short}} is at-will, meaning you or the company may end it at any time, with or without cause or notice.

Please sign below to accept this offer.

Sincerely,
{{owner}}
{{owner_title}}, {{my_company}}` },
  assignment: { name: 'Assignment confirmation', body: `{{date}}

Assignment confirmation for {{name}}

Position: {{job_title}}
Client site: {{client}}, {{job_location}}
Start date: {{start_date}}
Pay rate: {{pay_rate}} (overtime paid at 1.5x for hours over 40 in a workweek)
Assignment type: {{job_type}}

By signing, you confirm that you will report hours accurately each week, follow the client's site safety and conduct rules, contact {{my_short}} (not the client) about pay, scheduling or any concerns, and give as much notice as possible before ending the assignment.

{{my_company}} is your employer of record for this assignment.` },
  vendor: { name: 'Vendor subcontractor agreement', body: `{{date}}

Subcontractor agreement between {{my_company}} ("Agency") and {{name}} ("Vendor")

1. Services. Vendor will refer qualified candidates for positions Agency designates. Vendor remains the employer of record for its workers unless agreed otherwise in writing.
2. Fees. Vendor's share is {{fee}} of the gross margin on each placement, payable within 15 days after Agency receives client payment.
3. Compliance. Vendor will maintain general liability and workers' compensation insurance naming Agency as certificate holder, keep a current W-9 on file, and comply with all employment, wage-and-hour, and anti-discrimination laws.
4. Non-solicitation. Vendor will not directly solicit Agency clients for the placements it supports during this agreement and for 12 months after.
5. Confidentiality. Each party will keep the other's client, candidate and rate information confidential.
6. Term. This agreement runs one year from signature and renews unless either party gives 30 days' written notice.` },
  client: { name: 'Staffing services agreement', body: `{{date}}

Staffing services agreement between {{my_company}} ("Agency") and {{name}} ("Client")

1. Services. Agency will provide qualified temporary, contract and direct-hire personnel as Client requests.
2. Rates. Bill rates follow each job order. Standard markup is {{markup}}. Overtime is billed at 1.5x. Direct-hire fees are due on the candidate's start date.
3. Invoicing. Agency invoices weekly from approved hours. Payment terms are {{terms}}.
4. Conversion. Client may hire an Agency contractor after 520 hours worked without a fee, or earlier for the agreed conversion fee.
5. Supervision and safety. Client directs day-to-day work and provides a safe workplace and site-specific training.
6. Term. This agreement runs until either party ends it with 30 days' written notice.` },
};
