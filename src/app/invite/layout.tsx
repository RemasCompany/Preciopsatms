import Link from 'next/link';
import { Logo } from '@/components/Logo';

/** Joining a team: the logo above the form. */
export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <><header className="brandbar"><Link href="/" aria-label="Preciops-ATMS home"><Logo size={36} /></Link></header>{children}</>;
}
