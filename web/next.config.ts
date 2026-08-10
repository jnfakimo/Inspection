import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/word-cloud/v2',
  assetPrefix: '/word-cloud/v2',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
