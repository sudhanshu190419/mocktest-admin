import type { Metadata } from 'next';
import { AuthPreviewShell } from '@/components/auth/AuthPreviewShell';

export const metadata: Metadata = {
  title: 'Verify Phone — MakeMeTopper',
  description: 'Enter your 6-digit SMS verification code to verify your phone number.',
};

export default function VerifyPage() {
  return <AuthPreviewShell screen="verify" />;
}
