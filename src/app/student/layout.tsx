'use client';

import React from 'react';
import { StudentGuard } from '@/components/student/StudentGuard';
import { CourseStoreShell } from '@/components/marketing/CourseStoreShell';
import { StudentSubNav } from '@/components/student/StudentSubNav';
import { StudentBottomNav } from '@/components/student/StudentBottomNav';
import '../courses/courses.css';
import './student.css';

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StudentGuard>
      <div className="course-store">
        <div className="student-portal">
          <CourseStoreShell>
            <StudentSubNav />
            <main id="store-main" className="student-main-content">
              {children}
            </main>
            <StudentBottomNav />
          </CourseStoreShell>
        </div>
      </div>
    </StudentGuard>
  );
}
