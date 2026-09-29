import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Preciops ATMS — Advanced Talent Management System',
  description: 'Applicant tracking, CRM, timesheets, payroll export, e-signatures and compliance for staffing firms.',
  appleWebApp: { capable: true, title: 'Preciops', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false }, // phone numbers are linked on purpose where it helps
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#152238' }, { media: '(prefers-color-scheme: dark)', color: '#0F1624' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
