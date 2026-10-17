/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // for Docker hosts; Vercel ignores it
  experimental: { instrumentationHook: true, serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    // Pages behind a sign-in or a private link can't be framed by another site (clickjacking).
    const noFrame = [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=(), geolocation=(self)' },
        ],
      },
      ...['/app/:path*', '/login', '/signup', '/forgot', '/reset/:path*', '/invite/:path*', '/client/:path*', '/shifts/:path*', '/sign/:path*', '/feedback/:path*'].map((source) => ({ source, headers: noFrame })),
      {
        // Public job API + embed script are read cross-origin from customers' websites.
        source: '/api/public/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      { source: '/embed.js', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }, { key: 'Cache-Control', value: 'public, max-age=300' }] },
    ];
  },
};
export default nextConfig;
