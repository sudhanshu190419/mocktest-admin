'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { teacherService } from '@/services/teacherService';
import { useMockTests } from '@/hooks/mockTest/useMockTests';
import { useQuestions } from '@/hooks/mockTest/useQuestions';
import { useResults } from '@/hooks/mockTest/useMockResults';
import { useTeacherAnalytics } from '@/hooks/analytics/useAnalytics';
import { useNotifications, useNotificationDashboard } from '@/hooks/notification/useNotifications';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { formatDuration, getScoreColorClass, computeAccuracy } from '@/utils/mockResults';
import type { StudentRosterItem } from '@/data/mockData';

// ─── Color configs ─────────────────────────────────────────────────────────

const STAT_COLORS = {
  blue: { color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
  emerald: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
  amber: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
  purple: { color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800' },
  rose: { color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800' },
  indigo: { color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20', border: 'border-indigo-200 dark:border-indigo-800' },
  cyan: { color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-900/20', border: 'border-cyan-200 dark:border-cyan-800' },
  gray: { color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200 dark:border-gray-700' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeDaysAgo(isoString: string): number {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  return Math.floor((now - then) / 86400000);
}

function formatTimeAgo(isoString: string): string {
  const days = computeDaysAgo(isoString);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}



// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, subtext, theme }: {
  label: string;
  value: string | number;
  subtext?: string;
  theme: keyof typeof STAT_COLORS;
}) {
  const t = STAT_COLORS[theme];
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} p-4 transition-shadow hover:shadow-md`}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${t.color}`}>{value}</p>
      {subtext && <p className="mt-0.5 text-xs text-gray-400">{subtext}</p>}
    </div>
  );
}

// ─── Skeleton helpers ───────────────────────────────────────────────────────

function StatCardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <Skeleton className="mb-2 h-3 w-20" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="mt-1 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function InlineSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Dashboard Page
// ═══════════════════════════════════════════════════════════════════════════

export default function TeacherDashboardPage() {
  const { teacherProfile, instituteId, user } = useAuth();
  const teacherId = teacherProfile?.id ?? '';
  const userId = user?.id;

  // ── Data Queries ──────────────────────────────────────────────────────

  // 1. Teacher overview data (comprehensive stats from backend)
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['teacher', 'overview', teacherId],
    queryFn: () => teacherService.getTeacherOverviewData(teacherId),
    enabled: !!teacherId,
    staleTime: 30_000,
  });

  // 2. Mock tests for status counts
  const { data: testsData, isLoading: testsLoading } = useMockTests(
    {}, {}, { page: 1, pageSize: 1000 },
  );
  const tests = testsData?.data ?? [];

  // 3. Questions for total count
  const { data: questionsData, isLoading: questionsLoading } = useQuestions(
    {}, {}, { page: 1, pageSize: 1 },
  );
  const questionCount = questionsData?.count ?? 0;

  // 4. Results for result stats
  const { data: resultsData, isLoading: resultsLoading } = useResults(
    undefined, { sortBy: 'generatedAt', sortDirection: 'desc' }, { page: 1, pageSize: 1000 },
  );
  const results = resultsData?.data ?? [];

  // 5. Teacher analytics for difficulty distribution and student performance
  const { data: teacherAnalytics, isLoading: analyticsLoading } = useTeacherAnalytics(teacherId);

  // 6. Notifications
  const { data: notifDash, isLoading: notifLoading } = useNotificationDashboard(userId, instituteId ?? undefined);
  const { data: notifData, isLoading: notifListLoading } = useNotifications(
    userId,
    { isRead: false },
    { sortBy: 'receivedAt', sortDirection: 'desc' },
    { page: 1, pageSize: 5 },
  );

  // 7. Batches + Students for recent students list
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['teacher', 'batches', teacherId],
    queryFn: () => teacherService.getAssignedBatches(teacherId),
    enabled: !!teacherId,
  });

  const batchIds = useMemo(() => batches?.map((b) => b.id) ?? [], [batches]);

  const { data: allStudents, isLoading: studentsLoading } = useQuery({
    queryKey: ['teacher', 'students', ...batchIds],
    queryFn: async () => {
      const results: StudentRosterItem[] = [];
      for (const id of batchIds) {
        try {
          const roster = await teacherService.getStudentRoster(id);
          results.push(...roster);
        } catch { /* skip */ }
      }
      const seen = new Set<string>();
      return results.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
    },
    enabled: batchIds.length > 0,
  });

  const isLoading = overviewLoading || testsLoading || questionsLoading || resultsLoading || analyticsLoading || batchesLoading;
  const students = allStudents ?? [];

  // ── Derived Stats ─────────────────────────────────────────────────────

  const testStats = useMemo(() => {
    if (tests.length === 0) return { total: 0, draft: 0, pending: 0, published: 0, archived: 0 };
    return {
      total: tests.length,
      draft: tests.filter((t) => t.status === 'draft').length,
      pending: tests.filter((t) => t.status === 'pending_approval').length,
      published: tests.filter((t) => t.status === 'published').length,
      archived: tests.filter((t) => t.status === 'archived').length,
    };
  }, [tests]);

  const resultStats = useMemo(() => {
    if (results.length === 0) return { total: 0, avgPercentage: 0, avgAccuracy: null as number | null, totalCorrect: 0, totalWrong: 0, released: 0 };
    const avgPct = results.reduce((s, r) => s + r.percentage, 0) / results.length;
    const correct = results.reduce((s, r) => s + r.correctCount, 0);
    const wrong = results.reduce((s, r) => s + r.wrongCount, 0);
    return {
      total: results.length,
      avgPercentage: avgPct,
      avgAccuracy: computeAccuracy(correct, wrong),
      totalCorrect: correct,
      totalWrong: wrong,
      released: results.filter((r) => r.isReleased).length,
    };
  }, [results]);

  // Recent activity: combine recent results
  const recentResults = useMemo(() => results.slice(0, 8), [results]);

  // Top students by score percentage
  const topStudents = useMemo(() => {
    if (results.length === 0) return [];
    const studentMap = new Map<string, { totalPct: number; count: number; name: string }>();
    for (const r of results) {
      // Group by studentId, displaying the real student name when available
      const key = r.studentId;
      const existing = studentMap.get(key) ?? { totalPct: 0, count: 0, name: r.studentName || `Student #${key.slice(0, 6)}` };
      existing.totalPct += r.percentage;
      existing.count += 1;
      studentMap.set(key, existing);
    }
    return Array.from(studentMap.entries())
      .map(([id, s]) => ({ studentId: id, name: s.name, avgPct: s.totalPct / s.count, tests: s.count }))
      .sort((a, b) => b.avgPct - a.avgPct)
      .slice(0, 5);
  }, [results]);

  // Weak students (bottom 5 by avg percentage)
  const weakStudents = useMemo(() => {
    if (results.length === 0) return [];
    const studentMap = new Map<string, { totalPct: number; count: number; name: string }>();
    for (const r of results) {
      const key = r.studentId;
      const existing = studentMap.get(key) ?? { totalPct: 0, count: 0, name: r.studentName || `Student #${key.slice(0, 6)}` };
      existing.totalPct += r.percentage;
      existing.count += 1;
      studentMap.set(key, existing);
    }
    return Array.from(studentMap.entries())
      .map(([id, s]) => ({ studentId: id, name: s.name, avgPct: s.totalPct / s.count }))
      .sort((a, b) => a.avgPct - b.avgPct)
      .slice(0, 5);
  }, [results]);

  const isLoadingMain = isLoading;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome${teacherProfile?.name ? `, ${teacherProfile.name.split(' ')[0]}` : ''}`}
        description={
          overview
            ? `${overview.totalStudents ?? 0} students · ${overview.activeBatches ?? 0} batches · ${overview.specialization ?? ''}`
            : 'Loading your dashboard...'
        }
      />

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1: Top Summary Cards
         ══════════════════════════════════════════════════════════════════ */}
      {isLoadingMain ? (
        <StatCardSkeletons count={8} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Students" value={overview?.totalStudents ?? students.length} theme="blue" />
          <StatCard label="Mock Tests" value={testStats.total} subtext={`${testStats.published} published`} theme="emerald" />
          <StatCard label="Questions" value={questionCount} theme="purple" />
          <StatCard label="Published Tests" value={testStats.published} subtext={`${testStats.draft} drafts`} theme="indigo" />
          <StatCard
            label="Avg Score"
            value={resultStats.avgPercentage > 0 ? `${resultStats.avgPercentage.toFixed(1)}%` : '—'}
            theme={resultStats.avgPercentage >= 60 ? 'emerald' : resultStats.avgPercentage >= 40 ? 'amber' : 'gray'}
          />
          <StatCard
            label="Avg Accuracy"
            value={resultStats.avgAccuracy != null ? `${resultStats.avgAccuracy.toFixed(0)}%` : '—'}
            theme={resultStats.avgAccuracy != null && resultStats.avgAccuracy >= 60 ? 'emerald' : 'amber'}
          />
          <StatCard
            label="Active Students"
            value={students.filter((s) => s.status === 'Present Live' || s.status === 'Watched Recording').length}
            subtext={`of ${overview?.totalStudents ?? students.length} total`}
            theme="cyan"
          />
          <StatCard
            label="Pending Reviews"
            value={testStats.pending + testStats.draft}
            subtext={`${testStats.pending} awaiting approval`}
            theme="rose"
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2: Two-column layout (Left: 2/3, Right: 1/3)
         ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ─── LEFT COLUMN (2/3) ───────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">

          {/* Performance Chart: Weekly Attempts (CSS bars) */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Weekly Activity</h3>
            <p className="mb-4 text-xs text-gray-500">Results generated per week (last 8 weeks)</p>
            {results.length === 0 ? (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-gray-400">No activity data yet</p>
              </div>
            ) : (
              <div className="flex items-end gap-2" style={{ height: 120 }}>
                {Array.from({ length: 8 }).map((_, i) => {
                  const weekStart = new Date();
                  weekStart.setDate(weekStart.getDate() - (7 * (7 - i)));
                  const weekEnd = new Date(weekStart);
                  weekEnd.setDate(weekEnd.getDate() + 7);
                  const count = results.filter((r) => {
                    const d = new Date(r.generatedAt);
                    return d >= weekStart && d < weekEnd;
                  }).length;
                  const maxCount = Math.max(1, ...Array.from({ length: 8 }).map((_, j) => {
                    const ws = new Date(); ws.setDate(ws.getDate() - (7 * (7 - j)));
                    const we = new Date(ws); we.setDate(we.getDate() + 7);
                    return results.filter((r) => {
                      const d = new Date(r.generatedAt);
                      return d >= ws && d < we;
                    }).length;
                  }));
                  const height = Math.max(8, (count / maxCount) * 100);
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] font-medium text-gray-500">{count}</span>
                      <div
                        className="w-full rounded-t bg-blue-500 transition-all hover:bg-blue-600"
                        style={{ height: `${height}%`, minHeight: 4 }}
                        title={`${count} results`}
                      />
                      <span className="text-[9px] text-gray-400">
                        {weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Subject & Difficulty Performance */}
          {teacherAnalytics && teacherAnalytics.difficultyDistribution.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Difficulty Distribution</h3>
              <div className="flex gap-4">
                {teacherAnalytics.difficultyDistribution.map((d) => {
                  const colors: Record<string, string> = {
                    easy: 'bg-emerald-500',
                    medium: 'bg-amber-500',
                    hard: 'bg-rose-500',
                  };
                  return (
                    <div key={d.difficulty} className="flex-1">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium capitalize text-gray-700 dark:text-gray-300">{d.difficulty}</span>
                        <span className="text-xs font-semibold text-gray-500">{d.count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          className={`h-full rounded-full ${colors[d.difficulty] ?? 'bg-blue-500'} transition-all`}
                          style={{ width: `${d.percentage}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[10px] text-gray-400">{d.percentage.toFixed(0)}%</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Create Question', href: '/teacher/questions/create?tab=create', icon: '＋', color: 'bg-blue-600' },
                { label: 'Create Mock Test', href: '/teacher/mock-tests/create', icon: '📝', color: 'bg-emerald-600' },
                { label: 'View Students', href: '/teacher/students', icon: '👥', color: 'bg-purple-600' },
                { label: 'Release Results', href: '/teacher/results/list', icon: '📊', color: 'bg-amber-600' },
              ].map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm text-white shadow-sm ${action.color}`}>
                    {action.icon}
                  </div>
                  <span className="text-xs font-medium text-gray-700 group-hover:text-blue-600 dark:text-gray-300">
                    {action.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Pending Work */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Pending Work</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Draft Tests', value: testStats.draft, href: '/teacher/mock-tests/list?status=draft', color: 'text-gray-600', bg: 'bg-gray-50' },
                { label: 'Pending Approval', value: testStats.pending, href: '/teacher/mock-tests/list?status=pending_approval', color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: 'Unread Notifications', value: notifDash?.unreadCount ?? 0, href: '/teacher/notifications', color: 'text-rose-600', bg: 'bg-rose-50' },
                { label: 'Results to Release', value: resultStats.total - resultStats.released, href: '/teacher/results/list', color: 'text-blue-600', bg: 'bg-blue-50' },
              ].map((item) => (
                <Link key={item.label} href={item.href} className="group rounded-lg border border-gray-100 p-3 transition-colors hover:border-gray-200 dark:border-gray-700 dark:hover:border-gray-600">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{item.label}</p>
                  <p className={`mt-1 text-xl font-bold group-hover:opacity-80 ${item.color}`}>{item.value}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h3>
              <Link href="/teacher/results" className="text-xs font-medium text-blue-600 hover:text-blue-700">View all</Link>
            </div>
            {resultsLoading ? (
              <InlineSkeleton count={5} />
            ) : recentResults.length === 0 ? (
              <EmptyState title="No activity yet" description="Student test results and activity will appear here." />
            ) : (
              <div className="space-y-2">
                {recentResults.map((r) => (
                  <Link
                    key={r.resultId}
                    href={`/teacher/results/${r.resultId}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/30"
                  >
                    <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs text-white ${r.isReleased ? 'bg-emerald-500' : 'bg-gray-400'}`}>
                      {r.isReleased ? '✓' : '⏳'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {r.studentName
                          ? `${r.studentName}'s test result ${r.isReleased ? 'published' : 'generated'}`
                          : `Test result ${r.isReleased ? 'published' : 'generated'}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {r.correctCount}/{r.correctCount + r.wrongCount + r.skippedCount} correct · {formatDuration(r.totalTimeSeconds)}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className={`text-sm font-bold ${getScoreColorClass(r.percentage)}`}>
                        {r.percentage.toFixed(0)}%
                      </p>
                      <p className="text-[10px] text-gray-400">{formatTimeAgo(r.generatedAt)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN (1/3) ───────────────────────────────────── */}
        <div className="space-y-6">

          {/* Upcoming Live Classes */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Upcoming Classes</h3>
            {overview?.nextClass ? (
              <div>
                <div className="rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 p-4 text-white">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/70">
                      {overview.nextClass.status === 'live' ? '🔴 LIVE NOW' : '📅 Scheduled'}
                    </span>
                    <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">
                      {overview.nextClass.status === 'live' ? 'LIVE' : overview.nextClass.startTime}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold leading-snug">{overview.nextClass.title}</h4>
                  <p className="mt-1 text-xs text-white/70">{overview.nextClass.batchName}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-white/80">
                    <span>⏱ {overview.nextClass.durationMinutes} min</span>
                    <span>·</span>
                    <span>👥 {overview.nextClass.totalStudents} students</span>
                  </div>
                  <Link
                    href="/teacher/schedule"
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50"
                  >
                    {overview.nextClass.status === 'live' ? 'Join Class →' : 'View Details →'}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                <p className="text-xs text-gray-400">No upcoming classes scheduled</p>
              </div>
            )}
          </div>

          {/* Top Performers */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Top Performers</h3>
            {topStudents.length === 0 ? (
              <p className="text-xs text-gray-400">No performance data yet</p>
            ) : (
              <div className="space-y-2">
                {topStudents.map((s, i) => (
                  <Link key={s.studentId} href={`/teacher/students/${s.studentId}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-[10px] font-bold text-white">
                      {i + 1}
                    </div>
                    <span className="flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-300">{s.name}</span>
                    <span className={`text-xs font-bold ${getScoreColorClass(s.avgPct)}`}>
                      {s.avgPct.toFixed(0)}%
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Weak Students */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Need Attention</h3>
            {weakStudents.length === 0 ? (
              <p className="text-xs text-gray-400">All students performing well</p>
            ) : (
              <div className="space-y-2">
                {weakStudents.map((s, i) => (
                  <Link key={s.studentId} href={`/teacher/students/${s.studentId}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-rose-600 text-[10px] font-bold text-white">
                      {i + 1}
                    </div>
                    <span className="flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-300">{s.name}</span>
                    <span className="text-xs font-bold text-rose-500">
                      {s.avgPct.toFixed(0)}%
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent Students */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Students</h3>
              <Link href="/teacher/students/list" className="text-xs font-medium text-blue-600 hover:text-blue-700">View all</Link>
            </div>
            {studentsLoading ? (
              <InlineSkeleton count={3} />
            ) : students.length === 0 ? (
              <p className="text-xs text-gray-400">No students assigned</p>
            ) : (
              <div className="space-y-2">
                {students.slice(0, 5).map((s) => (
                  <Link key={s.id} href={`/teacher/students/${s.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[10px] font-bold text-white">
                      {s.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">{s.name}</p>
                      <p className="text-[10px] text-gray-400">Rank #{s.rank}</p>
                    </div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{s.avgScore}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Notification Widget */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
              <Link href="/teacher/notifications" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                {notifDash?.unreadCount ? `${notifDash.unreadCount} unread` : 'View all'}
              </Link>
            </div>
            {notifLoading || notifListLoading ? (
              <InlineSkeleton count={3} />
            ) : notifData?.notifications && notifData.notifications.length > 0 ? (
              <div className="space-y-2">
                {notifData.notifications.slice(0, 5).map((n) => (
                  <div key={n.notificationId} className="flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <div className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${!n.isRead ? 'bg-blue-500' : 'bg-transparent'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{n.title}</p>
                      <p className="text-[10px] text-gray-500">{n.message}</p>
                    </div>
                    <span className="flex-shrink-0 text-[10px] text-gray-400">{formatTimeAgo(n.receivedAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No notifications yet</p>
            )}
          </div>

          {/* Calendar / Schedule Widget */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Schedule</h3>
            {testStats.published > 0 || overview?.nextClass ? (
              <div className="space-y-3">
                {overview?.nextClass && (
                  <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900/50 dark:bg-blue-900/10">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs dark:bg-blue-900/30">📺</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{overview.nextClass.title}</p>
                      <p className="text-[10px] text-gray-500">{overview.nextClass.batchName} · {overview.nextClass.startTime} · {overview.nextClass.durationMinutes}min</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 dark:border-emerald-900/50 dark:bg-emerald-900/10">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-xs dark:bg-emerald-900/30">📝</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{testStats.published} Published Tests</p>
                    <p className="text-[10px] text-gray-500">{testStats.total} total tests · {testStats.draft} in draft</p>
                  </div>
                </div>
                {resultStats.total > 0 && (
                  <div className="flex items-start gap-3 rounded-lg border border-purple-100 bg-purple-50/50 p-3 dark:border-purple-900/50 dark:bg-purple-900/10">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100 text-xs dark:bg-purple-900/30">📊</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{resultStats.total} Results Generated</p>
                      <p className="text-[10px] text-gray-500">{resultStats.released} released · {resultStats.total - resultStats.released} pending</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No scheduled items yet</p>
            )}
          </div>

          {/* Teacher Overview Stats */}
          {overview && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Overview</h3>
              <div className="space-y-3">
                {[
                  { label: 'Rating', value: overview.rating ? `⭐ ${overview.rating.toFixed(2)}` : '—' },
                  { label: 'Specialization', value: overview.specialization ?? '—' },
                  { label: 'Classes Conducted', value: overview.analytics?.totalClassesConducted ?? '—' },
                  { label: 'Attendance Rate', value: overview.analytics?.avgAttendanceRate ?? '—' },
                  { label: 'Content Uploaded', value: overview.analytics?.totalContentUploaded ?? '—' },
                  { label: 'Top Chapter', value: overview.analytics?.topChapter ?? '—' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{item.label}</span>
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
