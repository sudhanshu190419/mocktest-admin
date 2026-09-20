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
import { Skeleton, ErrorState } from '@/components/ui/mmt';
import { ProgressBar } from '@/components/ui/mmt/ProgressBar';

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
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-48 w-full rounded-card" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="store-container">
        <ErrorState
          title="Access Restricted or Course Not Found"
          detail={error || 'You do not have active enrollment access to this course syllabus.'}
          onRetry={loadData}
        />
      </div>
    );
  }

  const { course, subjects, assignedMockTests } = data;

  return (
    <div className="store-container space-y-7 pb-12">
      {/* ── Breadcrumbs & Back Navigation ────────────────────────────────────── */}
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link href="/student/overview">My Learning</Link>
        <span aria-hidden="true">/</span>
        <Link href="/student/courses">My Courses</Link>
        <span aria-hidden="true">/</span>
        <span>{course.title}</span>
      </nav>

      {/* ── Top Hero Card (Design A) ───────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-surface p-6 sm:p-8 shadow-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3 py-1 text-caption font-bold text-brand-hover border border-line">
                <GraduationCap className="h-3.5 w-3.5" weight="duotone" />
                {course.category}
              </span>
              <span className="inline-flex items-center rounded-field bg-paper px-3 py-1 text-caption font-semibold text-ink-secondary border border-line">
                {course.batchName} {course.batchCode ? `· ${course.batchCode}` : ''}
              </span>
            </div>
            <h1 className="text-2xl sm:text-display font-extrabold tracking-tight text-ink">
              {course.title}
            </h1>
            {course.description && (
              <p className="text-body text-ink-secondary leading-relaxed">
                {course.description}
              </p>
            )}

            {/* Course Progress */}
            <div className="pt-2 max-w-md space-y-1.5">
              <div className="flex items-center justify-between text-caption font-bold">
                <span className="text-ink-secondary uppercase tracking-wider">Overall Syllabus Progress</span>
                <span className="text-ink tabular-nums">{course.progress}%</span>
              </div>
              <ProgressBar
                value={course.progress}
                label={`${course.title} progress`}
                tone={course.progress >= 80 ? 'success' : 'brand'}
              />
            </div>
          </div>

          {/* Quick Metrics Badge */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div className="rounded-card border border-line bg-sky-tint p-4 text-center min-w-[110px]">
              <p className="text-caption font-bold text-brand-hover uppercase">Progress</p>
              <p className="text-2xl font-black text-brand tabular-nums">{course.progress}%</p>
            </div>
            <div className="rounded-card border border-line bg-mint-tint p-4 text-center min-w-[110px]">
              <p className="text-caption font-bold text-mint-ink uppercase">Subjects</p>
              <p className="text-2xl font-black text-mint-ink tabular-nums">{subjects.length}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 1: Subject Learning Tracks ──────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h2 font-extrabold text-ink">Enrolled Subject Modules</h2>
            <p className="text-body text-ink-secondary">
              Select a subject track to enter the learning workspace, watch lectures, and download notes.
            </p>
          </div>
          <span className="text-body font-semibold text-ink-secondary">{subjects.length} Subjects</span>
        </div>

        {subjects.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-8 text-center">
            <p className="text-body font-semibold text-ink-secondary">No subject tracks assigned yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {subjects.map((sub) => (
              <div
                key={sub.batchSubjectId || sub.subjectId}
                className="group flex flex-col justify-between rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card hover:shadow-card-hover transition-all"
              >
                <div>
                  {/* Top: Emoji + Subject Name */}
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-card text-2xl shadow-xs"
                      style={{ backgroundColor: `${sub.color}15` }}
                    >
                      {sub.emoji}
                    </div>
                    <div>
                      <h3 className="text-h3 font-bold text-ink group-hover:text-brand transition-colors">
                        {sub.subjectName}
                      </h3>
                      {sub.code && (
                        <span className="text-caption font-semibold text-ink-muted">Code: {sub.code}</span>
                      )}
                    </div>
                  </div>

                  {/* Teacher Info */}
                  <div className="mt-4 flex min-h-[44px] items-center gap-2 rounded-field bg-paper p-2.5 text-body text-ink-secondary border border-line">
                    <User className="h-4 w-4 text-ink-muted shrink-0" weight="duotone" />
                    <span className="truncate">
                      Faculty: <strong className="text-ink">{sub.teacherName || 'Assigned Department'}</strong>
                    </span>
                  </div>

                  {/* Content Breakdown Metrics */}
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-field bg-sky-tint p-2">
                      <p className="text-body font-bold text-brand-hover tabular-nums">{sub.videoCount}</p>
                      <p className="text-caption text-ink-secondary">Lectures</p>
                    </div>
                    <div className="rounded-field bg-mint-tint p-2">
                      <p className="text-body font-bold text-mint-ink tabular-nums">{sub.pdfCount + sub.notesCount}</p>
                      <p className="text-caption text-ink-secondary">Notes/PDFs</p>
                    </div>
                    <div className="rounded-field bg-lilac-tint p-2">
                      <p className="text-body font-bold text-lilac-ink tabular-nums">{sub.mockTestsCount}</p>
                      <p className="text-caption text-ink-secondary">Tests</p>
                    </div>
                  </div>
                </div>

                {/* Open Workspace Action (≥44px hit-height) */}
                <div className="mt-6 border-t border-line pt-4">
                  <Link
                    href={`/student/courses/${course.courseId}/subjects/${sub.batchSubjectId || sub.subjectId}`}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-field bg-brand px-4 py-2.5 text-body font-bold text-white shadow-xs hover:bg-brand-hover active:scale-[0.98] transition-all"
                  >
                    <PlayCircle className="h-4 w-4" weight="bold" />
                    <span>Open Subject Workspace</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Assigned Course Mock Tests ───────────────────────────── */}
      {assignedMockTests && assignedMockTests.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-line">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-h2 font-extrabold text-ink">Assigned Mock Assessments</h2>
              <p className="text-body text-ink-secondary">
                Official course tests mapped to your enrolled batch.
              </p>
            </div>
            <Link
              href="/student/tests"
              className="text-body font-bold text-brand hover:underline"
            >
              View All Tests ({assignedMockTests.length}) →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignedMockTests.map((test) => {
              const attempt = test.attemptSummary;
              const isAvailable = test.status === 'available';

              let badgeText = isAvailable ? '● Ready to Attempt' : test.status;
              let badgePillClass = 'bg-sky-tint text-brand-hover border-line';

              if (attempt) {
                if (attempt.attemptState === 'in_progress') {
                  badgeText = '● In Progress (Resume)';
                  badgePillClass = 'bg-sand text-sand-ink border-amber-200';
                } else if (attempt.attemptState === 'limit_reached') {
                  badgeText = 'Attempts Exhausted';
                  badgePillClass = 'bg-paper text-ink-secondary border-line';
                } else if (attempt.attemptState === 'submitted') {
                  badgeText = '● Attempted / Submitted';
                  badgePillClass = 'bg-mint-tint text-mint-ink border-emerald-200';
                }
              }

              const actionLabel = attempt?.actionLabel || 'Start Test Assessment →';
              const actionHref = attempt?.actionHref || '/student/tests';

              return (
                <div
                  key={test.testId}
                  className="flex flex-col justify-between rounded-card border border-line bg-surface p-5 shadow-card"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center rounded-full bg-lilac-tint px-2.5 py-0.5 text-caption font-bold text-lilac-ink border border-purple-200">
                        {test.subjectName || 'Course Assessment'}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-bold border ${badgePillClass}`}>
                        {badgeText}
                      </span>
                    </div>

                    <h3 className="mt-2 text-h3 font-bold text-ink">{test.title}</h3>
                    {test.description && (
                      <p className="mt-1 text-body text-ink-secondary line-clamp-1">{test.description}</p>
                    )}

                    <div className="mt-3 flex items-center gap-3 text-body text-ink-secondary">
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4 text-ink-muted" weight="duotone" />
                        {test.durationMin !== null ? `${test.durationMin} mins` : 'Flexible'}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Exam className="h-4 w-4 text-brand" weight="duotone" />
                        {test.totalMarks !== null ? `${test.totalMarks} marks` : 'Configured'}
                      </span>
                      <span>·</span>
                      <span>{test.questionCount > 0 ? `${test.questionCount} Questions` : 'Questions attached'}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end border-t border-line pt-3">
                    <Link
                      href={actionHref}
                      className="inline-flex min-h-[36px] items-center gap-1 text-body font-bold text-brand hover:underline"
                    >
                      <span>{actionLabel}</span>
                    </Link>
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
