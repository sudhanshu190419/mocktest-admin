'use client';

/**
 * StudentWebContentPlayer Component
 *
 * Dedicated web viewer for enrolled students:
 *   - PDF / Lecture Notes / Assignment: Embedded PDF / doc view with signed URL resolution
 *   - Video Lectures: Responsive HTML5 player with speed controls & duration
 *   - Mock Test preview tile: Real assessment metadata, real question count, and dynamic attempt CTAs
 *
 * @module components/student/StudentWebContentPlayer
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  VideoCamera,
  FileText,
  DownloadSimple,
  ArrowSquareOut,
  CheckCircle,
  WarningCircle,
  Question,
  Clock,
  Exam,
  BookOpen,
  ArrowRight,
  Play,
} from '@phosphor-icons/react';
import {
  type SubjectWorkspaceContentItem,
  type AssignedMockTestItem,
  getStorageSignedUrl,
  markContentItemCompleted,
} from '@/services/student/studentCourseWebService';

interface StudentWebContentPlayerProps {
  contentItem?: SubjectWorkspaceContentItem | null;
  mockTestItem?: AssignedMockTestItem | null;
  onComplete?: (contentId: string) => void;
  onAskDoubt?: (contentId: string, title: string) => void;
}

export const StudentWebContentPlayer: React.FC<StudentWebContentPlayerProps> = ({
  contentItem,
  mockTestItem,
  onComplete,
  onAskDoubt,
}) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState<boolean>(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isMarkingComplete, setIsMarkingComplete] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Resolve signed URL when contentItem changes
  useEffect(() => {
    let cancelled = false;

    if (!contentItem) {
      setSignedUrl(null);
      setLoadingUrl(false);
      setUrlError(null);
      return;
    }

    // If signedUrl is already on the item
    if (contentItem.signedUrl) {
      setSignedUrl(contentItem.signedUrl);
      setIsCompleted(!!contentItem.isCompleted);
      return;
    }

    async function loadUrl() {
      setLoadingUrl(true);
      setUrlError(null);
      try {
        const url = await getStorageSignedUrl(
          contentItem!.storageBucket || 'content-pdfs',
          contentItem!.storagePath,
          7200 // 2 hours validity
        );
        if (!cancelled) {
          if (url) {
            setSignedUrl(url);
          } else {
            setUrlError('Content storage link pending or bucket private');
          }
          setLoadingUrl(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setUrlError(err?.message || 'Could not resolve content URL');
          setLoadingUrl(false);
        }
      }
    }

    loadUrl();
    setIsCompleted(!!contentItem.isCompleted);

    return () => {
      cancelled = true;
    };
  }, [contentItem]);

  // Handle video speed change
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, signedUrl]);

  // 1. Mock Test Selected State
  if (mockTestItem) {
    const attempt = mockTestItem.attemptSummary;
    const isAvailable = mockTestItem.status === 'available';

    // Status badge determination based on real student attempt state
    let statusBadgeText = isAvailable ? '● Ready to Attempt' : mockTestItem.status === 'upcoming' ? 'Scheduled Soon' : 'Expired';
    let statusBadgeClass = isAvailable
      ? 'bg-mint-tint text-mint-ink border-emerald-200'
      : mockTestItem.status === 'upcoming'
      ? 'bg-sand text-sand-ink border-amber-200'
      : 'bg-paper text-ink-secondary border-line';

    if (attempt) {
      if (attempt.attemptState === 'in_progress') {
        statusBadgeText = '● In Progress (Resume)';
        statusBadgeClass = 'bg-sand text-sand-ink border-amber-200';
      } else if (attempt.attemptState === 'limit_reached') {
        statusBadgeText = 'Attempts Exhausted';
        statusBadgeClass = 'bg-paper text-ink-secondary border-line';
      } else if (attempt.attemptState === 'submitted') {
        statusBadgeText = '● Attempted / Submitted';
        statusBadgeClass = 'bg-mint-tint text-mint-ink border-emerald-200';
      }
    }

    const actionLabel = attempt?.actionLabel || 'Start Test Assessment';
    const actionHref = attempt?.actionHref || '/student/tests';
    const canAttempt = attempt ? attempt.canAttempt : isAvailable;

    return (
      <div className="flex flex-col rounded-card border border-line bg-surface p-6 sm:p-7 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-field bg-brand text-white shadow-xs">
              <Exam className="h-6 w-6" weight="duotone" />
            </div>
            <div>
              <span className="inline-flex rounded-full bg-sky-tint px-2.5 py-0.5 text-caption font-bold text-brand-hover border border-line">
                Assigned Mock Assessment
              </span>
              <h2 className="text-h2 font-extrabold text-ink mt-1">{mockTestItem.title}</h2>
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-caption font-bold border shrink-0 ${statusBadgeClass}`}>
            {statusBadgeText}
          </span>
        </div>

        {mockTestItem.description && (
          <p className="mt-3 text-body text-ink-secondary leading-relaxed">{mockTestItem.description}</p>
        )}

        {/* Real Test Spec Grid */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-field border border-line bg-paper p-3.5 text-center">
            <Clock className="h-4 w-4 text-ink-muted mx-auto" weight="duotone" />
            <p className="mt-1 text-caption text-ink-secondary font-medium">Duration</p>
            <p className="text-body font-bold text-ink">
              {mockTestItem.durationMin !== null ? `${mockTestItem.durationMin} mins` : 'Flexible'}
            </p>
          </div>
          <div className="rounded-field border border-line bg-paper p-3.5 text-center">
            <Exam className="h-4 w-4 text-brand mx-auto" weight="duotone" />
            <p className="mt-1 text-caption text-ink-secondary font-medium">Total Marks</p>
            <p className="text-body font-bold text-ink">
              {mockTestItem.totalMarks !== null ? mockTestItem.totalMarks : '—'}
            </p>
          </div>
          <div className="rounded-field border border-line bg-paper p-3.5 text-center">
            <BookOpen className="h-4 w-4 text-brand mx-auto" weight="duotone" />
            <p className="mt-1 text-caption text-ink-secondary font-medium">Questions</p>
            <p className="text-body font-bold text-ink">
              {mockTestItem.questionCount > 0 ? `${mockTestItem.questionCount} Q` : 'Configured'}
            </p>
          </div>
          <div className="rounded-field border border-line bg-paper p-3.5 text-center">
            <WarningCircle className="h-4 w-4 text-amber-500 mx-auto" weight="duotone" />
            <p className="mt-1 text-caption text-ink-secondary font-medium">Negative Mark</p>
            <p className="text-body font-bold text-ink">
              {mockTestItem.negativeMarking ? `-${mockTestItem.negativeMarking}` : 'None'}
            </p>
          </div>
        </div>

        {/* Action Button (≥44px hit-height) */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <span className="text-body text-ink-secondary">
            {mockTestItem.attemptLimit
              ? `Attempt Limit: ${mockTestItem.attemptLimit} times${
                  attempt?.attemptsUsed ? ` (${attempt.attemptsUsed} used)` : ''
                }`
              : 'Unlimited Practice Attempts'}
          </span>
          {canAttempt ? (
            <a
              href={actionHref}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-field bg-brand px-6 py-2.5 text-body font-bold text-white shadow-xs hover:bg-brand-hover active:scale-[0.98] transition-all"
            >
              <span>{actionLabel}</span>
              <ArrowRight className="h-4 w-4" weight="bold" />
            </a>
          ) : (
            <a
              href="/student/tests"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-field bg-paper border border-line px-6 py-2.5 text-body font-bold text-ink-secondary transition-all"
            >
              <span>{actionLabel}</span>
              <ArrowRight className="h-4 w-4" weight="bold" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // 2. Empty / Nothing Selected State
  if (!contentItem) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-card bg-sky-tint text-brand">
          <BookOpen className="h-8 w-8" weight="duotone" />
        </div>
        <h3 className="mt-4 text-h3 font-bold text-ink">Select a Topic from the Curriculum</h3>
        <p className="mt-1.5 max-w-sm text-body text-ink-secondary leading-relaxed">
          Choose any video lecture, revision note, or formula PDF to start reading or streaming your coursework.
        </p>
      </div>
    );
  }

  const isVideo = contentItem.contentType === 'video';
  const isPdfOrNotes =
    contentItem.contentType === 'pdf' ||
    contentItem.contentType === 'notes' ||
    contentItem.contentType === 'assignment';

  const handleMarkComplete = async () => {
    if (isMarkingComplete) return;
    setIsMarkingComplete(true);
    setIsCompleted(true);
    try {
      await markContentItemCompleted(contentItem.contentId);
      if (onComplete) {
        onComplete(contentItem.contentId);
      }
    } catch (err) {
      console.warn('Failed to persist viewing history completion:', err);
    } finally {
      setIsMarkingComplete(false);
    }
  };

  return (
    <div className="flex flex-col rounded-card border border-line bg-surface shadow-card overflow-hidden">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-field text-white ${
              isVideo ? 'bg-brand' : 'bg-brand-hover'
            }`}
          >
            {isVideo ? <VideoCamera className="h-4 w-4" weight="duotone" /> : <FileText className="h-4 w-4" weight="duotone" />}
          </div>
          <div>
            <span className="text-caption font-bold uppercase tracking-wider text-ink-secondary">
              {contentItem.sectionName || 'Curriculum Module'} · {contentItem.contentType.toUpperCase()}
            </span>
            <h2 className="text-body font-bold text-ink line-clamp-1">{contentItem.title}</h2>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-field border border-line bg-surface px-2.5 py-1.5 text-caption font-semibold text-ink hover:bg-paper"
              title="Open in new tab"
            >
              <ArrowSquareOut className="h-3.5 w-3.5" weight="bold" />
              <span className="hidden sm:inline">Popout</span>
            </a>
          )}
          {signedUrl && isPdfOrNotes && (
            <a
              href={signedUrl}
              download
              className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-field bg-sky-tint px-2.5 py-1.5 text-caption font-semibold text-brand-hover border border-line hover:bg-sky-tint"
            >
              <DownloadSimple className="h-3.5 w-3.5" weight="bold" />
              <span className="hidden sm:inline">Save PDF</span>
            </a>
          )}
          <button
            type="button"
            onClick={handleMarkComplete}
            disabled={isMarkingComplete}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-field px-3 py-1.5 text-caption font-bold transition-colors ${
              isCompleted
                ? 'bg-mint-tint text-mint-ink border border-emerald-200'
                : 'border border-line bg-surface text-ink hover:border-emerald-500 hover:text-emerald-700'
            }`}
          >
            <CheckCircle className="h-3.5 w-3.5" weight="bold" />
            <span>{isCompleted ? 'Completed' : 'Mark Done'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Display Area */}
      <div className="relative min-h-[440px] bg-paper flex items-center justify-center">
        {loadingUrl ? (
          <div className="flex flex-col items-center justify-center text-ink-muted p-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p className="mt-3 text-caption font-medium">Securing document stream...</p>
          </div>
        ) : isVideo ? (
          /* Video Player Container */
          <div className="relative w-full h-[460px] bg-black flex flex-col justify-between">
            {signedUrl ? (
              <video
                ref={videoRef}
                key={signedUrl}
                src={signedUrl}
                controls
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-ink-muted">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-brand mb-3 shadow-card">
                  <Play className="h-8 w-8" weight="fill" />
                </div>
                <h4 className="text-h3 font-semibold text-ink">{contentItem.title}</h4>
                <p className="mt-1 text-caption text-ink-secondary max-w-sm">
                  {urlError || 'Video streaming container ready. File path attached.'}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* PDF / Document Viewer Container */
          <div className="w-full h-[520px] bg-paper flex flex-col">
            {signedUrl ? (
              <iframe
                src={`${signedUrl}#toolbar=1&navpanes=0&scrollbar=1`}
                className="w-full h-full border-0"
                title={contentItem.title}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-card bg-sky-tint text-brand mb-3">
                  <FileText className="h-7 w-7" weight="duotone" />
                </div>
                <h4 className="text-h3 font-bold text-ink">{contentItem.title}</h4>
                <p className="mt-1 text-body text-ink-secondary max-w-md">
                  {contentItem.description || 'Study note / reference material assigned to this batch.'}
                </p>
                <div className="mt-4 flex gap-2">
                  <span className="rounded-field bg-sky-tint px-2.5 py-1 text-caption font-semibold text-brand-hover border border-line">
                    {contentItem.pageCount ? `${contentItem.pageCount} Pages` : 'Document File'}
                  </span>
                  {contentItem.fileSizeBytes && (
                    <span className="rounded-field bg-sky-tint px-2.5 py-1 text-caption font-semibold text-brand-hover border border-line">
                      {(contentItem.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Info & Description Bar with In-Context Doubt CTA */}
      <div className="p-4 bg-surface border-t border-line">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-body font-bold text-ink">{contentItem.title}</h3>
            {contentItem.description && (
              <p className="mt-1 text-caption text-ink-secondary leading-relaxed">{contentItem.description}</p>
            )}
          </div>
          {onAskDoubt && (
            <button
              type="button"
              onClick={() => onAskDoubt(contentItem.contentId, contentItem.title)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-field bg-sand px-4 py-2 text-body font-bold text-sand-ink hover:bg-amber-100 transition-colors border border-amber-200 shadow-xs"
            >
              <Question className="h-4 w-4" weight="bold" />
              <span>Ask Doubt on this Lecture</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
