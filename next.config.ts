import type { NextConfig } from 'next';

// INV-15: on every response. HSTS is inert over http (localhost) and enforced in production.
const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
  // The generated Prisma client and the pg driver stay on the server.
  serverExternalPackages: ['@prisma/client', 'pg'],
  poweredByHeader: false,
  // D-60: the nightly demo reset re-loads the fixture event at runtime, from the cron route, so that function's bundle
  // must carry fixtures/event.json and fixtures/customers.csv. The loaders read them through a directory argument, which
  // the build's file tracer follows by file-name pattern: left alone it also bundled commands.csv and
  // expected_commands.csv. The answer key and the expected_* files are for inventory:eval only (non-negotiable 9), so
  // the two needed files are named and everything else under fixtures/ is kept out.
  outputFileTracingIncludes: { '/api/cron': ['./fixtures/event.json', './fixtures/customers.csv'] },
  outputFileTracingExcludes: {
    '/api/cron': ['./fixtures/expected_*', './fixtures/answer_key.csv', './fixtures/commands.csv', './fixtures/reference_output.txt', './fixtures/MANIFEST.json', './fixtures/stripe/**/*'],
  },
  headers: async () => [
    { source: '/:path*', headers: securityHeaders },
    // Share pages (spec §7c). Listed last, so its Referrer-Policy overrides the global one:
    // the token in the URL must never leave in a Referer header.
    {
      source: '/s/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
      ],
    },
  ],
};

export default config;
