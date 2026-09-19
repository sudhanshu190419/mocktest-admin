import type { Metadata } from 'next';
import { AuthPreviewShell } from '@/components/auth/AuthPreviewShell';

export const metadata: Metadata = {
  title: 'Choose Your Goal — MakeMeTopper',
  description: 'Select your examination goal to customize your courses, mock tests, and timetable.',
};

export default function OnboardingPage() {
  return <AuthPreviewShell screen="onboarding" />;
}
