import Link from 'next/link';
import { Logo } from '@/components/Logo';

/** Sign-in, sign-up and password pages: the logo above the form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <><header className="brandbar"><Link href="/" aria-label="Preciops-ATMS home"><Logo size={36} /></Link></header>{children}</>;
}
