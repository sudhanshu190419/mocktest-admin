'use client';

import React from 'react';
import Link from 'next/link';
import {
  IconLibrary,
  IconTest,
  IconPyq,
  IconPlay,
  IconSpark,
  IconGraduationCap,
  IconArrowRight,
  IconDoubt,
  IconCalendar,
  IconProgress,
} from '@/components/icons/student-icons';
import type {
  StudentEnrolledCourse,
  StudentLiveClassItem,
} from '@/services/student/studentDashboardWebService';
import type { StudentPyqPurchaseItem } from '@/hooks/student/useStudentPyqPurchases';

import { HeroSection } from './HeroSection';

export interface StudentHomeHeroData {
  enrolledCourses?: StudentEnrolledCourse[];
  pyqPurchases?: StudentPyqPurchaseItem[];
  liveClass?: StudentLiveClassItem | null;
}

interface StudentHomeHeroProps {
  studentName?: string;
  streamName?: string;
  data?: StudentHomeHeroData | null;
  loading?: boolean;
  isGuest?: boolean;
}

export function StudentHomeHero({
  studentName,
  streamName,
  data,
  loading = false,
  isGuest = false,
}: StudentHomeHeroProps) {
  const enrolledCourses = data?.enrolledCourses || [];
  const pyqPurchases = data?.pyqPurchases || [];
  const liveClass = data?.liveClass;

  const hasCourses = enrolledCourses.length > 0;
  const hasPyq = pyqPurchases.length > 0;
  const activeCourse = enrolledCourses[0];
  const activePyq = pyqPurchases[0];

  // 1. Loading Skeleton
  if (loading && !hasCourses && !hasPyq) {
    return (
      <section className="store-container py-10 lg:py-12" aria-busy="true">
        <div className="h-64 rounded-card bg-paper animate-pulse border border-line" />
      </section>
    );
  }

  // 2. Guest Variant — restored HeroSection with hero.png, high-impact typography, and feature badges
  if (isGuest || !studentName) {
    return <HeroSection />;
  }

  // 3. Variant: Logged in with Both Courses & PYQ
  if (hasCourses && hasPyq) {
    return (
      <section className="store-container py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Column: Greeting & Status */}
          <div className="lg:col-span-7 flex flex-col justify-between p-6 sm:p-8 rounded-card bg-white border border-line shadow-xs">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-tint text-brand text-caption font-bold">
                  <IconGraduationCap size={14} />
                  <span>STUDENT WORKSPACE</span>
                </span>
                {streamName && (
                  <span className="text-caption text-ink-secondary font-medium">
                    Goal: <strong className="text-ink">{streamName}</strong>
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight font-display mb-2">
                Welcome back, <span className="text-brand">{studentName}</span>.
              </h1>
              <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed max-w-lg mb-6">
                You have active access to enrolled courses and PYQ practice packages. Jump into your studies below.
              </p>
            </div>

            {/* Live Class Alert (if live) */}
            {liveClass && liveClass.status === 'live' && (
              <div className="p-3.5 rounded-field bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-white shrink-0 animate-pulse">
                    <IconPlay size={16} />
                  </span>
                  <div>
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white mb-0.5">
                      LIVE NOW
                    </span>
                    <p className="text-xs font-bold leading-tight line-clamp-1">{liveClass.title}</p>
                    <p className="text-caption text-rose-700">{liveClass.subject_name} · {liveClass.teacher_name}</p>
                  </div>
                </div>
                <Link
                  href="/student/classes"
                  className="px-3 py-1.5 rounded-field bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors shrink-0"
                >
                  Join Class →
                </Link>
              </div>
            )}

            {/* Quick CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-line">
              <Link
                href="/student/overview"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-colors shadow-xs"
              >
                <span>My Learning Center</span>
                <IconArrowRight size={13} />
              </Link>
              <Link
                href="/student/tests"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-paper hover:bg-sky-tint text-ink border border-line text-xs font-bold transition-colors"
              >
                <span>Practice Tests ({pyqPurchases.length} Active)</span>
              </Link>
            </div>
          </div>

          {/* Right Column: Active Course Spotlight & Quick Links */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="p-5 sm:p-6 rounded-card bg-white border border-line shadow-xs flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 text-caption font-bold text-brand uppercase tracking-wider">
                    <IconLibrary size={13} />
                    <span>Active Course</span>
                  </span>
                  <Link
                    href="/student/courses"
                    className="text-caption font-bold text-ink-muted hover:text-brand transition-colors inline-flex items-center gap-1"
                  >
                    <span>{enrolledCourses.length} Enrolled</span>
                    <IconArrowRight size={11} />
                  </Link>
                </div>
                <h3 className="text-base font-bold text-ink mb-1 line-clamp-2">
                  {activeCourse.title}
                </h3>
                <p className="text-caption text-ink-muted line-clamp-1">
                  Batch: {activeCourse.batch_name || 'Regular Classroom Program'}
                </p>
              </div>

              <div className="pt-3 border-t border-line mt-3">
                <Link
                  href={`/student/courses/${activeCourse.course_id}`}
                  className="w-full flex items-center justify-between px-3.5 py-2 rounded-field bg-brand hover:bg-brand-hover text-white transition-colors text-xs font-bold"
                >
                  <span>Continue Learning</span>
                  <IconPlay size={13} />
                </Link>
              </div>
            </div>

            {/* Quick 4-Link Matrix */}
            <div className="grid grid-cols-2 gap-2.5">
              <Link
                href="/student/courses"
                className="p-3 rounded-field bg-white border border-line hover:border-brand/40 transition-colors flex items-center gap-2.5"
              >
                <span className="h-8 w-8 rounded-lg bg-sky-tint text-brand flex items-center justify-center shrink-0">
                  <IconLibrary size={16} />
                </span>
                <span className="text-xs font-bold text-ink">My Courses</span>
              </Link>
              <Link
                href="/student/tests"
                className="p-3 rounded-field bg-white border border-line hover:border-brand/40 transition-colors flex items-center gap-2.5"
              >
                <span className="h-8 w-8 rounded-lg bg-sky-tint text-brand flex items-center justify-center shrink-0">
                  <IconTest size={16} />
                </span>
                <span className="text-xs font-bold text-ink">Mock Tests</span>
              </Link>
              <Link
                href="/student/results"
                className="p-3 rounded-field bg-white border border-line hover:border-brand/40 transition-colors flex items-center gap-2.5"
              >
                <span className="h-8 w-8 rounded-lg bg-sky-tint text-brand flex items-center justify-center shrink-0">
                  <IconProgress size={16} />
                </span>
                <span className="text-xs font-bold text-ink">Results</span>
              </Link>
              <Link
                href="/student/doubts"
                className="p-3 rounded-field bg-white border border-line hover:border-brand/40 transition-colors flex items-center gap-2.5"
              >
                <span className="h-8 w-8 rounded-lg bg-sky-tint text-brand flex items-center justify-center shrink-0">
                  <IconDoubt size={16} />
                </span>
                <span className="text-xs font-bold text-ink">Ask Doubts</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 4. Variant: Course-Only Buyer (Enrolled in courses, 0 PYQ)
  if (hasCourses && !hasPyq) {
    return (
      <section className="store-container py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-between p-6 sm:p-8 rounded-card bg-white border border-line shadow-xs">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-tint text-brand text-caption font-bold">
                  <IconLibrary size={14} />
                  <span>COURSE LEARNER</span>
                </span>
                {streamName && (
                  <span className="text-caption text-ink-secondary font-medium">
                    Goal: <strong className="text-ink">{streamName}</strong>
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight font-display mb-2">
                Welcome back, <span className="text-brand">{studentName}</span>.
              </h1>
              <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed max-w-lg mb-6">
                Your coursework is active. Resume your lessons or test your understanding with official past year papers.
              </p>
            </div>

            {/* Live Class Alert (if live) */}
            {liveClass && liveClass.status === 'live' && (
              <div className="p-3.5 rounded-field bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-white shrink-0 animate-pulse">
                    <IconPlay size={16} />
                  </span>
                  <div>
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white mb-0.5">
                      LIVE NOW
                    </span>
                    <p className="text-xs font-bold leading-tight line-clamp-1">{liveClass.title}</p>
                    <p className="text-caption text-rose-700">{liveClass.subject_name} · {liveClass.teacher_name}</p>
                  </div>
                </div>
                <Link
                  href="/student/classes"
                  className="px-3 py-1.5 rounded-field bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors shrink-0"
                >
                  Join Class →
                </Link>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-line">
              <Link
                href="/student/overview"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-colors shadow-xs"
              >
                <span>Open Student Portal</span>
                <IconArrowRight size={13} />
              </Link>
              <Link
                href="/pyq"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-paper hover:bg-sky-tint text-ink border border-line text-xs font-bold transition-colors"
              >
                <span>Add PYQ Practice Package ↗</span>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="p-5 sm:p-6 rounded-card bg-white border border-line shadow-xs flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 text-caption font-bold text-brand uppercase tracking-wider">
                    <IconLibrary size={13} />
                    <span>Current Course</span>
                  </span>
                  <Link
                    href="/student/courses"
                    className="text-caption font-bold text-ink-muted hover:text-brand transition-colors inline-flex items-center gap-1"
                  >
                    <span>{enrolledCourses.length} Courses</span>
                    <IconArrowRight size={11} />
                  </Link>
                </div>
                <h3 className="text-base font-bold text-ink mb-1 line-clamp-2">
                  {activeCourse.title}
                </h3>
                <p className="text-caption text-ink-muted line-clamp-1">
                  Batch: {activeCourse.batch_name || 'Classroom Program'}
                </p>
              </div>

              <div className="pt-3 border-t border-line mt-3">
                <Link
                  href={`/student/courses/${activeCourse.course_id}`}
                  className="w-full flex items-center justify-between px-3.5 py-2 rounded-field bg-brand hover:bg-brand-hover text-white transition-colors text-xs font-bold"
                >
                  <span>Continue Learning</span>
                  <IconPlay size={13} />
                </Link>
              </div>
            </div>

            {/* PYQ Upsell Card */}
            <div className="p-4 rounded-card bg-paper border border-line flex items-center justify-between gap-3">
              <div>
                <span className="text-caption font-bold text-ink-muted uppercase tracking-wide">Practice Past Papers</span>
                <p className="text-xs font-bold text-ink mt-0.5">Solve real questions from previous years</p>
              </div>
              <Link
                href="/pyq"
                className="px-3 py-1.5 rounded-field bg-white border border-line hover:border-brand text-ink text-xs font-bold transition-colors shrink-0"
              >
                Browse PYQ →
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 5. Variant: PYQ-Only Buyer (0 courses, ≥1 PYQ)
  if (!hasCourses && hasPyq) {
    return (
      <section className="store-container py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-between p-6 sm:p-8 rounded-card bg-white border border-line shadow-xs">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-tint text-brand text-caption font-bold">
                  <IconPyq size={14} />
                  <span>PYQ PRACTICE PASS</span>
                </span>
                {streamName && (
                  <span className="text-caption text-ink-secondary font-medium">
                    Goal: <strong className="text-ink">{streamName}</strong>
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight font-display mb-2">
                Welcome back, <span className="text-brand">{studentName}</span>.
              </h1>
              <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed max-w-lg mb-6">
                Your PYQ practice package is active. Take tests, review detailed step-by-step solutions, and monitor your accuracy.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-line">
              <Link
                href="/student/tests"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-colors shadow-xs"
              >
                <span>Take Practice Tests</span>
                <IconArrowRight size={13} />
              </Link>
              <Link
                href="/courses"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-button bg-paper hover:bg-sky-tint text-ink border border-line text-xs font-bold transition-colors"
              >
                <span>Explore Full Courses ↗</span>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="p-5 sm:p-6 rounded-card bg-white border border-line shadow-xs flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 text-caption font-bold text-brand uppercase tracking-wider">
                    <IconPyq size={13} />
                    <span>Active PYQ Package</span>
                  </span>
                  <Link
                    href="/student/tests"
                    className="text-caption font-bold text-ink-muted hover:text-brand transition-colors inline-flex items-center gap-1"
                  >
                    <span>{pyqPurchases.length} Packages</span>
                    <IconArrowRight size={11} />
                  </Link>
                </div>
                <h3 className="text-base font-bold text-ink mb-1 line-clamp-2">
                  {activePyq.packageName || 'Official Past Year Papers'}
                </h3>
                <p className="text-caption text-ink-muted">
                  Full question bank access with instant answer explanations
                </p>
              </div>

              <div className="pt-3 border-t border-line mt-3">
                <Link
                  href="/student/tests"
                  className="w-full flex items-center justify-between px-3.5 py-2 rounded-field bg-brand hover:bg-brand-hover text-white transition-colors text-xs font-bold"
                >
                  <span>Start Practice</span>
                  <IconTest size={13} />
                </Link>
              </div>
            </div>

            {/* Course Upsell Card */}
            <div className="p-4 rounded-card bg-paper border border-line flex items-center justify-between gap-3">
              <div>
                <span className="text-caption font-bold text-ink-muted uppercase tracking-wide">Structured Theory Batches</span>
                <p className="text-xs font-bold text-ink mt-0.5">Learn concepts from expert faculty</p>
              </div>
              <Link
                href="/courses"
                className="px-3 py-1.5 rounded-field bg-white border border-line hover:border-brand text-ink text-xs font-bold transition-colors shrink-0"
              >
                View Batches →
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 6. Variant: No Purchases Yet (Logged in, 0 courses, 0 PYQ)
  return (
    <section className="store-container py-8 lg:py-12">
      <div className="p-6 sm:p-8 rounded-card bg-white border border-line shadow-xs">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-tint text-brand text-caption font-bold mb-3">
            <IconSpark size={14} />
            <span>GETTING STARTED</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight font-display mb-2">
            Welcome back, <span className="text-brand">{studentName}</span>.
          </h1>
          <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed mb-6">
            You haven&apos;t enrolled in any courses or practice packages yet. Explore our structured classroom batches or test series below to begin your journey.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/courses"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-button bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-colors shadow-xs"
            >
              <span>Browse Courses</span>
              <IconArrowRight size={13} />
            </Link>
            <Link
              href="/pyq"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-button bg-paper hover:bg-sky-tint text-ink border border-line text-xs font-bold transition-colors"
            >
              <span>Explore PYQ Packages</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
