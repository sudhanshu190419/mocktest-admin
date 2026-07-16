'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCoursePurchaseList } from '@/hooks/admin/useCommerce';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import {
  BookOpen,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import type { CoursePurchaseListItem } from '@/services/admin/commerceService';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const days = Math.floor((now - then) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const BOOLEAN_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function CoursePurchasesPage() {
  const { instituteId } = useAuth();

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
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
  const filters = useMemo(() => ({
    search: debouncedSearch || undefined,
    isActive: activeFilter ? activeFilter === 'true' : undefined,
    instituteId: instituteId ?? undefined,
  }), [activeFilter, debouncedSearch, instituteId]);

  const {
    data: purchaseList,
    isLoading,
    isError,
    error,
    refetch,
  } = useCoursePurchaseList(filters, { page, pageSize });

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<CoursePurchaseListItem>[] = useMemo(() => [
    {
      key: 'studentName',
      header: 'Student',
      render: (item) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[160px]">
            {item.studentName ?? '—'}
          </p>
          {item.studentPhone && (
            <p className="text-[11px] text-gray-400 font-mono">{item.studentPhone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'courseTitle',
      header: 'Course',
      render: (item) => (
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[200px] block">
          {item.courseTitle ?? '—'}
        </span>
      ),
    },
    {
      key: 'enrolledAt',
      header: 'Enrolled Date',
      render: (item) => (
        <div className="text-xs text-gray-500">
          <p>{formatDate(item.enrolledAt)}</p>
          <p className="text-[10px] text-gray-400">{formatTimeAgo(item.enrolledAt)}</p>
        </div>
      ),
    },
    {
      key: 'isActive',
      header: 'Active',
      render: (item) => (
        <StatusBadge
          status={item.isActive ? 'active' : 'inactive'}
          showDot={true}
        />
      ),
    },
    {
      key: 'orderId',
      header: 'Order',
      render: (item) => (
        <span className="text-xs text-gray-500 font-mono">
          {item.orderId ? `${item.orderId.slice(0, 8)}...` : '—'}
        </span>
      ),
    },
  ], []);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      <PageHeader
        title="Course Purchases"
        description="Verify course enrollments and active student access."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Commerce', href: '/admin/commerce' },
          { label: 'Course Purchases' },
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
            Failed to load course purchases: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by student name or phone..."
          className="min-w-[200px] flex-1"
        />
        <Select
          value={activeFilter}
          onChange={(v) => handleFilterChange(setActiveFilter, v)}
          options={BOOLEAN_OPTIONS}
          placeholder="All"
          label="Status"
          className="min-w-[130px]"
        />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={purchaseList?.data ?? []}
        keyExtractor={(item) => item.enrollmentId}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            icon={<BookOpen size={40} weight="thin" />}
            title="No course purchases found"
            description={
              debouncedSearch || activeFilter
                ? 'Try adjusting your search or filters.'
                : 'Course enrollments will appear here once students purchase courses.'
            }
          />
        }
        page={page}
        pageSize={pageSize}
        totalCount={purchaseList?.count ?? 0}
        onPageChange={setPage}
      />
    </div>
  );
}
