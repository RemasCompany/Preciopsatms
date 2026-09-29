/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // for Docker hosts; Vercel ignores it
  experimental: { instrumentationHook: true, serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    return [
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
