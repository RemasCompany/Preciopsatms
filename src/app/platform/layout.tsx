import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Preciops platform', robots: { index: false, follow: false } };

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <main className="public platform" style={{ maxWidth: 1280 }}>{children}</main>;
}
