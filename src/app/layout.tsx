import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Preciops ATMS — Advanced Talent Management System', description: 'Applicant tracking, CRM, timesheets, payroll export, e-signatures and compliance for staffing firms.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
