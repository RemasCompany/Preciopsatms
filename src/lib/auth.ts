import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { audit } from './audit';

// next-auth hands authorize() a plain header object; the audit log wants a Request.
const asRequest = (h?: Record<string, unknown>) => new Request('http://local', { headers: Object.entries(h ?? {}).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])) });

declare module 'next-auth' {
  interface Session {
    user: { id: string; email: string; name?: string | null; orgId: string; role: string; issuedAt?: number };
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
      credentials: { email: { type: 'email' }, password: { type: 'password' }, orgId: { type: 'text' } },
      async authorize(creds, req) {
        const email = creds?.email?.toLowerCase().trim();
        if (!email || !creds?.password) return null;
        const user = await db.user.findUnique({ where: { email }, include: { memberships: { orderBy: { createdAt: 'asc' } } } });
        if (!user) return null;
        if (!(await bcrypt.compare(creds.password, user.passwordHash))) {
          // A wrong password for a real account is worth knowing about (someone guessing). Unknown emails aren't logged anywhere.
          for (const m of user.memberships) await audit(m.organizationId, { id: user.id, email: user.email }, 'auth.login_failed', `Wrong password for ${user.email}`, { targetType: 'user', targetId: user.id, req: asRequest(req?.headers) });
          return null;
        }
        // Sign in to the requested company (e.g. right after accepting an invite), else the first one joined.
        const m = user.memberships.find((x) => x.organizationId === creds.orgId) ?? user.memberships[0];
        if (!m) return null;
        await audit(m.organizationId, { id: user.id, email: user.email }, 'auth.login', `${user.email} signed in`, { targetType: 'user', targetId: user.id, req: asRequest(req?.headers) });
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
      session.user = { ...session.user, id: token.uid!, orgId: token.orgId!, role: token.role!, issuedAt: typeof token.iat === 'number' ? token.iat : undefined } as never;
      return session;
    },
  },
};
