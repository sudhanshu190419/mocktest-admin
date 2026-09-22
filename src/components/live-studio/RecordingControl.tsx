'use client';

/**
 * RecordingControl — Live Studio Start/Stop Recording control
 *
 * Teacher-facing control for the Recorded Classes module. It is purely a
 * consumer of the existing recording layer and never talks to LiveKit,
 * Egress, or R2 directly:
 *
 *   Start → useStartRecording()   → recordingService.startRecording()
 *   Stop  → useStopRecording()    → recordingService.stopRecording()
 *   Live  → useRecordingStatus()  → recordingService.getRecordingStatus()
 *   Row   → useRecordings()       → recordingService.getRecordings()
 *
 * The studio never asks the teacher for a bucket or storage path — the R2
 * destination is reserved server-side by `recording-egress-start`.
 *
 * ── State comes from the database, not from a button boolean ──
 * A live class can own only ONE recording row (`uq_recordings_class_segment`
 * on (class_id, segment_number), segment_number defaulting to 1), so the
 * control adopts the newest recording row for the class and derives the whole
 * UI from its lifecycle status. That keeps it correct across re-renders,
 * studio remounts, rejoin, and transitions driven by the recording webhook.
 *
 * @module components/live-studio/RecordingControl
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Record as RecordIcon,
  Stop,
  CircleNotch,
  WarningCircle,
  CheckCircle,
  Info,
} from '@phosphor-icons/react';

import {
  useRecordings,
  useRecordingStatus,
  useStartRecording,
  useStopRecording,
  useRetryRecording,
} from '@/hooks/recording/useRecordings';
import { recordingKeys } from '@/hooks/recording/queryKeys';
import type { RecordingStatus } from '@/types/recording';

// ─── Props ─────────────────────────────────────────────────────────────────

interface RecordingControlProps {
  /** Live class to record (`live_classes.class_id`). Must be a valid UUID. */
  classId: string;
  /** Live class title — used as the recording title. */
  classTitle: string;
}

// ─── Derived-status helpers (pure) ─────────────────────────────────────────

/**
 * A lifecycle transition this control itself just persisted.
 *
 * `at` is the local time the transition was written, used to tell a cached
 * status response apart from one fetched after the write.
 */
export interface StatusCommand {
  status: RecordingStatus;
  at: number;
}

/**
 * Resolve the status to render.
 *
 * The status query is the source of truth, EXCEPT during the round trip right
 * after this control wrote a transition (start / stop / retry): the cached
 * response still describes the pre-transition row, so the status we just
 * persisted is shown until a response fetched after the write arrives.
 *
 * This keeps the actions honest — the Stop button never reappears on a row
 * that is already processing, and Retry never reappears on a row that is
 * already recording again.
 *
 * @param queried   Status from `useRecordingStatus` (may be stale).
 * @param queriedAt `dataUpdatedAt` of that query (0 when never fetched).
 * @param list      Status of the class's newest recording row.
 * @param command   The most recent transition written by this control.
 */
export function pickDisplayStatus(input: {
  queried: RecordingStatus | null;
  queriedAt: number;
  list: RecordingStatus | null;
  command: StatusCommand | null;
}): RecordingStatus | null {
  const { queried, queriedAt, list, command } = input;

  if (command && queriedAt <= command.at) {
    return command.status;
  }

  return queried ?? list ?? null;
}

/**
 * Recording title for a live class.
 *
 * `public.recordings` enforces `char_length(title) >= 3`
 * (ck_recordings_title_length), so an unusable class title falls back to a
 * generic one instead of failing the insert.
 */
export function buildRecordingTitle(classTitle: string): string {
  const trimmed = (classTitle ?? '').trim();
  return trimmed.length >= 3 ? trimmed : 'Live Class Recording';
}

// ─── Local feedback notice ─────────────────────────────────────────────────

type NoticeTone = 'success' | 'error' | 'info';

interface Notice {
  tone: NoticeTone;
  message: string;
}

const NOTICE_DISMISS_MS = 6000;

const NOTICE_CLASSES: Record<NoticeTone, string> = {
  error: 'border-red-500/40 bg-red-500/20 text-red-200',
  success: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200',
  info: 'border-white/15 bg-white/10 text-blue-100',
};

