'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useCourseDetail,
  usePublishCourse,
  useArchiveCourse,
  useRestoreCourse,
  useDeleteCourse,
} from '@/hooks/admin/useCourseManagement';
import {
  useAssignedTeachers,
  useAvailableTeachers,
  useAssignTeachers,
  useRemoveTeacher,
  useRemoveTeachers,
} from '@/hooks/admin/useCourseTeacherAssignment';
import type { AssignedCourseTeacher, AvailableCourseTeacher } from '@/services/admin/courseTeacherAssignmentService';
import {
  useAssignedBatches,
  useAvailableBatches,
  useAssignBatches,
  useRemoveBatch,
  useRemoveBatches,
} from '@/hooks/admin/useCourseBatchAssignment';
import type { AssignedCourseBatch, AvailableCourseBatch } from '@/services/admin/courseBatchAssignmentService';

import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SearchBar } from '@/components/ui/SearchBar';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import type { CourseManagementDetail } from '@/services/admin/courseManagementService';
import {
  BookOpen,
  CalendarBlank,
  Clock,
  FileText,
  ChalkboardTeacher,
  CheckCircle,
  Archive,
  Star,
  TrendUp,
  Users,
  CurrencyInr,
  Tag,
  XCircle,
  UserCircle,
  Buildings,
  Sparkle,
  Trash,
  Image,
  Question,
  GraduationCap,
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

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDuration(days: number | null): string {
  if (days === null) return 'Not specified';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  if (months < 12) {
    return remainingDays > 0 ? `${months}mo ${remainingDays}d` : `${months} months`;
  }
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths > 0 ? `${years}y ${remainingMonths}mo` : `${years} years`;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
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
    rose: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800',
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

export default function CourseDetailPage() {
  const params = useParams();
  const courseId = params.id as string;

  const { data: course, isLoading, isError, error, refetch } = useCourseDetail(courseId);

  // ── Confirmation & Feedback State (Lifecycle) ────────────────────────
  const [confirmAction, setConfirmAction] = useState<{
    type: 'publish' | 'archive' | 'restore' | 'delete';
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

  // ── Teacher Assignment State ─────────────────────────────────────────
  const [teacherSearch, setTeacherSearch] = useState('');
  const [debouncedTeacherSearch, setDebouncedTeacherSearch] = useState('');
  const teacherSearchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [selectedAssignedIds, setSelectedAssignedIds] = useState<Set<string>>(new Set());
  const [selectedAvailableIds, setSelectedAvailableIds] = useState<Set<string>>(new Set());

  const [teacherConfirmAction, setTeacherConfirmAction] = useState<{
    type: 'assign' | 'remove-single' | 'remove-bulk';
    teacherId?: string;
    teacherName?: string;
    count?: number;
  } | null>(null);

  const [teacherFeedback, setTeacherFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearTeacherFeedback = useCallback(() => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setTeacherFeedback(null), 4000);
  }, []);

  // Teacher search debounce
  useEffect(() => {
    if (teacherSearchRef.current) clearTimeout(teacherSearchRef.current);
    teacherSearchRef.current = setTimeout(() => setDebouncedTeacherSearch(teacherSearch), 400);
    return () => {
      if (teacherSearchRef.current) clearTimeout(teacherSearchRef.current);
    };
  }, [teacherSearch]);

  // Clean up feedback timeout on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  // ── Batch Assignment State ───────────────────────────────────────────
  const [batchSearch, setBatchSearch] = useState('');
  const [debouncedBatchSearch, setDebouncedBatchSearch] = useState('');
  const batchSearchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [selectedAssignedBatchIds, setSelectedAssignedBatchIds] = useState<Set<string>>(new Set());
  const [selectedAvailableBatchIds, setSelectedAvailableBatchIds] = useState<Set<string>>(new Set());

  const [batchConfirmAction, setBatchConfirmAction] = useState<{
    type: 'assign' | 'remove-single' | 'remove-bulk';
    batchId?: string;
    batchName?: string;
    count?: number;
  } | null>(null);

  const [batchFeedback, setBatchFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const batchFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearBatchFeedback = useCallback(() => {
    if (batchFeedbackTimeoutRef.current) clearTimeout(batchFeedbackTimeoutRef.current);
    batchFeedbackTimeoutRef.current = setTimeout(() => setBatchFeedback(null), 4000);
  }, []);

  // Batch search debounce
  useEffect(() => {
    if (batchSearchRef.current) clearTimeout(batchSearchRef.current);
    batchSearchRef.current = setTimeout(() => setDebouncedBatchSearch(batchSearch), 400);
    return () => {
      if (batchSearchRef.current) clearTimeout(batchSearchRef.current);
    };
  }, [batchSearch]);



  // ── Query Hooks (Teacher Assignment) ─────────────────────────────────
  const {
    data: assignedTeachers,
    isLoading: assignedLoading,
  } = useAssignedTeachers(courseId);

  const {
    data: availableTeachers,
    isLoading: availableLoading,
  } = useAvailableTeachers(courseId, debouncedTeacherSearch || undefined);

  // ── Query Hooks (Batch Assignment) ───────────────────────────────────
  const {
    data: assignedBatches,
    isLoading: assignedBatchesLoading,
  } = useAssignedBatches(courseId);

  const {
    data: availableBatches,
    isLoading: availableBatchesLoading,
  } = useAvailableBatches(courseId, debouncedBatchSearch || undefined);



  // ── Mutation Hooks ──────────────────────────────────────────────────
  const publishMutation = usePublishCourse();
  const archiveMutation = useArchiveCourse();
  const restoreMutation = useRestoreCourse();
  const deleteMutation = useDeleteCourse();

  const assignMutation = useAssignTeachers();
  const removeTeacherMutation = useRemoveTeacher();
  const removeTeachersMutation = useRemoveTeachers();

  const assignBatchesMutation = useAssignBatches();
  const removeBatchMutation = useRemoveBatch();
  const removeBatchesMutation = useRemoveBatches();



  // ── Lifecycle Action Executor ────────────────────────────────────────
  const executeAction = useCallback(async (action: 'publish' | 'archive' | 'restore' | 'delete') => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      let result;
      switch (action) {
        case 'publish':
          result = await publishMutation.mutateAsync(courseId);
          break;
        case 'archive':
          result = await archiveMutation.mutateAsync(courseId);
          break;
        case 'restore':
          result = await restoreMutation.mutateAsync(courseId);
          break;
        case 'delete':
          result = await deleteMutation.mutateAsync(courseId);
          break;
      }

      if (!result.success) {
        setActionError(result.error ?? 'Action failed. Please try again.');
        setActionLoading(false);
        return;
      }

      setActionSuccess(`Course ${action === 'publish' ? 'published' : action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : 'deleted'} successfully`);
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [courseId, publishMutation, archiveMutation, restoreMutation, deleteMutation, refetch, clearFeedback]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type);
  }, [confirmAction, executeAction]);

  // ── Teacher Confirm Dialog Handlers ──────────────────────────────────
  const handleConfirmAssign = async () => {
    if (!selectedAvailableIds.size) return;

    const result = await assignMutation.mutateAsync({
      courseId,
      teacherIds: Array.from(selectedAvailableIds),
    });

    if (result.success) {
      const count = result.data?.assigned ?? selectedAvailableIds.size;
      setTeacherFeedback({
        type: 'success',
        message: `${count} teacher(s) assigned to this course successfully.`,
      });
      setSelectedAvailableIds(new Set());
    } else {
      setTeacherFeedback({
        type: 'error',
        message: result.error ?? 'Failed to assign teachers.',
      });
    }
    setTeacherConfirmAction(null);
    clearTeacherFeedback();
  };

  const handleConfirmRemoveSingle = async () => {
    if (!teacherConfirmAction?.teacherId) return;

    const result = await removeTeacherMutation.mutateAsync({
      courseId,
      teacherId: teacherConfirmAction.teacherId,
    });

    if (result.success) {
      setTeacherFeedback({
        type: 'success',
        message: `"${teacherConfirmAction.teacherName ?? 'Teacher'}" removed from this course.`,
      });
    } else {
      setTeacherFeedback({
        type: 'error',
        message: result.error ?? 'Failed to remove teacher.',
      });
    }
    setTeacherConfirmAction(null);
    clearTeacherFeedback();
  };

  const handleConfirmRemoveBulk = async () => {
    if (!selectedAssignedIds.size) return;

    const result = await removeTeachersMutation.mutateAsync({
      courseId,
      teacherIds: Array.from(selectedAssignedIds),
    });

    if (result.success) {
      setTeacherFeedback({
        type: 'success',
        message: `${selectedAssignedIds.size} teacher(s) removed from this course.`,
      });
      setSelectedAssignedIds(new Set());
    } else {
      setTeacherFeedback({
        type: 'error',
        message: result.error ?? 'Failed to remove teachers.',
      });
    }
    setTeacherConfirmAction(null);
    clearTeacherFeedback();
  };

  const handleTeacherConfirm = async () => {
    if (!teacherConfirmAction) return;
    switch (teacherConfirmAction.type) {
      case 'assign':
        await handleConfirmAssign();
        break;
      case 'remove-single':
        await handleConfirmRemoveSingle();
        break;
      case 'remove-bulk':
        await handleConfirmRemoveBulk();
        break;
    }
  };

  const getTeacherConfirmProps = () => {
    if (!teacherConfirmAction) {
      return { open: false, title: '', message: '', variant: 'default' as const };
    }

    switch (teacherConfirmAction.type) {
      case 'assign':
        return {
          open: true,
          title: 'Assign Teachers',
          message: `Assign ${teacherConfirmAction.count ?? selectedAvailableIds.size} selected teacher(s) to this course?`,
          confirmLabel: 'Assign',
          variant: 'default' as const,
        };
      case 'remove-single':
        return {
          open: true,
          title: 'Remove Teacher',
          message: `Remove "${teacherConfirmAction.teacherName ?? 'this teacher'}" from this course? They can be re-assigned later.`,
          confirmLabel: 'Remove',
          variant: 'danger' as const,
        };
      case 'remove-bulk':
        return {
          open: true,
          title: 'Remove Teachers',
          message: `Remove ${teacherConfirmAction.count ?? selectedAssignedIds.size} selected teacher(s) from this course? They can be re-assigned later.`,
          confirmLabel: 'Remove All',
          variant: 'danger' as const,
        };
      default:
        return {
          open: true,
          title: 'Confirm Action',
          message: 'Are you sure you want to proceed?',
          confirmLabel: 'Confirm',
          variant: 'default' as const,
        };
    }
  };

  const teacherConfirmProps = getTeacherConfirmProps();
  const isTeacherConfirmLoading =
    (teacherConfirmAction?.type === 'assign' && assignMutation.isPending) ||
    (teacherConfirmAction?.type === 'remove-single' && removeTeacherMutation.isPending) ||
    (teacherConfirmAction?.type === 'remove-bulk' && removeTeachersMutation.isPending);

  // ── Batch Confirm Dialog Handlers ────────────────────────────────────
  const handleBatchConfirmAssign = async () => {
    if (!selectedAvailableBatchIds.size) return;

    const result = await assignBatchesMutation.mutateAsync({
      courseId,
      batchIds: Array.from(selectedAvailableBatchIds),
    });

    if (result.success) {
      const count = result.data?.assigned ?? selectedAvailableBatchIds.size;
      setBatchFeedback({
        type: 'success',
        message: `${count} batch(es) assigned to this course successfully.`,
      });
      setSelectedAvailableBatchIds(new Set());
    } else {
      setBatchFeedback({
        type: 'error',
        message: result.error ?? 'Failed to assign batches.',
      });
    }
    setBatchConfirmAction(null);
    clearBatchFeedback();
  };

  const handleBatchConfirmRemoveSingle = async () => {
    if (!batchConfirmAction?.batchId) return;

    const result = await removeBatchMutation.mutateAsync({
      courseId,
      batchId: batchConfirmAction.batchId,
    });

    if (result.success) {
      setBatchFeedback({
        type: 'success',
        message: `"${batchConfirmAction.batchName ?? 'Batch'}" removed from this course.`,
      });
    } else {
      setBatchFeedback({
        type: 'error',
        message: result.error ?? 'Failed to remove batch.',
      });
    }
    setBatchConfirmAction(null);
    clearBatchFeedback();
  };

  const handleBatchConfirmRemoveBulk = async () => {
    if (!selectedAssignedBatchIds.size) return;

    const result = await removeBatchesMutation.mutateAsync({
      courseId,
      batchIds: Array.from(selectedAssignedBatchIds),
    });

    if (result.success) {
      setBatchFeedback({
        type: 'success',
        message: `${selectedAssignedBatchIds.size} batch(es) removed from this course.`,
      });
      setSelectedAssignedBatchIds(new Set());
    } else {
      setBatchFeedback({
        type: 'error',
        message: result.error ?? 'Failed to remove batches.',
      });
    }
    setBatchConfirmAction(null);
    clearBatchFeedback();
  };

  const handleBatchConfirm = async () => {
    if (!batchConfirmAction) return;
    switch (batchConfirmAction.type) {
      case 'assign':
        await handleBatchConfirmAssign();
        break;
      case 'remove-single':
        await handleBatchConfirmRemoveSingle();
        break;
      case 'remove-bulk':
        await handleBatchConfirmRemoveBulk();
        break;
    }
  };

  const getBatchConfirmProps = () => {
    if (!batchConfirmAction) {
      return { open: false, title: '', message: '', variant: 'default' as const };
    }

    switch (batchConfirmAction.type) {
      case 'assign':
        return {
          open: true,
          title: 'Assign Batches',
          message: `Assign ${batchConfirmAction.count ?? selectedAvailableBatchIds.size} selected batch(es) to this course?`,
          confirmLabel: 'Assign',
          variant: 'default' as const,
        };
      case 'remove-single':
        return {
          open: true,
          title: 'Remove Batch',
          message: `Remove "${batchConfirmAction.batchName ?? 'this batch'}" from this course? It can be re-assigned later.`,
          confirmLabel: 'Remove',
          variant: 'danger' as const,
        };
      case 'remove-bulk':
        return {
          open: true,
          title: 'Remove Batches',
          message: `Remove ${batchConfirmAction.count ?? selectedAssignedBatchIds.size} selected batch(es) from this course? They can be re-assigned later.`,
          confirmLabel: 'Remove All',
          variant: 'danger' as const,
        };
      default:
        return {
          open: true,
          title: 'Confirm Action',
          message: 'Are you sure you want to proceed?',
          confirmLabel: 'Confirm',
          variant: 'default' as const,
        };
    }
  };

  const batchConfirmProps = getBatchConfirmProps();
  const isBatchConfirmLoading =
    (batchConfirmAction?.type === 'assign' && assignBatchesMutation.isPending) ||
    (batchConfirmAction?.type === 'remove-single' && removeBatchMutation.isPending) ||
    (batchConfirmAction?.type === 'remove-bulk' && removeBatchesMutation.isPending);



  // ── Confirm Dialog Configuration (Lifecycle) ─────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type } = confirmAction;

    switch (type) {
      case 'publish':
        return {
          title: 'Publish Course',
          message: `Are you sure you want to publish this course? It will be made available in the student catalog.`,
          confirmLabel: 'Publish',
          variant: 'default' as const,
        };
      case 'archive':
        return {
          title: 'Archive Course',
          message: `Are you sure you want to archive this course? It will be hidden from the catalog but existing enrollments will be preserved.`,
          confirmLabel: 'Archive',
          variant: 'warning' as const,
        };
      case 'restore':
        return {
          title: 'Restore Course',
          message: `Are you sure you want to restore this archived course? It will be returned to published status.`,
          confirmLabel: 'Restore',
          variant: 'default' as const,
        };
      case 'delete':
        return {
          title: 'Delete Course',
          message: `Are you sure you want to delete this course? Only courses without active enrollments can be deleted. This action cannot be undone.`,
          confirmLabel: 'Delete',
          variant: 'danger' as const,
        };
      default:
        return null;
    }
  }, [confirmAction]);

  // ── Assigned Teachers Columns ────────────────────────────────────────
  const assignedTeacherColumns: Column<AssignedCourseTeacher>[] = useMemo(() => [
    {
      key: 'teacherName',
      header: 'Name',
      render: (item) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-[10px] font-bold text-white shadow-sm">
            {getInitials(item.teacherName)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {item.teacherName}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'facultyId',
      header: 'Faculty ID',
      render: (item) => (
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
          {item.facultyId ?? '—'}
        </span>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      render: (item) => (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {item.department ?? '—'}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (item) => (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {item.role ?? '—'}
        </span>
      ),
    },
    {
      key: 'assignedAt',
      header: 'Assigned Date',
      render: (item) => (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {item.assignedAt ? formatDate(item.assignedAt) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (item) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTeacherConfirmAction({
              type: 'remove-single',
              teacherId: item.teacherId,
              teacherName: item.teacherName,
            });
          }}
          disabled={removeTeacherMutation.isPending || removeTeachersMutation.isPending}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          {removeTeacherMutation.isPending &&
          teacherConfirmAction?.type === 'remove-single' &&
          teacherConfirmAction?.teacherId === item.teacherId ? (
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <Trash size={12} />
          )}
          Remove
        </button>
      ),
    },
  ], [removeTeacherMutation.isPending, removeTeachersMutation.isPending, teacherConfirmAction]);

  // ── Available Teachers Columns ───────────────────────────────────────
  const availableTeacherColumns: Column<AvailableCourseTeacher>[] = useMemo(() => [
    {
      key: 'teacherName',
      header: 'Name',
      render: (item) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-[10px] font-bold text-white shadow-sm">
            {getInitials(item.teacherName)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {item.teacherName}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'facultyId',
      header: 'Faculty ID',
      render: (item) => (
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
          {item.facultyId ?? '—'}
        </span>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      render: (item) => (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {item.department ?? '—'}
        </span>
      ),
    },
    {
      key: 'designation',
      header: 'Designation',
      render: (item) => (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {item.designation ?? '—'}
        </span>
      ),
    },
  ], []);

  // ── Assigned Batches Columns ─────────────────────────────────────────
  const assignedBatchColumns: Column<AssignedCourseBatch>[] = useMemo(() => [
    {
      key: 'batchName',
      header: 'Batch Name',
      render: (item) => (
        <div className="max-w-[160px]">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {item.batchName}
          </p>
        </div>
      ),
    },
    {
      key: 'batchCode',
      header: 'Batch Code',
      render: (item) => (
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
          {item.batchCode}
        </span>
      ),
    },
    {
      key: 'academicYear',
      header: 'Academic Year',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.academicYear}
        </span>
      ),
    },
    {
      key: 'streamName',
      header: 'Stream',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.streamName ?? '—'}
        </span>
      ),
    },
    {
      key: 'teacherCount',
      header: 'Teachers',
      render: (item) => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {item.teacherCount}
        </span>
      ),
    },
    {
      key: 'studentCount',
      header: 'Students',
      render: (item) => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {item.studentCount}
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
      key: 'assignedAt',
      header: 'Assigned Date',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.assignedAt ? formatDate(item.assignedAt) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (item) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setBatchConfirmAction({
              type: 'remove-single',
              batchId: item.batchId,
              batchName: item.batchName,
            });
          }}
          disabled={removeBatchMutation.isPending || removeBatchesMutation.isPending}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          {removeBatchMutation.isPending &&
          batchConfirmAction?.type === 'remove-single' &&
          batchConfirmAction?.batchId === item.batchId ? (
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <Trash size={12} />
          )}
          Remove
        </button>
      ),
    },
  ], [removeBatchMutation.isPending, removeBatchesMutation.isPending, batchConfirmAction]);

  // ── Available Batches Columns ────────────────────────────────────────
  const availableBatchColumns: Column<AvailableCourseBatch>[] = useMemo(() => [
    {
      key: 'batchName',
      header: 'Batch Name',
      render: (item) => (
        <div className="max-w-[160px]">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {item.batchName}
          </p>
        </div>
      ),
    },
    {
      key: 'batchCode',
      header: 'Batch Code',
      render: (item) => (
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
          {item.batchCode}
        </span>
      ),
    },
    {
      key: 'academicYear',
      header: 'Academic Year',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.academicYear}
        </span>
      ),
    },
    {
      key: 'streamName',
      header: 'Stream',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.streamName ?? '—'}
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
  ], []);



  // ═════════════════════════════════════════════════════════════════════
  //  Loading State
  // ═════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Course Details"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Courses', href: '/admin/courses' },
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
  if (isError || !course) {
    return (
      <div>
        <PageHeader
          title="Course Details"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Courses', href: '/admin/courses' },
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
                Failed to load course details
              </p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'The course could not be found or an error occurred.'}
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/admin/courses"
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-900 dark:text-red-400"
              >
                ← Back to Course List
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
  //  Render — Course Data Loaded
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header (Section 1)
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title={course.title}
        description={`${course.streamName ?? 'No Stream'} · ${course.language ?? 'Language not set'}`}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Courses', href: '/admin/courses' },
          { label: course.title },
        ]}
        actions={
          <Link
            href="/admin/courses"
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
                {course.title}
              </h2>
              <StatusBadge status={course.status} showDot={true} />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {course.shortDescription ?? course.slug}
            </p>
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-4 sm:flex-shrink-0">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{course.teachersCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Teachers</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{course.batchesCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Batches</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{course.enrollmentCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Enrollments</p>
            </div>
          </div>
        </div>

        {/* Metadata badges */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
            <Tag size={12} />
            {course.streamName ?? '—'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
            <CurrencyInr size={12} />
            {formatPrice(course.originalPrice, course.currency)}
            {course.discountedPrice !== null && (
              <span className="text-purple-500"> → {formatPrice(course.discountedPrice, course.currency)}</span>
            )}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <Clock size={12} />
            {formatDuration(course.duration)}
          </span>
          {course.featured && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              <Star size={12} weight="fill" />
              Featured
            </span>
          )}
          {course.trending && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
              <TrendUp size={12} weight="fill" />
              Trending
            </span>
          )}
        </div>

        {/* Timestamps */}
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1">
            <CalendarBlank size={12} />
            Created {formatDate(course.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            Updated {formatDate(course.updatedAt)}
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
              Course Overview (Section 2 continued)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Course Overview
            </h3>
            <p className="mb-3 text-xs text-gray-500">Basic details, stream, and description</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<FileText size={18} />}
                label="Course Title"
                value={course.title}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="Slug"
                value={<span className="font-mono text-xs">{course.slug}</span>}
              />
              <InfoRow
                icon={<CheckCircle size={18} />}
                label="Status"
                value={<StatusBadge status={course.status} showDot={true} />}
              />
              <InfoRow
                icon={<Buildings size={18} />}
                label="Stream"
                value={course.streamName ?? '—'}
              />
              <InfoRow
                icon={<FileText size={18} />}
                label="Short Description"
                value={course.shortDescription ?? '—'}
              />
              <InfoRow
                icon={<BookOpen size={18} />}
                label="Description"
                value={course.description ?? 'No description provided'}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="Language"
                value={course.language ?? 'Not specified'}
              />
              <InfoRow
                icon={<Question size={18} />}
                label="Difficulty Level"
                value={course.difficultyLevel ? course.difficultyLevel.charAt(0).toUpperCase() + course.difficultyLevel.slice(1) : 'Not specified'}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Duration"
                value={formatDuration(course.duration)}
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Created Date"
                value={formatDate(course.createdAt)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Updated Date"
                value={formatDateTime(course.updatedAt)}
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard
                icon={<ChalkboardTeacher size={22} weight="duotone" />}
                label="Teachers"
                value={course.teachersCount}
                color="purple"
              />
              <StatCard
                icon={<GraduationCap size={22} weight="duotone" />}
                label="Batches"
                value={course.batchesCount}
                color="indigo"
              />
              <StatCard
                icon={<Users size={22} weight="duotone" />}
                label="Enrollments"
                value={course.enrollmentCount}
                color="emerald"
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Teachers Summary (Section 4)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Teachers Summary
            </h3>
            <p className="mb-3 text-xs text-gray-500">Teachers assigned to this course</p>
            {course.teachers.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {course.teachers.map((teacher) => (
                  <div key={teacher.teacherId} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-[10px] font-bold text-white">
                      {getInitials(teacher.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {teacher.name}
                      </p>
                      {teacher.role && (
                        <p className="text-xs text-gray-500">{teacher.role}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ChalkboardTeacher size={28} weight="thin" />}
                title="No teachers assigned"
                description="Teachers can be assigned to this course in the Teacher Assignment phase."
              />
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════
              Batch Summary (Section 5)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Batch Summary
            </h3>
            <p className="mb-3 text-xs text-gray-500">Batches linked to this course</p>
            {course.batches.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {course.batches.map((batch) => (
                  <div key={batch.batchId} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        <GraduationCap size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {batch.name}
                        </p>
                        <p className="font-mono text-xs text-gray-500">
                          {batch.batchCode}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<GraduationCap size={28} weight="thin" />}
                title="No batches linked"
                description="Batches can be linked to this course in the Batch Assignment phase."
              />
            )}
          </div>



          {/* ════════════════════════════════════════════════════════════
              Teacher Assignment (Section — NEW)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Teacher Assignment
              </h3>
            </div>
            <p className="mb-4 text-xs text-gray-500">
              Assign or remove teachers from this course. A course may have multiple teachers.
            </p>

            {/* Teacher feedback banners */}
            {teacherFeedback && (
              <div
                className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${
                  teacherFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                }`}
              >
                {teacherFeedback.type === 'success' ? (
                  <CheckCircle size={16} weight="duotone" />
                ) : (
                  <XCircle size={16} weight="duotone" />
                )}
                {teacherFeedback.message}
              </div>
            )}

            {/* Two-panel layout */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* ─── LEFT: Assigned Teachers ────────────────────────── */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Assigned ({assignedTeachers?.length ?? 0})
                  </h4>
                  {selectedAssignedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setTeacherConfirmAction({
                          type: 'remove-bulk',
                          count: selectedAssignedIds.size,
                        })
                      }
                      disabled={removeTeachersMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      {removeTeachersMutation.isPending ? (
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <Trash size={12} />
                      )}
                      Remove Selected ({selectedAssignedIds.size})
                    </button>
                  )}
                </div>

                <DataTable
                  columns={assignedTeacherColumns}
                  data={assignedTeachers ?? []}
                  keyExtractor={(item) => item.teacherId}
                  isLoading={assignedLoading}
                  selectedIds={selectedAssignedIds}
                  onSelectionChange={setSelectedAssignedIds}
                  emptyState={
                    <EmptyState
                      icon={<ChalkboardTeacher size={28} weight="thin" />}
                      title="No teachers assigned"
                      description="Use the Available Teachers panel to assign teachers to this course."
                    />
                  }
                  className="min-h-[200px]"
                />
              </div>

              {/* ─── RIGHT: Available Teachers ──────────────────────── */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Available ({availableTeachers?.length ?? 0})
                  </h4>
                  {selectedAvailableIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setTeacherConfirmAction({
                          type: 'assign',
                          count: selectedAvailableIds.size,
                        })
                      }
                      disabled={assignMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                    >
                      {assignMutation.isPending ? (
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <PlusCircle size={12} />
                      )}
                      Assign Selected ({selectedAvailableIds.size})
                    </button>
                  )}
                </div>

                {/* Search */}
                <div className="mb-3">
                  <SearchBar
                    value={teacherSearch}
                    onChange={setTeacherSearch}
                    placeholder="Search by name or faculty ID..."
                    className="w-full"
                  />
                </div>

                <DataTable
                  columns={availableTeacherColumns}
                  data={availableTeachers ?? []}
                  keyExtractor={(item) => item.teacherId}
                  isLoading={availableLoading}
                  selectedIds={selectedAvailableIds}
                  onSelectionChange={setSelectedAvailableIds}
                  emptyState={
                    <EmptyState
                      icon={<ChalkboardTeacher size={28} weight="thin" />}
                      title={debouncedTeacherSearch ? 'No matching teachers' : 'No teachers available'}
                      description={
                        debouncedTeacherSearch
                          ? 'Try a different search term.'
                          : 'All eligible teachers are already assigned to this course.'
                      }
                    />
                  }
                  className="min-h-[200px]"
                />
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Batch Assignment (Section — NEW)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Batch Assignment
              </h3>
            </div>
            <p className="mb-4 text-xs text-gray-500">
              Assign or remove batches from this course. A course may contain multiple batches.
            </p>

            {/* Batch feedback banners */}
            {batchFeedback && (
              <div
                className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${
                  batchFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                }`}
              >
                {batchFeedback.type === 'success' ? (
                  <CheckCircle size={16} weight="duotone" />
                ) : (
                  <XCircle size={16} weight="duotone" />
                )}
                {batchFeedback.message}
              </div>
            )}

            {/* Two-panel layout */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* ─── LEFT: Assigned Batches ──────────────────────────── */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Assigned ({assignedBatches?.length ?? 0})
                  </h4>
                  {selectedAssignedBatchIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setBatchConfirmAction({
                          type: 'remove-bulk',
                          count: selectedAssignedBatchIds.size,
                        })
                      }
                      disabled={removeBatchesMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      {removeBatchesMutation.isPending ? (
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <Trash size={12} />
                      )}
                      Remove Selected ({selectedAssignedBatchIds.size})
                    </button>
                  )}
                </div>

                <DataTable
                  columns={assignedBatchColumns}
                  data={assignedBatches ?? []}
                  keyExtractor={(item) => item.batchId}
                  isLoading={assignedBatchesLoading}
                  selectedIds={selectedAssignedBatchIds}
                  onSelectionChange={setSelectedAssignedBatchIds}
                  emptyState={
                    <EmptyState
                      icon={<GraduationCap size={28} weight="thin" />}
                      title="No batches assigned"
                      description="Use the Available Batches panel to assign batches to this course."
                    />
                  }
                  className="min-h-[200px]"
                />
              </div>

              {/* ─── RIGHT: Available Batches ────────────────────────── */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Available ({availableBatches?.length ?? 0})
                  </h4>
                  {selectedAvailableBatchIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setBatchConfirmAction({
                          type: 'assign',
                          count: selectedAvailableBatchIds.size,
                        })
                      }
                      disabled={assignBatchesMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                    >
                      {assignBatchesMutation.isPending ? (
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <PlusCircle size={12} />
                      )}
                      Assign Selected ({selectedAvailableBatchIds.size})
                    </button>
                  )}
                </div>

                {/* Search */}
                <div className="mb-3">
                  <SearchBar
                    value={batchSearch}
                    onChange={setBatchSearch}
                    placeholder="Search by name, code, or academic year..."
                    className="w-full"
                  />
                </div>

                <DataTable
                  columns={availableBatchColumns}
                  data={availableBatches ?? []}
                  keyExtractor={(item) => item.batchId}
                  isLoading={availableBatchesLoading}
                  selectedIds={selectedAvailableBatchIds}
                  onSelectionChange={setSelectedAvailableBatchIds}
                  emptyState={
                    <EmptyState
                      icon={<GraduationCap size={28} weight="thin" />}
                      title={debouncedBatchSearch ? 'No matching batches' : 'No batches available'}
                      description={
                        debouncedBatchSearch
                          ? 'Try a different search term.'
                          : 'All eligible batches are already assigned to this course.'
                      }
                    />
                  }
                  className="min-h-[200px]"
                />
              </div>
            </div>
          </div>

            {/* ════════════════════════════════════════════════════════════
                Recent Activity
                ════════════════════════════════════════════════════════════ */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Recent Activity
              </h3>
              <p className="mb-4 text-xs text-gray-500">Latest activity for this course</p>
              <EmptyState
                icon={<Clock size={32} weight="thin" />}
                title="No recent activity"
                description="Activity will appear once enrollments, teacher assignments, and content updates take place."
              />
            </div>
        </div>

        {/* ─── RIGHT COLUMN (1/3) ────────────────────────────────────── */}
        <div className="space-y-6">

          {/* ════════════════════════════════════════════════════════════
              Pricing (Section 6)
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Pricing
            </h3>
            <p className="mb-3 text-xs text-gray-500">Course pricing and currency</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<CurrencyInr size={18} />}
                label="Original Price"
                value={formatPrice(course.originalPrice, course.currency)}
              />
              <InfoRow
                icon={<CurrencyInr size={18} />}
                label="Discounted Price"
                value={course.discountedPrice !== null ? formatPrice(course.discountedPrice, course.currency) : 'No discount'}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="Currency"
                value={course.currency}
              />
              {course.discountedPrice !== null && course.originalPrice > 0 && (
                <InfoRow
                  icon={<Sparkle size={18} />}
                  label="Discount"
                  value={`${Math.round((1 - course.discountedPrice / course.originalPrice) * 100)}% off`}
                />
              )}
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Publication Information (Section 7)
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
                value={<StatusBadge status={course.status} showDot={true} />}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Published At"
                value={course.publishedAt ? formatDateTime(course.publishedAt) : 'Not published yet'}
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Created At"
                value={formatDate(course.createdAt)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Last Updated"
                value={formatDateTime(course.updatedAt)}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Metadata
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Metadata
            </h3>
            <p className="mb-3 text-xs text-gray-500">Featured, trending, and sorting</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Star size={18} />}
                label="Featured"
                value={course.featured ? 'Yes' : 'No'}
              />
              <InfoRow
                icon={<TrendUp size={18} />}
                label="Trending"
                value={course.trending ? 'Yes' : 'No'}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="Sort Order"
                value={String(course.sortOrder)}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Media
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Media
            </h3>
            <p className="mb-3 text-xs text-gray-500">Course images and banners</p>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Image size={18} />}
                label="Thumbnail"
                value={course.thumbnailPath ? 'Uploaded' : 'Not uploaded'}
              />
              <InfoRow
                icon={<Image size={18} />}
                label="Banner"
                value={course.bannerPath ? 'Uploaded' : 'Not uploaded'}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              Lifecycle Actions
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Lifecycle Actions
            </h3>
            <p className="mb-4 text-xs text-gray-500">Manage this course</p>
            <div className="space-y-2">
              {/* Draft / Pending Approval / Approved → Publish */}
              {(course.status === 'draft' || course.status === 'pending_approval' || course.status === 'approved') && (
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
              {course.status === 'published' && (
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
              {course.status === 'archived' && (
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

              {/* Archived → Delete */}
              {course.status === 'archived' && (
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
          Confirm Dialog (Lifecycle)
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

      {/* ════════════════════════════════════════════════════════════════
          Confirm Dialog (Teacher Assignment)
         ════════════════════════════════════════════════════════════════ */}
      <ConfirmDialog
        open={teacherConfirmProps.open}
        onClose={() => {
          if (!isTeacherConfirmLoading) setTeacherConfirmAction(null);
        }}
        onConfirm={handleTeacherConfirm}
        title={teacherConfirmProps.title}
        message={teacherConfirmProps.message}
        confirmLabel={teacherConfirmProps.confirmLabel}
        variant={teacherConfirmProps.variant}
        loading={isTeacherConfirmLoading}
      />

      {/* ════════════════════════════════════════════════════════════════
          Confirm Dialog (Batch Assignment)
         ════════════════════════════════════════════════════════════════ */}
      <ConfirmDialog
        open={batchConfirmProps.open}
        onClose={() => {
          if (!isBatchConfirmLoading) setBatchConfirmAction(null);
        }}
        onConfirm={handleBatchConfirm}
        title={batchConfirmProps.title}
        message={batchConfirmProps.message}
        confirmLabel={batchConfirmProps.confirmLabel}
        variant={batchConfirmProps.variant}
        loading={isBatchConfirmLoading}
      />


    </div>
  );
}
