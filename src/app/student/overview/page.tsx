'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkle,
  VideoCamera,
  BookOpen,
  Exam,
  TrendUp,
  Target,
  Clock,
  CheckCircle,
  XCircle,
  WarningCircle,
  ArrowRight,
  ArrowSquareOut,
  CalendarCheck,
  Lightning,
  CircleNotch,
  Play,
  FileText,
  CaretRight,
  GraduationCap
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchCompleteStudentDashboard,
  type StudentDashboardSummary,
} from '@/services/student/studentDashboardWebService';

export default function StudentOverviewPage() {
  const { user, teacherProfile } = useAuth();
  const [data, setData] = useState<StudentDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchCompleteStudentDashboard();
      setData(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const studentName = data?.profile?.name || teacherProfile?.name || user?.email?.split('@')[0] || 'Student';
  const streamName = data?.selectedStreamName || 'Competitive Exam Prep';
  const activeBatch = data?.activeBatches && data.activeBatches.length > 0 ? data.activeBatches[0].name : 'Active Enrolled Batch';

  // Helper for subject icons
  const getSubjectEmoji = (name: string) => {
    const s = name.toLowerCase();
    if (s.includes('phy')) return '📘';
    if (s.includes('chem')) return '🧪';
    if (s.includes('bio')) return '🧬';
    if (s.includes('math')) return '📐';
    return '📚';
  };

  // ── SKELETON LOADER ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Hero Skeleton */}
        <div className="h-44 rounded-3xl bg-white/70 border border-sky-100 p-6 flex flex-col justify-between shadow-xs">
          <div className="h-6 w-48 bg-sky-100 rounded-full" />
          <div className="space-y-2">
            <div className="h-8 w-72 bg-slate-200 rounded-xl" />
            <div className="h-4 w-96 bg-slate-100 rounded-lg" />
          </div>
        </div>

        {/* Live Banner Skeleton */}
        <div className="h-28 rounded-3xl bg-emerald-50/60 border border-emerald-100 p-6" />

        {/* 4 KPIs Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-white/80 border border-slate-100 p-4" />
          ))}
        </div>

        {/* Content Split Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-72 rounded-3xl bg-white/70 border border-slate-100" />
          <div className="h-72 rounded-3xl bg-white/70 border border-slate-100" />
        </div>
      </div>
    );
  }

  // ── ERROR STATE ──────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="p-8 rounded-3xl bg-red-50 border border-red-200 text-center max-w-lg mx-auto my-12">
        <WarningCircle size={40} className="text-red-500 mx-auto mb-3" weight="duotone" />
        <h3 className="text-base font-bold text-red-900 mb-1">Unable to Load Student Dashboard</h3>
        <p className="text-xs text-red-700 mb-4 leading-relaxed">{error}</p>
        <button
          onClick={() => loadDashboard()}
          className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold text-xs hover:bg-red-700 transition-colors shadow-sm"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const liveClass = data?.liveClass;
  const enrolledCourses = data?.enrolledCourses || [];
  const subjectAnalytics = data?.subjectAnalytics || [];
  const weakChapters = data?.weakChapters || [];
  const recentResults = data?.recentResults || [];
  const assignedMockTests = data?.assignedMockTests || [];

  return (
    <div className="space-y-6 pb-12">
      
      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1 — WELCOME & STUDENT CONTEXT HERO BANNER
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-sky-600 via-sky-700 to-indigo-800 text-white p-6 sm:p-8 shadow-md shadow-sky-600/10">
        {/* Subtle Decorative Background Circles */}
        <div className="absolute -right-10 -bottom-10 w-64 h-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute left-1/2 -top-12 w-48 h-48 rounded-full bg-sky-400/20 blur-xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-xs font-semibold text-sky-100">
              <Sparkle size={13} weight="fill" className="text-amber-300" />
              <span>{streamName}</span>
              <span className="opacity-60">•</span>
              <span>{activeBatch}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-sans">
              Welcome back, {studentName}! 👋
            </h1>
            <p className="text-xs sm:text-sm text-sky-100/90 max-w-xl leading-relaxed">
              Your academic console is up-to-date. Review today’s scheduled lectures, take assigned mock tests, or dive into chapter notes.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/student/courses"
              className="px-4 py-2.5 rounded-2xl bg-white text-sky-800 hover:bg-sky-50 font-bold text-xs transition-all shadow-sm flex items-center gap-2 shrink-0"
            >
              <BookOpen size={16} weight="bold" />
              <span>Continue Learning</span>
            </Link>
            <Link
              href="/student/tests"
              className="px-4 py-2.5 rounded-2xl bg-sky-500/40 hover:bg-sky-500/60 border border-white/25 text-white font-bold text-xs transition-all flex items-center gap-2 shrink-0"
            >
              <Exam size={16} weight="bold" />
              <span>Mock Tests</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2 — LIVE NOW / NEXT SCHEDULED CLASS BANNER
         ═══════════════════════════════════════════════════════════════════ */}
      {liveClass ? (
        <div className={`p-5 sm:p-6 rounded-3xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm ${
          liveClass.status === 'live'
            ? 'bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-white border-emerald-300 shadow-emerald-500/5'
            : 'bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-white border-sky-200'
        }`}>
          <div className="flex items-start sm:items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl shrink-0 ${
              liveClass.status === 'live'
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25 animate-pulse'
                : 'bg-sky-600 text-white shadow-md shadow-sky-600/20'
            }`}>
              <VideoCamera size={24} weight="duotone" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {liveClass.status === 'live' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500 text-white uppercase tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                    Live Class Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 uppercase tracking-wider">
                    <Clock size={12} weight="bold" /> Upcoming Lecture
                  </span>
                )}
                <span className="text-xs font-bold text-slate-500">•</span>
                <span className="text-xs font-semibold text-slate-600">{liveClass.subject_name}</span>
              </div>

              <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
                {liveClass.title}
              </h2>
              <p className="text-xs text-slate-500">
                Faculty: <strong className="text-slate-700 font-semibold">{liveClass.teacher_name}</strong> •{' '}
                {new Date(liveClass.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({liveClass.duration_minutes} mins)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 pt-2 md:pt-0">
            <Link
              href="/student/classes"
              className={`w-full sm:w-auto px-5 py-3 rounded-2xl font-extrabold text-xs tracking-wide shadow-md flex items-center justify-center gap-2 transition-all ${
                liveClass.status === 'live'
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20'
                  : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-600/20'
              }`}
            >
              <Play size={16} weight="fill" />
              <span>{liveClass.status === 'live' ? 'Join Classroom Now' : 'Class Details'}</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="p-5 rounded-3xl bg-white border border-sky-100 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
              <CalendarCheck size={22} weight="duotone" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">No Live Class in Session</p>
              <p className="text-[11px] text-slate-500">Check your weekly timetable or recorded lectures archive.</p>
            </div>
          </div>
          <Link
            href="/student/timetable"
            className="px-3.5 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs transition-colors"
          >
            Timetable &rarr;
          </Link>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3 — ACADEMIC PERFORMANCE SNAPSHOT (4 KPIS)
         ═══════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <TrendUp size={16} weight="bold" className="text-sky-600" />
            <span>Academic Performance Snapshot</span>
          </h2>
          <span className="text-xs text-slate-500">Real-time metrics</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Tile 1: Tests Attempted */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Mock Tests</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                <Exam size={18} weight="duotone" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">
              {data?.analytics?.testsAttempted ?? 0}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Completed Evaluations</p>
          </div>

          {/* Tile 2: Avg Score */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Average Score</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <CheckCircle size={18} weight="duotone" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">
              {data?.analytics?.averageScore ?? 0}%
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Across All Assessments</p>
          </div>

          {/* Tile 3: Accuracy */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Overall Accuracy</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Target size={18} weight="duotone" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">
              {data?.analytics?.accuracy ?? 0}%
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Correct vs Attempted</p>
          </div>

          {/* Tile 4: Percentile / Rank */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Class Standing</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <Lightning size={18} weight="duotone" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">
              {data?.analytics?.percentile !== null && data?.analytics?.percentile !== undefined
                ? `${data.analytics.percentile}th %`
                : data?.analytics?.rank && data?.analytics?.rank !== '--'
                ? data.analytics.rank
                : '--'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Batch Percentile Benchmark</p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 4 — CONTINUE LEARNING / MY ENROLLED COURSES
         ═══════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <BookOpen size={16} weight="bold" className="text-sky-600" />
            <span>Continue Learning (My Courses)</span>
          </h2>
          <Link href="/student/courses" className="text-xs font-bold text-sky-600 hover:text-sky-700 hover:underline">
            All Courses &rarr;
          </Link>
        </div>

        {enrolledCourses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {enrolledCourses.map((course) => {
              const summary = data?.courseContentSummary?.[course.course_id] || [];
              const totalLectures = Array.isArray(summary) ? summary.reduce((a: number, c: any) => a + (c.total_lectures || 0), 0) : 0;
              const totalPdfs = Array.isArray(summary) ? summary.reduce((a: number, c: any) => a + (c.total_materials || 0), 0) : 0;

              return (
                <div
                  key={course.course_id}
                  className="p-5 rounded-3xl bg-white border border-slate-200/90 shadow-xs hover:border-sky-300 hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-100 uppercase tracking-wider mb-1.5">
                          {course.category || 'Core Program'}
                        </span>
                        <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                          {course.title}
                        </h3>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500">
                      Batch: <strong className="text-slate-700 font-semibold">{course.batch_name || activeBatch}</strong>
                    </p>

                    <div className="flex items-center gap-4 text-xs text-slate-500 pt-1">
                      <span className="flex items-center gap-1.5">
                        <Play size={14} className="text-sky-600" />
                        <span>{totalLectures > 0 ? `${totalLectures} Lectures` : 'Lectures Included'}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <FileText size={14} className="text-emerald-600" />
                        <span>{totalPdfs > 0 ? `${totalPdfs} Study PDFs` : 'Formula Notes'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-end">
                    <Link
                      href={`/student/courses/${course.course_id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 transition-colors"
                    >
                      <span>Continue Learning</span>
                      <ArrowRight size={14} weight="bold" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 rounded-3xl bg-white border border-slate-200 text-center">
            <GraduationCap size={40} className="text-slate-400 mx-auto mb-2" weight="duotone" />
            <h3 className="text-sm font-bold text-slate-900 mb-1">No Active Courses Enrolled</h3>
            <p className="text-xs text-slate-500 mb-4">Contact your academic administrator to enroll in your target batch courses.</p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 6 & 7 & 8 — SPLIT GRID: TESTS + RESULTS + WEAK AREAS
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (Span 7) — Assigned Tests & Recent Results */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Recent Test Result Card */}
          {recentResults.length > 0 && (
            <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-white to-slate-50 border border-slate-200/90 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <CheckCircle size={20} weight="duotone" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Latest Mock Test Scorecard
                    </span>
                    <h3 className="text-sm font-extrabold text-slate-900">
                      {recentResults[0].test_title}
                    </h3>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xl font-black text-emerald-600 block leading-tight">
                    {recentResults[0].score} / {recentResults[0].total_score}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {recentResults[0].percentage}% Score
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-100 text-center">
                <div className="p-2.5 rounded-xl bg-white border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-500 block">Accuracy</span>
                  <span className="text-xs font-black text-slate-900">{recentResults[0].accuracy}%</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-500 block">Submitted</span>
                  <span className="text-xs font-black text-slate-900">
                    {new Date(recentResults[0].submitted_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-500 block">Status</span>
                  <span className="text-xs font-black text-emerald-600">Evaluated</span>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Link
                  href={
                    recentResults[0].attempt_id && recentResults[0].test_id
                      ? `/student/tests/${recentResults[0].test_id}/results/${recentResults[0].attempt_id}`
                      : '/student/results'
                  }
                  className="text-xs font-bold text-sky-600 hover:text-sky-700 hover:underline flex items-center gap-1.5"
                >
                  <span>Review Solutions & Explanations</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          )}

          {/* Active / Assigned Mock Tests */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Exam size={16} weight="bold" className="text-purple-600" />
                <span>Assigned Mock Tests</span>
              </h3>
              <Link href="/student/tests" className="text-xs font-bold text-sky-600 hover:text-sky-700 hover:underline">
                View All &rarr;
              </Link>
            </div>

            {assignedMockTests.length > 0 ? (
              <div className="space-y-3">
                {assignedMockTests.slice(0, 3).map((test) => {
                  const attemptId = test.latestResult?.attemptId || test.attemptSummary?.latestAttemptId;
                  const resultHref = attemptId ? `/student/tests/${test.testId}/results/${attemptId}` : `/student/tests/${test.testId}`;

                  return (
                    <div
                      key={test.testId}
                      className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-xs font-bold text-slate-900 truncate">{test.title}</h4>
                          {test.subjectName && (
                            <span className="text-[10px] font-semibold text-slate-500 px-2 py-0.5 rounded-full bg-slate-100 shrink-0">
                              {test.subjectName}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {test.durationMin ? `⏱ ${test.durationMin} mins • ` : ''}
                          📝 {test.questionCount} Questions
                          {test.totalMarks !== null && test.totalMarks !== undefined ? ` • 🏆 ${test.totalMarks} Marks` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {test.attemptSummary?.attemptState === 'submitted' ? (
                          <>
                            <Link
                              href={resultHref}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-xs"
                            >
                              View Result
                            </Link>
                            {test.attemptSummary.canAttempt && (
                              <Link
                                href={`/student/tests/${test.testId}`}
                                className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] transition-colors shadow-xs"
                              >
                                Retake Test
                              </Link>
                            )}
                          </>
                        ) : test.attemptSummary?.attemptState === 'in_progress' ? (
                          <Link
                            href={`/student/tests/${test.testId}`}
                            className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] transition-colors shadow-xs"
                          >
                            Resume Test
                          </Link>
                        ) : test.attemptSummary?.attemptState === 'limit_reached' ? (
                          <Link
                            href={resultHref}
                            className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition-colors"
                          >
                            View Result
                          </Link>
                        ) : (
                          <Link
                            href={`/student/tests/${test.testId}`}
                            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition-colors shadow-xs"
                          >
                            Start Test
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1">
                <p className="text-xs font-bold text-slate-700">No Mock Tests Assigned</p>
                <p className="text-[11px] text-slate-500">
                  New mock tests assigned to your enrolled batches will appear here.
                </p>
              </div>
            )}
          </div>

        </div>

        {/* Right Column (Span 5) — Weak Areas & Study Focus */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Target Focus / Growth Areas (< 60% Accuracy) */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-amber-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-900">
                <WarningCircle size={18} weight="duotone" className="text-amber-600" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider">
                  Target Focus Areas (&lt;60% Accuracy)
                </h3>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                weakChapters.length > 0
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-slate-500 bg-slate-50 border-slate-200'
              }`}>
                {weakChapters.length > 0 ? 'Action Required' : 'Up to Date'}
              </span>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Based on your recent test evaluations, practicing these chapters will yield maximum score improvement.
            </p>

            {weakChapters.length > 0 ? (
              <div className="space-y-2.5">
                {weakChapters.map((chap) => (
                  <div
                    key={chap.chapter_id}
                    className="p-3 rounded-2xl bg-amber-50/50 border border-amber-100 flex items-center justify-between"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-amber-800 tracking-wider block">
                        {chap.subject_name}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900">{chap.chapter_name}</h4>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-rose-600 block">{chap.accuracy}%</span>
                      <Link
                        href="/student/tests"
                        className="text-[10px] font-bold text-amber-800 hover:underline"
                      >
                        Practice &rarr;
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-amber-50/40 border border-amber-100/80 text-center space-y-1.5">
                <p className="text-xs font-bold text-amber-900">No weak areas identified yet</p>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Complete mock tests to unlock personalized study recommendations and targeted chapter analytics.
                </p>
              </div>
            )}
          </div>

          {/* Quick Support / Ask a Doubt Card */}
          <div className="p-5 rounded-3xl bg-gradient-to-br from-indigo-50 to-sky-50 border border-indigo-100 shadow-xs space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
                <GraduationCap size={20} weight="duotone" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-indigo-950">Have questions about a topic?</h4>
                <p className="text-[11px] text-slate-500">Ask expert faculty and get verified step-by-step solutions.</p>
              </div>
            </div>

            <Link
              href="/student/doubts"
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-xs"
            >
              <span>Ask a Faculty Doubt</span>
              <ArrowSquareOut size={14} />
            </Link>
          </div>

        </div>

      </div>

    </div>
  );
}
