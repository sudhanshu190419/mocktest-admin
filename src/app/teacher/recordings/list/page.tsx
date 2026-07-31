'use client';

/**
 * Teacher Recordings List Page
 *
 * Displays a paginated, filterable table of the teacher's recordings.
 * Reuses the existing RecordingCard for thumbnail previews and the
 * DataTable component for the list layout — consistent with other
 * teacher list pages (mock-tests, content, etc.).
 *
 * @module app/teacher/recordings/list/page
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/config/supabase';
import {
  useRecordings,
  useRecordingAssignments,
  useDeleteRecording,
  useRetryRecording,
} from '@/hooks/recording/useRecordings';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';

import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { RecordingStatusBadge } from '@/components/recording/RecordingStatusBadge';
import { RecordingDuration } from '@/components/recording/RecordingDuration';
import { RecordingError } from '@/components/recording/RecordingError';
import type { Recording, RecordingStatus } from '@/types/recording';
import {
  VideoCamera,
  Play,
  Trash,
  ArrowCounterClockwise,
  Share,
} from '@phosphor-icons/react';

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'recording', label: 'Recording' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'partial', label: 'Partial' },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ─── Page Component ─────────────────────────────────────────────────────────

export default function RecordingsListPage() {
  const router = useRouter();

  // ── UI State ─────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [batchSubjectFilter, setBatchSubjectFilter] = useState('');
  const [teacherSubjects, setTeacherSubjects] = useState<
    { batchSubjectId: string; label: string }[]
  >([]);
  const [sortOrder, setSortOrder] = useState('newest');
  const [deleteConfirm, setDeleteConfirm] = useState<{
    recordingId: string;
    title: string;
  } | null>(null);

  // ── Feedback Toast ───────────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showFeedback = useCallback(
    (type: 'success' | 'error', message: string) => {
      setFeedback({ type, message });
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setFeedback(null), 4000);
    },
    [],
  );

  // ── Fetch teacher's assigned batch subjects for filter dropdown ─────────
  useEffect(() => {
    async function fetchSubjects() {
      const { data: myTeacherId } = await supabase.rpc('get_my_teacher_id');
      if (!myTeacherId) return;

      const { data: assignments } = await supabase
        .from('batch_subject_teachers')
        .select(`
          batch_subject_id,
          batch_subjects!inner (
            batches!inner (name),
            subjects!inner (name)
          )
        `)
        .eq('teacher_id', myTeacherId);

      if (!assignments) return;

      setTeacherSubjects(
        (assignments as any[]).map((row: any) => ({
          batchSubjectId: row.batch_subject_id,
          label: `${row.batch_subjects?.subjects?.name} \u2022 ${row.batch_subjects?.batches?.name}`,
        })),
      );
    }
    fetchSubjects();
  }, []);

  // ── Build Query Filters ──────────────────────────────────────────────────
  const filters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (search) f.search = search;
    if (statusFilter) f.status = statusFilter;
    if (batchSubjectFilter) f.batchSubjectId = batchSubjectFilter;
    return f;
  }, [search, statusFilter, batchSubjectFilter]);

  const sortOptions = useMemo(
    () => ({
      sortBy: 'createdAt' as const,
      sortDirection: (sortOrder === 'newest' ? 'desc' : 'asc') as 'asc' | 'desc',
    }),
    [sortOrder],
  );

  // ── Query ─────────────────────────────────────────────────────────────────
  const {
    data: recordingsData,
    isLoading,
    isError,
    error,
    refetch,
  } = useRecordings(
    Object.keys(filters).length ? (filters as any) : undefined,
    sortOptions,
    { page, pageSize: PAGE_SIZE },
  );

  const recordings = (recordingsData?.data?.recordings ?? []) as Recording[];
  const totalCount = recordingsData?.data?.total ?? 0;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const {
    mutate: deleteRecording,
    isPending: isDeleting,
  } = useDeleteRecording();

  const {
    mutate: retryRecording,
    isPending: isRetrying,
  } = useRetryRecording();

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (!deleteConfirm) return;
    deleteRecording(deleteConfirm.recordingId, {
      onSuccess: () => {
        showFeedback('success', `"${deleteConfirm.title}" has been deleted.`);
        setDeleteConfirm(null);
      },
      onError: () => {
        showFeedback('error', 'Failed to delete recording. Please try again.');
        setDeleteConfirm(null);
      },
    });
  }, [deleteConfirm, deleteRecording, showFeedback]);

  const handleRetry = useCallback(
    (recordingId: string) => {
      retryRecording(recordingId, {
        onSuccess: () => {
          showFeedback('success', 'Recording retry initiated. Processing will resume shortly.');
        },
        onError: () => {
          showFeedback('error', 'Failed to retry recording. Please try again.');
        },
      });
    },
    [retryRecording, showFeedback],
  );

  const handlePlay = useCallback(
    (recordingId: string) => {
      router.push(`/teacher/recordings/${recordingId}`);
    },
    [router],
  );

  const handleShare = useCallback(
    async (recordingId: string, title: string) => {
      // Copy the detail page URL as a share link
      const url = `${window.location.origin}/teacher/recordings/${recordingId}`;
      try {
        await navigator.clipboard.writeText(url);
        showFeedback('success', `Share link for "${title}" copied to clipboard.`);
      } catch {
        showFeedback('error', 'Failed to copy link. Please copy the URL manually.');
      }
    },
    [showFeedback],
  );

  // ── Table Columns ─────────────────────────────────────────────────────────
  const columns: Column<Recording>[] = useMemo(
    () => [
      {
        key: 'title',
        header: 'Recording',
        className: 'max-w-[240px]',
        render: (r) => (
          <div className="flex items-center gap-3 max-w-[240px]">
            <div className="relative flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800">
              {r.thumbnailUrl ? (
                <img
                  src={r.thumbnailUrl}
                  alt={r.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <VideoCamera
                  size={16}
                  weight="light"
                  className="text-gray-300 dark:text-gray-600"
                />
              )}
              {r.durationSeconds != null && r.durationSeconds > 0 && (
                <div className="absolute bottom-0.5 right-0.5">
                  <RecordingDuration seconds={r.durationSeconds} />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {r.title}
              </p>
              {r.classId && (
                <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                  Class recording
                </p>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => <RecordingStatusBadge status={r.status} />,
      },
      {
        key: 'durationSeconds',
        header: 'Duration',
        render: (r) =>
          r.durationSeconds != null && r.durationSeconds > 0 ? (
            <RecordingDuration seconds={r.durationSeconds} format="compact" />
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
          ),
      },
      {
        key: 'createdAt',
        header: 'Date',
        sortable: true,
        render: (r) => (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {formatDate(r.createdAt)}
          </span>
        ),
      },
      {
        key: 'sourceType',
        header: 'Source',
        render: (r) => (
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase ${
              r.sourceType === 'uploaded'
                ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
            }`}
          >
            {r.sourceType === 'uploaded' ? 'Uploaded' : 'Live Class'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        render: (r) => (
          <div className="flex items-center gap-1">
            {r.status === 'completed' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlay(r.recordingId);
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                <Play size={12} weight="fill" />
                Play
              </button>
            )}
            {r.status === 'completed' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleShare(r.recordingId, r.title);
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <Share size={12} />
                Share
              </button>
            )}
            {r.status === 'failed' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRetry(r.recordingId);
                }}
                disabled={isRetrying}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-40 dark:text-orange-400 dark:hover:bg-orange-900/20"
              >
                <ArrowCounterClockwise size={12} />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteConfirm({
                  recordingId: r.recordingId,
                  title: r.title,
                });
              }}
              disabled={isDeleting}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Trash size={12} />
              Delete
            </button>
          </div>
        ),
      },
    ],
    [handlePlay, handleShare, handleRetry, isDeleting, isRetrying],
  );

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Recorded Classes"
        description={
          totalCount > 0
            ? `${totalCount} recording${totalCount !== 1 ? 's' : ''}`
            : 'Manage your recorded live classes'
        }
        breadcrumbs={[
          { label: 'Recorded Classes', href: '/teacher/recordings' },
          { label: 'All Recordings' },
        ]}
      />

      {/* ── Feedback Toast ───────────────────────────────────────────── */}
      {feedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* ── Error State ──────────────────────────────────────────────── */}
      {isError && !isLoading && (
        <div className="mb-4">
          <RecordingError
            message={
              (error as Error)?.message ??
              'Failed to load recordings. Please try again.'
            }
            onRetry={() => refetch()}
            variant="banner"
          />
        </div>
      )}

      {/* ── Search & Filters ─────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search recordings by title..."
          className="min-w-[240px] flex-1"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="min-w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          {STATUS_FILTER_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={batchSubjectFilter}
          onChange={(e) => {
            setBatchSubjectFilter(e.target.value);
            setPage(1);
          }}
          className="min-w-[200px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Subjects</option>
          {teacherSubjects.map((s) => (
            <option key={s.batchSubjectId} value={s.batchSubjectId}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={sortOrder}
          onChange={(e) => {
            setSortOrder(e.target.value);
            setPage(1);
          }}
          className="min-w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Data Table ───────────────────────────────────────────────── */}
      <DataTable<Recording>
        columns={columns}
        data={recordings}
        keyExtractor={(r) => r.recordingId}
        onRowClick={(r) => router.push(`/teacher/recordings/${r.recordingId}`)}
        isLoading={isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            icon={<VideoCamera size={32} weight="light" />}
            title={
              search || statusFilter
                ? 'No matching recordings'
                : 'No recordings yet'
            }
            description={
              search || statusFilter
                ? 'Try adjusting your search terms or filters.'
                : 'Recordings will appear here after you finish a live class with recording enabled.'
            }
          />
        }
      />

      {/* ── Delete Confirmation ──────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Delete Recording"
        message={`Are you sure you want to delete "${deleteConfirm?.title ?? 'this recording'}"? Students will no longer be able to access this recording. This action can be undone by contacting an administrator.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
