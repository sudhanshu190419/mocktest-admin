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
  WarningCircle,
  ArrowRight,
  ArrowSquareOut,
  CalendarCheck,
  Lightning,
  Play,
  FileText,
  GraduationCap,
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

  const rawName = data?.profile?.name || teacherProfile?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Student';
  const studentName = rawName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  const streamName = data?.selectedStreamName || 'Competitive Exam Prep';
  const activeBatch = data?.activeBatches && data.activeBatches.length > 0 ? data.activeBatches[0].name : 'Active Enrolled Batch';

  // ── SKELETON LOADER ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="store-container space-y-6 animate-pulse">
        {/* Hero Skeleton */}
        <div className="student-hero-banner h-48 bg-white/70" />

        {/* 4 KPIs Skeleton */}
        <div className="student-kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-white border border-slate-100" />
          ))}
        </div>

        {/* Split Grid Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-72 rounded-3xl bg-white border border-slate-100" />
          <div className="lg:col-span-5 h-72 rounded-3xl bg-white border border-slate-100" />
        </div>
      </div>
    );
  }

  // ── ERROR STATE ──────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="store-container">
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
      </div>
    );
  }

  const liveClass = data?.liveClass;
  const enrolledCourses = data?.enrolledCourses || [];
  const weakChapters = data?.weakChapters || [];
  const recentResults = data?.recentResults || [];
  const assignedMockTests = data?.assignedMockTests || [];

  return (
    <div className="store-container space-y-7 pb-12">
      
      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1 — WELCOME & STUDENT CONTEXT HERO BANNER (Design A)
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="student-hero-banner">
        <div className="student-hero-header">
          <div>
            <div className="student-pill student-pill-sky mb-3">
              <Sparkle size={13} weight="fill" />
              <span>{streamName}</span>
              <span className="opacity-40">•</span>
              <span>{activeBatch}</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
              Welcome back, {studentName}.
            </h1>
            <p className="student-hero-lead">
              Pick up where you left off, take your next mock test, or review your personalized study recommendations.
            </p>
          </div>

          <div className="student-hero-actions">
            <Link
              href="/student/courses"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-store-blue text-white font-bold text-xs hover:opacity-90 transition-all shadow-sm"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
            >
              <BookOpen size={16} weight="bold" />
              <span>Continue Learning</span>
            </Link>
            <Link
              href="/student/tests"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all shadow-xs"
            >
              <Exam size={16} weight="bold" />
              <span>Mock Tests</span>
            </Link>
            <Link
              href="/courses"
              className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl text-slate-600 hover:text-slate-900 text-xs font-semibold transition-all"
            >
              <span>Explore Catalog</span>
              <ArrowSquareOut size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2 — LIVE NOW / NEXT SCHEDULED CLASS BANNER
         ═══════════════════════════════════════════════════════════════════ */}
      {liveClass ? (
        <section className={`student-live-hero ${
          liveClass.status === 'live'
            ? 'border-emerald-300'
            : 'border-blue-200'
        }`}>
          <div className="flex items-start sm:items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl shrink-0 ${
              liveClass.status === 'live'
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25 animate-pulse'
                : 'bg-store-blue text-white shadow-md'
            }`} style={{ backgroundColor: liveClass.status === 'live' ? '#10b981' : 'var(--color-store-blue)' }}>
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
                  <span className="student-pill student-pill-sky">
                    <Clock size={12} weight="bold" /> Upcoming Lecture
                  </span>
                )}
                <span className="text-xs font-bold text-slate-400">•</span>
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
              className="w-full sm:w-auto px-5 py-3 rounded-xl font-extrabold text-xs tracking-wide shadow-md flex items-center justify-center gap-2 text-white transition-all"
              style={{ backgroundColor: liveClass.status === 'live' ? '#10b981' : 'var(--color-store-blue)' }}
            >
              <Play size={16} weight="fill" />
              <span>{liveClass.status === 'live' ? 'Join Classroom Now' : 'Class Details'}</span>
            </Link>
          </div>
        </section>
      ) : (
        <section className="student-card flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-store-sky text-store-blue" style={{ background: 'var(--color-store-sky)', color: 'var(--color-store-blue)' }}>
              <CalendarCheck size={22} weight="duotone" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">No Live Class in Session</p>
              <p className="text-[11px] text-slate-500">Check your weekly timetable or recorded lectures archive.</p>
            </div>
          </div>
          <Link
            href="/student/timetable"
            className="px-4 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs transition-colors"
          >
            Timetable &rarr;
          </Link>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3 — ACADEMIC PERFORMANCE SNAPSHOT (4 KPIS)
         ═══════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="student-section-header">
          <h2 className="flex items-center gap-2">
            <TrendUp size={18} weight="bold" style={{ color: 'var(--color-store-blue)' }} />
            <span>Academic Performance Snapshot</span>
          </h2>
          <span className="text-xs text-slate-400 font-medium">Real-time metrics</span>
        </div>

        <div className="student-kpi-grid">
          {/* Tile 1: Tests Attempted */}
          <div className="student-kpi-card">
            <div className="student-kpi-top">
              <span className="student-kpi-label">Mock Tests</span>
              <div className="student-kpi-icon-box">
                <Exam size={18} weight="duotone" />
              </div>
            </div>
            <div className="student-kpi-value tabular-nums">
              {data?.analytics?.testsAttempted ?? 0}
            </div>
            <p className="student-kpi-sub">Completed Evaluations</p>
          </div>

          {/* Tile 2: Avg Score */}
          <div className="student-kpi-card">
            <div className="student-kpi-top">
              <span className="student-kpi-label">Average Score</span>
              <div className="student-kpi-icon-box" style={{ background: 'var(--color-store-mint)', color: 'var(--color-store-green)' }}>
                <CheckCircle size={18} weight="duotone" />
              </div>
            </div>
            <div className="student-kpi-value tabular-nums" style={{ color: 'var(--color-store-green)' }}>
              {data?.analytics?.averageScore ?? 0}%
            </div>
            <p className="student-kpi-sub">Across All Assessments</p>
          </div>

          {/* Tile 3: Accuracy */}
          <div className="student-kpi-card">
            <div className="student-kpi-top">
              <span className="student-kpi-label">Overall Accuracy</span>
              <div className="student-kpi-icon-box" style={{ background: 'var(--color-store-lilac)', color: 'var(--color-store-violet)' }}>
                <Target size={18} weight="duotone" />
              </div>
            </div>
            <div className="student-kpi-value tabular-nums" style={{ color: 'var(--color-store-violet)' }}>
              {data?.analytics?.accuracy ?? 0}%
            </div>
            <p className="student-kpi-sub">Correct vs Attempted</p>
          </div>

          {/* Tile 4: Percentile / Rank */}
          <div className="student-kpi-card">
            <div className="student-kpi-top">
              <span className="student-kpi-label">Class Standing</span>
              <div className="student-kpi-icon-box" style={{ background: 'var(--color-store-sand)', color: '#854d0e' }}>
                <Lightning size={18} weight="duotone" />
              </div>
            </div>
            <div className="student-kpi-value tabular-nums" style={{ color: '#854d0e' }}>
              {data?.analytics?.percentile !== null && data?.analytics?.percentile !== undefined
                ? `${data.analytics.percentile}th %`
                : data?.analytics?.rank && data?.analytics?.rank !== '--'
                ? data.analytics.rank
                : '--'}
            </div>
            <p className="student-kpi-sub">Batch Percentile Benchmark</p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 4 — CONTINUE LEARNING / MY ENROLLED COURSES
         ═══════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="student-section-header">
          <h2 className="flex items-center gap-2">
            <BookOpen size={18} weight="bold" style={{ color: 'var(--color-store-blue)' }} />
            <span>Continue Learning (My Courses)</span>
          </h2>
          <Link href="/student/courses" className="text-xs font-bold hover:underline" style={{ color: 'var(--color-store-blue)' }}>
            All Courses &rarr;
          </Link>
        </div>

        {enrolledCourses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {enrolledCourses.map((course) => {
              const summary = data?.courseContentSummary?.[course.course_id] || [];
              const totalLectures = Array.isArray(summary)
                ? summary.reduce((a: number, c: any) => a + (c.total_lectures || c.contentCountsByType?.video || 0), 0)
                : 0;
              const totalPdfs = Array.isArray(summary)
                ? summary.reduce((a: number, c: any) => a + (c.total_materials || (c.contentCountsByType?.pdf || 0) + (c.contentCountsByType?.notes || 0)), 0)
                : 0;

              const firstBatchSubjectId = Array.isArray(summary) && summary.length > 0
                ? (summary[0]?.batchSubjectId || summary[0]?.batch_subject_id || null)
                : null;

              const resumeHref = firstBatchSubjectId
                ? `/student/courses/${course.course_id}/subjects/${firstBatchSubjectId}`
                : `/student/courses/${course.course_id}`;

              return (
                <article
                  key={course.course_id}
                  className="student-card flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div>
                      <span className="student-pill student-pill-sky mb-2">
                        {course.category || 'Core Program'}
                      </span>
                      <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                        {course.title}
                      </h3>
                    </div>

                    <p className="text-xs text-slate-500">
                      Batch: <strong className="text-slate-700 font-semibold">{course.batch_name || activeBatch}</strong>
                    </p>

                    <div className="flex items-center gap-4 text-xs text-slate-500 pt-1">
                      <span className="flex items-center gap-1.5">
                        <Play size={14} style={{ color: 'var(--color-store-blue)' }} />
                        <span>{totalLectures > 0 ? `${totalLectures} Lectures` : 'Lectures Included'}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <FileText size={14} style={{ color: 'var(--color-store-green)' }} />
                        <span>{totalPdfs > 0 ? `${totalPdfs} Study PDFs` : 'Formula Notes'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-end">
                    <Link
                      href={resumeHref}
                      className="inline-flex items-center gap-1.5 text-xs font-bold transition-colors"
                      style={{ color: 'var(--color-store-blue)' }}
                    >
                      <span>Continue Learning</span>
                      <ArrowRight size={14} weight="bold" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="student-card text-center p-8 sm:p-10">
            <GraduationCap size={40} className="text-slate-400 mx-auto mb-2" weight="duotone" />
            <h3 className="text-sm font-bold text-slate-900 mb-1">No Active Courses Enrolled</h3>
            <p className="text-xs text-slate-500 mb-4">Contact your academic administrator to enroll in your target batch courses, or explore available programs.</p>
            <Link
              href="/courses"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white font-bold text-xs hover:opacity-90 transition-colors shadow-xs"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
            >
              <span>Explore Courses</span>
              <ArrowSquareOut size={14} />
            </Link>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 5 — SPLIT GRID: TESTS + RESULTS + WEAK AREAS
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (Span 7) — Assigned Tests & Recent Results */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Recent Test Result Card */}
          {recentResults.length > 0 && (
            <div className="student-card space-y-4" style={{ background: 'linear-gradient(135deg, #ffffff 0%, var(--color-store-paper) 100%)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--color-store-mint)', color: 'var(--color-store-green)' }}>
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
                  <span className="text-xl font-black block leading-tight tabular-nums" style={{ color: 'var(--color-store-green)' }}>
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
                  <span className="text-xs font-black text-slate-900 tabular-nums">{recentResults[0].accuracy}%</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-500 block">Submitted</span>
                  <span className="text-xs font-black text-slate-900">
                    {new Date(recentResults[0].submitted_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-500 block">Status</span>
                  <span className="text-xs font-black" style={{ color: 'var(--color-store-green)' }}>Evaluated</span>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Link
                  href={
                    recentResults[0].attempt_id && recentResults[0].test_id
                      ? `/student/tests/${recentResults[0].test_id}/results/${recentResults[0].attempt_id}`
                      : '/student/results'
                  }
                  className="text-xs font-bold hover:underline flex items-center gap-1.5"
                  style={{ color: 'var(--color-store-blue)' }}
                >
                  <span>Review Solutions & Explanations</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          )}

          {/* Active / Assigned Mock Tests */}
          <div className="student-card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Exam size={16} weight="bold" style={{ color: 'var(--color-store-blue)' }} />
                <span>Assigned Mock Tests</span>
              </h3>
              <Link href="/student/tests" className="text-xs font-bold hover:underline" style={{ color: 'var(--color-store-blue)' }}>
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
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between hover:bg-slate-100/70 transition-colors gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-xs font-bold text-slate-900 truncate">{test.title}</h4>
                          {test.subjectName && (
                            <span className="text-[10px] font-semibold text-slate-500 px-2 py-0.5 rounded-full bg-white border border-slate-200 shrink-0">
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
                              className="px-3 py-1.5 rounded-xl text-white font-bold text-[11px] transition-colors shadow-xs"
                              style={{ backgroundColor: 'var(--color-store-green)' }}
                            >
                              View Result
                            </Link>
                            {test.attemptSummary.canAttempt && (
                              <Link
                                href={`/student/tests/${test.testId}`}
                                className="px-3 py-1.5 rounded-xl text-white font-bold text-[11px] transition-colors shadow-xs"
                                style={{ backgroundColor: 'var(--color-store-blue)' }}
                              >
                                Retake Test
                              </Link>
                            )}
                          </>
                        ) : test.attemptSummary?.attemptState === 'in_progress' ? (
                          <Link
                            href={`/student/tests/${test.testId}`}
                            className="px-3.5 py-1.5 rounded-xl text-white font-bold text-[11px] transition-colors shadow-xs"
                            style={{ backgroundColor: 'var(--color-store-blue)' }}
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
                            className="px-3.5 py-1.5 rounded-xl text-white font-bold text-[11px] transition-colors shadow-xs"
                            style={{ backgroundColor: 'var(--color-store-blue)' }}
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
          <div className="student-card border-amber-200 space-y-4" style={{ background: 'linear-gradient(135deg, #fffbeb 0%, var(--color-store-white) 70%)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-900">
                <WarningCircle size={18} weight="duotone" className="text-amber-600" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider">
                  Target Focus Areas (&lt;60% Accuracy)
                </h3>
              </div>
              <span className={`student-pill ${
                weakChapters.length > 0 ? 'student-pill-apricot' : 'student-pill-sky'
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
                    className="p-3 rounded-2xl bg-white/90 border border-amber-100 flex items-center justify-between"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-amber-800 tracking-wider block">
                        {chap.subject_name}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900">{chap.chapter_name}</h4>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-rose-600 block tabular-nums">{chap.accuracy}%</span>
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
              <div className="p-4 rounded-2xl bg-white/70 border border-amber-100/80 text-center space-y-1.5">
                <p className="text-xs font-bold text-amber-900">No weak areas identified yet</p>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Complete mock tests to unlock personalized study recommendations and targeted chapter analytics.
                </p>
              </div>
            )}
          </div>

          {/* Quick Support / Ask a Doubt Card */}
          <div className="student-card space-y-3" style={{ background: 'linear-gradient(135deg, var(--color-store-sky) 0%, var(--color-store-white) 80%)' }}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-xs" style={{ backgroundColor: 'var(--color-store-blue)' }}>
                <GraduationCap size={20} weight="duotone" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">Have questions about a topic?</h4>
                <p className="text-[11px] text-slate-500">Ask expert faculty and get verified step-by-step solutions.</p>
              </div>
            </div>

            <Link
              href="/student/doubts"
              className="w-full py-2.5 rounded-xl text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-xs"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
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
