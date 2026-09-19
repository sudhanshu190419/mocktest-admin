'use client';

import React from 'react';
import Link from 'next/link';
import { StudentProfileView } from '@/components/student/StudentProfileView';

export default function StudentProfilePage() {
  return (
    <div className="store-container space-y-7 pb-12">
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link href="/student/overview">Student Hub</Link>
        <span aria-hidden="true">/</span>
        <span>Profile & Account</span>
      </nav>

      <StudentProfileView />
    </div>
  );
}
