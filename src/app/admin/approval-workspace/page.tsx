'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useApprovalWorkspaceStats } from '@/hooks/admin/useApprovalWorkspace';
import { useQuestionApprovalList } from '@/hooks/admin/useQuestionApproval';
import { useMockTestList } from '@/hooks/admin/useMockTestManagement';
import { useContentList } from '@/hooks/content/useContent';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

// ═══════════════════════════════════════════════════════════════════════════
//  Types & Helpers
// ═══════════════════════════════════════════════════════════════════════════

type ResourceType = 'all' | 'questions' | 'mock-tests' | 'content';
type ActivityStatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type SortOrder = 'newest' | 'oldest';

interface ActivityItem {
  id: string;
  resourceType: Exclude<ResourceType, 'all'>;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Group a raw status into the workspace filter buckets. */
function statusGroup(status: string): 'pending' | 'approved' | 'rejected' | 'other' {
  if (status === 'pending_approval' || status === 'pending_review') return 'pending';
  if (status === 'published' || status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'other';
}

const RESOURCE_META: Record<
  Exclude<ResourceType, 'all'>,
  { label: string; icon: string; href: string }
> = {
  questions: { label: 'Questions', icon: '❓', href: '/admin/questions' },
  'mock-tests': { label: 'Mock Tests', icon: '📝', href: '/admin/mock-tests' },
  content: { label: 'Content', icon: '📄', href: '/admin/content/review' },
};

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton Components
// ═══════════════════════════════════════════════════════════════════════════

function PendingCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      <Skeleton className="mb-2 h-3 w-24" />
      <Skeleton className="mb-1 h-8 w-16" />
      <Skeleton className="mb-4 h-3 w-28" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════

export default function ApprovalWorkspacePage() {
  const { instituteId } = useAuth();

  // ── Aggregated statistics (single lightweight call) ─────────────────
  const { data: stats, isLoading: statsLoading } = useApprovalWorkspaceStats(instituteId);

  // ── Recent activity feeds (latest items per resource type) ──────────
  const scope = instituteId ? { instituteId } : undefined;

  const { data: questionData, isLoading: questionsLoading } = useQuestionApprovalList(
    scope,
    { sortBy: 'updatedAt', sortDirection: 'desc' },
    { page: 1, pageSize: 8 },
  );
  const { data: mockTestData, isLoading: mockTestsLoading } = useMockTestList(
    scope,
    { sortBy: 'updatedAt', sortDirection: 'desc' },
    { page: 1, pageSize: 8 },
  );
  const { data: contentData, isLoading: contentLoading } = useContentList(
    scope,
    { sortBy: 'updatedAt', sortDirection: 'desc' },
    { page: 1, pageSize: 8 },
  );

  const activityLoading = questionsLoading || mockTestsLoading || contentLoading;

  // ── Normalise feeds into a single activity stream ───────────────────
  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    for (const row of questionData?.data ?? []) {
      items.push({
        id: row.questionId,
        resourceType: 'questions',
        title: row.questionText,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    for (const row of mockTestData?.data ?? []) {
      items.push({
        id: row.testId,
        resourceType: 'mock-tests',
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    for (const row of contentData?.data ?? []) {
      items.push({
        id: row.contentId,
        resourceType: 'content',
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    return items.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [questionData, mockTestData, contentData]);

  // ── Latest pending submission per resource (for the pending cards) ──
  const latestPendingAt = useMemo(() => {
    const result: Record<Exclude<ResourceType, 'all'>, string | null> = {
      questions: null,
      'mock-tests': null,
      content: null,
    };
    for (const item of activity) {
      if (statusGroup(item.status) !== 'pending') continue;
      if (!result[item.resourceType]) result[item.resourceType] = item.updatedAt;
    }
    return result;
  }, [activity]);

  // ── Quick filters (client-side on the activity stream) ──────────────
  const [resourceFilter, setResourceFilter] = useState<ResourceType>('all');
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const filteredActivity = useMemo(() => {
    let items = activity;

    if (resourceFilter !== 'all') {
      items = items.filter((i) => i.resourceType === resourceFilter);
    }
    if (statusFilter !== 'all') {
      items = items.filter((i) => statusGroup(i.status) === statusFilter);
    }

    return [...items].sort((a, b) => {
      const diff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return sortOrder === 'newest' ? diff : -diff;
    });
  }, [activity, resourceFilter, statusFilter, sortOrder]);

  // ── Pending cards config ────────────────────────────────────────────
  const pendingCards = [
    {
      key: 'questions' as const,
      label: 'Pending Questions',
      count: stats?.pendingQuestions ?? 0,
      href: '/admin/questions',
      lastAt: latestPendingAt.questions,
      color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
    },
    {
      key: 'mock-tests' as const,
      label: 'Pending Mock Tests',
      count: stats?.pendingMockTests ?? 0,
      href: '/admin/mock-tests',
      lastAt: latestPendingAt['mock-tests'],
      color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
    },
    {
      key: 'content' as const,
      label: 'Pending Content',
      count: stats?.pendingContent ?? 0,
      href: '/admin/content/review',
      lastAt: latestPendingAt.content,
      color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800',
    },
  ];

  // ═══════════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Workspace"
        description="Centralized review hub for all academic resources pending approval"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Approval Workspace' },
        ]}
      />

      {/* ════════════════════════════════════════════════════════════════
          Pending Review Cards
         ════════════════════════════════════════════════════════════════ */}
      {statsLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <PendingCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pendingCards.map((card) => (
            <div
              key={card.key}
              className={`rounded-xl border p-5 transition-all hover:shadow-md ${card.color}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">
                {card.label}
              </p>
              <p className="mt-2 text-3xl font-bold">{card.count}</p>
              <p className="mt-1 text-xs opacity-60">
                {card.lastAt
                  ? `Last submission ${formatTimeAgo(card.lastAt)}`
                  : 'No pending items'}
              </p>
              <Link
                href={card.href}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-current/20 bg-white/60 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white dark:bg-gray-900/40 dark:hover:bg-gray-900"
              >
                Review {card.key === 'mock-tests' ? 'Mock Tests' : card.key === 'content' ? 'Content' : 'Questions'}
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Quick Statistics
         ════════════════════════════════════════════════════════════════ */}
      {statsLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
              <Skeleton className="mb-2 h-3 w-20" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            label="Total Pending"
            value={(stats?.totalPending ?? 0).toLocaleString()}
            subtext="across all resources"
            color="amber"
          />
          <MetricCard
            label="Approved Today"
            value={(stats?.approvedToday ?? 0).toLocaleString()}
            subtext="since midnight"
            color="emerald"
          />
          <MetricCard
            label="Rejected Today"
            value={(stats?.rejectedToday ?? 0).toLocaleString()}
            subtext="since midnight"
            color="rose"
          />
          <MetricCard
            label="Approved This Week"
            value={(stats?.approvedThisWeek ?? 0).toLocaleString()}
            subtext="since Monday"
            color="blue"
          />
          <MetricCard
            label="Rejected This Week"
            value={(stats?.rejectedThisWeek ?? 0).toLocaleString()}
            subtext="since Monday"
            color="purple"
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Two-Column Layout (Activity 2/3, Quick Actions 1/3)
         ════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ─── LEFT: Recent Activity + Filters ───────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Recent Activity
              </h3>

              {/* Quick Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={resourceFilter}
                  onChange={(e) => setResourceFilter(e.target.value as ResourceType)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  aria-label="Filter by resource type"
                >
                  <option value="all">All Resources</option>
                  <option value="questions">Questions</option>
                  <option value="mock-tests">Mock Tests</option>
                  <option value="content">Content</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as ActivityStatusFilter)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  aria-label="Filter by status"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>

                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  aria-label="Sort order"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>
            </div>

            {activityLoading ? (
              <ActivitySkeleton />
            ) : filteredActivity.length === 0 ? (
              <EmptyState
                title="No recent activity"
                description={
                  resourceFilter !== 'all' || statusFilter !== 'all'
                    ? 'No items match the selected filters.'
                    : 'Teacher submissions and review activity will appear here.'
                }
              />
            ) : (
              <div className="space-y-2">
                {filteredActivity.slice(0, 8).map((item) => (
                  <Link
                    key={`${item.resourceType}-${item.id}`}
                    href={RESOURCE_META[item.resourceType].href}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/30"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm dark:bg-gray-800">
                      {RESOURCE_META[item.resourceType].icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {item.title}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {RESOURCE_META[item.resourceType].label} · {formatTimeAgo(item.updatedAt)}
                      </p>
                    </div>
                    <StatusBadge status={item.status} showDot={false} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT: Quick Actions ──────────────────────────────────── */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Quick Actions
            </h3>
            <div className="space-y-2">
              {[
                { label: 'Review Questions', href: '/admin/questions', icon: '❓', color: 'bg-amber-600' },
                { label: 'Review Mock Tests', href: '/admin/mock-tests', icon: '📝', color: 'bg-purple-600' },
                { label: 'Review Content', href: '/admin/content/review', icon: '📄', color: 'bg-rose-600' },
              ].map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm text-white shadow-sm ${action.color}`}
                  >
                    {action.icon}
                  </div>
                  <span className="text-xs font-medium text-gray-700 group-hover:text-blue-600 dark:text-gray-300">
                    {action.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Pipeline summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Review Pipeline
            </h3>
            {statsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { label: 'Questions', value: stats?.pendingQuestions ?? 0, href: '/admin/questions' },
                  { label: 'Mock Tests', value: stats?.pendingMockTests ?? 0, href: '/admin/mock-tests' },
                  { label: 'Content', value: stats?.pendingContent ?? 0, href: '/admin/content/review' },
                ].map((row) => (
                  <Link
                    key={row.label}
                    href={row.href}
                    className="flex items-center justify-between rounded-lg px-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30"
                  >
                    <span className="text-xs text-gray-500">{row.label}</span>
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-gray-900 dark:text-gray-100">
                      {row.value} pending
                      <span className="text-gray-400">→</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
