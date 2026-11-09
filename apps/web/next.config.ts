import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
