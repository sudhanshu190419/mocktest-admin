import type { Metadata } from 'next';
import { AuthPreviewShell } from '@/components/auth/AuthPreviewShell';

export const metadata: Metadata = {
  title: 'Sign Up — MakeMeTopper',
  description: 'Create your MakeMeTopper student account to start your learning journey.',
};

export default function SignUpPage() {
  return <AuthPreviewShell screen="signup" />;
}
