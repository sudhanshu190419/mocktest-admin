'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  WarningCircle,
  ShieldWarning,
  ArrowsOut,
  X,
  SquaresFour,
  CheckCircle,
  BookmarkSimple,
} from '@phosphor-icons/react';
import type { TestRunnerSessionData, RunnerQuestion } from '@/services/student/studentTestWebService';
import {
  submitAndEvaluateMockAttempt,
  updateMockAttemptTime,
} from '@/services/student/studentTestWebService';
import { webPersistenceQueue, type SaveStatus } from '@/services/student/webPersistenceQueue';
import { webTimerService } from '@/services/student/webTimerService';
import { Sheet } from '@/components/ui/mmt/Sheet';
import { TestRunnerHeader } from './TestRunnerHeader';
import { SectionTabs, type SectionTabItem } from './SectionTabs';
import { QuestionDisplay } from './QuestionDisplay';
import { QuestionActions } from './QuestionActions';
import { QuestionPalette } from './QuestionPalette';
import { ScientificCalculatorModal } from './ScientificCalculatorModal';
import { SubmitConfirmModal } from './SubmitConfirmModal';
import { QuitConfirmModal } from './QuitConfirmModal';
import { SubmissionOverlay, type SubmissionStage } from './SubmissionOverlay';

interface FullscreenDoc extends Document {
  webkitFullscreenEnabled?: boolean;
  mozFullScreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
}

interface TestRunnerShellProps {
  sessionData: TestRunnerSessionData;
}

