import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { audit } from './audit';
import { limited } from './rate-limit';
import { checkSecondStep, TWO_STEP_INVALID, TWO_STEP_REQUIRED } from './two-step';

/** Sign-in attempts allowed per email and per IP address in 15 minutes, so passwords can't be guessed at speed. */
export const LOGIN_LIMITS = { email: 10, ip: 50, windowMs: 15 * 60e3 };
export const TOO_MANY = 'TOO_MANY_ATTEMPTS';

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
      credentials: { email: { type: 'email' }, password: { type: 'password' }, code: { type: 'text' }, orgId: { type: 'text' } },
      async authorize(creds, req) {
        const email = creds?.email?.toLowerCase().trim();
        if (!email || !creds?.password) return null;
        const ip = String(req?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
        if (await limited('login-ip', ip, LOGIN_LIMITS.ip, LOGIN_LIMITS.windowMs) || await limited('login-email', email, LOGIN_LIMITS.email, LOGIN_LIMITS.windowMs)) throw new Error(TOO_MANY);
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
        // Two-step sign-in: the password was right; now the code from their app (or a recovery code). The page asks
        // for it when told it's required. Wrong codes count against the same sign-in limits as wrong passwords.
        let viaRecovery = false;
        if (user.totpEnabledAt) {
          const code = creds.code?.trim();
          if (!code || code === 'undefined') throw new Error(TWO_STEP_REQUIRED);
          const ok = await checkSecondStep(user, code);
          if (!ok) {
            await audit(m.organizationId, { id: user.id, email: user.email }, 'auth.two_step_failed', `Wrong two-step code for ${user.email} (password was right)`, { targetType: 'user', targetId: user.id, req: asRequest(req?.headers) });
            throw new Error(TWO_STEP_INVALID);
          }
          viaRecovery = ok === 'recovery';
        }
        if (viaRecovery) await audit(m.organizationId, { id: user.id, email: user.email }, 'auth.recovery_used', `${user.email} signed in with a recovery code (${user.recoveryCodes.length - 1} left)`, { targetType: 'user', targetId: user.id, req: asRequest(req?.headers) });
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
