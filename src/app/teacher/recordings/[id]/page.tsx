'use client';

/**
 * Teacher Recording Detail Page
 *
 * Displays full details of a single recording with playback, status
 * information, and all available actions (play, share, delete, retry).
 * Uses existing RecordingCard, RecordingStatusBadge, ProcessingIndicator,
 * and other recording components.
 *
 * @module app/teacher/recordings/[id]/page
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useRecording,
  useRecordingStatus,
  usePlaybackUrl,
  useDeleteRecording,
  useRetryRecording,
} from '@/hooks/recording/useRecordings';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RecordingStatusBadge } from '@/components/recording/RecordingStatusBadge';
import { RecordingDuration } from '@/components/recording/RecordingDuration';
import { ProcessingIndicator } from '@/components/recording/ProcessingIndicator';
import { RecordingError } from '@/components/recording/RecordingError';
import type { Recording, RecordingStatus } from '@/types/recording';
import {
  Play,
  Share,
  Trash,
  ArrowCounterClockwise,
  VideoCamera,
  Clock,
  CalendarBlank,

  FileText,
  WarningCircle,
  Eye,
  Copy,
  Check,
} from '@phosphor-icons/react';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Info Card Component ────────────────────────────────────────────────────

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
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <div className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">
          {value}
        </div>
      </div>
    </div>
  );
}

// ─── Action Button Component ────────────────────────────────────────────────

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger' | 'primary';
}) {
  const baseStyles =
    'inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40';

  const variantStyles = {
    primary:
      'bg-blue-600 text-white hover:bg-blue-700 shadow-sm dark:bg-blue-500 dark:hover:bg-blue-600',
    danger:
      'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/30',
    default:
      'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variantStyles[variant]}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Stat Card Component ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'blue' | 'emerald' | 'amber' | 'gray';
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    emerald:
      'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
    amber:
      'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
    gray: 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color]}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {value}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Page Component
// ═══════════════════════════════════════════════════════════════════════════

export default function RecordingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const recordingId = params?.id as string;

  // ── State ────────────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
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

  // ── Queries ──────────────────────────────────────────────────────────────
  const {
    data: recordingData,
    isLoading: isRecordingLoading,
    isError: isRecordingError,
    error: recordingError,
    refetch: refetchRecording,
  } = useRecording(recordingId);

  const recording = recordingData?.data as Recording | undefined;

  // Status polling (auto-stops when terminal)
  const { data: statusData } = useRecordingStatus(recordingId);
  const liveStatus =
    (statusData?.data?.status as RecordingStatus) ?? recording?.status;

  // Playback URL (only for completed recordings)
  const {
    data: playbackData,
    isLoading: isPlaybackLoading,
  } = usePlaybackUrl(
    recording?.status === 'completed' || liveStatus === 'completed'
      ? recordingId
      : null,
  );

  const playbackUrl = playbackData?.data?.playbackUrl as string | undefined;

  // ── Mutations ────────────────────────────────────────────────────────────
  const {
    mutate: deleteRecording,
    isPending: isDeleting,
  } = useDeleteRecording();

  const {
    mutate: retryRecording,
    isPending: isRetrying,
  } = useRetryRecording();

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    deleteRecording(recordingId, {
      onSuccess: () => {
        showFeedback('success', 'Recording deleted successfully.');
        setShowDeleteConfirm(false);
        // Navigate back to list after brief delay
        setTimeout(() => router.push('/teacher/recordings/list'), 1200);
      },
      onError: () => {
        showFeedback('error', 'Failed to delete recording. Please try again.');
        setShowDeleteConfirm(false);
      },
    });
  }, [recordingId, deleteRecording, router, showFeedback]);

  const handleRetry = useCallback(() => {
    retryRecording(recordingId, {
      onSuccess: () => {
        showFeedback('success', 'Recording retry initiated. Processing will resume shortly.');
      },
      onError: () => {
        showFeedback('error', 'Failed to retry recording. Please try again.');
      },
    });
  }, [recordingId, retryRecording, showFeedback]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/teacher/recordings/${recordingId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback(true);
      showFeedback('success', 'Share link copied to clipboard.');
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      showFeedback('error', 'Failed to copy link. Please copy the URL manually.');
    }
  }, [recordingId, showFeedback]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  // ── Loading State ─────────────────────────────────────────────────────────
  if (isRecordingLoading) {
    return (
      <div>
        <PageHeader
          title="Loading Recording..."
          breadcrumbs={[
            { label: 'Recorded Classes', href: '/teacher/recordings/list' },
            { label: 'Loading...' },
          ]}
        />
        <div className="animate-pulse space-y-6">
          <div className="h-64 w-full rounded-xl bg-gray-200 dark:bg-gray-700" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <div className="h-8 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-full rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="space-y-3">
              <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Error State ───────────────────────────────────────────────────────────
  if (isRecordingError || !recording) {
    return (
      <div>
        <PageHeader
          title="Recording Not Found"
          breadcrumbs={[
            { label: 'Recorded Classes', href: '/teacher/recordings/list' },
            { label: 'Error' },
          ]}
        />
        <RecordingError
          message={
            (recordingError as Error)?.message ??
            'Recording not found or you do not have permission to view it.'
          }
          onRetry={() => refetchRecording()}
          variant="banner"
        />
        <div className="mt-4">
          <Link
            href="/teacher/recordings/list"
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            <ArrowCounterClockwise size={14} />
            Back to Recordings
          </Link>
        </div>
      </div>
    );
  }

  // ── Resolve display status ────────────────────────────────────────────────
  const displayStatus = liveStatus ?? recording.status;
  const isActive = displayStatus === 'recording' || displayStatus === 'processing';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title={recording.title}
        breadcrumbs={[
          { label: 'Recorded Classes', href: '/teacher/recordings/list' },
          { label: recording.title },
        ]}
        actions={
          <Link
            href="/teacher/recordings/list"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Eye size={16} />
            All Recordings
          </Link>
        }
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ─── Left Column: Thumbnail & Player (2/3) ─────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Thumbnail / Video Player */}
          <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-gradient-to-br from-gray-100 to-gray-200 dark:border-gray-700 dark:from-gray-800 dark:to-gray-900">
            <div className="aspect-video w-full">
              {playbackUrl && displayStatus === 'completed' ? (
                <video
                  src={playbackUrl}
                  controls
                  className="h-full w-full object-contain bg-black"
                  poster={recording.thumbnailUrl ?? undefined}
                >
                  Your browser does not support the video tag.
                </video>
              ) : recording.thumbnailUrl ? (
                <img
                  src={recording.thumbnailUrl}
                  alt={recording.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <VideoCamera
                    size={64}
                    weight="light"
                    className="text-gray-300 dark:text-gray-600"
                  />
                </div>
              )}
            </div>

            {/* Overlay: Duration badge */}
            {recording.durationSeconds != null && recording.durationSeconds > 0 && (
              <div className="absolute bottom-3 left-3">
                <RecordingDuration
                  seconds={recording.durationSeconds}
                  overlay
                />
              </div>
            )}

            {/* Status badge overlay (top-right) */}
            <div className="absolute right-3 top-3">
              <RecordingStatusBadge status={displayStatus} />
            </div>
          </div>

          {/* Processing Indicator */}
          {isActive && (
            <ProcessingIndicator
              status={displayStatus as 'recording' | 'processing'}
              size="default"
            />
          )}

          {/* Failure Message */}
          {displayStatus === 'failed' && recording.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
              <div className="flex items-start gap-3">
                <WarningCircle
                  size={20}
                  weight="fill"
                  className="mt-0.5 shrink-0 text-red-500"
                />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">
                    Recording Failed
                  </p>
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {recording.errorMessage}
                  </p>
                  {recording.lastRetriedAt && (
                    <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                      Last retry: {formatDateTime(recording.lastRetriedAt)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Playback disabled state */}
          {displayStatus === 'completed' && !playbackUrl && !isPlaybackLoading && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Playback URL is being generated. Please refresh the page in a moment.
              </p>
            </div>
          )}

          {/* Description */}
          {recording.description && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Description
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {recording.description}
              </p>
            </div>
          )}
        </div>

        {/* ─── Right Column: Info & Actions (1/3) ────────────────────── */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Actions
            </h3>
            <div className="space-y-2.5">
              {/* Play */}
              {displayStatus === 'completed' && (
                <ActionButton
                  icon={<Play size={16} weight="fill" />}
                  label="Play Recording"
                  onClick={() => {
                    const video = document.querySelector('video');
                    if (video) {
                      video.scrollIntoView({ behavior: 'smooth' });
                      video.play().catch(() => {});
                    }
                  }}
                  variant="primary"
                  disabled={!playbackUrl}
                />
              )}

              {/* Share */}
              {displayStatus === 'completed' && (
                <ActionButton
                  icon={copyFeedback ? <Check size={16} /> : <Copy size={16} />}
                  label={copyFeedback ? 'Copied!' : 'Copy Share Link'}
                  onClick={handleShare}
                  variant="default"
                />
              )}

              {/* Retry (failed only) */}
              {displayStatus === 'failed' && (
                <ActionButton
                  icon={
                    isRetrying ? (
                      <svg
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <ArrowCounterClockwise size={16} />
                    )
                  }
                  label={isRetrying ? 'Retrying...' : 'Retry Processing'}
                  onClick={handleRetry}
                  disabled={isRetrying}
                  variant="default"
                />
              )}

              {/* Delete */}
              <ActionButton
                icon={<Trash size={16} />}
                label="Delete Recording"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeleting}
                variant="danger"
              />
            </div>
          </div>

          {/* Recording Info */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Recording Info
            </h3>
            <div className="space-y-4">
              <InfoRow
                icon={<VideoCamera size={16} />}
                label="Status"
                value={<RecordingStatusBadge status={displayStatus} />}
              />
              <InfoRow
                icon={<Clock size={16} />}
                label="Duration"
                value={
                  recording.durationSeconds != null && recording.durationSeconds > 0
                    ? `${recording.durationSeconds} seconds`
                    : '—'
                }
              />
              <InfoRow
                icon={<FileText size={16} />}
                label="File Size"
                value={formatBytes(recording.fileSizeBytes)}
              />
              <InfoRow
                icon={<CalendarBlank size={16} />}
                label="Recorded On"
                value={formatDateTime(recording.createdAt)}
              />
              <InfoRow
                icon={<Eye size={16} />}
                label="Recording ID"
                value={
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {recording.recordingId.slice(0, 8)}...
                  </code>
                }
              />
            </div>
          </div>

          {/* Stats */}
          {recording.retryCount > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Retry Count"
                value={recording.retryCount}
                icon={<ArrowCounterClockwise size={18} />}
                color="amber"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Delete Confirmation Dialog ───────────────────────────────── */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Recording"
        message={`Are you sure you want to delete "${recording.title}"? This recording will be hidden from students. You can restore it later by contacting an administrator.`}
        confirmLabel="Delete Recording"
        cancelLabel="Cancel"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
