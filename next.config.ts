import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'ocolfottogbybitfpdqy.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/my',
        destination: '/student/overview',
      },
      {
        source: '/my/:path*',
        destination: '/student/:path*',
      },
      {
        source: '/dashboard',
        destination: '/student/overview',
      },
    ];
  },
};

export default nextConfig;

