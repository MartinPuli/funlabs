import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next 16 blocks cross-origin dev resources; the e2e runner opens 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: [],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self), display-capture=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
