'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { teacherService } from '@/services/teacherService';
import { useStudentAnalytics } from '@/hooks/analytics/useAnalytics';
import { useStudentResults } from '@/hooks/mockTest/useMockResults';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { computeAccuracy, formatDuration, getScoreColorClass } from '@/utils/mockResults';
import type { StudentRosterItem } from '@/data/mockData';

export default function StudentProfilePage() {
  const params = useParams();
  const studentId = params.id as string;

  const { teacherProfile } = useAuth();
  const teacherId = teacherProfile?.id ?? '';

  // Fetch all batches to find this student
  const { data: batches } = useQuery({
    queryKey: ['teacher', 'batches', teacherId],
    queryFn: () => teacherService.getAssignedBatches(teacherId),
    enabled: !!teacherId,
  });

  const batchIds = useMemo(() => batches?.map((b) => b.id) ?? [], [batches]);

  const { data: allStudents } = useQuery({
    queryKey: ['teacher', 'students', ...batchIds],
    queryFn: async () => {
      const results: StudentRosterItem[] = [];
      for (const id of batchIds) {
        try {
          const roster = await teacherService.getStudentRoster(id);
          results.push(...roster);
        } catch {
          // skip
        }
      }
      const seen = new Set<string>();
      return results.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
    },
    enabled: batchIds.length > 0,
  });

  const studentProfile = useMemo(
    () => allStudents?.find((s) => s.id === studentId),
    [allStudents, studentId],
  );

  // Analytics hooks
  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useStudentAnalytics(studentId);
  const { data: resultsData, isLoading: resultsLoading } = useStudentResults(studentId, {}, undefined, { page: 1, pageSize: 10 });

  const results = resultsData?.data ?? [];
  const isLoading = analyticsLoading || !studentProfile;

  // Subject/chapter breakdown
  const strongSubjects = analytics?.strongSubjects ?? [];
  const weakSubjects = analytics?.weakSubjects ?? [];
  const performanceTrend = analytics?.performanceTrend ?? [];

  const statCards = [
    {
      label: 'Average Score',
      value: analytics?.averageScore != null ? analytics.averageScore.toFixed(1) : '—',
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
    },
    {
      label: 'Highest Score',
      value: analytics?.highestScore != null ? analytics.highestScore.toFixed(1) : '—',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      border: 'border-emerald-200 dark:border-emerald-800',
    },
    {
      label: 'Accuracy',
      value: analytics?.accuracy != null ? `${analytics.accuracy.toFixed(0)}%` : '—',
      color: analytics?.accuracy && analytics.accuracy >= 60 ? 'text-emerald-600' : 'text-amber-600',
      bg: 'bg-gray-50 dark:bg-gray-800/30',
      border: 'border-gray-200 dark:border-gray-700',
    },
    {
      label: 'Tests Attempted',
      value: analytics?.testsAttempted ?? '—',
      color: 'text-indigo-600',
      bg: 'bg-indigo-50 dark:bg-indigo-900/20',
      border: 'border-indigo-200 dark:border-indigo-800',
    },
    {
      label: 'Average Rank',
      value: analytics?.averageRank != null ? `#${analytics.averageRank.toFixed(0)}` : '—',
      color: 'text-purple-600',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      border: 'border-purple-200 dark:border-purple-800',
    },
    {
      label: 'Completion Rate',
      value: analytics?.testsAttempted
        ? `${((analytics.testsCompleted / analytics.testsAttempted) * 100).toFixed(0)}%`
        : '—',
      color: 'text-cyan-600',
      bg: 'bg-cyan-50 dark:bg-cyan-900/20',
      border: 'border-cyan-200 dark:border-cyan-800',
    },
  ];

  if (analyticsError) {
    console.error('Student analytics error:', analyticsError);
  }

  return (
    <div>
      <PageHeader
        title={studentProfile?.name ?? 'Student Profile'}
        description={studentProfile ? `Roll: ${studentProfile.rollNumber} · Rank #${studentProfile.rank}` : 'Loading...'}
        breadcrumbs={[
          { label: 'Students', href: '/teacher/students' },
          { label: studentProfile?.name ?? 'Profile' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/students/${studentId}/analytics`}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              Analytics
            </Link>
            <Link
              href={`/teacher/students/${studentId}/results`}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Results
            </Link>
            <Link
              href={`/teacher/students/${studentId}/activity`}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600"
            >
              Activity
            </Link>
          </div>
        }
      />

      {/* Profile Card */}
      {studentProfile && (
        <div className="mb-8 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-8">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-2xl font-bold text-white">
                {studentProfile.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-white">
                <h2 className="text-xl font-bold">{studentProfile.name}</h2>
                <p className="text-sm text-white/80">
                  Roll: {studentProfile.rollNumber} · Rank #{studentProfile.rank}
                </p>
                <div className="mt-2 flex items-center gap-3 text-xs text-white/70">
                  <span>Score: {studentProfile.avgScore}</span>
                  <span>·</span>
                  <span>Attendance: {studentProfile.attendanceRate}</span>
                  <span>·</span>
                  <span>Status: {studentProfile.status}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-gray-100 px-6 py-4 dark:border-gray-800 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Strong Chapter</p>
              <p className="mt-0.5 text-sm font-medium text-emerald-600">{studentProfile.strongChapter}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Weak Chapter</p>
              <p className="mt-0.5 text-sm font-medium text-rose-600">{studentProfile.weakChapter}</p>
            </div>
            {studentProfile.pendingDoubt && (
              <div className="col-span-2 sm:col-span-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Pending Doubt</p>
                <p className="mt-0.5 text-xs text-gray-600 italic dark:text-gray-400">
                  {studentProfile.pendingDoubt}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {isLoading ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
              <Skeleton className="mb-2 h-3 w-16" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {statCards.map((stat) => (
            <div
              key={stat.label}
              className={`rounded-xl border ${stat.border} ${stat.bg} p-5 transition-shadow hover:shadow-md`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{stat.label}</p>
              <p className={`mt-1.5 text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Strong Subjects */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Strong Subjects</h3>
          {strongSubjects.length === 0 ? (
            <p className="text-sm text-gray-500">No data yet.</p>
          ) : (
            <div className="space-y-3">
              {strongSubjects.slice(0, 5).map((s) => (
                <div key={s.subjectId}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{s.subjectName}</span>
                    <span className={`text-xs font-semibold ${getScoreColorClass(s.percentage)}`}>
                      {s.percentage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(s.percentage, 100)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {s.correct} correct / {s.wrong} wrong / {s.skipped} skipped
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Weak Subjects */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Weak Subjects</h3>
          {weakSubjects.length === 0 ? (
            <p className="text-sm text-gray-500">No data yet.</p>
          ) : (
            <div className="space-y-3">
              {weakSubjects.slice(0, 5).map((s) => (
                <div key={s.subjectId}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{s.subjectName}</span>
                    <span className={`text-xs font-semibold ${getScoreColorClass(s.percentage)}`}>
                      {s.percentage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-rose-500 transition-all"
                      style={{ width: `${Math.min(s.percentage, 100)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {s.correct} correct / {s.wrong} wrong / {s.skipped} skipped
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Tests */}
      <div className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recent Tests</h2>
          <Link
            href={`/teacher/students/${studentId}/results`}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            View all
          </Link>
        </div>

        {resultsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState title="No test results" description="This student has not completed any tests yet." />
        ) : (
          <div className="space-y-2">
            {results.slice(0, 5).map((r) => (
              <Link
                key={r.resultId}
                href={`/teacher/results/${r.resultId}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      Test result
                    </span>
                    <StatusBadge status={r.isReleased ? 'published' : 'draft'} />
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {r.correctCount} correct · {r.wrongCount} wrong · {r.skippedCount} skipped
                  </p>
                </div>
                <div className="ml-4 text-right">
                  <p className={`text-lg font-bold ${getScoreColorClass(r.percentage)}`}>
                    {r.percentage.toFixed(1)}%
                  </p>
                  <p className="text-xs text-gray-500">{formatDuration(r.totalTimeSeconds)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
