'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  GraduationCap,
  Exam,
  User,
  Clock,
  PlayCircle,
  Warning,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import {
  fetchCourseDetailWorkspace,
  type CourseDetailWorkspaceData,
} from '@/services/student/studentCourseWebService';

export default function StudentCourseDetailPage() {
  const params = useParams();
  const courseId = params?.courseId as string;

  const [data, setData] = useState<CourseDetailWorkspaceData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!courseId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data: resData, error: resErr } = await fetchCourseDetailWorkspace(courseId);
      if (resErr) {
        setError(resErr);
      } else {
        setData(resData);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load course details');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [courseId]);

  if (isLoading) {
    return (
      <div className="store-container space-y-6 animate-pulse">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="student-hero-banner h-48 bg-white/70" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="student-card h-64" />
          <div className="student-card h-64" />
          <div className="student-card h-64" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="store-container">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center max-w-lg mx-auto my-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <Warning className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900">Access Restricted or Course Not Found</h3>
          <p className="mt-1 text-xs text-slate-600 max-w-sm mx-auto">
            {error || 'You do not have active enrollment access to this course syllabus.'}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              onClick={loadData}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <ArrowsClockwise className="h-3.5 w-3.5" />
              Retry
            </button>
            <Link
              href="/student/courses"
              className="inline-flex items-center gap-1.5 rounded-xl text-white px-4 py-2 text-xs font-bold hover:opacity-90"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to My Courses
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { course, subjects, assignedMockTests } = data;

  return (
    <div className="store-container space-y-7 pb-12">
      {/* ── Breadcrumbs & Back Navigation ────────────────────────────────────── */}
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link href="/student/courses">My Courses</Link>
        <span aria-hidden="true">/</span>
        <span>{course.title}</span>
      </nav>

      {/* ── Top Hero Card ───────────────────────────────────────────────────── */}
      <section className="student-hero-banner">
        <div className="student-hero-header">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="student-pill student-pill-sky">
                <GraduationCap className="h-3.5 w-3.5" />
                {course.category}
              </span>
              <span className="inline-flex items-center rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {course.batchName} {course.batchCode ? `· ${course.batchCode}` : ''}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              {course.title}
            </h1>
            {course.description && (
              <p className="student-hero-lead">
                {course.description}
              </p>
            )}
          </div>

          {/* Quick Metrics Badge */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div className="student-card p-3.5 text-center min-w-[110px]" style={{ background: 'var(--color-store-sky)' }}>
              <p className="text-[11px] font-bold text-slate-500 uppercase">Progress</p>
              <p className="text-xl font-black tabular-nums" style={{ color: 'var(--color-store-blue)' }}>{course.progress}%</p>
            </div>
            <div className="student-card p-3.5 text-center min-w-[110px]" style={{ background: 'var(--color-store-mint)' }}>
              <p className="text-[11px] font-bold text-slate-500 uppercase">Subjects</p>
              <p className="text-xl font-black tabular-nums" style={{ color: 'var(--color-store-green)' }}>{subjects.length}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 1: Subject Learning Tracks ──────────────────────────────── */}
      <section className="space-y-4">
        <div className="student-section-header">
          <div>
            <h2>Enrolled Subject Modules</h2>
            <p className="text-xs text-slate-500">
              Select a subject track to enter the learning workspace, watch lectures, and download notes.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">{subjects.length} Subjects Available</span>
        </div>

        {subjects.length === 0 ? (
          <div className="student-card text-center p-8">
            <p className="text-sm font-semibold text-slate-600">No subject tracks assigned yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {subjects.map((sub) => (
              <div
                key={sub.batchSubjectId || sub.subjectId}
                className="student-card group flex flex-col justify-between hover:-translate-y-1 transition-all"
              >
                <div>
                  {/* Top: Emoji + Subject Name */}
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl shadow-xs"
                      style={{ backgroundColor: `${sub.color}15` }}
                    >
                      {sub.emoji}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 group-hover:text-store-blue transition-colors">
                        {sub.subjectName}
                      </h3>
                      {sub.code && (
                        <span className="text-[11px] font-semibold text-slate-400">Code: {sub.code}</span>
                      )}
                    </div>
                  </div>

                  {/* Teacher Info */}
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600 border border-slate-100">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    <span className="truncate">
                      Faculty: <strong className="text-slate-800">{sub.teacherName || 'Assigned Department'}</strong>
                    </span>
                  </div>

                  {/* Content Breakdown Metrics */}
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl p-2" style={{ background: 'var(--color-store-sky)' }}>
                      <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-store-blue)' }}>{sub.videoCount}</p>
                      <p className="text-[10px] text-slate-500">Lectures</p>
                    </div>
                    <div className="rounded-xl p-2" style={{ background: 'var(--color-store-mint)' }}>
                      <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-store-green)' }}>{sub.pdfCount + sub.notesCount}</p>
                      <p className="text-[10px] text-slate-500">Notes/PDFs</p>
                    </div>
                    <div className="rounded-xl p-2" style={{ background: 'var(--color-store-lilac)' }}>
                      <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-store-violet)' }}>{sub.mockTestsCount}</p>
                      <p className="text-[10px] text-slate-500">Tests</p>
                    </div>
                  </div>
                </div>

                {/* Open Workspace Action */}
                <div className="mt-6 border-t border-slate-100 pt-4">
                  <Link
                    href={`/student/courses/${course.courseId}/subjects/${sub.batchSubjectId || sub.subjectId}`}
                    className="flex w-full items-center justify-center gap-2 rounded-xl text-white px-4 py-2.5 text-xs font-bold shadow-xs hover:opacity-95 transition-all"
                    style={{ backgroundColor: 'var(--color-store-blue)' }}
                  >
                    <PlayCircle className="h-4 w-4" />
                    Open Subject Workspace
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Assigned Course Mock Tests ───────────────────────────── */}
      {assignedMockTests && assignedMockTests.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-slate-200">
          <div className="student-section-header">
            <div>
              <h2>Assigned Mock Assessments</h2>
              <p className="text-xs text-slate-500">
                Official course tests mapped to your enrolled batch.
              </p>
            </div>
            <Link
              href="/student/tests"
              className="text-xs font-bold hover:underline"
              style={{ color: 'var(--color-store-blue)' }}
            >
              View All Tests ({assignedMockTests.length}) →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignedMockTests.map((test) => {
              const attempt = test.attemptSummary;
              const isAvailable = test.status === 'available';

              let badgeText = isAvailable ? '● Ready to Attempt' : test.status;
              let badgePillClass = 'student-pill-sky';

              if (attempt) {
                if (attempt.attemptState === 'in_progress') {
                  badgeText = '● In Progress (Resume)';
                  badgePillClass = 'student-pill-sand';
                } else if (attempt.attemptState === 'limit_reached') {
                  badgeText = 'Attempts Exhausted';
                  badgePillClass = 'student-pill-apricot';
                } else if (attempt.attemptState === 'submitted') {
                  badgeText = '● Attempted / Submitted';
                  badgePillClass = 'student-pill-mint';
                }
              }

              const actionLabel = attempt?.actionLabel || 'Start Test Assessment →';
              const actionHref = attempt?.actionHref || '/student/tests';

              return (
                <div
                  key={test.testId}
                  className="student-card flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="student-pill student-pill-lilac">
                        {test.subjectName || 'Course Assessment'}
                      </span>
                      <span className={`student-pill ${badgePillClass}`}>
                        {badgeText}
                      </span>
                    </div>

                    <h3 className="mt-2 text-sm font-bold text-slate-900">{test.title}</h3>
                    {test.description && (
                      <p className="mt-1 text-xs text-slate-500 line-clamp-1">{test.description}</p>
                    )}

                    <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {test.durationMin !== null ? `${test.durationMin} mins` : 'Flexible'}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Exam className="h-3.5 w-3.5" style={{ color: 'var(--color-store-blue)' }} />
                        {test.totalMarks !== null ? `${test.totalMarks} marks` : 'Configured'}
                      </span>
                      <span>·</span>
                      <span>{test.questionCount > 0 ? `${test.questionCount} Questions` : 'Questions attached'}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end border-t border-slate-100 pt-3">
                    <a
                      href={actionHref}
                      className="inline-flex items-center gap-1 text-xs font-bold hover:underline"
                      style={{ color: 'var(--color-store-blue)' }}
                    >
                      {actionLabel}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
