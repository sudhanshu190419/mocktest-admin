'use client';

import React from 'react';
import Link from 'next/link';
import {
  BookOpen,
  FileText,
  GraduationCap,
  Play,
  VideoCamera,
  ArrowRight,
  ChatCircleDots,
} from '@phosphor-icons/react';
import { ButtonLink } from './Button';
import type {
  StudentDashboardSummary,
  StudentEnrolledCourse,
  StudentLiveClassItem,
} from '@/services/student/studentDashboardWebService';

export interface StudentHomeHeroData {
  enrolledCourses?: StudentEnrolledCourse[];
  liveClass?: StudentLiveClassItem | null;
}

interface StudentHomeHeroProps {
  studentName: string;
  streamName?: string;
  data: StudentHomeHeroData | StudentDashboardSummary | null;
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

  // 1. Loading Skeleton — only show placeholder on cold start when no cached data exists
  if (loading && !isEnrolled) {
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
            <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-sky-100/70 via-sky-50/40 to-transparent rounded-full -mr-20 -mt-20 pointer-events-none" />

            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-2.5 mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 border border-sky-200/60 text-sky-700 text-[11px] font-bold tracking-wide">
                  <GraduationCap size={15} weight="fill" className="text-sky-600" />
                  STUDENT LEARNING HUB
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  Target: <strong className="text-slate-700">{streamName}</strong>
                </span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight font-display mb-3">
                Welcome back, <br />
                <span className="text-sky-600">{studentName}</span>.
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
            <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/70 shadow-xs relative overflow-hidden flex-1 flex flex-col justify-between">
              <div className="absolute top-0 right-0 p-6 opacity-5 text-slate-900 pointer-events-none">
                <BookOpen size={110} weight="duotone" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100/70 text-sky-700 text-[11px] font-bold tracking-wide">
                    <BookOpen size={13} weight="fill" className="text-sky-600" />
                    CURRENT ACTIVE COURSE
                  </span>
                  <Link
                    href="/student/courses"
                    className="text-xs text-slate-500 hover:text-sky-600 font-medium inline-flex items-center gap-1 transition-colors"
                  >
                    <span>{enrolledCourses.length} Enrolled {enrolledCourses.length === 1 ? 'Course' : 'Courses'}</span>
                    <ArrowRight size={12} weight="bold" />
                  </Link>
                </div>
                <h3 className="text-lg sm:text-xl font-bold font-display text-slate-900 mb-1 line-clamp-2">
                  {activeCourse.title}
                </h3>
                <p className="text-xs text-slate-500 line-clamp-1">
                  Batch: <span className="font-medium text-slate-700">{activeCourse.batch_name || 'Regular Classroom Program'}</span>
                </p>
              </div>

              <div className="relative z-10 pt-2.5 border-t border-slate-100 mt-2">
                <Link
                  href={`/student/courses/${activeCourse.course_id}`}
                  className="w-full flex items-center justify-between px-4 py-2 sm:py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white transition-all duration-200 shadow-xs hover:shadow-sm group"
                >
                  <span className="font-bold text-xs sm:text-sm inline-flex items-center gap-1.5">
                    <span>Continue Learning</span>
                    <ArrowRight size={13} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
                  </span>
                  <span className="w-7 h-7 rounded-full bg-white text-sky-600 flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform">
                    <Play size={13} weight="fill" className="ml-0.5" />
                  </span>
                </Link>
              </div>
            </div>

            {/* Quick 3-Link Shortcut Strip */}
            <div className="grid grid-cols-3 gap-3">
              {/* Card 1: My Courses */}
              <Link
                href="/student/courses"
                className="p-4 sm:p-4.5 rounded-[22px] bg-white border border-slate-200/70 shadow-xs hover:shadow-md hover:border-slate-300 transition-all duration-200 flex flex-col justify-between group"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="w-10 h-10 rounded-full bg-sky-100/90 text-sky-600 flex items-center justify-center shrink-0">
                    <BookOpen size={20} weight="fill" />
                  </span>
                  <span className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 group-hover:bg-sky-100 group-hover:translate-x-0.5 transition-all">
                    <ArrowRight size={13} weight="bold" />
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 leading-tight mb-0.5">My Courses</h4>
                  <p className="text-[11px] text-slate-500 font-normal leading-tight line-clamp-1">View all enrolled courses</p>
                </div>
              </Link>

              {/* Card 2: Mock Tests */}
              <Link
                href="/student/tests"
                className="p-4 sm:p-4.5 rounded-[22px] bg-white border border-slate-200/70 shadow-xs hover:shadow-md hover:border-slate-300 transition-all duration-200 flex flex-col justify-between group"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                    <FileText size={20} weight="fill" />
                  </span>
                  <span className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 group-hover:bg-sky-100 group-hover:translate-x-0.5 transition-all">
                    <ArrowRight size={13} weight="bold" />
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 leading-tight mb-0.5">Mock Tests</h4>
                  <p className="text-[11px] text-slate-500 font-normal leading-tight line-clamp-1">Practice and improve</p>
                </div>
              </Link>

              {/* Card 3: Ask Doubts */}
              <Link
                href="/student/doubts"
                className="p-4 sm:p-4.5 rounded-[22px] bg-white border border-slate-200/70 shadow-xs hover:shadow-md hover:border-slate-300 transition-all duration-200 flex flex-col justify-between group"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="w-10 h-10 rounded-full bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
                    <ChatCircleDots size={20} weight="fill" />
                  </span>
                  <span className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 group-hover:bg-sky-100 group-hover:translate-x-0.5 transition-all">
                    <ArrowRight size={13} weight="bold" />
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 leading-tight mb-0.5">Ask Doubts</h4>
                  <p className="text-[11px] text-slate-500 font-normal leading-tight line-clamp-1">Get help from experts</p>
                </div>
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
