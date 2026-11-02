'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/config/supabase';
import { usePermissions } from '@/hooks/admin/usePermissions';
import {
  useInstallmentPlanList,
  useSetInstallmentPlanActive,
} from '@/hooks/admin/useInstallmentPlanAdmin';
import { useSubscriptionCourses } from '@/hooks/admin/useSubscriptionAdmin';
import {
  formatIntervalLabel,
  type InstallmentPlanListItem,
  type InstallmentPlanSortOptions,
} from '@/services/admin/installmentPlanAdminService';
import { InstallmentPlanFormModal } from '@/components/ui/InstallmentPlanFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { AdminRouteGuard } from '@/components/admin/AdminRouteGuard';
import { cn } from '@/lib/utils';
import {
  Plus,
  ArrowsClockwise,
  PencilSimple,
  CheckCircle,
  Prohibit,
  CreditCard,
  Lock,
  CalendarCheck,
  X,
  WarningOctagon,
  ClipboardText,
  ArrowSquareOut,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'totalFee_desc', label: 'Fee (High to Low)' },
  { value: 'totalFee_asc', label: 'Fee (Low to High)' },
  { value: 'planName_asc', label: 'Plan Name (A-Z)' },
  { value: 'numberOfInstallments_asc', label: 'Fewest Installments' },
  { value: 'numberOfInstallments_desc', label: 'Most Installments' },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function getSortValue(sortKey: string): InstallmentPlanSortOptions {
  const [field, dir] = sortKey.split('_') as [
    InstallmentPlanSortOptions['sortBy'],
    'asc' | 'desc',
  ];
  return { sortBy: field, sortDirection: dir ?? 'desc' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Page View
// ═══════════════════════════════════════════════════════════════════════════

function InstallmentPlansView() {
  const { instituteId } = useAuth();
  const { canAccessFinance } = usePermissions();

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [courseFilter, setCourseFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('createdAt_desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Review queue & active tab state
  const [activeTab, setActiveTab] = useState<'plans' | 'review'>('plans');
  const [reviewOrders, setReviewOrders] = useState<any[]>([]);
  const [loadingReview, setLoadingReview] = useState(false);

  const fetchReviewOrders = useCallback(async () => {
    setLoadingReview(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          order_id,
          profile_id,
          student_id,
          total_amount,
          currency,
          status,
          fulfillment_status,
          admin_review_reason,
          placed_at,
          order_items (
            item_name,
            course_id,
            installment_plan_id
          ),
          payments (
            payment_id,
            gateway_order_id,
            gateway_payment_id,
            amount,
            status
          )
        `)
        .eq('fulfillment_status', 'requires_review')
        .order('placed_at', { ascending: false });

      if (!error && data) {
        setReviewOrders(data);
      }
    } catch (_err) {
      // Non-critical
    } finally {
      setLoadingReview(false);
    }
  }, []);

  // Fetch review orders on mount
  useState(() => {
    void fetchReviewOrders();
  });

  // Modal / dialog state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingPlan, setEditingPlan] = useState<InstallmentPlanListItem | null>(null);
  const [toggleTarget, setToggleTarget] = useState<InstallmentPlanListItem | null>(null);
  const [modalSession, setModalSession] = useState(0);

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

  // Fetch plans
  const filters = useMemo(
    () => ({
      courseId: courseFilter || undefined,
      status: (statusFilter || undefined) as 'active' | 'inactive' | undefined,
      search: debouncedSearch || undefined,
      instituteId: instituteId ?? undefined,
    }),
    [courseFilter, statusFilter, debouncedSearch, instituteId],
  );

  const {
    data: planList,
    isLoading,
    isError,
    error,
    refetch,
  } = useInstallmentPlanList(filters, getSortValue(sortKey), { page, pageSize });

  // Fetch courses for dropdown
  const { data: courses } = useSubscriptionCourses(instituteId);

  const courseOptions = useMemo(
    () => [
      { value: '', label: 'All Courses' },
      ...(courses ?? []).map((c) => ({ value: c.courseId, label: c.title })),
    ],
    [courses],
  );

  const toggleMutation = useSetInstallmentPlanActive();

  const handleOpenCreate = () => {
    setEditingPlan(null);
    setModalMode('create');
    setModalSession((prev) => prev + 1);
    setModalOpen(true);
  };

  const handleOpenEdit = (plan: InstallmentPlanListItem) => {
    setEditingPlan(plan);
    setModalMode('edit');
    setModalSession((prev) => prev + 1);
    setModalOpen(true);
  };

  const handleToggleConfirm = useCallback(async () => {
    if (!toggleTarget) return;
    await toggleMutation.mutateAsync({
      planId: toggleTarget.planId,
      isActive: !toggleTarget.isActive,
    });
    setToggleTarget(null);
  }, [toggleTarget, toggleMutation]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    setCourseFilter('');
    setStatusFilter('');
    setSortKey('createdAt_desc');
    setPage(1);
  };

  const hasActiveFilters = Boolean(searchQuery || courseFilter || statusFilter || sortKey !== 'createdAt_desc');

  // Columns definition for DataTable
  const columns: Column<InstallmentPlanListItem>[] = useMemo(
    () => [
      {
        key: 'planName',
        header: 'Plan Name',
        render: (item) => (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {item.planName}
              </span>
              {(item.agreementsCount ?? 0) > 0 && (
                <span
                  title="Financial terms locked by Migration 221 because student agreements exist"
                  className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                >
                  <Lock size={10} weight="bold" />
                  Locked Terms
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Created {formatDate(item.createdAt)}
            </p>
          </div>
        ),
      },
      {
        key: 'course',
        header: 'Course',
        render: (item) => (
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {item.courseTitle ?? '—'}
          </span>
        ),
      },
      {
        key: 'totalFee',
        header: 'Total Course Fee',
        render: (item) => (
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {formatCurrency(item.totalFee)}
          </div>
        ),
      },
      {
        key: 'installments',
        header: 'Tranches & Cadence',
        render: (item) => {
          const approx = item.numberOfInstallments > 0
            ? item.totalFee / item.numberOfInstallments
            : 0;
          return (
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
                <CalendarCheck size={14} className="text-amber-600 dark:text-amber-400" />
                {item.numberOfInstallments} Tranches
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatIntervalLabel(item.intervalMonths)} • ~{formatCurrency(approx)}/tranche
              </p>
            </div>
          );
        },
      },
      {
        key: 'agreements',
        header: 'Commitments',
        render: (item) => {
          const count = item.agreementsCount ?? 0;
          return count > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              {count} agreement{count === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              No agreements
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => (
          <StatusBadge
            status={item.isActive ? 'active' : 'inactive'}
            label={item.isActive ? 'Active' : 'Inactive'}
          />
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        headerClassName: 'text-right',
        className: 'text-right',
        render: (item) => (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => handleOpenEdit(item)}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="Edit plan"
            >
              <PencilSimple size={16} />
            </button>
            <button
              type="button"
              onClick={() => setToggleTarget(item)}
              className={cn(
                'rounded-lg p-1.5 transition-colors',
                item.isActive
                  ? 'text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20'
                  : 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20',
              )}
              title={item.isActive ? 'Deactivate plan' : 'Activate plan'}
            >
              {item.isActive ? <Prohibit size={16} /> : <CheckCircle size={16} />}
            </button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Installment Plans & Commerce"
        description="Configure milestone installment plans, manage tranches, and review installment orders requiring manual intervention."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Commerce', href: '/admin/commerce' },
          { label: 'Installment Plans' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              title="Refresh plans"
            >
              <ArrowsClockwise size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <Plus size={16} weight="bold" />
              New Installment Plan
            </button>
          </div>
        }
      />

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:w-64">
            <SearchBar
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Search by plan name..."
            />
          </div>

          <div className="w-full sm:w-56">
            <Select
              value={courseFilter}
              onChange={(val) => handleFilterChange(setCourseFilter, val)}
              options={courseOptions}
            />
          </div>

          <div className="w-full sm:w-40">
            <Select
              value={statusFilter}
              onChange={(val) => handleFilterChange(setStatusFilter, val)}
              options={STATUS_OPTIONS}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-full sm:w-48">
            <Select
              value={sortKey}
              onChange={(val) => handleFilterChange(setSortKey, val)}
              options={SORT_OPTIONS}
            />
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900"
            >
              <X size={14} />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/40 dark:bg-red-950/20">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Failed to load installment plans
          </p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : 'An unexpected database error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            <ArrowsClockwise size={14} />
            Retry
          </button>
        </div>
      )}

      {/* Data Table & Empty States */}
      {!isError && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <DataTable
            columns={columns}
            data={planList?.data ?? []}
            keyExtractor={(item) => item.planId}
            isLoading={isLoading}
            page={page}
            pageSize={pageSize}
            totalCount={planList?.count ?? 0}
            onPageChange={setPage}
            emptyState={
              hasActiveFilters ? (
                <EmptyState
                  icon={<CreditCard size={36} weight="duotone" />}
                  title="No plans match your filters"
                  description="Try adjusting your course, status, or search terms to see available installment plans."
                  action={
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
                    >
                      Clear Filters
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<CreditCard size={44} weight="duotone" className="text-amber-500" />}
                  title="No Installment Plans Yet"
                  description="Create course installment plans so students can commit to fixed fees and pay across multiple milestone tranches."
                  action={
                    <button
                      type="button"
                      onClick={handleOpenCreate}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
                    >
                      <Plus size={16} weight="bold" />
                      Create First Plan
                    </button>
                  }
                />
              )
            }
          />
        </div>
      )}

      {/* Form Modal (Create / Edit) */}
      <InstallmentPlanFormModal
        key={modalSession}
        open={modalOpen}
        mode={modalMode}
        plan={editingPlan}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          void refetch();
        }}
      />

      {/* Activate / Deactivate Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => void handleToggleConfirm()}
        title={toggleTarget?.isActive ? 'Deactivate Installment Plan?' : 'Activate Installment Plan?'}
        message={
          toggleTarget?.isActive
            ? `Deactivating "${toggleTarget.planName}" will hide it from new student checkouts (per Migration 220). All existing student commitments, payment allocations, and schedules remain fully intact.`
            : `Activating "${toggleTarget?.planName}" will make it immediately visible to students enrolling in "${toggleTarget?.courseTitle ?? 'this course'}".`
        }
        confirmLabel={toggleTarget?.isActive ? 'Deactivate Plan' : 'Activate Plan'}
        variant={toggleTarget?.isActive ? 'warning' : 'default'}
        loading={toggleMutation.isPending}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Export with Admin Route Guard (permission = 'accessFinance')
// ═══════════════════════════════════════════════════════════════════════════

export default function InstallmentPlansPage() {
  return (
    <AdminRouteGuard permission="accessFinance">
      <InstallmentPlansView />
    </AdminRouteGuard>
  );
}
