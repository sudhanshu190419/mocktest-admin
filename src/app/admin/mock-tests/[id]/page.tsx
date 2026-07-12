'use client';

import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useMockTestDetail,
  useMockTestQuestions,
  usePublishMockTest,
  useArchiveMockTest,
  useRestoreMockTest,
  useDuplicateMockTest,
  useDeleteMockTest,
} from '@/hooks/admin/useMockTestManagement';
import {
  useMockTestReleaseStatus,
  useReleaseMockResults,
  useUnreleaseMockResults,
} from '@/hooks/mockTest/useMockResults';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { MockTestManagementDetail } from '@/services/admin/mockTestManagementService';
import {
  Exam,
  CalendarBlank,
  Clock,
  FileText,
  BookOpen,
  ChalkboardTeacher,
  CheckCircle,
  Sparkle,
  Archive,
  Question,
  Users,
  Student,
  Gear,
  Shuffle,
  Lock,
  PlayCircle,
  XCircle,
  UserCircle,
  Books,
  Tag,
  Prohibit,
  CopySimple,
  Trash,
  CircleNotch,
  ArrowSquareOut,
  Eye,
  EyeSlash,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h} hours`;
}

function formatYesNo(value: boolean | undefined | null): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Not configured';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton
// ═══════════════════════════════════════════════════════════════════════════

function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Overview skeleton */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-4 h-4 w-3/4" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
      </div>

      {/* Two-column skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-4 h-4 w-32" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-4 h-4 w-24" />
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Info Row Component
// ═══════════════════════════════════════════════════════════════════════════

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
          {value}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Stat Card Component
// ═══════════════════════════════════════════════════════════════════════════

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
    amber: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
    purple: 'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800',
    gray: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorMap[color] ?? colorMap.blue}`}>
      <div className="mb-2">{icon}</div>
      <p className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p className="text-[11px] font-medium uppercase tracking-wider opacity-70 mt-0.5">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function MockTestDetailPage() {
  const params = useParams();
  const mockTestId = params.id as string;

  const { data: test, isLoading, isError, error, refetch } = useMockTestDetail(mockTestId);
  const { data: questions, isLoading: questionsLoading } = useMockTestQuestions(mockTestId);

  // ── Confirmation & Feedback State ────────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<{
    type: 'publish' | 'archive' | 'restore' | 'duplicate' | 'delete' | 'releaseResults' | 'unreleaseResults';
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const clearFeedback = useCallback(() => {
    setTimeout(() => {
      setActionError(null);
      setActionSuccess(null);
    }, 4000);
  }, []);

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const publishMutation = usePublishMockTest();
  const archiveMutation = useArchiveMockTest();
  const restoreMutation = useRestoreMockTest();
  const duplicateMutation = useDuplicateMockTest();
  const deleteMutation = useDeleteMockTest();

  // ── Result Release Hooks ──────────────────────────────────────────────
  const { data: releaseStatus, isLoading: releaseStatusLoading, error: releaseStatusError } = useMockTestReleaseStatus(mockTestId);
  const releaseResultsMutation = useReleaseMockResults();
  const unreleaseResultsMutation = useUnreleaseMockResults();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (action: 'publish' | 'archive' | 'restore' | 'duplicate' | 'delete' | 'releaseResults' | 'unreleaseResults') => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      switch (action) {
        case 'publish': {
          const result = await publishMutation.mutateAsync(mockTestId);
          if (!result.success) {
            setActionError(result.error ?? 'Failed to publish mock test.');
            return;
          }
          break;
        }
        case 'archive': {
          const result = await archiveMutation.mutateAsync(mockTestId);
          if (!result.success) {
            setActionError(result.error ?? 'Failed to archive mock test.');
            return;
          }
          break;
        }
        case 'restore': {
          const result = await restoreMutation.mutateAsync(mockTestId);
          if (!result.success) {
            setActionError(result.error ?? 'Failed to restore mock test.');
            return;
          }
          break;
        }
        case 'duplicate': {
          const result = await duplicateMutation.mutateAsync(mockTestId);
          if (!result.success) {
            setActionError(result.error ?? 'Failed to duplicate mock test.');
            return;
          }
          break;
        }
        case 'delete': {
          const result = await deleteMutation.mutateAsync(mockTestId);
          if (!result.success) {
            setActionError(result.error ?? 'Failed to delete mock test.');
            return;
          }
          break;
        }
        case 'releaseResults':
          await releaseResultsMutation.mutateAsync(mockTestId);
          break;
        case 'unreleaseResults':
          await unreleaseResultsMutation.mutateAsync(mockTestId);
          break;
      }

      setActionSuccess(action === 'releaseResults' ? 'Results released successfully'
        : action === 'unreleaseResults' ? 'Results hidden successfully'
        : `Mock test ${action === 'publish' ? 'published' : action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : action === 'duplicate' ? 'duplicated' : 'deleted'} successfully`);
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [mockTestId, publishMutation, archiveMutation, restoreMutation, duplicateMutation, deleteMutation, releaseResultsMutation, unreleaseResultsMutation, refetch, clearFeedback]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type);
  }, [confirmAction, executeAction]);

  // ── Confirm Dialog Configuration ────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type } = confirmAction;

    switch (type) {
      case 'publish':
        return {
          title: 'Publish Mock Test',
          message: `Are you sure you want to publish this mock test? It will be made available to students.`,
          confirmLabel: 'Publish',
          variant: 'default' as const,
        };
      case 'archive':
        return {
          title: 'Archive Mock Test',
          message: `Are you sure you want to archive this mock test? Students will no longer see it.`,
          confirmLabel: 'Archive',
          variant: 'warning' as const,
        };
      case 'restore':
        return {
          title: 'Restore Mock Test',
          message: `Are you sure you want to restore this archived mock test?`,
          confirmLabel: 'Restore',
          variant: 'default' as const,
        };
      case 'duplicate':
        return {
          title: 'Duplicate Mock Test',
          message: `Create a copy of this mock test? The duplicate will be created as a draft.`,
          confirmLabel: 'Duplicate',
          variant: 'default' as const,
        };
      case 'delete':
        return {
          title: 'Delete Mock Test',
          message: `Are you sure you want to delete this mock test? This action cannot be undone.`,
          confirmLabel: 'Delete',
          variant: 'danger' as const,
        };
      case 'releaseResults':
        return {
          title: 'Release Results',
          message: releaseStatus && releaseStatus.unreleasedResults > 0
            ? `Release results for all ${releaseStatus.totalResults} students? ${releaseStatus.unreleasedResults} unreleased result(s) will become visible to students.`
            : 'All results are already released. No changes will be made.',
          confirmLabel: 'Release Results',
          variant: 'default' as const,
        };
      case 'unreleaseResults':
        return {
          title: 'Hide Results',
          message: releaseStatus && releaseStatus.releasedResults > 0
            ? `Hide results for all ${releaseStatus.totalResults} students? ${releaseStatus.releasedResults} released result(s) will no longer be visible to students.`
            : 'No results are currently released. No changes will be made.',
          confirmLabel: 'Hide Results',
          variant: 'warning' as const,
        };
      default:
        return null;
    }
  }, [confirmAction, releaseStatus]);

  // ── Difficulty Breakdown (from backend if available) ─────────────────
  // The detail response does not include difficulty breakdown currently.
  // When the backend adds a difficulty breakdown to the detail endpoint,
  // populate `difficultyInfo` from the response.
  const difficultyInfo = null as { easy: number; medium: number; hard: number } | null;

  // ═════════════════════════════════════════════════════════════════════
  //  Loading State
  // ═════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Mock Test Details"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Mock Tests', href: '/admin/mock-tests' },
            { label: 'Loading...' },
          ]}
        />
        <DetailPageSkeleton />
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Error State
  // ═════════════════════════════════════════════════════════════════════
  if (isError || !test) {
    return (
      <div>
        <PageHeader
          title="Mock Test Details"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Mock Tests', href: '/admin/mock-tests' },
            { label: 'Error' },
          ]}
        />
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <XCircle size={28} weight="duotone" className="text-red-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-red-800 dark:text-red-300">
                Failed to load mock test details
              </p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'The mock test could not be found or an error occurred.'}
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/admin/mock-tests"
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-900 dark:text-red-400"
              >
                ← Back to Mock Test List
              </Link>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Render — Mock Test Data Loaded
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header (Section 1)
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title={test.title}
        description={`${test.testType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} · ${test.streamName ?? 'No Stream'}`}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Mock Tests', href: '/admin/mock-tests' },
          { label: test.title },
        ]}
        actions={
          <Link
            href="/admin/mock-tests"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            ← Back to List
          </Link>
        }
      />

      {/* ════════════════════════════════════════════════════════════════
          Overview Card (Section 2)
         ════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          {/* Title + Status */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">
                {test.title}
              </h2>
              <StatusBadge status={test.status} showDot={true} />
            </div>
            {test.description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {test.description}
              </p>
            )}
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-4 sm:flex-shrink-0">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{test.questionCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Questions</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{test.attemptCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Attempts</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{test.uniqueStudentCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Students</p>
            </div>
          </div>
        </div>

        {/* Metadata badges */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
            <Tag size={12} />
            {test.testType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
            <Books size={12} />
            {test.streamName ?? '—'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400">
            <BookOpen size={12} />
            {test.subjectName ?? 'All Subjects'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <UserCircle size={12} />
            {test.teacherName ?? 'Unknown'}
          </span>
        </div>

        {/* Timestamps */}
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1">
            <CalendarBlank size={12} />
            Created {formatDate(test.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            Updated {formatDate(test.updatedAt)}
          </span>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Two-Column Layout
         ════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ─── LEFT COLUMN (2/3) ────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">

          {/* ════════════════════════════════════════════════════════════
              Mock Test Information (Section 2 continued)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Mock Test Information
            </h3>
            <p className="mb-3 text-xs text-gray-500">Basic details, stream, subject, and teacher</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<FileText size={18} />}
                label="Test Title"
                value={test.title}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="Type"
                value={test.testType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              />
              <InfoRow
                icon={<CheckCircle size={18} />}
                label="Status"
                value={<StatusBadge status={test.status} showDot={true} />}
              />
              <InfoRow
                icon={<Books size={18} />}
                label="Stream"
                value={test.streamName ?? '—'}
              />
              <InfoRow
                icon={<BookOpen size={18} />}
                label="Subject"
                value={test.subjectName ?? 'All Subjects'}
              />
              <InfoRow
                icon={<ChalkboardTeacher size={18} />}
                label="Teacher"
                value={test.teacherName ?? 'Unknown'}
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Created Date"
                value={formatDate(test.createdAt)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Updated Date"
                value={formatDateTime(test.updatedAt)}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Statistics (Section 3)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Statistics
            </h3>
            <p className="mb-4 text-xs text-gray-500">Usage and performance overview</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                icon={<Question size={22} weight="duotone" />}
                label="Questions"
                value={test.questionCount}
                color="blue"
              />
              <StatCard
                icon={<Users size={22} weight="duotone" />}
                label="Total Attempts"
                value={test.attemptCount}
                color="purple"
              />
              <StatCard
                icon={<Student size={22} weight="duotone" />}
                label="Unique Students"
                value={test.uniqueStudentCount}
                color="emerald"
              />
              <StatCard
                icon={<Sparkle size={22} weight="duotone" />}
                label="Average Score"
                value={test.averageScore !== null ? test.averageScore.toFixed(1) : '—'}
                color={test.averageScore !== null ? 'amber' : 'gray'}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Configuration (Section 4)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Configuration
            </h3>
            <p className="mb-3 text-xs text-gray-500">Test settings, limits, and availability</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Clock size={18} />}
                label="Duration"
                value={formatDuration(test.durationMin)}
              />
              <InfoRow
                icon={<Exam size={18} />}
                label="Total Marks"
                value={`${test.totalMarks}${test.passingMarks !== null ? ` (Passing: ${test.passingMarks})` : ''}`}
              />
              <InfoRow
                icon={<Prohibit size={18} />}
                label="Negative Marking"
                value={test.negativeMarking > 0 ? `${test.negativeMarking} per wrong answer` : 'No negative marking'}
              />
              <InfoRow
                icon={<Shuffle size={18} />}
                label="Shuffle Questions"
                value={formatYesNo(test.shuffleQuestions)}
              />
              <InfoRow
                icon={<Shuffle size={18} />}
                label="Shuffle Options"
                value={formatYesNo(test.shuffleOptions)}
              />
              <InfoRow
                icon={<Lock size={18} />}
                label="Maximum Attempts"
                value={test.attemptLimit !== null ? `${test.attemptLimit} attempt${test.attemptLimit > 1 ? 's' : ''}` : 'Unlimited'}
              />
              <InfoRow
                icon={<Gear size={18} />}
                label="Calculator Allowed"
                value={formatYesNo(test.calculatorAllowed)}
              />
              <InfoRow
                icon={<PlayCircle size={18} />}
                label="Availability"
                value={
                  test.availableFrom
                    ? `From ${formatDateTime(test.availableFrom)}${test.availableUntil ? ` until ${formatDateTime(test.availableUntil)}` : ''}`
                    : 'Not configured'
                }
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Questions (Section 5)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <div className="p-5 pb-0">
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Questions
              </h3>
              <p className="mb-4 text-xs text-gray-500">Questions assigned to this mock test</p>
              <div className="flex items-center gap-4 mb-4">
                <StatCard
                  icon={<Question size={22} weight="duotone" />}
                  label="Total Questions"
                  value={test.questionCount}
                  color="blue"
                />
                {difficultyInfo && (
                  <>
                    <StatCard
                      icon={<FileText size={22} weight="duotone" />}
                      label="Easy"
                      value={difficultyInfo.easy}
                      color="emerald"
                    />
                    <StatCard
                      icon={<FileText size={22} weight="duotone" />}
                      label="Medium"
                      value={difficultyInfo.medium}
                      color="amber"
                    />
                    <StatCard
                      icon={<FileText size={22} weight="duotone" />}
                      label="Hard"
                      value={difficultyInfo.hard}
                      color="rose"
                    />
                  </>
                )}
              </div>
            </div>

            {/* Question list or states */}
            {questionsLoading ? (
              <div className="px-5 pb-5 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-800/20">
                    <Skeleton className="h-5 w-5 shrink-0" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-5 w-16 shrink-0" />
                  </div>
                ))}
              </div>
            ) : questions && questions.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {questions.map((q) => (
                  <div
                    key={q.questionId}
                    className="flex items-start gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-800/20"
                  >
                    {/* Order number */}
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {q.orderSequence}
                    </div>

                    {/* Question info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {q.questionText}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                        {q.subjectName && (
                          <span>{q.subjectName}</span>
                        )}
                        {q.chapterName && (
                          <span className="text-gray-400">{q.chapterName}</span>
                        )}
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Difficulty badge */}
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          q.difficulty === 'easy'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
                            : q.difficulty === 'medium'
                              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400'
                              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400'
                        }`}
                      >
                        {q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)}
                      </span>

                      {/* Type badge */}
                      <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                        {q.questionType.toUpperCase()}
                      </span>

                      {/* Marks */}
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-8 text-right">
                        {q.marks}m
                      </span>

                      {/* Status badge */}
                      <StatusBadge status={q.status} showDot={true} />

                      {/* View Question link */}
                      <Link
                        href={`/admin/questions/${q.questionId}`}
                        className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        View
                        <ArrowSquareOut size={12} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 pb-5">
                <EmptyState
                  icon={<Question size={32} weight="thin" />}
                  title="No questions added yet"
                  description="No questions have been added to this mock test."
                />
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════
              Recent Activity (Section 7)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Recent Activity
            </h3>
            <p className="mb-4 text-xs text-gray-500">Latest student activity on this test</p>
            {test.attemptCount > 0 ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-900/10">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Users size={18} weight="duotone" className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {test.attemptCount} attempt{test.attemptCount > 1 ? 's' : ''} recorded
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {test.uniqueStudentCount} unique student{test.uniqueStudentCount > 1 ? 's' : ''} ·{' '}
                      {test.averageScore !== null ? `Average score: ${test.averageScore.toFixed(1)}` : 'Scores not yet computed'}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Clock size={32} weight="thin" />}
                title="No student attempts yet"
                description="Activity will appear once students attempt this mock test."
              />
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN (1/3) ────────────────────────────────────── */}
        <div className="space-y-6">

          {/* ════════════════════════════════════════════════════════════
              Publication Information (Section 6)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Publication Information
            </h3>
            <p className="mb-3 text-xs text-gray-500">Status and timeline</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<CheckCircle size={18} />}
                label="Current Status"
                value={<StatusBadge status={test.status} showDot={true} />}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Published At"
                value={test.publishedAt ? formatDateTime(test.publishedAt) : 'Not published yet'}
              />
              <InfoRow
                icon={<UserCircle size={18} />}
                label="Created By"
                value={test.teacherName ?? 'Unknown'}
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Created At"
                value={formatDate(test.createdAt)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Last Updated"
                value={formatDateTime(test.updatedAt)}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Result Release
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Result Settings
            </h3>
            <p className="mb-3 text-xs text-gray-500">Release and availability configuration</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Sparkle size={18} />}
                label="Result Release Mode"
                value={test.resultReleaseMode.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Release Date"
                value={'Not scheduled'}
              />
              <InfoRow
                icon={<PlayCircle size={18} />}
                label="Available From"
                value={test.availableFrom ? formatDateTime(test.availableFrom) : 'Immediately'}
              />
              <InfoRow
                icon={<Archive size={18} />}
                label="Available Until"
                value={test.availableUntil ? formatDateTime(test.availableUntil) : 'No expiry'}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Scoring Summary
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Scoring
            </h3>
            <p className="mb-3 text-xs text-gray-500">Marks and passing criteria</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Exam size={18} />}
                label="Total Marks"
                value={`${test.totalMarks}`}
              />
              <InfoRow
                icon={<CheckCircle size={18} />}
                label="Passing Marks"
                value={test.passingMarks !== null ? `${test.passingMarks}` : 'Not configured'}
              />
              <InfoRow
                icon={<Prohibit size={18} />}
                label="Negative Marking"
                value={test.negativeMarking > 0 ? `${test.negativeMarking} per wrong answer` : 'None'}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Result Release
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Result Release
            </h3>
            <p className="mb-3 text-xs text-gray-500">Manage student access to results</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Eye size={18} />}
                label="Total Results"
                value={releaseStatusLoading ? '…' : String(releaseStatus?.totalResults ?? 0)}
              />
              <InfoRow
                icon={<CheckCircle size={18} />}
                label="Released"
                value={releaseStatusLoading ? '…' : String(releaseStatus?.releasedResults ?? 0)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Unreleased"
                value={releaseStatusLoading ? '…' : String(releaseStatus?.unreleasedResults ?? 0)}
              />
              <InfoRow
                icon={<Sparkle size={18} />}
                label="Release Status"
                value={
                  releaseStatusLoading ? (
                    <span className="text-gray-400">Loading…</span>
                  ) : releaseStatus && releaseStatus.totalResults === 0 ? (
                    <span className="text-gray-400">No results yet</span>
                  ) : releaseStatus?.allReleased ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      All Released
                    </span>
                  ) : releaseStatus?.releasedResults && releaseStatus.releasedResults > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Partial Release
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                      Not Released
                    </span>
                  )
                }
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Generated Period"
                value={
                  releaseStatusLoading ? '…' : (
                    releaseStatus?.earliestGenerated && releaseStatus?.latestGenerated
                      ? `${formatDate(releaseStatus.earliestGenerated)} — ${formatDate(releaseStatus.latestGenerated)}`
                      : '—'
                  )
                }
              />
            </div>

            <div className="mt-4 space-y-2">
              {/* Release Results — enabled when there are unreleased results */}
              {(!releaseStatusLoading && releaseStatus && releaseStatus.unreleasedResults > 0) && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'releaseResults' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
                >
                  {actionLoading && confirmAction?.type === 'releaseResults' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Eye size={16} weight="fill" />
                  )}
                  {actionLoading && confirmAction?.type === 'releaseResults' ? 'Releasing...' : 'Release Results'}
                </button>
              )}

              {/* Unrelease Results — enabled when there are released results */}
              {(!releaseStatusLoading && releaseStatus && releaseStatus.releasedResults > 0) && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'unreleaseResults' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {actionLoading && confirmAction?.type === 'unreleaseResults' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <EyeSlash size={16} />
                  )}
                  {actionLoading && confirmAction?.type === 'unreleaseResults' ? 'Hiding...' : 'Unrelease Results'}
                </button>
              )}

              {/* Empty state when no results exist */}
              {(!releaseStatusLoading && releaseStatus && releaseStatus.totalResults === 0) && (
                <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center dark:border-gray-700">
                  <p className="text-xs text-gray-400">No student results to manage</p>
                </div>
              )}

              {/* Loading skeleton */}
              {releaseStatusLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              )}
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Lifecycle Actions
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Lifecycle Actions
            </h3>
            <p className="mb-4 text-xs text-gray-500">Manage this mock test</p>
            <div className="space-y-2">
              {/* Pending Approval → Publish */}
              {test.status === 'pending_approval' && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'publish' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
                >
                  {actionLoading && confirmAction?.type === 'publish' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Sparkle size={16} weight="fill" />
                  )}
                  {actionLoading && confirmAction?.type === 'publish' ? 'Publishing...' : 'Publish'}
                </button>
              )}

              {/* Published → Archive */}
              {test.status === 'published' && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'archive' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-40"
                >
                  {actionLoading && confirmAction?.type === 'archive' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Archive size={16} weight="fill" />
                  )}
                  {actionLoading && confirmAction?.type === 'archive' ? 'Archiving...' : 'Archive'}
                </button>
              )}

              {/* Archived → Restore */}
              {test.status === 'archived' && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'restore' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
                >
                  {actionLoading && confirmAction?.type === 'restore' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Sparkle size={16} weight="fill" />
                  )}
                  {actionLoading && confirmAction?.type === 'restore' ? 'Restoring...' : 'Restore'}
                </button>
              )}

              {/* Duplicate — available for published and archived */}
              {(test.status === 'published' || test.status === 'archived') && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'duplicate' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {actionLoading && confirmAction?.type === 'duplicate' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <CopySimple size={16} />
                  )}
                  {actionLoading && confirmAction?.type === 'duplicate' ? 'Duplicating...' : 'Duplicate'}
                </button>
              )}

              {/* Delete — available for draft and pending_approval */}
              {(test.status === 'draft' || test.status === 'pending_approval') && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'delete' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-40"
                >
                  {actionLoading && confirmAction?.type === 'delete' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Trash size={16} weight="fill" />
                  )}
                  {actionLoading && confirmAction?.type === 'delete' ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Confirmation Dialog
         ════════════════════════════════════════════════════════════════ */}
      {confirmDialogConfig && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleConfirm}
          title={confirmDialogConfig.title}
          message={confirmDialogConfig.message}
          confirmLabel={confirmDialogConfig.confirmLabel}
          variant={confirmDialogConfig.variant}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
