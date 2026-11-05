import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@dinesense/ui'],
  output: 'standalone',
  // Trace workspace packages from the monorepo root so the standalone bundle is self-contained.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // The API is proxied same-origin so the httpOnly refresh cookie works without CORS gymnastics.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
  // Konva ships an optional Node canvas backend we never use in the browser.
  webpack: (cfg: { externals?: unknown[] }) => {
    cfg.externals = [...(cfg.externals ?? []), { canvas: 'canvas' }];
    return cfg;
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
