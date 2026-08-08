'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  useSubscriptionMetrics,
  useSubscriptionList,
  usePermanentOwnerList,
  useFlaggedOrderList,
  useSubscriptionCourses,
} from '@/hooks/admin/useSubscriptionAdmin';
import { subscriptionAdminService } from '@/services/admin/subscriptionAdminService';
import { downloadCsv } from '@/utils/csv';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { MetricCard } from '@/components/analytics/MetricCard';
import {
  ArrowsClockwise,
  CheckCircle,
  Clock,
  Hourglass,
  WarningCircle,
  Crown,
  Repeat,
  Warning,
  Copy,
  DownloadSimple,
} from '@phosphor-icons/react';
import type {
  SubscriptionListItem,
  PermanentOwnerListItem,
  FlaggedOrderListItem,
  SubscriptionStatus,
} from '@/services/admin/subscriptionAdminService';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'grace', label: 'Grace' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
];

const BILLING_CYCLE_OPTIONS = [
  { value: '', label: 'All Cycles' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half-Yearly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'custom', label: 'Custom' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'endDate_asc', label: 'Expiry (Soonest)' },
  { value: 'endDate_desc', label: 'Expiry (Latest)' },
  { value: 'startDate_desc', label: 'Started (Newest)' },
  { value: 'status_asc', label: 'Status (A-Z)' },
];

