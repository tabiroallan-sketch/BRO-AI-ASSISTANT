import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  ...(process.env.BRO_DESKTOP_BUILD === '1'
    ? { output: 'standalone', outputFileTracingRoot: path.join(dirname, '..') }
    : { outputFileTracingRoot: path.join(dirname, '..') }),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/voice',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        ],
      },
      {
        source: '/voice/:path*',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
