'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { usePaymentList } from '@/hooks/admin/useCommerce';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import {
  CurrencyCircleDollar,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import type { PaymentListItem, PaymentStatus } from '@/services/admin/commerceService';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'captured', label: 'Captured' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Partially Refunded' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'amount_desc', label: 'Amount (High to Low)' },
  { value: 'amount_asc', label: 'Amount (Low to High)' },
  { value: 'paidAt_desc', label: 'Paid (Newest)' },
  { value: 'paidAt_asc', label: 'Paid (Oldest)' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getSortValue(sortKey: string): { sortBy: 'createdAt' | 'amount' | 'paidAt'; sortDirection: 'asc' | 'desc' } {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as any, sortDirection: dir ?? 'desc' };
}

function getPaymentStatusColor(status: string): 'emerald' | 'amber' | 'rose' | 'indigo' | 'gray' {
  switch (status) {
    case 'captured': return 'emerald';
    case 'pending': return 'amber';
    case 'failed': return 'rose';
    case 'refunded': return 'indigo';
    case 'partially_refunded': return 'indigo';
    default: return 'gray';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function PaymentsPage() {
  const { instituteId } = useAuth();

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('createdAt_desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(value), 400);
  }, []);

  const handleFilterChange = useCallback((setter: (val: string) => void, value: string) => {
    setter(value);
    setPage(1);
  }, []);

  // ── Data Fetching ────────────────────────────────────────────────────
  const sort = getSortValue(sortKey);

  const filters = useMemo(() => ({
    status: statusFilter ? (statusFilter as PaymentStatus) : undefined,
    search: debouncedSearch || undefined,
    instituteId: instituteId ?? undefined,
  }), [statusFilter, debouncedSearch, instituteId]);

  const {
    data: paymentList,
    isLoading,
    isError,
    error,
    refetch,
  } = usePaymentList(filters, sort, { page, pageSize });

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<PaymentListItem>[] = useMemo(() => [
    {
      key: 'paymentId',
      header: 'Payment ID',
      render: (item) => (
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
          {item.paymentId.slice(0, 8)}...
        </span>
      ),
    },
    {
      key: 'razorpayPaymentId',
      header: 'Razorpay ID',
      render: (item) => (
        <div className="min-w-0 max-w-[130px]">
          {item.razorpayPaymentId ? (
            <span className="font-mono text-[11px] text-gray-500 truncate block">
              {item.razorpayPaymentId}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
          {item.razorpayOrderId && (
            <p className="text-[10px] text-gray-400 font-mono truncate">
              Order: {item.razorpayOrderId}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'orderStudentName',
      header: 'Student',
      render: (item) => (
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[140px] block">
          {item.orderStudentName ?? '—'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (item) => (
        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
          {formatCurrency(item.amount, item.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => (
        <StatusBadge status={item.status} showDot={true} />
      ),
    },
    {
      key: 'gateway',
      header: 'Gateway',
      render: (item) => (
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">
          {item.gateway}
        </span>
      ),
    },
    {
      key: 'failureReason',
      header: 'Failure Reason',
      render: (item) => (
        <span className="text-xs text-rose-600 dark:text-rose-400 max-w-[150px] truncate block">
          {item.failureReason ?? '—'}
        </span>
      ),
    },
    {
      key: 'paidAt',
      header: 'Paid At',
      render: (item) => (
        <div className="text-xs text-gray-500">
          {item.paidAt ? (
            <p>{formatDateTime(item.paidAt)}</p>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>
      ),
    },
  ], []);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Monitor payment attempts, capture status, failures, and refunds."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Commerce', href: '/admin/commerce' },
          { label: 'Payments' },
        ]}
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ArrowsClockwise size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        }
      />

      {/* Error State */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            Failed to load payments: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by student name, payment ID, or Razorpay ID..."
          className="min-w-[200px] flex-1"
        />
        <Select
          value={statusFilter}
          onChange={(v) => handleFilterChange(setStatusFilter, v)}
          options={STATUS_OPTIONS}
          placeholder="All Statuses"
          label="Status"
          className="min-w-[150px]"
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

      {/* Table */}
      <DataTable
        columns={columns}
        data={paymentList?.data ?? []}
        keyExtractor={(item) => item.paymentId}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            icon={<CurrencyCircleDollar size={40} weight="thin" />}
            title="No payments found"
            description={
              debouncedSearch || statusFilter
                ? 'Try adjusting your search or filters.'
                : 'Payments will appear here once transactions are processed.'
            }
          />
        }
        page={page}
        pageSize={pageSize}
        totalCount={paymentList?.count ?? 0}
        onPageChange={setPage}
      />
    </div>
  );
}
