import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The e2e server uses its own build dir so it cannot clash with a dev server on :3000.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Internal packages export TS source directly.
  transpilePackages: [
    '@srs/site-model',
    '@srs/capture',
    '@srs/audit',
    '@srs/agents',
    '@srs/sections',
    '@srs/brand',
  ],
};

export default nextConfig;
