import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/Inspection/v2',
  assetPrefix: '/Inspection/v2/',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
