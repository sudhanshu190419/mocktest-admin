import type { Metadata } from 'next';
import { AuthPreviewShell } from '@/components/auth/AuthPreviewShell';

export const metadata: Metadata = {
  title: 'Reset Password — MakeMeTopper',
  description: 'Reset your MakeMeTopper password using phone verification.',
};

export default function ForgotPasswordPage() {
  return <AuthPreviewShell screen="forgot-password" />;
}
