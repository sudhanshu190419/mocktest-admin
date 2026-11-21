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
  async redirects() {
    return [
      {
        source: '/admin/commerce/subscription-plans',
        destination: '/admin/commerce',
        permanent: false,
      },
      {
        source: '/admin/commerce/subscriptions',
        destination: '/admin/commerce',
        permanent: false,
      },
      {
        source: '/admin/commerce/subscriptions/:id',
        destination: '/admin/commerce',
        permanent: false,
      },
    ];
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