export const TestRunnerShell: React.FC<TestRunnerShellProps> = ({ sessionData }) => {
  const router = useRouter();
  const { test, attempt, questions: initialQuestions, restoredState } = sessionData;
  const attemptId = attempt.attemptId;

  // ─── Core State ────────────────────────────────────────────────────────────
  const [questions] = useState<RunnerQuestion[]>(initialQuestions);
  const [currentIndex, setCurrentIndex] = useState<number>(restoredState.lastQuestionIndex || 0);
  const [selectedOptions, setSelectedOptions] = useState<Record<number, string | string[] | null>>(
    restoredState.selectedOptions || {}
  );
  const [markedForReview, setMarkedForReview] = useState<Set<number>>(
    new Set(restoredState.markedForReviewIndices || [])
  );
  const [visitedQuestions, setVisitedQuestions] = useState<Set<number>>(
    new Set(restoredState.visitedIndices || [0])
  );
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());

  // ─── Timer & Connectivity State ────────────────────────────────────────────
  const [remainingSeconds, setRemainingSeconds] = useState<number>(attempt.serverRemainingSeconds);
  const [formattedTime, setFormattedTime] = useState<string>(
    webTimerService.getFormattedTime() || '00:00'
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // ─── Fullscreen & Anti-Distraction Warnings ────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [fullscreenSupported] = useState<boolean>(true);
  const [showFullscreenWarning, setShowFullscreenWarning] = useState<boolean>(false);
  const [tabSwitchCount, setTabSwitchCount] = useState<number>(0);
  const [showTabWarning, setShowTabWarning] = useState<boolean>(false);
  const [multiTabWarning, setMultiTabWarning] = useState<boolean>(false);

  // ─── Modals & Mobile Sheet State ───────────────────────────────────────────
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isMobilePaletteOpen, setIsMobilePaletteOpen] = useState(false);

  const [submissionStage, setSubmissionStage] = useState<SubmissionStage>('idle');
  const [isTimeoutSubmission, setIsTimeoutSubmission] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(attempt.status === 'submitted');

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const isSubmittingRef = useRef<boolean>(false);
  const currentIndexRef = useRef<number>(currentIndex);
  const currentQuestionStartTimeRef = useRef<number>(0);
  const questionTimesRef = useRef<Record<string, number>>(restoredState.accumulatedQuestionTimes || {});

  // Sync ref in effect
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    currentQuestionStartTimeRef.current = Date.now();
  }, []);

  // ─── Time Spent Accumulator ────────────────────────────────────────────────
  const flushCurrentQuestionTime = useCallback(() => {
    const currentQ = questions[currentIndexRef.current];
    if (!currentQ) return;

    const now = Date.now();
    const startTime = currentQuestionStartTimeRef.current || now;
    const elapsed = Math.max(0, Math.floor((now - startTime) / 1000));
    const prev = questionTimesRef.current[currentQ.id] || 0;
    const updated = prev + elapsed;

    questionTimesRef.current[currentQ.id] = updated;
    currentQuestionStartTimeRef.current = now;
  }, [questions]);

  // ─── Single-Flight Submission State Machine ────────────────────────────────
  const executeSubmission = useCallback(
    async (isTimeout: boolean = false) => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;

      setIsTimeoutSubmission(isTimeout);
      setSubmissionStage('draining');
      setSubmissionError(null);

      // 1. Accumulate active question time
      flushCurrentQuestionTime();

      // 2. Drain all pending dirty answers via persistence queue barrier
      try {
        await webPersistenceQueue.drainAllDirtyAnswers(attemptId, 15000);
      } catch (drainErr) {
        console.warn('[TestRunnerShell] Answer drain warning:', drainErr);
      }

      // 3. Stop timer & server heartbeat
      webTimerService.stop();
      void updateMockAttemptTime(attemptId, 0, questions[currentIndexRef.current]?.id);

      // 4. Authoritative Evaluation RPC
      setSubmissionStage('evaluating');
      const timeRemaining = webTimerService.getRemainingSeconds();
      const totalTestSeconds = test.durationMin * 60;
      const timeTakenSeconds = Math.max(0, totalTestSeconds - timeRemaining);

      const result = await submitAndEvaluateMockAttempt(
        attemptId,
        timeTakenSeconds,
        questionTimesRef.current
      );

      if (result.success && result.data) {
        setSubmissionStage('submitted');
        setIsSubmitted(true);
      } else {
        setSubmissionStage('error');
        setSubmissionError(result.error || 'Failed to evaluate test. Please retry.');
        isSubmittingRef.current = false;
      }
    },
    [attemptId, flushCurrentQuestionTime, questions, test.durationMin]
  );

  // ─── 1. Initialize Authoritative Timer ─────────────────────────────────────
  useEffect(() => {
    if (isSubmitted) return;

    webTimerService.start({
      attemptId,
      initialRemainingSeconds: attempt.serverRemainingSeconds,
      syncIntervalMs: 60_000,
      getCurrentQuestionId: () => questions[currentIndexRef.current]?.id,
      onTick: (remaining, formatted) => {
        setRemainingSeconds(remaining);
        setFormattedTime(formatted);
      },
      onTimeUp: () => {
        console.log('[TestRunnerShell] Authoritative countdown expired. Executing auto-submit.');
        void executeSubmission(true);
      },
      onServerSync: async (id, timeRemaining, lastQuestionId) => {
        const res = await updateMockAttemptTime(id, timeRemaining, lastQuestionId);
        return res.success;
      },
      onSyncStatusChange: (status) => {
        if (status === 'failed') setSaveStatus('failed');
      },
    });

    const unsubscribeQueue = webPersistenceQueue.subscribeSaveStatus((status) => {
      setSaveStatus(status);
    });

    return () => {
      webTimerService.dispose();
      unsubscribeQueue();
    };
  }, [attempt.serverRemainingSeconds, attemptId, executeSubmission, isSubmitted, questions]);

  // ─── 2. Browser Navigation & Refresh Protection (beforeunload) ─────────────
  useEffect(() => {
    if (isSubmitted) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      void webPersistenceQueue.flushBatch(attemptId);
      void webTimerService.syncWithServer();

      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [attemptId, isSubmitted]);

  // ─── 3. Browser Visibility & Background-Tab Lifecycle ──────────────────────
  useEffect(() => {
    if (isSubmitted) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setTabSwitchCount((prev) => prev + 1);
        setShowTabWarning(true);

        void webPersistenceQueue.flushBatch(attemptId);
        void webTimerService.syncWithServer();
      } else if (document.visibilityState === 'visible') {
        if (webTimerService.getRemainingSeconds() <= 0) {
          void executeSubmission(true);
        }
      }
    };

    const handlePageHide = () => {
      void webPersistenceQueue.flushBatch(attemptId);
      void webTimerService.syncWithServer();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [attemptId, executeSubmission, isSubmitted]);

  // ─── 4. Online / Offline Connectivity Detection ────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void webPersistenceQueue.flushBatch(attemptId);
      void webTimerService.syncWithServer();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [attemptId]);

  // ─── 5. Fullscreen Management & Exit Detection ─────────────────────────────
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFullscreenChange = () => {
      const inFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(inFullscreen);
      if (!inFullscreen && !isSubmitted && !isSubmittingRef.current) {
        setShowFullscreenWarning(true);
      } else {
        setShowFullscreenWarning(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isSubmitted]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const doc = document as FullscreenDoc;
      const docEl = document.documentElement as FullscreenElement;
      if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
        setIsFullscreen(true);
        setShowFullscreenWarning(false);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn('[TestRunnerShell] Fullscreen toggle error:', err);
    }
  }, []);

  // ─── 6. Multi-Tab Conflict Warning (BroadcastChannel) ──────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !window.BroadcastChannel) return;

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(`exam_session_${attemptId}`);
      channel.postMessage({ type: 'SESSION_ACTIVE', timestamp: Date.now() });

      channel.onmessage = (event) => {
        if (event.data?.type === 'SESSION_ACTIVE') {
          setMultiTabWarning(true);
        }
      };
    } catch (e) {
      console.warn('[TestRunnerShell] BroadcastChannel init error:', e);
    }

    return () => {
      channel?.close();
    };
  }, [attemptId]);

  // ─── Answer Option Handlers ────────────────────────────────────────────────
  const markVisited = useCallback((index: number) => {
    setVisitedQuestions((prev) => {
      if (prev.has(index)) return prev;
      const updated = new Set(prev);
      updated.add(index);
      return updated;
    });
  }, []);

  const handleOptionChange = useCallback(
    (value: string | string[] | null) => {
      if (isSubmitted) return;

      setSelectedOptions((prev) => ({
        ...prev,
        [currentIndex]: value,
      }));
      markVisited(currentIndex);

      const q = questions[currentIndex];
      if (q) {
        const timeSpent = questionTimesRef.current[q.id] || 0;
        webPersistenceQueue.enqueueAnswer(
          {
            questionId: q.id,
            answerId: q.answerId,
            questionType: q.questionType,
            value,
            isMarkedForReview: markedForReview.has(currentIndex),
            timeSpentSeconds: timeSpent,
          },
          attemptId
        );
      }
    },
    [isSubmitted, currentIndex, markVisited, questions, attemptId, markedForReview]
  );

  const handleClear = useCallback(() => {
    if (isSubmitted) return;
    handleOptionChange(null);
  }, [isSubmitted, handleOptionChange]);

  // NTA Action: Mark for Review & Next
  const handleMarkForReviewAndNext = useCallback(() => {
    if (isSubmitted) return;

    setMarkedForReview((prev) => {
      const updated = new Set(prev);
      updated.add(currentIndex);

      const q = questions[currentIndex];
      if (q) {
        const timeSpent = questionTimesRef.current[q.id] || 0;
        webPersistenceQueue.enqueueAnswer(
          {
            questionId: q.id,
            answerId: q.answerId,
            questionType: q.questionType,
            value: selectedOptions[currentIndex] ?? null,
            isMarkedForReview: true,
            timeSpentSeconds: timeSpent,
          },
          attemptId
        );
      }

      return updated;
    });

    flushCurrentQuestionTime();
    void webPersistenceQueue.flushBatch(attemptId);

    if (currentIndex < questions.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      markVisited(nextIdx);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setShowSubmitModal(true);
    }
  }, [
    isSubmitted,
    currentIndex,
    questions,
    selectedOptions,
    attemptId,
    flushCurrentQuestionTime,
    markVisited,
  ]);

  const handleToggleBookmark = useCallback(() => {
    setBookmarks((prev) => {
      const updated = new Set(prev);
      if (updated.has(currentIndex)) {
        updated.delete(currentIndex);
      } else {
        updated.add(currentIndex);
      }
      return updated;
    });
  }, [currentIndex]);

  // ─── Navigation Handlers ───────────────────────────────────────────────────
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      flushCurrentQuestionTime();
      void webPersistenceQueue.flushBatch(attemptId);
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      markVisited(prevIdx);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentIndex, flushCurrentQuestionTime, attemptId, markVisited]);

  const handleSaveAndNext = useCallback(() => {
    if (isSubmitted) return;
    flushCurrentQuestionTime();
    void webPersistenceQueue.flushBatch(attemptId);

    if (currentIndex < questions.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      markVisited(nextIdx);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setShowSubmitModal(true);
    }
  }, [isSubmitted, flushCurrentQuestionTime, attemptId, currentIndex, questions.length, markVisited]);

  const handleJumpQuestion = useCallback(
    (index: number) => {
      if (index === currentIndex) return;
      flushCurrentQuestionTime();
      void webPersistenceQueue.flushBatch(attemptId);

      setCurrentIndex(index);
      markVisited(index);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [currentIndex, flushCurrentQuestionTime, attemptId, markVisited]
  );

  // ─── Keyboard Navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSaveAndNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevious, handleSaveAndNext]);

  // ─── Derived Section Tab Items ─────────────────────────────────────────────
  const currentQuestion = questions[currentIndex];
  const activeSection = currentQuestion?.sectionName || currentQuestion?.subjectName || 'General';

  const sectionTabs: SectionTabItem[] = useMemo(() => {
    const map = new Map<string, { count: number; answered: number; startIndex: number }>();
    questions.forEach((q, idx) => {
      const sec = q.sectionName || q.subjectName || 'General';
      const existing = map.get(sec);
      const isAns =
        selectedOptions[idx] !== null &&
        selectedOptions[idx] !== undefined &&
        (typeof selectedOptions[idx] !== 'string' || selectedOptions[idx] !== '') &&
        (!Array.isArray(selectedOptions[idx]) || (selectedOptions[idx] as string[]).length > 0);

      if (!existing) {
        map.set(sec, { count: 1, answered: isAns ? 1 : 0, startIndex: idx });
      } else {
        existing.count += 1;
        if (isAns) existing.answered += 1;
      }
    });

    return Array.from(map.entries()).map(([name, data]) => ({
      name,
      questionCount: data.count,
      answeredCount: data.answered,
      startIndex: data.startIndex,
    }));
  }, [questions, selectedOptions]);

  // ─── Metric Calculations for Submission ────────────────────────────────────
  const answeredCount = useMemo(() => {
    let count = 0;
    for (const [, val] of Object.entries(selectedOptions)) {
      if (
        val !== null &&
        val !== undefined &&
        (typeof val !== 'string' || val !== '') &&
        (!Array.isArray(val) || val.length > 0)
      ) {
        count++;
      }
    }
    return count;
  }, [selectedOptions]);

  const markedCount = markedForReview.size;
  const unansweredCount = questions.length - answeredCount;
  const notVisitedCount = questions.length - visitedQuestions.size;

  const handleConfirmSubmit = () => {
    setShowSubmitModal(false);
    void executeSubmission(false);
  };

  return (
    <div
      className="min-h-screen bg-paper flex flex-col font-sans select-none print:hidden"
      onContextMenu={(e) => {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
        }
      }}
    >
      {/* 1. Top Bar Header */}
      <TestRunnerHeader
        title={test.title}
        testType={test.testType}
        remainingSeconds={remainingSeconds}
        formattedTime={formattedTime}
        saveStatus={saveStatus}
        isOnline={isOnline}
        isFullscreen={isFullscreen}
        fullscreenSupported={fullscreenSupported}
        calculatorAllowed={test.calculatorAllowed}
        isSubmitting={submissionStage !== 'idle' && submissionStage !== 'error'}
        onToggleFullscreen={toggleFullscreen}
        onOpenCalculator={() => setIsCalculatorOpen(true)}
        onExit={() => setShowQuitModal(true)}
        onSubmit={() => setShowSubmitModal(true)}
      />

      {/* 2. Soft Warning Banners (Tab Switch, Fullscreen Exit, Multi-Tab) */}
      {showFullscreenWarning && !isSubmitted && (
        <div className="bg-amber-500/20 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between text-caption text-amber-900 font-medium">
          <div className="flex items-center gap-2">
            <WarningCircle size={16} weight="fill" className="text-amber-600" />
            <span>Fullscreen was exited. For an optimal testing experience, please remain in fullscreen.</span>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center gap-1 text-brand hover:text-brand-hover font-bold underline cursor-pointer"
          >
            <ArrowsOut size={14} weight="bold" />
            <span>Re-enter Fullscreen</span>
          </button>
        </div>
      )}

      {showTabWarning && !isSubmitted && (
        <div className="bg-sky-tint border-b border-line px-4 py-2 flex items-center justify-between text-caption text-ink font-medium">
          <div className="flex items-center gap-2">
            <ShieldWarning size={16} weight="fill" className="text-brand" />
            <span>
              Tab switch detected ({tabSwitchCount} {tabSwitchCount === 1 ? 'time' : 'times'}). Your exam progress was synced securely.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowTabWarning(false)}
            className="text-ink-secondary hover:text-ink cursor-pointer"
            aria-label="Dismiss tab warning"
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      )}

      {multiTabWarning && !isSubmitted && (
        <div className="bg-red-500/20 border-b border-red-500/40 px-4 py-2 flex items-center justify-between text-caption text-red-900 font-medium">
          <div className="flex items-center gap-2">
            <WarningCircle size={16} weight="fill" className="text-red-600" />
            <span>Multiple tabs detected for this test attempt. Please keep only one tab open to avoid conflicts.</span>
          </div>
          <button
            type="button"
            onClick={() => setMultiTabWarning(false)}
            className="text-ink-secondary hover:text-ink cursor-pointer"
            aria-label="Dismiss multi-tab warning"
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      )}

      {/* 3. Section Navigation Tabs */}
      <SectionTabs
        sections={sectionTabs}
        activeSection={activeSection}
        onSelectSection={(_name, startIdx) => handleJumpQuestion(startIdx)}
      />

      {/* 4. Mobile Palette Quick-Trigger Bar (<1024px) */}
      <div className="lg:hidden bg-white border-b border-line px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3 text-caption">
          <div className="flex items-center gap-1 text-mint-ink font-semibold">
            <CheckCircle size={14} weight="fill" className="text-emerald-600" />
            <span>{answeredCount} Ans</span>
          </div>
          <div className="flex items-center gap-1 text-lilac-ink font-semibold">
            <BookmarkSimple size={14} weight="fill" className="text-purple-600" />
            <span>{markedCount} Marked</span>
          </div>
          <div className="flex items-center gap-1 text-ink-secondary">
            <span>{unansweredCount} Left</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsMobilePaletteOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-paper hover:bg-sky-tint text-ink rounded-field text-caption font-bold border border-line cursor-pointer transition-colors"
        >
          <SquaresFour size={16} weight="bold" className="text-brand" />
          <span>Palette</span>
        </button>
      </div>

      {/* 5. Main Workspace: Question Area + Desktop Palette */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Question Card (Canvas Primary) */}
        <div className="lg:col-span-8 flex flex-col gap-4 min-w-0">
          {currentQuestion ? (
            <QuestionDisplay
              question={currentQuestion}
              totalQuestions={questions.length}
              selectedOption={selectedOptions[currentIndex] ?? null}
              onOptionChange={handleOptionChange}
              isBookmarked={bookmarks.has(currentIndex)}
              onToggleBookmark={handleToggleBookmark}
            />
          ) : (
            <div className="p-12 text-center bg-white rounded-card border border-line text-ink-secondary">
              No questions found for this test session.
            </div>
          )}
        </div>

        {/* Right 4 Columns: Desktop Question Palette (>=1024px) */}
        <aside className="hidden lg:block lg:col-span-4 sticky top-24">
          <QuestionPalette
            questions={questions}
            currentIndex={currentIndex}
            selectedOptions={selectedOptions}
            markedForReview={markedForReview}
            visitedQuestions={visitedQuestions}
            onSelectQuestion={handleJumpQuestion}
          />
        </aside>
      </main>

      {/* 6. Mobile Question Palette in Interactive Bottom Sheet (<1024px) */}
      <Sheet
        open={isMobilePaletteOpen}
        onClose={() => setIsMobilePaletteOpen(false)}
        title={`Question Palette (${answeredCount}/${questions.length} answered)`}
      >
        <div className="py-2">
          <QuestionPalette
            questions={questions}
            currentIndex={currentIndex}
            selectedOptions={selectedOptions}
            markedForReview={markedForReview}
            visitedQuestions={visitedQuestions}
            onSelectQuestion={(index) => {
              handleJumpQuestion(index);
              setIsMobilePaletteOpen(false);
            }}
          />
        </div>
      </Sheet>

      {/* 7. Sticky Bottom Action Bar */}
      <QuestionActions
        currentIndex={currentIndex}
        totalQuestions={questions.length}
        isMarkedForReview={markedForReview.has(currentIndex)}
        onClear={handleClear}
        onToggleReview={handleMarkForReviewAndNext}
        onPrevious={handlePrevious}
        onSaveAndNext={handleSaveAndNext}
        disabled={isSubmitted || submissionStage !== 'idle'}
      />

      {/* 8. Modals & Overlays */}
      <ScientificCalculatorModal
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
      />

      <SubmitConfirmModal
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onConfirm={handleConfirmSubmit}
        totalQuestions={questions.length}
        answeredCount={answeredCount}
        markedCount={markedCount}
        unansweredCount={unansweredCount}
        notVisitedCount={notVisitedCount}
      />

      <QuitConfirmModal
        isOpen={showQuitModal}
        onClose={() => setShowQuitModal(false)}
        onConfirm={() => {
          setShowQuitModal(false);
          router.push('/student/tests');
        }}
      />

      <SubmissionOverlay
        stage={submissionStage}
        isTimeout={isTimeoutSubmission}
        errorMessage={submissionError}
        onRetry={() => void executeSubmission(isTimeoutSubmission)}
        onGoToResults={() => router.push(`/student/tests/${test.testId}/results/${attemptId}`)}
      />
    </div>
  );
};
