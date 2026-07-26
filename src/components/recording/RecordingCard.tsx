'use client';

/**
 * RecordingCard
 *
 * Reusable card component for displaying a recording in grid/list views.
 * Supports both teacher and student variants with context-appropriate
 * action buttons.
 *
 * @module components/recording/RecordingCard
 */

import { useState } from 'react';
import type { Recording } from '@/types/recording';
import { RecordingStatusBadge } from './RecordingStatusBadge';
import { RecordingDuration } from './RecordingDuration';
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

// ─── Icons ──────────────────────────────────────────────────────────────────

import {
  Play,
  Share,
  Trash,
  ArrowCounterClockwise,
  VideoCamera,
} from '@phosphor-icons/react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecordingCardProps {
  /** The recording to display. */
  recording: Recording;
  /** Called when the user clicks Play. */
  onPlay?: (recordingId: string) => void;
  /** Called when the user clicks Share. */
  onShare?: (recordingId: string) => void;
  /** Called when the user clicks Delete. */
  onDelete?: (recordingId: string) => void;
  /** Called when the user clicks Retry (failed recordings). */
  onRetry?: (recordingId: string) => void;
  /** Display variant. `teacher` shows all actions; `student` shows only Play. */
  variant?: 'teacher' | 'student';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RecordingCard({
  recording,
  onPlay,
  onShare,
  onDelete,
  onRetry,
  variant = 'teacher',
}: RecordingCardProps) {
  const [imgError, setImgError] = useState(false);

  const showActions = variant === 'teacher' || recording.status === 'completed';

  return (
    <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      {/* ── Thumbnail ─────────────────────────────────────────────────── */}
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800">
        {recording.thumbnailUrl && !imgError ? (
          <img
            src={recording.thumbnailUrl}
            alt={recording.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <VideoCamera
              size={40}
              weight="light"
              className="text-gray-300 dark:text-gray-600"
            />
          </div>
        )}

        {/* Duration badge (bottom-left) */}
        {recording.durationSeconds != null && recording.durationSeconds > 0 && (
          <div className="absolute bottom-2 left-2">
            <RecordingDuration seconds={recording.durationSeconds} />
          </div>
        )}

        {/* Play overlay on hover (completed only) */}
        {recording.status === 'completed' && (
          <button
            type="button"
            onClick={() => onPlay?.(recording.recordingId)}
            className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/30"
            aria-label={`Play ${recording.title}`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg opacity-0 transition-all duration-200 group-hover:opacity-100 dark:bg-gray-900/90">
              <Play size={22} weight="fill" className="ml-0.5 text-gray-900 dark:text-white" />
            </div>
          </button>
        )}
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="space-y-2 p-4">
        <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          {recording.title}
        </h3>

        <div className="flex items-center gap-2">
          <RecordingStatusBadge status={recording.status} />
        </div>

        {recording.description && (
          <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {recording.description}
          </p>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500">
          {formatDate(recording.createdAt)}
        </p>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      {showActions && (
        <div className="flex items-center gap-1 border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
          {recording.status === 'completed' && (
            <button
              type="button"
              onClick={() => onPlay?.(recording.recordingId)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
            >
              <Play size={12} weight="fill" />
              Play
            </button>
          )}

          {variant === 'teacher' && recording.status === 'completed' && (
            <button
              type="button"
              onClick={() => onShare?.(recording.recordingId)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
            >
              <Share size={12} />
              Share
            </button>
          )}

          {variant === 'teacher' && recording.status === 'failed' && (
            <button
              type="button"
              onClick={() => onRetry?.(recording.recordingId)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-orange-600 transition-colors hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
            >
              <ArrowCounterClockwise size={12} />
              Retry
            </button>
          )}

          {variant === 'teacher' && (
            <button
              type="button"
              onClick={() => onDelete?.(recording.recordingId)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Trash size={12} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
