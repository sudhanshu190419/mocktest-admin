import type { Metadata } from 'next';
import { PrivacyPolicyView } from '@/components/marketing/PrivacyPolicyView';

export const metadata: Metadata = {
  title: 'Privacy Policy — Make Me Topper',
  description:
    'Official canonical Privacy Policy for Make Me Topper. Learn how we handle student account data, mock test analytics, permissions, payments, and data protection.',
  alternates: {
    canonical: 'https://makemetopper.com/privacy-policy',
  },
  openGraph: {
    title: 'Privacy Policy — Make Me Topper',
    description:
      'Official canonical Privacy Policy for Make Me Topper web and Android mobile applications.',
    url: 'https://makemetopper.com/privacy-policy',
    type: 'website',
  },
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicyView />;
}
