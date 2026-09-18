'use client';

/**
 * Student Course Details / Syllabus Overview Page
 * (/student/courses/[courseId])
 *
 * Displays course syllabus, subject tracks, content breakdown, and mock tests.
 *
 * @module app/student/courses/[courseId]/page
 */

import React, { useEffect, useState } from 'react';
import {
  useParams,
  useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CaretRight,
  ArrowLeft,
  GraduationCap,
  BookOpen,
  VideoCamera,
  FileText,
  Exam,
  User,
  Clock,
  PlayCircle,
  CheckCircle,
  Warning,
  ArrowsClockwise,
  Sparkle
} from '@phosphor-icons/react';
import {
  fetchCourseDetailWorkspace,
  type CourseDetailWorkspaceData,
} from '@/services/student/studentCourseWebService';

export default function StudentCourseDetailPage() {
  const params = useParams();
  const router = useRouter();
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
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="h-48 rounded-2xl bg-slate-200" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-64 rounded-2xl bg-slate-200" />
          <div className="h-64 rounded-2xl bg-slate-200" />
          <div className="h-64 rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to My Courses
          </Link>
        </div>
      </div>
    );
  }

  const { course, subjects, assignedMockTests, totalContentCount, completedContentCount } = data;

  return (
    <div className="space-y-6">
      {/* ── Breadcrumbs & Back Navigation ────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Link href="/student/courses" className="hover:text-sky-600">
          My Courses
        </Link>
        <CaretRight className="h-3 w-3" />
        <span className="text-slate-800 font-semibold">{course.title}</span>
      </div>

      {/* ── Top Hero Card ───────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-sky-700 via-sky-600 to-indigo-700 p-6 md:p-8 text-white shadow-sm">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-md">
                <GraduationCap className="h-3.5 w-3.5" />
                {course.category}
              </span>
              <span className="inline-flex items-center rounded-full bg-sky-950/40 px-3 py-1 text-xs font-medium">
                {course.batchName} {course.batchCode ? `· ${course.batchCode}` : ''}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{course.title}</h1>
            {course.description && (
              <p className="text-xs md:text-sm text-sky-100 leading-relaxed max-w-xl">
                {course.description}
              </p>
            )}
          </div>

          {/* Quick Metrics Badge */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div className="rounded-xl bg-white/10 p-3.5 backdrop-blur-md text-center border border-white/10 min-w-[100px]">
              <p className="text-xs text-sky-200">Completion</p>
              <p className="text-lg font-bold">{course.progress}%</p>
            </div>
            <div className="rounded-xl bg-white/10 p-3.5 backdrop-blur-md text-center border border-white/10 min-w-[100px]">
              <p className="text-xs text-sky-200">Subjects</p>
              <p className="text-lg font-bold">{subjects.length}</p>
            </div>
          </div>
        </div>

        {/* Decorative blur */}
        <div className="absolute right-0 top-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      {/* ── Section 1: Subject Learning Tracks ──────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Enrolled Subject Modules</h2>
            <p className="text-xs text-slate-500">
              Select a subject track to enter the learning workspace, watch lectures, and download notes.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">{subjects.length} Subjects Available</span>
        </div>

        {subjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-semibold text-slate-600">No subject tracks assigned yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {subjects.map((sub) => (
              <div
                key={sub.batchSubjectId || sub.subjectId}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-sky-300 hover:shadow-md transition-all"
              >
                <div>
                  {/* Top: Emoji + Subject Name */}
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl shadow-sm"
                      style={{ backgroundColor: `${sub.color}15` }}
                    >
                      {sub.emoji}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 group-hover:text-sky-600 transition-colors">
                        {sub.subjectName}
                      </h3>
                      {sub.code && (
                        <span className="text-[11px] font-semibold text-slate-400">Code: {sub.code}</span>
                      )}
                    </div>
                  </div>

                  {/* Teacher Info */}
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    <span className="truncate">
                      Faculty: <strong className="text-slate-800">{sub.teacherName || 'Assigned Department'}</strong>
                    </span>
                  </div>

                  {/* Content Breakdown Metrics */}
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-sky-50 p-2">
                      <p className="text-xs font-bold text-sky-700">{sub.videoCount}</p>
                      <p className="text-[10px] text-slate-500">Lectures</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2">
                      <p className="text-xs font-bold text-emerald-700">{sub.pdfCount + sub.notesCount}</p>
                      <p className="text-[10px] text-slate-500">Notes & PDFs</p>
                    </div>
                    <div className="rounded-lg bg-indigo-50 p-2">
                      <p className="text-xs font-bold text-indigo-700">{sub.mockTestsCount}</p>
                      <p className="text-[10px] text-slate-500">Tests</p>
                    </div>
                  </div>
                </div>

                {/* Open Workspace Action */}
                <div className="mt-6 border-t border-slate-100 pt-4">
                  <Link
                    href={`/student/courses/${course.courseId}/subjects/${sub.batchSubjectId || sub.subjectId}`}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-sky-700 active:scale-[0.98] transition-all"
                  >
                    <PlayCircle className="h-4 w-4" />
                    Open Subject Workspace
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Assigned Course Mock Tests ───────────────────────────── */}
      {assignedMockTests && assignedMockTests.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Assigned Mock Assessments</h2>
              <p className="text-xs text-slate-500">
                Official course tests mapped to your enrolled batch.
              </p>
            </div>
            <Link
              href="/student/tests"
              className="text-xs font-bold text-sky-600 hover:text-sky-700 hover:underline"
            >
              View All Tests ({assignedMockTests.length}) →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignedMockTests.map((test) => {
              const attempt = test.attemptSummary;
              const isAvailable = test.status === 'available';

              let badgeText = isAvailable ? '● Ready to Attempt' : test.status;
              let badgeClass = isAvailable
                ? 'bg-emerald-100 text-emerald-800'
                : test.status === 'upcoming'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-600';

              if (attempt) {
                if (attempt.attemptState === 'in_progress') {
                  badgeText = '● In Progress (Resume)';
                  badgeClass = 'bg-sky-100 text-sky-800';
                } else if (attempt.attemptState === 'limit_reached') {
                  badgeText = 'Attempts Exhausted';
                  badgeClass = 'bg-slate-100 text-slate-600';
                } else if (attempt.attemptState === 'submitted') {
                  badgeText = '● Attempted / Submitted';
                  badgeClass = 'bg-emerald-100 text-emerald-800';
                }
              }

              const actionLabel = attempt?.actionLabel || 'Start Test Assessment →';
              const actionHref = attempt?.actionHref || '/student/tests';

              return (
                <div
                  key={test.testId}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-300 transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700 border border-indigo-100">
                        {test.subjectName || 'Course Assessment'}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeClass}`}>
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
                        <Exam className="h-3.5 w-3.5 text-indigo-500" />
                        {test.totalMarks !== null ? `${test.totalMarks} marks` : 'Configured'}
                      </span>
                      <span>·</span>
                      <span>{test.questionCount > 0 ? `${test.questionCount} Questions` : 'Questions attached'}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end border-t border-slate-100 pt-3">
                    <a
                      href={actionHref}
                      className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 hover:text-sky-700"
                    >
                      {actionLabel}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
