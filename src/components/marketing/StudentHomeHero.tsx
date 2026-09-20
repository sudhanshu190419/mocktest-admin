'use client';

import React from 'react';
import Link from 'next/link';
import {
  BookOpen,
  GraduationCap,
  Play,
  VideoCamera,
  ArrowRight,
  ChatCircleDots,
} from '@phosphor-icons/react';
import { ButtonLink } from './Button';
import type { StudentDashboardSummary } from '@/services/student/studentDashboardWebService';

interface StudentHomeHeroProps {
  studentName: string;
  streamName?: string;
  data: StudentDashboardSummary | null;
  loading: boolean;
}

export function StudentHomeHero({
  studentName,
  streamName = 'NEET / JEE 2026',
  data,
  loading,
}: StudentHomeHeroProps) {
  const enrolledCourses = data?.enrolledCourses || [];
  const liveClass = data?.liveClass;
  const isEnrolled = enrolledCourses.length > 0;
  const activeCourse = enrolledCourses[0];

  // 1. Loading Skeleton
  if (loading) {
    return (
      <section className="store-container py-10 lg:py-12">
        <div className="h-64 rounded-3xl bg-white/70 animate-pulse border border-slate-200/60" />
      </section>
    );
  }

  // 2. State A: Enrolled Student (1+ courses)
  if (isEnrolled) {
    return (
      <section className="store-container py-10 lg:py-14">
        {/* Top Greeting & Status */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Column: Welcome & Quick-Jump */}
          <div className="lg:col-span-7 flex flex-col justify-between p-8 sm:p-10 rounded-3xl bg-white border border-slate-200/70 shadow-xs relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-blue-50/70 via-sky-50/40 to-transparent rounded-full -mr-20 -mt-20 pointer-events-none" />

            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-2.5 mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200/60 text-blue-700 text-[11px] font-bold tracking-wide">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  STUDENT LEARNING HUB
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  Target: <strong className="text-slate-700">{streamName}</strong>
                </span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight font-display mb-3">
                Welcome back, <br />
                <span className="text-blue-600">{studentName}</span>.
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed max-w-lg mb-6">
                Your preparation is active. Jump straight back into your ongoing curriculum, join live classes, or take scheduled mock tests.
              </p>
            </div>

            {/* Live Class Alert (if live) */}
            {liveClass && liveClass.status === 'live' ? (
              <div className="relative z-10 p-4 rounded-2xl bg-gradient-to-r from-red-500 to-rose-600 text-white flex items-center justify-between gap-4 mb-6 shadow-md">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
                    <VideoCamera size={20} weight="fill" />
                  </span>
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-white text-red-600 mb-0.5">
                      LIVE NOW
                    </span>
                    <p className="text-xs font-bold leading-tight line-clamp-1">{liveClass.title}</p>
                    <p className="text-[11px] text-white/80">{liveClass.subject_name} · {liveClass.teacher_name}</p>
                  </div>
                </div>
                <Link
                  href="/student/classes"
                  className="px-3.5 py-1.5 rounded-xl bg-white text-red-600 text-xs font-bold hover:bg-red-50 transition-colors shrink-0"
                >
                  Join Class →
                </Link>
              </div>
            ) : null}

            {/* Quick Actions Row */}
            <div className="relative z-10 flex flex-wrap items-center gap-3 pt-4 border-t border-slate-100">
              <ButtonLink
                href="/student/overview"
                className="store-enroll-button !mt-0 !w-auto inline-flex items-center gap-2 text-xs font-bold"
              >
                <span>Open Student Portal</span>
                <ArrowRight size={14} weight="bold" />
              </ButtonLink>
              <ButtonLink
                href="/courses"
                variant="secondary"
                className="!w-auto inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <span>Browse Full Catalog ↗</span>
              </ButtonLink>
            </div>
          </div>

          {/* Right Column: Active Enrolled Course Card & Hub Shortcuts */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Ongoing Course Spotlight */}
            <div className="p-6 rounded-3xl bg-slate-900 text-white shadow-md relative overflow-hidden flex-1 flex flex-col justify-between">
              <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                <BookOpen size={120} weight="duotone" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="px-2.5 py-1 rounded-md bg-blue-500/20 text-blue-300 text-[10px] font-black uppercase tracking-wider border border-blue-400/30">
                    CURRENT ACTIVE COURSE
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {enrolledCourses.length} Enrolled {enrolledCourses.length === 1 ? 'Course' : 'Courses'}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold font-display text-white mb-2 line-clamp-2">
                  {activeCourse.title}
                </h3>
                <p className="text-xs text-slate-300 mb-4 line-clamp-1">
                  Batch: {activeCourse.batch_name || 'Regular Classroom Program'}
                </p>
              </div>

              <div className="relative z-10 pt-4 border-t border-white/10">
                <Link
                  href={`/student/courses/${activeCourse.course_id}`}
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors shadow-sm"
                >
                  <span>Continue Learning</span>
                  <Play size={14} weight="fill" />
                </Link>
              </div>
            </div>

            {/* Quick 3-Link Shortcut Strip */}
            <div className="grid grid-cols-3 gap-2">
              <Link
                href="/student/courses"
                className="p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/40 text-center transition-all group"
              >
                <BookOpen size={18} className="mx-auto text-blue-600 mb-1 group-hover:scale-110 transition-transform" />
                <span className="block text-[11px] font-bold text-slate-800 leading-tight">My Courses</span>
              </Link>
              <Link
                href="/student/tests"
                className="p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/40 text-center transition-all group"
              >
                <GraduationCap size={18} className="mx-auto text-indigo-600 mb-1 group-hover:scale-110 transition-transform" />
                <span className="block text-[11px] font-bold text-slate-800 leading-tight">Mock Tests</span>
              </Link>
              <Link
                href="/student/doubts"
                className="p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/40 text-center transition-all group"
              >
                <ChatCircleDots size={18} className="mx-auto text-amber-600 mb-1 group-hover:scale-110 transition-transform" />
                <span className="block text-[11px] font-bold text-slate-800 leading-tight">Ask Doubts</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 3. Fallback: Not enrolled (handled by HeroCarousel in MarketingHomeView)
  return null;
}
