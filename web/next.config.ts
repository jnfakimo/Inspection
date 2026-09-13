import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/Inspection/v2',
  assetPrefix: '/Inspection/v2/',
  trailingSlash: true,
  images: { unoptimized: true },
  webpack(config) {
    config.resolve.alias['@'] = path.resolve(__dirname);
    return config;
  },
};

export default nextConfig;
