import React from 'react';
import { CourseStoreShell } from '@/components/marketing/CourseStoreShell';

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="course-store">
      <CourseStoreShell>{children}</CourseStoreShell>
    </div>
  );
}