const NOTICE_ICONS: Record<NoticeTone, typeof Info> = {
  error: WarningCircle,
  success: CheckCircle,
  info: Info,
};

// ─── Component ─────────────────────────────────────────────────────────────

export function RecordingControl({
  classId,
  classTitle,
}: RecordingControlProps): React.JSX.Element {
  const queryClient = useQueryClient();

  // ── The class's existing recording row (survives remounts) ─────────────
  const listQuery = useRecordings(
    { classId },
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page: 1, pageSize: 1 },
  );

  const latest =
    listQuery.data?.success ? listQuery.data.data?.recordings?.[0] ?? null : null;

  // A recording started in this session always wins over the list, so a stale
  // list response can never re-target Stop at an older row. When nothing has
  // been started here, the class's newest row is adopted directly — no effect
  // required, so a remount / rejoin picks the active recording back up.
  const [localRecordingId, setLocalRecordingId] = useState<string | null>(null);
  const recordingId = localRecordingId ?? latest?.recordingId ?? null;

  // ── Status: authoritative query, plus transitions we just wrote ─────────
  const statusQuery = useRecordingStatus(recordingId);

  const [command, setCommand] = useState<StatusCommand | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const status = pickDisplayStatus({
    queried: (statusQuery.data?.data?.status as RecordingStatus | undefined) ?? null,
    queriedAt: statusQuery.dataUpdatedAt,
    list: latest && latest.recordingId === recordingId ? latest.status : null,
    command,
  });

  // ── Notice helpers ─────────────────────────────────────────────────────
  const showNotice = useCallback((tone: NoticeTone, message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ tone, message });
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_DISMISS_MS);
  }, []);

  // Clear a pending dismissal timer on unmount.
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // ── Mutations (existing hooks only) ────────────────────────────────────
  const startMutation = useStartRecording();
  const stopMutation = useStopRecording();
  const retryMutation = useRetryRecording();

  const isStarting = startMutation.isPending;
  const isStopping = stopMutation.isPending;
  const isRetrying = retryMutation.isPending;

  /** True until the class's recording list has resolved for the first time. */
  const isResolvingRecording = listQuery.isLoading;

  const handleStart = useCallback(() => {
    // Duplicate-start guard: one click, one recording row. `recordingId` is
    // set as soon as a row exists for this class, so a second click (or a
    // re-render) can never create a second recording.
    if (isStarting || isResolvingRecording || recordingId) return;

    startMutation.mutate(
      {
        classId,
        title: buildRecordingTitle(classTitle),
        recordingType: 'live_class',
      },
      {
        onSuccess: (result) => {
          if (!result.success || !result.data) {
            showNotice('error', result.error ?? 'Could not start recording. Please try again.');
            return;
          }

          // Adopt the new row immediately so the UI can never fall back to
          // "Start" while the recording is active.
          setLocalRecordingId(result.data.recordingId);
          setCommand({ status: result.data.status, at: Date.now() });
          showNotice('success', 'Recording started.');
        },
        onError: (err) => {
          showNotice(
            'error',
            err instanceof Error ? err.message : 'Could not start recording. Please try again.',
          );
        },
      },
    );
  }, [classId, classTitle, isResolvingRecording, isStarting, recordingId, startMutation, showNotice]);

  const handleStop = useCallback(() => {
    if (!recordingId || isStopping) return;

    stopMutation.mutate(recordingId, {
      onSuccess: (result) => {
        if (!result.success) {
          // Keep the active state and the recordingId — the teacher can retry
          // stopping the still-running recording.
          showNotice('error', result.error ?? 'Could not stop recording. Please try again.');
          return;
        }

        // `stopRecording()` persists exactly this status.
        setCommand({ status: 'processing', at: Date.now() });
        showNotice('info', 'Recording stopped. Processing…');
      },
      onError: (err) => {
        showNotice(
          'error',
          err instanceof Error ? err.message : 'Could not stop recording. Please try again.',
        );
      },
    });
  }, [recordingId, isStopping, stopMutation, showNotice]);

  const handleRetry = useCallback(() => {
    if (!recordingId || isRetrying) return;

    retryMutation.mutate(recordingId, {
      onSuccess: (result) => {
        if (!result.success || !result.data) {
          showNotice('error', result.error ?? 'Could not retry recording. Please try again.');
          return;
        }

        setCommand({ status: result.data.status, at: Date.now() });

        // The retry hook invalidates list queries only, and this status query
        // is cached as a terminal 'failed' (so it is not polling). Refresh it
        // explicitly, or the UI would keep showing the pre-retry state.
        queryClient.invalidateQueries({
          queryKey: recordingKeys.status(result.data.recordingId),
        });

        showNotice('success', 'Recording restarted.');
      },
      onError: (err) => {
        showNotice(
          'error',
          err instanceof Error ? err.message : 'Could not retry recording. Please try again.',
        );
      },
    });
  }, [recordingId, isRetrying, retryMutation, queryClient, showNotice]);

  // ── Render ─────────────────────────────────────────────────────────────

  const NoticeIcon = notice ? NOTICE_ICONS[notice.tone] : Info;

  return (
    <div className="relative flex items-center">
      {/* Feedback notice — floats above the control bar (no layout shift). */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`absolute bottom-full left-0 mb-3 flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-[11px] font-medium backdrop-blur-md ${NOTICE_CLASSES[notice.tone]}`}
        >
          <NoticeIcon size={14} weight="bold" aria-hidden="true" />
          <span>{notice.message}</span>
        </div>
      )}

      {status === 'recording' ? (
        /* ── Active recording ── */
        <div className="flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/20 py-1.5 pl-3.5 pr-1.5">
          <span className="flex items-center gap-2 text-xs font-bold text-red-200">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
            Recording
          </span>
          <button
            type="button"
            onClick={handleStop}
            disabled={isStopping}
            aria-label="Stop recording"
            className="flex items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStopping ? (
              <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" />
            ) : (
              <Stop size={14} weight="fill" aria-hidden="true" />
            )}
            {isStopping ? 'Stopping…' : 'Stop Recording'}
          </button>
        </div>
      ) : status === 'processing' ? (
        /* ── Egress finished, export still running ── */
        <span
          role="status"
          className="flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/15 px-3.5 py-2 text-xs font-medium text-blue-200"
        >
          <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" />
          Processing recording…
        </span>
      ) : status === 'completed' ? (
        /* ── Artifact is stored and ready for playback ── */
        <span
          role="status"
          className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-200"
        >
          <CheckCircle size={14} weight="bold" aria-hidden="true" />
          Recording ready
        </span>
      ) : status === 'partial' ? (
        /* ── Existing semantics: short/incomplete clip ── */
        <span
          role="status"
          className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-medium text-amber-200"
        >
          <Info size={14} weight="bold" aria-hidden="true" />
          Partial recording
        </span>
      ) : status === 'failed' ? (
        /* ── Recoverable failure: retry reuses the SAME recording row ── */
        <div className="flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/15 py-1.5 pl-3.5 pr-1.5">
          <span className="flex items-center gap-2 text-xs font-medium text-red-200">
            <WarningCircle size={14} weight="bold" aria-hidden="true" />
            Recording failed
          </span>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            aria-label="Retry recording"
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRetrying ? (
              <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" />
            ) : (
              <RecordIcon size={14} weight="fill" className="text-red-400" aria-hidden="true" />
            )}
            {isRetrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : recordingId ? (
        /* ── Defensive: a row exists but its status is not known yet ── */
        <span
          role="status"
          className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-medium text-blue-100"
        >
          <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" />
          Checking recording…
        </span>
      ) : (
        /* ── No recording for this class yet ── */
        <button
          type="button"
          onClick={handleStart}
          disabled={isStarting || isResolvingRecording}
          aria-label="Start recording this live class"
          className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:border-red-500/40 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isStarting || isResolvingRecording ? (
            <CircleNotch size={16} weight="bold" className="animate-spin" aria-hidden="true" />
          ) : (
            <RecordIcon size={16} weight="fill" className="text-red-400" aria-hidden="true" />
          )}
          {isStarting ? 'Starting…' : isResolvingRecording ? 'Checking…' : 'Start Recording'}
        </button>
      )}
    </div>
  );
}
