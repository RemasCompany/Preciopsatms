import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { withAuth, type NextRequestWithAuth } from 'next-auth/middleware';
import { canonicalRedirect } from '@/lib/canonical';

const auth = withAuth({ pages: { signIn: '/login' } });

/** Every page moves to the app's one address (see canonical.ts); /app also needs a signed-in session. */
export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  const to = canonicalRedirect(req.nextUrl, req.headers.get('host'), process.env.APP_URL);
  if (to) return NextResponse.redirect(to, 308);
  if (req.nextUrl.pathname === '/app' || req.nextUrl.pathname.startsWith('/app/')) return auth(req as NextRequestWithAuth, ev);
  return NextResponse.next();
}

// Pages only: not API routes, Next's own files or static assets.
export const config = { matcher: ['/((?!api/|_next/|brand/|favicon|icon|apple-icon|manifest|robots|sitemap|embed\\.js|sw\\.js|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|txt|xml|json)$).*)'] };
