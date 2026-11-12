import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Preciops-ATMS | Advanced Talent Management Software',
  description: 'Hire, train, schedule, pay and stay compliant from one platform. Preciops-ATMS brings ATS, employee training, shift differentials, HR audit logs and payroll together for any industry.',
  appleWebApp: { capable: true, title: 'Preciops', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false }, // phone numbers are linked on purpose where it helps
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#0B1F3A' }, { media: '(prefers-color-scheme: dark)', color: '#0F1624' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
