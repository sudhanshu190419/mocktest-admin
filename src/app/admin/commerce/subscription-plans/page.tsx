'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  useSubscriptionPlanList,
  useDuplicateSubscriptionPlan,
  useSetSubscriptionPlanActive,
} from '@/hooks/admin/useSubscriptionPlanAdmin';
import { useSubscriptionCourses } from '@/hooks/admin/useSubscriptionAdmin';
import {
  PLAN_BILLING_CYCLE_OPTIONS,
  getBillingCycleLabel,
  type PlanBillingCycle,
  type SubscriptionPlanListItem,
} from '@/services/admin/subscriptionPlanAdminService';
import { SubscriptionPlanFormModal } from '@/components/ui/SubscriptionPlanFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import {
  Plus,
  ArrowsClockwise,
  PencilSimple,
  Copy,
  CheckCircle,
  Prohibit,
  X,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const CYCLE_FILTER_OPTIONS = [
  { value: '', label: 'All Cycles' },
  ...PLAN_BILLING_CYCLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'price_asc', label: 'Price (Low to High)' },
  { value: 'price_desc', label: 'Price (High to Low)' },
  { value: 'billingCycle_asc', label: 'Billing Cycle (A-Z)' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

type PlanSortField = 'createdAt' | 'price' | 'billingCycle' | 'isActive';

function getSortValue(sortKey: string): {
  sortBy: PlanSortField;
  sortDirection: 'asc' | 'desc';
} {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as PlanSortField, sortDirection: dir ?? 'desc' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function SubscriptionPlansPage() {
  const { instituteId, user } = useAuth();

  // ── Filter state ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [courseFilter, setCourseFilter] = useState('');
  const [cycleFilter, setCycleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('createdAt_desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // ── Modal / dialog state ─────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlanListItem | null>(null);
  const [toggleTarget, setToggleTarget] = useState<SubscriptionPlanListItem | null>(null);
  // Changes on every open so the modal remounts with fresh form state.
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

  // ── Data fetching ────────────────────────────────────────────────────
  const filters = useMemo(() => ({
    courseId: courseFilter || undefined,
    billingCycle: cycleFilter || undefined,
    status: (statusFilter || undefined) as 'active' | 'inactive' | undefined,
    search: debouncedSearch || undefined,
    instituteId: instituteId ?? undefined,
  }), [courseFilter, cycleFilter, statusFilter, debouncedSearch, instituteId]);

  const {
    data: planList,
    isLoading,
    isError,
    error,
    refetch,
  } = useSubscriptionPlanList(filters, getSortValue(sortKey), { page, pageSize });

  const { data: courses } = useSubscriptionCourses(instituteId);

  const courseOptions = useMemo(
    () => [{ value: '', label: 'All Courses' }, ...(courses ?? []).map((c) => ({ value: c.courseId, label: c.title }))],
    [courses],
  );

  // ── Mutations ────────────────────────────────────────────────────────
  const duplicateMutation = useDuplicateSubscriptionPlan();
  const toggleMutation = useSetSubscriptionPlanActive();

  const actorId = user?.id ?? '';

  // Duplicate flow: pick a target course + billing cycle (the copy can never
  // keep both the source course and source cycle — schema invariant).
  const [duplicateTarget, setDuplicateTarget] = useState<{
    plan: SubscriptionPlanListItem;
    courseId: string;
    billingCycle: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleDuplicateConfirm = useCallback(async () => {
    if (!duplicateTarget || !actorId) return;
    const result = await duplicateMutation.mutateAsync({
      planId: duplicateTarget.plan.planId,
      input: {
        courseId: duplicateTarget.courseId,
        billingCycle: duplicateTarget.billingCycle as PlanBillingCycle,
        updatedBy: actorId,
      },
    });
    setDuplicateTarget(null);
    if (!result.success) {
      alert(result.error ?? 'Failed to duplicate the plan.');
      return;
    }
    setNotice(
      `Duplicated \u201c${result.data?.name ?? duplicateTarget.plan.name}\u201d as an inactive copy — edit it before activating.`,
    );
  }, [actorId, duplicateMutation, duplicateTarget]);

  const handleToggleActive = async () => {
    if (!toggleTarget || !actorId) return;
    const result = await toggleMutation.mutateAsync({
      planId: toggleTarget.planId,
      isActive: !toggleTarget.isActive,
      updatedBy: actorId,
    });
    if (!result.success && result.error) {
      alert(result.error);
    }
    setToggleTarget(null);
  };

  const openCreate = useCallback(() => {
    setEditingPlan(null);
    setModalSession((s) => s + 1);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((plan: SubscriptionPlanListItem) => {
    setEditingPlan(plan);
    setModalSession((s) => s + 1);
    setModalOpen(true);
  }, []);

  // ── Columns ──────────────────────────────────────────────────────────
  const columns: Column<SubscriptionPlanListItem>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Plan',
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100 max-w-[180px]">
            {item.name}
          </p>
          <p className="truncate font-mono text-[11px] text-gray-400 max-w-[180px]">{item.slug}</p>
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
      key: 'billingCycle',
      header: 'Billing Cycle',
      render: (item) => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {getBillingCycleLabel(item.billingCycle)}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      render: (item) => (
        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
          {formatCurrency(item.price, item.currencyCode)}
        </span>
      ),
    },
    {
      key: 'durationDays',
      header: 'Duration',
      render: (item) => <span className="text-xs text-gray-500">{item.durationDays} days</span>,
    },
    {
      key: 'trialDays',
      header: 'Trial',
      render: (item) => (
        <span className="text-xs text-gray-500">{item.trialDays > 0 ? `${item.trialDays}d` : '—'}</span>
      ),
    },
    {
      key: 'isFeatured',
      header: 'Featured',
      render: (item) =>
        item.isFeatured ? (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">★ Featured</span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (item) => (
        <StatusBadge status={item.isActive ? 'active' : 'inactive'} showDot={true} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (item) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => openEdit(item)}
            title="Edit plan"
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
          >
            <PencilSimple size={15} />
          </button>
          <button
            type="button"
            onClick={() =>
              setDuplicateTarget({
                plan: item,
                courseId: item.courseId ?? '',
                billingCycle: PLAN_BILLING_CYCLE_OPTIONS.some((o) => o.value === item.billingCycle)
                  ? item.billingCycle ?? 'monthly'
                  : 'monthly',
              })
            }
            disabled={duplicateMutation.isPending}
            title="Duplicate plan"
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            onClick={() => setToggleTarget(item)}
            disabled={toggleMutation.isPending}
            title={item.isActive ? 'Deactivate plan' : 'Activate plan'}
            className={cnActionIcon(item.isActive)}
          >
            {item.isActive ? <Prohibit size={15} /> : <CheckCircle size={15} />}
          </button>
        </div>
      ),
    },
  ], [duplicateMutation.isPending, toggleMutation.isPending, openEdit]);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription Plans"
        description="Create, edit, duplicate, and manage course-scoped subscription plans."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Commerce', href: '/admin/commerce' },
          { label: 'Subscription Plans' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus size={14} weight="bold" />
              New Plan
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowsClockwise size={14} className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        }
      />

      {/* Success Notice */}
      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="rounded-lg p-1 text-emerald-600 transition-colors hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            Failed to load subscription plans:{' '}
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by plan name, slug, or course..."
          className="min-w-[200px] flex-1"
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
          value={cycleFilter}
          onChange={(v) => handleFilterChange(setCycleFilter, v)}
          options={CYCLE_FILTER_OPTIONS}
          placeholder="All Cycles"
          label="Billing Cycle"
          className="min-w-[140px]"
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
        data={planList?.data ?? []}
        keyExtractor={(item) => item.planId}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            icon={<Copy size={40} weight="thin" />}
            title="No subscription plans found"
            description={
              debouncedSearch || courseFilter || cycleFilter || statusFilter
                ? 'Try adjusting your search or filters.'
                : 'Create your first course-scoped plan to start selling subscriptions.'
            }
            action={
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <Plus size={14} weight="bold" />
                New Plan
              </button>
            }
          />
        }
        page={page}
        pageSize={pageSize}
        totalCount={planList?.count ?? 0}
        onPageChange={setPage}
      />

      {/* Create / Edit Modal */}
      <SubscriptionPlanFormModal
        key={modalSession}
        open={modalOpen}
        mode={editingPlan ? 'edit' : 'create'}
        plan={editingPlan}
        onClose={() => setModalOpen(false)}
      />

      {/* Activate / Deactivate Confirm */}
      <ConfirmDialog
        open={toggleTarget != null}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => void handleToggleActive()}
        title={toggleTarget?.isActive ? 'Deactivate plan?' : 'Activate plan?'}
        message={
          toggleTarget?.isActive
            ? `"${toggleTarget?.name}" will stop being offered for purchase immediately. Existing active subscriptions are unaffected.`
            : `"${toggleTarget?.name}" will become available for purchase again.`
        }
        confirmLabel={toggleTarget?.isActive ? 'Deactivate' : 'Activate'}
        variant={toggleTarget?.isActive ? 'warning' : 'default'}
        loading={toggleMutation.isPending}
      />

      {/* Duplicate Dialog — pick target course + billing cycle */}
      <ConfirmDialog
        open={duplicateTarget != null}
        onClose={() => setDuplicateTarget(null)}
        onConfirm={() => void handleDuplicateConfirm()}
        title="Duplicate plan"
        message={`Copy \u201c${duplicateTarget?.plan.name ?? ''}\u201d to a course and billing cycle. The copy is created inactive (no sales impact).`}
        confirmLabel="Duplicate"
        variant="default"
        loading={duplicateMutation.isPending}
      >
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Target Course *
            </label>
            <select
              value={duplicateTarget?.courseId ?? ''}
              onChange={(e) =>
                setDuplicateTarget((t) => (t ? { ...t, courseId: e.target.value } : t))
              }
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">Select Course</option>
              {(courses ?? []).map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Billing Cycle *
            </label>
            <select
              value={duplicateTarget?.billingCycle ?? 'monthly'}
              onChange={(e) =>
                setDuplicateTarget((t) => (t ? { ...t, billingCycle: e.target.value } : t))
              }
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              {PLAN_BILLING_CYCLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Each course allows one plan per billing cycle — if the chosen combination is already
taken, pick a different cycle or course.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}

// Action-icon button style helper.
function cnActionIcon(active: boolean): string {
  return [
    'rounded-lg p-1.5 transition-colors disabled:opacity-40',
    active
      ? 'text-gray-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400'
      : 'text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400',
  ].join(' ');
}
