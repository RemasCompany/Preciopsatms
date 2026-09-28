import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from './db';

declare module 'next-auth' {
  interface Session {
    user: { id: string; email: string; name?: string | null; orgId: string; role: string };
  }
}
declare module 'next-auth/jwt' {
  interface JWT { uid?: string; orgId?: string; role?: string }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Email and password',
      credentials: { email: { type: 'email' }, password: { type: 'password' } },
      async authorize(creds) {
        const email = creds?.email?.toLowerCase().trim();
        if (!email || !creds?.password) return null;
        const user = await db.user.findUnique({ where: { email }, include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } } });
        if (!user || !(await bcrypt.compare(creds.password, user.passwordHash))) return null;
        const m = user.memberships[0];
        if (!m) return null;
        return { id: user.id, email: user.email, name: user.name, orgId: m.organizationId, role: m.role } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as { id: string; orgId: string; role: string };
        token.uid = u.id; token.orgId = u.orgId; token.role = u.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = { ...session.user, id: token.uid!, orgId: token.orgId!, role: token.role! } as never;
      return session;
    },
  },
};
