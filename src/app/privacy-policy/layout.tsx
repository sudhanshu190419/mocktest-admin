import React from 'react';
import { CourseStoreShell } from '@/components/marketing/CourseStoreShell';

export default function PrivacyPolicyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CourseStoreShell>{children}</CourseStoreShell>;
}
