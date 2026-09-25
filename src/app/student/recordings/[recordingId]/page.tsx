'use client';

/**
 * Student Recorded Class Player Page (/student/recordings/[recordingId])
 *
 * Dedicated Next.js Page for viewing a single live-class recording.
 *
 * Lifecycle & Security:
 *   1. Authorizes student batch enrollment and loads recording metadata + viewing history.
 *   2. Requests initial short-lived presigned playback URL from Cloudflare R2 via Edge Function.
 *   3. Mounts the StudentRecordingPlayer with HTML5 video, proactive/reactive URL refresh,
 *      and resume playback tracking.
 *   4. Displays recording metadata, instructor information, and doubt support via StudentRecordingDetails.
 *
 * @module app/student/recordings/[recordingId]/page
 */

import React, { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  IconWarning,
  IconArrowLeft,
  IconRefresh,
} from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import {
  fetchStudentRecordingById,
  getStudentPlaybackUrl,
  type StudentRecording,
  type StudentPlaybackUrlResult,
} from '@/services/student/studentRecordingWebService';
import { StudentRecordingPlayer } from '@/components/student/recordings/player/StudentRecordingPlayer';
import { StudentRecordingDetails } from '@/components/student/recordings/player/StudentRecordingDetails';

interface PageProps {
  params?: Promise<{ recordingId: string }> | { recordingId: string };
}

export default function StudentRecordingPlayerPage({ params }: PageProps) {
  // Resolve recordingId from params prop or useParams hook
  const routeParams = useParams();
  let paramRecordingId = routeParams?.recordingId as string | undefined;

  if (params) {
    // If params is a Promise (Next.js 15), unwrap with use, otherwise read property
    if (typeof (params as any).then === 'function') {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const resolved = use(params as Promise<{ recordingId: string }>);
      paramRecordingId = resolved?.recordingId || paramRecordingId;
    } else {
      paramRecordingId = (params as { recordingId: string })?.recordingId || paramRecordingId;
    }
  }

  const recordingId = paramRecordingId || '';
  const { user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState<StudentRecording | null>(null);
  const [playbackUrlData, setPlaybackUrlData] = useState<StudentPlaybackUrlResult | null>(null);

  const [currentProgress, setCurrentProgress] = useState<{
    position: number;
    isCompleted: boolean;
    watchedPercentage: number;
  } | null>(null);

  // ── Load Recording & Initial Playback URL ──────────────────────────────
  const loadRecordingData = useCallback(async () => {
    if (!recordingId) {
      setErrorMessage('Invalid recording identifier.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      // 1. Fetch metadata and check access permissions
      const recResult = await fetchStudentRecordingById(recordingId, user?.id);

      if (recResult.error || !recResult.data) {
        setErrorMessage(
          recResult.error ||
            'Recording not found or you do not have permission to view it.'
        );
        setLoading(false);
        return;
      }

      setRecording(recResult.data);
      if (recResult.data.progress) {
        setCurrentProgress({
          position: recResult.data.progress.lastPositionSeconds,
          isCompleted: recResult.data.progress.isCompleted,
          watchedPercentage: recResult.data.progress.watchedPercentage,
        });
      }

      // 2. Request initial presigned playback URL
      const urlResult = await getStudentPlaybackUrl(recordingId);
      if (urlResult.error || !urlResult.data) {
        console.warn('[RecordingPage] Initial playback URL request failed:', urlResult.error);
        // We still render the player; it has built-in retry and reactive refresh
      } else {
        setPlaybackUrlData(urlResult.data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load recorded class.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [recordingId, user?.id]);

  useEffect(() => {
    loadRecordingData();
  }, [loadRecordingData]);

  const handleProgressUpdate = (position: number, isCompleted: boolean) => {
    if (!recording) return;
    const dur = recording.durationSeconds || 1;
    const pct = Math.min(100, Math.round((position / dur) * 100));
    setCurrentProgress({
      position,
      isCompleted,
      watchedPercentage: pct,
    });
  };

  // ── Loading Skeleton State ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-900/5 dark:bg-neutral-950 p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Breadcrumb Skeleton */}
          <div className="h-4 w-36 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />

          {/* Video Player Skeleton */}
          <div className="w-full aspect-video bg-paper rounded-card flex flex-col items-center justify-center gap-3 shadow-card border border-line animate-pulse">
            <IconRefresh className="w-8 h-8 animate-spin text-brand" />
            <span className="text-xs text-ink-muted font-medium">
              Loading recorded session...
            </span>
          </div>

          {/* Details Skeleton */}
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="h-6 w-20 bg-paper rounded-lg animate-pulse" />
              <div className="h-6 w-28 bg-paper rounded-lg animate-pulse" />
            </div>
            <div className="h-8 w-3/4 bg-paper rounded-field animate-pulse" />
            <div className="h-20 w-full bg-paper rounded-card animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error / Unauthorized State ─────────────────────────────────────────
  if (errorMessage || !recording) {
    return (
      <div className="min-h-screen bg-sand flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full bg-surface rounded-sheet border border-line p-8 text-center shadow-card space-y-5">
          <div className="w-16 h-16 rounded-card bg-rose-50 border border-rose-200 mx-auto flex items-center justify-center text-rose-600 shadow-xs">
            <IconWarning className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold text-ink">
              Recorded Class Unavailable
            </h2>
            <p className="text-xs text-ink-secondary leading-relaxed">
              {errorMessage || 'This recording is either not found or you are not enrolled in the corresponding batch.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              onClick={loadRecordingData}
              className="w-full inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 rounded-field bg-paper hover:bg-sky-tint text-ink text-xs font-semibold border border-line transition-colors"
            >
              <IconRefresh className="w-4 h-4" />
              <span>Retry</span>
            </button>

            <Link
              href="/student/recordings"
              className="w-full inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 rounded-field bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <IconArrowLeft className="w-4 h-4" />
              <span>All Recordings</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal Ready State ─────────────────────────────────────────────────
  return (
    <div className="store-container space-y-7 pb-12">
      {/* ── Breadcrumb Navigation ──────────────────────────────────── */}
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link href="/student/overview">My Learning</Link>
        <span aria-hidden="true">/</span>
        <Link href="/student/recordings">Recorded Classes</Link>
        <span aria-hidden="true">/</span>
        <span>{recording.title}</span>
      </nav>

      <div className="space-y-8">
        {/* ── Video Player Component ─────────────────────────────────── */}
        <section aria-label="Class Video Player">
          <StudentRecordingPlayer
            recordingId={recording.recordingId}
            title={recording.title}
            initialPlaybackUrl={playbackUrlData?.playbackUrl ?? null}
            initialExpiresAt={playbackUrlData?.expiresAt ?? null}
            initialDurationSeconds={recording.durationSeconds}
            initialPositionSeconds={recording.progress?.lastPositionSeconds ?? 0}
            isCompleted={recording.progress?.isCompleted ?? false}
            studentId={user?.id}
            thumbnailUrl={recording.thumbnailPath}
            onProgressUpdate={handleProgressUpdate}
          />
        </section>

        {/* ── Metadata & Instructor Details ──────────────────────────── */}
        <section aria-label="Class Details and Instructor Information">
          <StudentRecordingDetails
            recording={recording}
            isCompleted={currentProgress?.isCompleted}
            watchedPercentage={currentProgress?.watchedPercentage}
          />
        </section>
      </div>
    </div>
  );
}
