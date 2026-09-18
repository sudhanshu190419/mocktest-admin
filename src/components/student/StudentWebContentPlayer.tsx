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
  Sparkle,
  BookOpen,
  ArrowRight,
  Play,
  ArrowClockwise,
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
      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
      : mockTestItem.status === 'upcoming'
      ? 'bg-amber-100 text-amber-800 border border-amber-200'
      : 'bg-slate-100 text-slate-600';

    if (attempt) {
      if (attempt.attemptState === 'in_progress') {
        statusBadgeText = '● In Progress (Resume)';
        statusBadgeClass = 'bg-sky-100 text-sky-800 border border-sky-200';
      } else if (attempt.attemptState === 'limit_reached') {
        statusBadgeText = 'Attempts Exhausted';
        statusBadgeClass = 'bg-slate-100 text-slate-600 border border-slate-200';
      } else if (attempt.attemptState === 'submitted') {
        statusBadgeText = '● Attempted / Submitted';
        statusBadgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      }
    }

    const actionLabel = attempt?.actionLabel || 'Start Test Assessment';
    const actionHref = attempt?.actionHref || '/student/tests';
    const canAttempt = attempt ? attempt.canAttempt : isAvailable;

    return (
      <div className="flex flex-col rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/40 via-white to-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Exam className="h-5 w-5" />
            </div>
            <div>
              <span className="inline-flex rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800">
                Assigned Mock Assessment
              </span>
              <h2 className="text-xl font-bold text-slate-900 mt-1">{mockTestItem.title}</h2>
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass}`}>
            {statusBadgeText}
          </span>
        </div>

        {mockTestItem.description && (
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">{mockTestItem.description}</p>
        )}

        {/* Real Test Spec Grid */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
            <Clock className="h-4 w-4 text-slate-400 mx-auto" />
            <p className="mt-1 text-xs text-slate-500 font-medium">Duration</p>
            <p className="text-base font-bold text-slate-900">
              {mockTestItem.durationMin !== null ? `${mockTestItem.durationMin} mins` : 'Flexible'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
            <Exam className="h-4 w-4 text-indigo-500 mx-auto" />
            <p className="mt-1 text-xs text-slate-500 font-medium">Total Marks</p>
            <p className="text-base font-bold text-slate-900">
              {mockTestItem.totalMarks !== null ? mockTestItem.totalMarks : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
            <BookOpen className="h-4 w-4 text-sky-500 mx-auto" />
            <p className="mt-1 text-xs text-slate-500 font-medium">Questions</p>
            <p className="text-base font-bold text-slate-900">
              {mockTestItem.questionCount > 0 ? `${mockTestItem.questionCount} Q` : 'Configured'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
            <WarningCircle className="h-4 w-4 text-amber-500 mx-auto" />
            <p className="mt-1 text-xs text-slate-500 font-medium">Negative Mark</p>
            <p className="text-base font-bold text-slate-900">
              {mockTestItem.negativeMarking ? `-${mockTestItem.negativeMarking}` : 'None'}
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <span className="text-xs text-slate-500">
            {mockTestItem.attemptLimit
              ? `Attempt Limit: ${mockTestItem.attemptLimit} times${
                  attempt?.attemptsUsed ? ` (${attempt.attemptsUsed} used)` : ''
                }`
              : 'Unlimited Practice Attempts'}
          </span>
          {canAttempt ? (
            <a
              href={actionHref}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-md hover:bg-indigo-700 active:scale-[0.98] transition-all"
            >
              {actionLabel}
              <ArrowRight className="h-4 w-4" />
            </a>
          ) : (
            <a
              href="/student/tests"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-200 px-6 py-3 text-sm font-bold text-slate-600 shadow-none hover:bg-slate-300 transition-all"
            >
              {actionLabel}
              <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // 2. Empty / Nothing Selected State
  if (!contentItem) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
          <BookOpen className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-base font-bold text-slate-800">Select a Topic from the Curriculum</h3>
        <p className="mt-1.5 max-w-sm text-xs text-slate-500 leading-relaxed">
          Choose any video lecture, revision note, or formula PDF on the left to start reading or streaming your coursework.
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
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${
              isVideo ? 'bg-purple-600' : 'bg-sky-600'
            }`}
          >
            {isVideo ? <VideoCamera className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {contentItem.sectionName || 'Curriculum Module'} · {contentItem.contentType.toUpperCase()}
            </span>
            <h2 className="text-sm font-bold text-slate-900 line-clamp-1">{contentItem.title}</h2>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Open in new tab"
            >
              <ArrowSquareOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Popout</span>
            </a>
          )}
          {signedUrl && isPdfOrNotes && (
            <a
              href={signedUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 border border-sky-200 hover:bg-sky-100"
            >
              <DownloadSimple className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Save PDF</span>
            </a>
          )}
          <button
            onClick={handleMarkComplete}
            disabled={isMarkingComplete}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              isCompleted
                ? 'bg-emerald-600 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700'
            }`}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            {isCompleted ? 'Completed' : 'Mark Done'}
          </button>
        </div>
      </div>

      {/* Main Content Display Area */}
      <div className="relative min-h-[440px] bg-slate-900 flex items-center justify-center">
        {loadingUrl ? (
          <div className="flex flex-col items-center justify-center text-slate-400 p-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <p className="mt-3 text-xs font-medium">Securing document stream...</p>
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
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-purple-400 mb-3">
                  <Play className="h-8 w-8" />
                </div>
                <h4 className="text-base font-semibold text-white">{contentItem.title}</h4>
                <p className="mt-1 text-xs text-slate-400 max-w-sm">
                  {urlError || 'Video streaming container ready. File path attached.'}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* PDF / Document Viewer Container */
          <div className="w-full h-[520px] bg-slate-100 flex flex-col">
            {signedUrl ? (
              <iframe
                src={`${signedUrl}#toolbar=1&navpanes=0&scrollbar=1`}
                className="w-full h-full border-0"
                title={contentItem.title}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-600 mb-3">
                  <FileText className="h-7 w-7" />
                </div>
                <h4 className="text-base font-bold text-slate-900">{contentItem.title}</h4>
                <p className="mt-1 text-xs text-slate-500 max-w-md">
                  {contentItem.description || 'Study note / reference material assigned to this batch.'}
                </p>
                <div className="mt-4 flex gap-2">
                  <span className="rounded-md bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {contentItem.pageCount ? `${contentItem.pageCount} Pages` : 'Document File'}
                  </span>
                  {contentItem.fileSizeBytes && (
                    <span className="rounded-md bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {(contentItem.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Info & Description Bar */}
      <div className="p-4 bg-white border-t border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{contentItem.title}</h3>
            {contentItem.description && (
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">{contentItem.description}</p>
            )}
          </div>
          {onAskDoubt && (
            <button
              onClick={() => onAskDoubt(contentItem.contentId, contentItem.title)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 transition-colors"
            >
              <Question className="h-3.5 w-3.5" />
              Ask Doubt on this Lecture
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
