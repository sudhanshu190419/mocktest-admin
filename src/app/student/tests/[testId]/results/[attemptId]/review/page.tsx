'use client';

import React, { useEffect, useState, use, useMemo } from 'react';
import Link from 'next/link';
import {
  SpinnerGap,
  WarningCircle,
  ArrowLeft,
} from '@phosphor-icons/react';
import {
  fetchStudentAnswerReview,
  type ReviewSessionData,
  type ReviewQuestionItem,
} from '@/services/student/studentTestResultWebService';
import { ReviewHeader, type ReviewFilterType } from '@/components/student/test-review/ReviewHeader';
import { QuestionNavigator } from '@/components/student/test-review/QuestionNavigator';
import { ReviewQuestionDisplay } from '@/components/student/test-review/ReviewQuestionDisplay';
import { ReviewActions } from '@/components/student/test-review/ReviewActions';

interface ReviewPageProps {
  params: Promise<{ testId: string; attemptId: string }>;
}

export default function StudentAnswerReviewPage({ params }: ReviewPageProps) {
  const unwrappedParams = use(params);
  const { testId, attemptId } = unwrappedParams;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<ReviewSessionData | null>(null);

  // Active review states
  const [activeFilter, setActiveFilter] = useState<ReviewFilterType>('all');
  const [activeSection, setActiveSection] = useState<string>('all');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadReview() {
      setLoading(true);
      setError(null);

      const res = await fetchStudentAnswerReview(testId, attemptId);

      if (!isMounted) return;

      if (!res.success) {
        setError(res.error || 'Failed to load answer review.');
      } else {
        setReviewData(res.data);
        if (res.data.questions.length > 0) {
          setSelectedQuestionId(res.data.questions[0].questionId);
        }
      }

      setLoading(false);
    }

    void loadReview();

    return () => {
      isMounted = false;
    };
  }, [testId, attemptId]);

  // Derived Filtered Questions
  const filteredQuestions = useMemo(() => {
    if (!reviewData) return [];

    return reviewData.questions.filter((q) => {
      // 1. Section match
      if (activeSection !== 'all' && q.sectionName !== activeSection) {
        return false;
      }

      // 2. Status match
      if (activeFilter === 'correct') return q.status === 'correct';
      if (activeFilter === 'incorrect') return q.status === 'incorrect';
      if (activeFilter === 'skipped') return q.status === 'skipped';
      if (activeFilter === 'pending') return q.status === 'pending' || q.status === 'evaluated';

      return true;
    });
  }, [reviewData, activeFilter, activeSection]);

  // Active question resolution
  const activeQuestion = useMemo(() => {
    if (!reviewData || !selectedQuestionId) return reviewData?.questions[0] || null;
    return reviewData.questions.find((q) => q.questionId === selectedQuestionId) || reviewData.questions[0];
  }, [reviewData, selectedQuestionId]);

  const activeIndexInFiltered = useMemo(() => {
    if (!activeQuestion) return 0;
    const idx = filteredQuestions.findIndex((q) => q.questionId === activeQuestion.questionId);
    return idx >= 0 ? idx : 0;
  }, [filteredQuestions, activeQuestion]);

  // Status counts for header tabs
  const counts = useMemo(() => {
    if (!reviewData) return { all: 0, correct: 0, incorrect: 0, skipped: 0, pending: 0 };
    let correct = 0;
    let incorrect = 0;
    let skipped = 0;
    let pending = 0;

    for (const q of reviewData.questions) {
      if (q.status === 'correct') correct++;
      else if (q.status === 'incorrect') incorrect++;
      else if (q.status === 'pending' || q.status === 'evaluated') pending++;
      else skipped++;
    }

    return {
      all: reviewData.questions.length,
      correct,
      incorrect,
      skipped,
      pending,
    };
  }, [reviewData]);

  // Navigation handlers
  const handlePrevious = () => {
    if (activeIndexInFiltered > 0) {
      const prev = filteredQuestions[activeIndexInFiltered - 1];
      if (prev) {
        setSelectedQuestionId(prev.questionId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  const handleNext = () => {
    if (activeIndexInFiltered < filteredQuestions.length - 1) {
      const next = filteredQuestions[activeIndexInFiltered + 1];
      if (next) {
        setSelectedQuestionId(next.questionId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 p-8 bg-white rounded-3xl border border-slate-200 shadow-xl max-w-sm w-full text-center">
          <SpinnerGap size={40} className="animate-spin text-indigo-600" />
          <h3 className="font-bold text-slate-800 text-lg">Loading Solutions</h3>
          <p className="text-xs text-slate-500">Preparing verified question explanations and diagrams...</p>
        </div>
      </div>
    );
  }

  // Error State
  if (error || !reviewData) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 p-8 bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full text-center">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
            <WarningCircle size={40} weight="fill" />
          </div>
          <h3 className="font-bold text-slate-900 text-lg">Unable to Load Review</h3>
          <p className="text-xs text-slate-600 font-medium">{error || 'Review session not available.'}</p>
          <Link
            href={`/student/tests/${testId}/results/${attemptId}`}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors mt-2 shadow-sm"
          >
            <ArrowLeft size={16} weight="bold" />
            <span>Return to Scorecard</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      {/* 1. Header with Filters */}
      <ReviewHeader
        testTitle={reviewData.test.title}
        testId={testId}
        attemptId={attemptId}
        totalScore={reviewData.attempt.totalScore}
        maxScore={reviewData.attempt.maxScore}
        percentage={reviewData.attempt.percentage}
        activeFilter={activeFilter}
        onSelectFilter={(f) => {
          setActiveFilter(f);
        }}
        sections={reviewData.sections}
        activeSection={activeSection}
        onSelectSection={(sec) => {
          setActiveSection(sec);
        }}
        counts={counts}
      />

      {/* 2. Main Body: Split Pane (Questions on Left, Navigator on Right) */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Detailed Question View (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
          {activeQuestion ? (
            <ReviewQuestionDisplay
              question={activeQuestion}
              totalQuestions={reviewData.test.totalQuestions}
              testId={testId}
              testTitle={reviewData.test.title}
            />
          ) : (
            <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 text-slate-500">
              No questions match the selected filter.
            </div>
          )}
        </div>

        {/* Right: Question Navigator Grid (4 cols) */}
        <aside className="hidden lg:block lg:col-span-4 sticky top-32">
          <QuestionNavigator
            questions={filteredQuestions}
            currentIndex={activeIndexInFiltered}
            onSelectQuestion={(idx) => {
              const target = filteredQuestions[idx];
              if (target) {
                setSelectedQuestionId(target.questionId);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          />
        </aside>
      </main>

      {/* 3. Mobile Navigator Matrix (Bottom of page on mobile) */}
      <div className="lg:hidden max-w-7xl w-full mx-auto px-4 pb-6">
        <QuestionNavigator
          questions={filteredQuestions}
          currentIndex={activeIndexInFiltered}
          onSelectQuestion={(idx) => {
            const target = filteredQuestions[idx];
            if (target) {
              setSelectedQuestionId(target.questionId);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
        />
      </div>

      {/* 4. Sticky Bottom Actions */}
      <ReviewActions
        currentIndex={activeIndexInFiltered}
        totalQuestions={filteredQuestions.length}
        onPrevious={handlePrevious}
        onNext={handleNext}
      />
    </div>
  );
}
