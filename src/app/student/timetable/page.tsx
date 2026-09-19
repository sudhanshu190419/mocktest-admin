'use client';

import React from 'react';
import Link from 'next/link';
import { StudentTimetableView } from '@/components/student/timetable/StudentTimetableView';

export default function StudentTimetablePage() {
  return (
    <div className="store-container space-y-7 pb-12">
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link href="/student/overview">Student Hub</Link>
        <span aria-hidden="true">/</span>
        <span>Timetable & Schedule</span>
      </nav>

      <StudentTimetableView />
    </div>
  );
}
