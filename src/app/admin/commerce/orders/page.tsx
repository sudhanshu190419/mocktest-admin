'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrderList } from '@/hooks/admin/useCommerce';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import {
  ShoppingCart,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import type { OrderListItem, OrderStatus } from '@/services/admin/commerceService';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
];

const PRODUCT_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'course', label: 'Course' },
  { value: 'pyq_package', label: 'PYQ Package' },
  { value: 'subscription_plan', label: 'Subscription' },
];

const SORT_OPTIONS = [
  { value: 'placedAt_desc', label: 'Newest First' },
  { value: 'placedAt_asc', label: 'Oldest First' },
  { value: 'totalAmount_desc', label: 'Amount (High to Low)' },
  { value: 'totalAmount_asc', label: 'Amount (Low to High)' },
  { value: 'confirmedAt_desc', label: 'Confirmed (Newest)' },
  { value: 'confirmedAt_asc', label: 'Confirmed (Oldest)' },
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

function getSortValue(sortKey: string): { sortBy: 'placedAt' | 'totalAmount' | 'confirmedAt'; sortDirection: 'asc' | 'desc' } {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as any, sortDirection: dir ?? 'desc' };
}

function getProductTypeLabel(type: string): string {
  switch (type) {
    case 'course': return 'Course';
    case 'pyq_package': return 'PYQ Package';
    case 'subscription_plan': return 'Subscription';
    default: return type;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function OrdersPage() {
  const { instituteId } = useAuth();

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState('');
  const [sortKey, setSortKey] = useState('placedAt_desc');
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
    status: statusFilter ? (statusFilter as OrderStatus) : undefined,
    productType: productTypeFilter ? (productTypeFilter as any) : undefined,
    search: debouncedSearch || undefined,
    instituteId: instituteId ?? undefined,
  }), [statusFilter, productTypeFilter, debouncedSearch, instituteId]);

  const {
    data: orderList,
    isLoading,
    isError,
    error,
    refetch,
  } = useOrderList(filters, sort, { page, pageSize });

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<OrderListItem>[] = useMemo(() => [
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
      key: 'productType',
      header: 'Product Type',
      render: (item) => (
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {getProductTypeLabel(item.productType)}
        </span>
      ),
    },
    {
      key: 'productName',
      header: 'Product',
      render: (item) => (
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[160px] block">
          {item.productName ?? '—'}
        </span>
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
      header: 'Status',
      render: (item) => (
        <StatusBadge status={item.status} showDot={true} />
      ),
    },
    {
      key: 'placedAt',
      header: 'Placed At',
      render: (item) => (
        <div className="text-xs text-gray-500">
          <p>{formatDateTime(item.placedAt)}</p>
        </div>
      ),
    },
    {
      key: 'confirmedAt',
      header: 'Confirmed At',
      render: (item) => (
        <div className="text-xs text-gray-500">
          {item.confirmedAt ? (
            <p>{formatDateTime(item.confirmedAt)}</p>
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
        title="Orders"
        description="View and verify the complete lifecycle of every purchase order."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Commerce', href: '/admin/commerce' },
          { label: 'Orders' },
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
            Failed to load orders: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by student name, phone, or order ID..."
          className="min-w-[200px] flex-1"
        />
        <Select
          value={statusFilter}
          onChange={(v) => handleFilterChange(setStatusFilter, v)}
          options={STATUS_OPTIONS}
          placeholder="All Statuses"
          label="Status"
          className="min-w-[140px]"
        />
        <Select
          value={productTypeFilter}
          onChange={(v) => handleFilterChange(setProductTypeFilter, v)}
          options={PRODUCT_TYPE_OPTIONS}
          placeholder="All Types"
          label="Product Type"
          className="min-w-[140px]"
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
        data={orderList?.data ?? []}
        keyExtractor={(item) => item.orderId}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            icon={<ShoppingCart size={40} weight="thin" />}
            title="No orders found"
            description={
              debouncedSearch || statusFilter || productTypeFilter
                ? 'Try adjusting your search or filters.'
                : 'Orders will appear here once students make purchases.'
            }
          />
        }
        page={page}
        pageSize={pageSize}
        totalCount={orderList?.count ?? 0}
        onPageChange={setPage}
      />
    </div>
  );
}
