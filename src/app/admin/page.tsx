'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useAdminDashboardStats } from '@/hooks/admin/useAdminDashboard';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const days = Math.floor((now - then) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton Components
// ═══════════════════════════════════════════════════════════════════════════

function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
          <Skeleton className="mb-2 h-3 w-20" />
          <Skeleton className="mb-1 h-7 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function InlineListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      <Skeleton className="mb-4 h-4 w-32" />
      <InlineListSkeleton count={3} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Dashboard Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminDashboardPage() {
  const { teacherProfile, instituteId } = useAuth();

  // ── Dashboard Data ──────────────────────────────────────────────────
  const { data: dashboard, isLoading, isError, error, refetch } = useAdminDashboardStats(instituteId);

  const stats = dashboard?.stats;
  const recentRegistrations = dashboard?.recentRegistrations ?? [];
  const upcomingClasses = dashboard?.upcomingClasses ?? [];

  const currentDate = formatDate(new Date());

  // ── Derived Stats for display ───────────────────────────────────────
  const statCards = useMemo(() => {
    if (!stats) return [];
    return [
      {
        label: 'Total Students',
        value: stats.totalStudents.toLocaleString(),
        subtext: 'enrolled',
        color: 'blue' as const,
      },
      {
        label: 'Total Teachers',
        value: stats.totalTeachers.toLocaleString(),
        subtext: 'faculty members',
        color: 'emerald' as const,
      },
      {
        label: 'Active Batches',
        value: stats.activeBatches.toLocaleString(),
        subtext: 'currently running',
        color: 'purple' as const,
      },
      {
        label: 'Published Mock Tests',
        value: stats.publishedMockTests.toLocaleString(),
        subtext: 'available to students',
        color: 'indigo' as const,
      },
      {
        label: 'Pending Questions',
        value: stats.pendingQuestionApprovals.toLocaleString(),
        subtext: 'awaiting approval',
        color: 'amber' as const,
      },
      {
        label: 'Pending Content',
        value: stats.pendingContentApprovals.toLocaleString(),
        subtext: 'awaiting review',
        color: 'rose' as const,
      },
      {
        label: 'Pending Mock Tests',
        value: stats.pendingMockTestApprovals.toLocaleString(),
        subtext: 'awaiting approval',
        color: 'rose' as const,
      },
      {
        label: 'Monthly Revenue',
        value: stats.monthlyRevenue !== null ? `₹${stats.monthlyRevenue.toLocaleString()}` : '—',
        subtext: stats.monthlyRevenue !== null ? 'this month' : 'Coming soon',
        color: 'cyan' as const,
      },
    ];
  }, [stats]);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Dashboard Header — Welcome + Date + Refresh
         ════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageHeader
            title={`Welcome${teacherProfile?.name ? `, ${teacherProfile.name.split(' ')[0]}` : ''}`}
            description={`${currentDate}${teacherProfile?.designation ? ` · ${teacherProfile.designation}` : ''}`}
          />
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <svg
            className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
            />
          </svg>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Error State
         ════════════════════════════════════════════════════════════════ */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 flex-shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Failed to load dashboard data
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                {error instanceof Error ? error.message : 'An unexpected error occurred. Please try refreshing.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Quick Statistics Cards
         ════════════════════════════════════════════════════════════════ */}
      {isLoading ? (
        <StatCardsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <MetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              subtext={stat.subtext}
              color={stat.color}
            />
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Two-Column Layout (Left: 2/3, Right: 1/3)
         ════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ─── LEFT COLUMN (2/3) ───────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">

          {/* Quick Actions */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Teacher Management', href: '/admin/teachers', icon: '👨‍🏫', color: 'bg-blue-600' },
                { label: 'Student Management', href: '/admin/students', icon: '👥', color: 'bg-emerald-600' },
                { label: 'Academic Structure', href: '/admin/academic', icon: '🏛️', color: 'bg-purple-600' },
                { label: 'Question Bank', href: '/admin/questions', icon: '❓', color: 'bg-amber-600' },
                { label: 'Mock Tests', href: '/admin/mock-tests', icon: '📝', color: 'bg-rose-600' },
                { label: 'Approval Center', href: '/admin/approvals', icon: '✅', color: 'bg-indigo-600' },
                { label: 'Notifications', href: '/admin/notifications', icon: '🔔', color: 'bg-cyan-600' },
                { label: 'Reports', href: '/admin/reports', icon: '📊', color: 'bg-gray-600' },
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

          {/* Pending Approvals Panel */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pending Approvals</h3>
              <Link
                href="/admin/approvals"
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                View all
              </Link>
            </div>
            {isLoading ? (
              <InlineListSkeleton count={3} />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    label: 'Questions',
                    value: stats?.pendingQuestionApprovals ?? 0,
                    href: '/admin/approvals?type=questions',
                    color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
                  },
                  {
                    label: 'Content',
                    value: stats?.pendingContentApprovals ?? 0,
                    href: '/admin/approvals?type=content',
                    color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800',
                  },
                  {
                    label: 'Mock Tests',
                    value: stats?.pendingMockTestApprovals ?? 0,
                    href: '/admin/approvals?type=mock-tests',
                    color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
                  },
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`rounded-lg border p-4 transition-all hover:shadow-sm ${item.color}`}
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wider opacity-70">{item.label}</p>
                    <p className="mt-1 text-2xl font-bold">{item.value}</p>
                    <p className="mt-0.5 text-xs opacity-60">pending review</p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent Registrations */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Registrations</h3>
              {recentRegistrations.length > 0 && (
                <Link
                  href="/admin/students"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  View all
                </Link>
              )}
            </div>
            {isLoading ? (
              <InlineListSkeleton count={4} />
            ) : recentRegistrations.length === 0 ? (
              <EmptyState
                title="No recent registrations"
                description="New user registrations will appear here."
              />
            ) : (
              <div className="space-y-2">
                {recentRegistrations.slice(0, 6).map((reg) => (
                  <div
                    key={reg.profileId}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/30"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
                      {reg.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {reg.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {reg.phone ?? reg.email ?? 'No contact'}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <StatusBadge status={reg.role} showDot={false} />
                      <p className="mt-0.5 text-[10px] text-gray-400">{formatTimeAgo(reg.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN (1/3) ───────────────────────────────────── */}
        <div className="space-y-6">

          {/* Upcoming Live Classes */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Upcoming Classes</h3>
              {upcomingClasses.length > 0 && (
                <Link
                  href="/admin/live-classes"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  View all
                </Link>
              )}
            </div>
            {isLoading ? (
              <InlineListSkeleton count={3} />
            ) : upcomingClasses.length === 0 ? (
              <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                <p className="text-xs text-gray-400">No upcoming classes scheduled</p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingClasses.slice(0, 4).map((cls) => (
                  <div
                    key={cls.classId}
                    className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900/50 dark:bg-blue-900/10"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs dark:bg-blue-900/30">
                      📺
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
                        {cls.title}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(cls.scheduledAt).toLocaleDateString('en-IN', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {cls.durationMin ? ` · ${cls.durationMin} min` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Institute Snapshot */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Institute Snapshot</h3>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { label: 'Institute ID', value: instituteId ?? '—' },
                  { label: 'Admin Name', value: teacherProfile?.name ?? '—' },
                  { label: 'Total Students', value: stats?.totalStudents.toLocaleString() ?? '—' },
                  { label: 'Total Teachers', value: stats?.totalTeachers.toLocaleString() ?? '—' },
                  { label: 'Active Batches', value: stats?.activeBatches.toLocaleString() ?? '—' },
                  { label: 'Published Tests', value: stats?.publishedMockTests.toLocaleString() ?? '—' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{item.label}</span>
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* System Status */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">System Status</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Database</span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Operational
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Storage</span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Operational
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Authentication</span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Operational
                </span>
              </div>
              <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">API Status</span>
                  <span className="text-xs font-medium text-amber-600">
                    Some endpoints pending
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
