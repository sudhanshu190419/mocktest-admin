import React from 'react';
import { CourseStoreShell } from '@/components/marketing/CourseStoreShell';

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CourseStoreShell>{children}</CourseStoreShell>;
}
