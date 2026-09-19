import type { Metadata } from 'next';
import { AuthPreviewShell } from '@/components/auth/AuthPreviewShell';

export const metadata: Metadata = {
  title: 'Log In — MakeMeTopper',
  description: 'Log in to your MakeMeTopper account to access your courses, mock tests, and timetable.',
};

export default function LoginPage() {
  return <AuthPreviewShell screen="login" />;
}