type TabKey = 'subscriptions' | 'owners' | 'flags';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'owners', label: 'Permanent Owners' },
  { key: 'flags', label: 'Integrity Flags' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number | null | undefined, currency: string): string {
  const value = amount ?? 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getBillingCycleLabel(cycle: string | null | undefined): string {
  switch (cycle) {
    case 'monthly': return 'Monthly';
    case 'quarterly': return 'Quarterly';
    case 'half_yearly': return 'Half-Yearly';
    case 'yearly': return 'Yearly';
    case 'lifetime': return 'Lifetime';
    case 'custom': return 'Custom';
    default: return cycle ?? '—';
  }
}

type SubscriptionSortField = 'createdAt' | 'endDate' | 'startDate' | 'status';

function getSortValue(
  sortKey: string,
): { sortBy: SubscriptionSortField; sortDirection: 'asc' | 'desc' } {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as SubscriptionSortField, sortDirection: dir ?? 'desc' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function SubscriptionsPage() {
  const router = useRouter();
  const { instituteId } = useAuth();

  // ── Tabs ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>('subscriptions');

  // ── Shared filter state ─────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState(1);
  const [pageOwner, setPageOwner] = useState(1);
  const [pageFlags, setPageFlags] = useState(1);
  const pageSize = 15;

  // ── Tab 1: Subscriptions filters ────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [cycleFilter, setCycleFilter] = useState('');
  const [sortKey, setSortKey] = useState('createdAt_desc');

  // ── Tab 2: Permanent owners filters ─────────────────────────────────
  const [ownerSearchQuery, setOwnerSearchQuery] = useState('');
  const [ownerDebouncedSearch, setOwnerDebouncedSearch] = useState('');
  const ownerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ownerCourseFilter, setOwnerCourseFilter] = useState('');

  // ── Tab 3: Flags filters ────────────────────────────────────────────
  const [flagsSearchQuery, setFlagsSearchQuery] = useState('');
  const [flagsDebouncedSearch, setFlagsDebouncedSearch] = useState('');
  const flagsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = useCallback(
    (setQuery: (v: string) => void, setDebounced: (v: string) => void, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, value: string) => {
      setQuery(value);
      setPage(1);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setDebounced(value), 400);
    },
    [],
  );

  const handleFilterChange = useCallback((setter: (val: string) => void, value: string) => {
    setter(value);
    setPage(1);
  }, []);

  // ── Data Fetching ────────────────────────────────────────────────────
  const {
    data: metrics,
    isLoading: metricsLoading,
    isError: metricsError,
  } = useSubscriptionMetrics(instituteId);

  const subscriptionsFilters = useMemo(() => ({
    status: statusFilter ? (statusFilter as SubscriptionStatus) : undefined,
    courseId: courseFilter || undefined,
    billingCycle: cycleFilter || undefined,
    search: debouncedSearch || undefined,
    instituteId: instituteId ?? undefined,
  }), [statusFilter, courseFilter, cycleFilter, debouncedSearch, instituteId]);

  const sort = getSortValue(sortKey);

  const {
    data: subscriptionList,
    isLoading: subscriptionsLoading,
    isError: subscriptionsError,
    error: subscriptionsErrorObj,
    refetch: refetchSubscriptions,
  } = useSubscriptionList(subscriptionsFilters, sort, { page, pageSize });

  const ownerFilters = useMemo(() => ({
    courseId: ownerCourseFilter || undefined,
    search: ownerDebouncedSearch || undefined,
    instituteId: instituteId ?? undefined,
  }), [ownerCourseFilter, ownerDebouncedSearch, instituteId]);

  const {
    data: ownerList,
    isLoading: ownersLoading,
    isError: ownersError,
    error: ownersErrorObj,
    refetch: refetchOwners,
  } = usePermanentOwnerList(ownerFilters, { page: pageOwner, pageSize });

  const flagsFilters = useMemo(() => ({
    search: flagsDebouncedSearch || undefined,
    instituteId: instituteId ?? undefined,
  }), [flagsDebouncedSearch, instituteId]);

  const {
    data: flaggedList,
    isLoading: flagsLoading,
    isError: flagsError,
    error: flagsErrorObj,
    refetch: refetchFlags,
  } = useFlaggedOrderList(flagsFilters, { page: pageFlags, pageSize });

  const { data: courses } = useSubscriptionCourses(instituteId);

  const courseOptions = useMemo(
    () => [{ value: '', label: 'All Courses' }, ...(courses ?? []).map((c) => ({ value: c.courseId, label: c.title }))],
    [courses],
  );

  // ── CSV Export ──────────────────────────────────────────────────────

  const handleExport = async () => {
    try {
      if (activeTab === 'subscriptions') {
        const result = await subscriptionAdminService.exportSubscriptions(subscriptionsFilters);
        if (!result.success || !result.data) throw new Error(result.error ?? 'Export failed');
        const { data: rows, count } = result.data;
        if (rows.length < count) {
          alert(`Export capped at the first ${rows.length} of ${count} matching rows. Refine the filters to export the complete set.`);
        }
        downloadCsv(
          'subscriptions',
          ['Student', 'Phone', 'Course', 'Plan', 'Billing Cycle', 'Status', 'Start Date', 'End Date', 'Grace End', 'Content Access End', 'Price (INR)', 'Auto-Renew', 'Created At'],
          rows.map((s) => [
            s.studentName, s.studentPhone, s.courseTitle, s.planName,
            getBillingCycleLabel(s.billingCycle), s.status,
            s.startDate, s.endDate, s.graceEndDate, s.contentAccessEndDate,
            s.planPrice, s.isAutoRenew ? 'Yes' : 'No', s.createdAt,
          ]),
        );
      } else if (activeTab === 'owners') {
        const result = await subscriptionAdminService.exportPermanentOwners(ownerFilters);
        if (!result.success || !result.data) throw new Error(result.error ?? 'Export failed');
        const { data: rows, count } = result.data;
        if (rows.length < count) {
          alert(`Export capped at the first ${rows.length} of ${count} matching rows. Refine the filters to export the complete set.`);
        }
        downloadCsv(
          'permanent-owners',
          ['Student', 'Phone', 'Course', 'Enrolled At', 'Active'],
          rows.map((o) => [o.studentName, o.studentPhone, o.courseTitle, o.enrolledAt, o.isActive ? 'Yes' : 'No']),
        );
      } else {
        const result = await subscriptionAdminService.exportFlaggedOrders(flagsFilters);
        if (!result.success || !result.data) throw new Error(result.error ?? 'Export failed');
        const { data: rows, count } = result.data;
        if (rows.length < count) {
          alert(`Export capped at the first ${rows.length} of ${count} matching rows. Refine the filters to export the complete set.`);
        }
        downloadCsv(
          'integrity-flags',
          ['Order ID', 'Student', 'Phone', 'Amount', 'Currency', 'Order Status', 'Duplicate Of', 'Duplicate Kind', 'Flagged For Refund', 'Conversion', 'Placed At'],
          rows.map((o) => [
            o.orderId, o.studentName, o.studentPhone, o.totalAmount, o.currency, o.status,
            o.duplicateOfOrderId, o.duplicateKind, o.flaggedForRefund ? 'Yes' : 'No',
            o.conversion ? 'Yes' : 'No', o.placedAt,
          ]),
        );
      }
    } catch (err) {
      // Surface export failures visibly without blocking the UI.
      alert(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const isBusy =
    activeTab === 'subscriptions'
      ? subscriptionsLoading
      : activeTab === 'owners'
        ? ownersLoading
        : flagsLoading;

  // ── Table Columns ────────────────────────────────────────────────────

  const subscriptionColumns: Column<SubscriptionListItem>[] = useMemo(() => [
    {
      key: 'studentName',
      header: 'Student',
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100 max-w-[160px]">
            {item.studentName ?? '—'}
          </p>
          {item.studentPhone && (
            <p className="font-mono text-[11px] text-gray-400">{item.studentPhone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'courseTitle',
      header: 'Course',
      render: (item) => (
        <span className="block max-w-[160px] truncate text-xs text-gray-700 dark:text-gray-300">
          {item.courseTitle ?? '—'}
        </span>
      ),
    },
    {
      key: 'planName',
      header: 'Plan',
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-gray-900 dark:text-gray-100 max-w-[140px]">
            {item.planName ?? '—'}
          </p>
          <p className="text-[11px] text-gray-400">{getBillingCycleLabel(item.billingCycle)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <StatusBadge status={item.status} showDot={true} />,
    },
    {
      key: 'startDate',
      header: 'Start',
      render: (item) => <span className="text-xs text-gray-500">{formatDate(item.startDate)}</span>,
    },
    {
      key: 'endDate',
      header: 'Expires',
      render: (item) => (
        <div className="text-xs text-gray-500">
          <p>{formatDate(item.endDate)}</p>
          {item.graceEndDate && (
            <p className="text-[10px] text-amber-500">Grace: {formatDate(item.graceEndDate)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'contentAccessEndDate',
      header: 'Content Access',
      render: (item) => (
        <span className="text-xs text-gray-500">{formatDate(item.contentAccessEndDate)}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (item) => <span className="text-xs text-gray-500">{formatDate(item.createdAt)}</span>,
    },
  ], []);

  const ownerColumns: Column<PermanentOwnerListItem>[] = useMemo(() => [
    {
      key: 'studentName',
      header: 'Student',
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100 max-w-[180px]">
            {item.studentName ?? '—'}
          </p>
          {item.studentPhone && (
            <p className="font-mono text-[11px] text-gray-400">{item.studentPhone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'courseTitle',
      header: 'Course',
      render: (item) => (
        <span className="block max-w-[200px] truncate text-xs text-gray-700 dark:text-gray-300">
          {item.courseTitle ?? '—'}
        </span>
      ),
    },
    {
      key: 'enrolledAt',
      header: 'Enrolled At',
      render: (item) => <span className="text-xs text-gray-500">{formatDate(item.enrolledAt)}</span>,
    },
    {
      key: 'isActive',
      header: 'Access',
      render: (item) => (
        <StatusBadge status={item.isActive ? 'active' : 'expired'} showDot={true} />
      ),
    },
  ], []);

  const flaggedColumns: Column<FlaggedOrderListItem>[] = useMemo(() => [
    {
      key: 'orderId',
      header: 'Order ID',
      render: (item) => (
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
          {item.orderId.slice(0, 8)}...
        </span>
      ),
    },
    {
      key: 'studentName',
      header: 'Student',
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100 max-w-[160px]">
            {item.studentName ?? '—'}
          </p>
          {item.studentPhone && (
            <p className="font-mono text-[11px] text-gray-400">{item.studentPhone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Amount',
      render: (item) => (
        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
          {formatCurrency(item.totalAmount, item.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Order Status',
      render: (item) => <StatusBadge status={item.status} showDot={true} />,
    },
    {
      key: 'flags',
      header: 'Flags',
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          {item.duplicateOfOrderId && (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">
              Duplicate {item.duplicateKind ? `(${item.duplicateKind})` : ''}
            </span>
          )}
          {item.flaggedForRefund && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              Refund Flag
            </span>
          )}
          {item.conversion && (
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400">
              Conversion
            </span>
          )}
          {!item.duplicateOfOrderId && !item.flaggedForRefund && !item.conversion && (
            <span className="text-xs text-gray-400">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'placedAt',
      header: 'Placed At',
      render: (item) => <span className="text-xs text-gray-500">{formatDateTime(item.placedAt)}</span>,
    },
  ], []);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  const renderTabError = (error: unknown, message: string) => (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">
        {message}: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions"
        description="Audit every student subscription, permanent ownership, and payment-integrity flag."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Commerce', href: '/admin/commerce' },
          { label: 'Subscriptions' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={isBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <DownloadSimple size={14} />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'subscriptions') refetchSubscriptions();
                else if (activeTab === 'owners') refetchOwners();
                else refetchFlags();
              }}
              disabled={isBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowsClockwise size={14} className={isBusy ? 'animate-spin' : ''} />
              {isBusy ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        }
      />

      {/* ════════════════════════════════════════════════════════════════════
          Metrics
         ════════════════════════════════════════════════════════════════════ */}
      {metricsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            Failed to load subscription metrics
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Active"
          value={(metrics?.active ?? 0).toLocaleString()}
          icon={<CheckCircle size={20} weight="duotone" />}
          color="emerald"
          loading={metricsLoading}
        />
        <MetricCard
          label="Grace"
          value={(metrics?.grace ?? 0).toLocaleString()}
          icon={<Clock size={20} weight="duotone" />}
          color="amber"
          loading={metricsLoading}
        />
        <MetricCard
          label="Expired"
          value={(metrics?.expired ?? 0).toLocaleString()}
          icon={<WarningCircle size={20} weight="duotone" />}
          color="rose"
          loading={metricsLoading}
        />
        <MetricCard
          label="Pending"
          value={(metrics?.pending ?? 0).toLocaleString()}
          icon={<Hourglass size={20} weight="duotone" />}
          color="gray"
          loading={metricsLoading}
        />
        <MetricCard
          label="Permanent Owners"
          value={(metrics?.permanentOwners ?? 0).toLocaleString()}
          icon={<Crown size={20} weight="duotone" />}
          color="purple"
          loading={metricsLoading}
        />
        <MetricCard
          label="Renewals"
          value={(metrics?.renewals ?? 0).toLocaleString()}
          icon={<ArrowsClockwise size={20} weight="duotone" />}
          color="blue"
          loading={metricsLoading}
        />
        <MetricCard
          label="Conversions"
          value={(metrics?.conversions ?? 0).toLocaleString()}
          icon={<Repeat size={20} weight="duotone" />}
          color="indigo"
          loading={metricsLoading}
        />
        <MetricCard
          label="Refund Flags"
          value={(metrics?.flaggedForRefund ?? 0).toLocaleString()}
          icon={<Warning size={20} weight="duotone" />}
          color="rose"
          loading={metricsLoading}
        />
        <MetricCard
          label="Duplicate Orders"
          value={(metrics?.duplicateOrders ?? 0).toLocaleString()}
          icon={<Copy size={20} weight="duotone" />}
          color="cyan"
          loading={metricsLoading}
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          Tabs
         ════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 dark:border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cnTab(activeTab === tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          Tab: Subscriptions
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4">
          {subscriptionsError && renderTabError(subscriptionsErrorObj, 'Failed to load subscriptions')}

          <div className="flex flex-wrap items-end gap-3">
            <SearchBar
              value={searchQuery}
              onChange={(v) => onSearchChange(setSearchQuery, setDebouncedSearch, searchTimeoutRef, v)}
              placeholder="Search by student name or phone..."
              className="min-w-[200px] flex-1"
            />
            <Select
              value={statusFilter}
              onChange={(v) => handleFilterChange(setStatusFilter, v)}
              options={STATUS_OPTIONS}
              placeholder="All Statuses"
              label="Status"
              className="min-w-[130px]"
            />
            <Select
              value={cycleFilter}
              onChange={(v) => handleFilterChange(setCycleFilter, v)}
              options={BILLING_CYCLE_OPTIONS}
              placeholder="All Cycles"
              label="Billing Cycle"
              className="min-w-[140px]"
            />
            <Select
              value={courseFilter}
              onChange={(v) => handleFilterChange(setCourseFilter, v)}
              options={courseOptions}
              placeholder="All Courses"
              label="Course"
              className="min-w-[180px]"
            />
            <Select
              value={sortKey}
              onChange={(v) => handleFilterChange(setSortKey, v)}
              options={SORT_OPTIONS}
              placeholder="Sort by"
              label="Sort"
              className="min-w-[150px]"
            />
          </div>

          <DataTable
            columns={subscriptionColumns}
            data={subscriptionList?.data ?? []}
            keyExtractor={(item) => item.subscriptionId}
            isLoading={subscriptionsLoading}
            onRowClick={(item) => router.push(`/admin/commerce/subscriptions/${item.subscriptionId}`)}
            emptyState={
              <EmptyState
                icon={<Clock size={40} weight="thin" />}
                title="No subscriptions found"
                description={
                  debouncedSearch || statusFilter || cycleFilter || courseFilter
                    ? 'Try adjusting your search or filters.'
                    : 'Subscriptions will appear here once students purchase plans.'
                }
              />
            }
            page={page}
            pageSize={pageSize}
            totalCount={subscriptionList?.count ?? 0}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab: Permanent Owners
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'owners' && (
        <div className="space-y-4">
          {ownersError && renderTabError(ownersErrorObj, 'Failed to load permanent owners')}

          <div className="flex flex-wrap items-end gap-3">
            <SearchBar
              value={ownerSearchQuery}
              onChange={(v) => onSearchChange(setOwnerSearchQuery, setOwnerDebouncedSearch, ownerTimeoutRef, v)}
              placeholder="Search by student name or phone..."
              className="min-w-[200px] flex-1"
            />
            <Select
              value={ownerCourseFilter}
              onChange={(v) => {
                setOwnerCourseFilter(v);
                setPageOwner(1);
              }}
              options={courseOptions}
              placeholder="All Courses"
              label="Course"
              className="min-w-[180px]"
            />
          </div>

          <DataTable
            columns={ownerColumns}
            data={ownerList?.data ?? []}
            keyExtractor={(item) => item.enrollmentId}
            isLoading={ownersLoading}
            emptyState={
              <EmptyState
                icon={<Crown size={40} weight="thin" />}
                title="No permanent owners found"
                description={
                  ownerDebouncedSearch || ownerCourseFilter
                    ? 'Try adjusting your search or filters.'
                    : 'Students who complete a one-time course purchase appear here.'
                }
              />
            }
            page={pageOwner}
            pageSize={pageSize}
            totalCount={ownerList?.count ?? 0}
            onPageChange={setPageOwner}
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab: Duplicates & Refund Flags
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'flags' && (
        <div className="space-y-4">
          {flagsError && renderTabError(flagsErrorObj, 'Failed to load flagged orders')}

          <div className="flex flex-wrap items-end gap-3">
            <SearchBar
              value={flagsSearchQuery}
              onChange={(v) => onSearchChange(setFlagsSearchQuery, setFlagsDebouncedSearch, flagsTimeoutRef, v)}
              placeholder="Search by student or order ID..."
              className="min-w-[200px] flex-1"
            />
          </div>

          <DataTable
            columns={flaggedColumns}
            data={flaggedList?.data ?? []}
            keyExtractor={(item) => item.orderId}
            isLoading={flagsLoading}
            emptyState={
              <EmptyState
                icon={<Warning size={40} weight="thin" />}
                title="No flagged orders"
                description={
                  flagsDebouncedSearch
                    ? 'Try adjusting your search.'
                    : 'Orders flagged by payment-integrity checks (duplicates, refund flags, conversions) appear here for finance review.'
                }
              />
            }
            page={pageFlags}
            pageSize={pageSize}
            totalCount={flaggedList?.count ?? 0}
            onPageChange={setPageFlags}
          />
        </div>
      )}
    </div>
  );
}

// Tab button style helper (kept inline to avoid importing cn twice)
function cnTab(active: boolean): string {
  return [
    'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
    active
      ? 'border-amber-500 text-amber-700 dark:text-amber-400'
      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
  ].join(' ');
}
