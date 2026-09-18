'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  SpinnerGap,
  WarningCircle,
  ArrowLeft,
} from '@phosphor-icons/react';
import {
  fetchStudentTestResult,
  type StudentTestResultData,
} from '@/services/student/studentTestResultWebService';
import { ResultHero } from '@/components/student/test-results/ResultHero';
import { ScoreSummaryCards } from '@/components/student/test-results/ScoreSummaryCards';
import { SubjectBreakdown } from '@/components/student/test-results/SubjectBreakdown';
import { TimeAnalysis } from '@/components/student/test-results/TimeAnalysis';
import { PerformanceInsights } from '@/components/student/test-results/PerformanceInsights';
import { ResultReleaseBanner } from '@/components/student/test-results/ResultReleaseBanner';
import { ResultActions } from '@/components/student/test-results/ResultActions';

interface ResultsPageProps {
  params: Promise<{ testId: string; attemptId: string }>;
}

export default function StudentTestResultsPage({ params }: ResultsPageProps) {
  const unwrappedParams = use(params);
  const { testId, attemptId } = unwrappedParams;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReleased, setIsReleased] = useState<boolean>(true);
  const [resultData, setResultData] = useState<StudentTestResultData | null>(null);
  const [unreleasedMeta, setUnreleasedMeta] = useState<{ testTitle: string; attemptedAt: string; releasedAt?: string | null } | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadResult() {
      setLoading(true);
      setError(null);

      const res = await fetchStudentTestResult(testId, attemptId);

      if (!isMounted) return;

      if (!res.success) {
        setError(res.error || 'Failed to load test result.');
      } else if (!res.isReleased) {
        setIsReleased(false);
        setUnreleasedMeta({
          testTitle: res.data.testTitle || 'Mock Test',
          attemptedAt: res.data.attemptedAt || new Date().toISOString(),
          releasedAt: res.data.releasedAt,
        });
      } else {
        setIsReleased(true);
        setResultData(res.data);
      }

      setLoading(false);
    }

    void loadResult();

    return () => {
      isMounted = false;
    };
  }, [testId, attemptId]);

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 p-8 bg-white rounded-3xl border border-slate-200 shadow-xl max-w-sm w-full text-center">
          <SpinnerGap size={40} className="animate-spin text-indigo-600" />
          <h3 className="font-bold text-slate-800 text-lg">Retrieving Scorecard</h3>
          <p className="text-xs text-slate-500">Loading authoritative test results and section analytics...</p>
        </div>
      </div>
    );
  }

  // Error State
  if (error || (!resultData && isReleased)) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 p-8 bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full text-center">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
            <WarningCircle size={40} weight="fill" />
          </div>
          <h3 className="font-bold text-slate-900 text-lg">Unable to Display Results</h3>
          <p className="text-xs text-slate-600 font-medium">{error || 'Result record not found.'}</p>
          <Link
            href="/student/tests"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors mt-2 shadow-sm"
          >
            <ArrowLeft size={16} weight="bold" />
            <span>Return to Test Hub</span>
          </Link>
        </div>
      </div>
    );
  }

  // Unreleased Result Banner
  if (!isReleased && unreleasedMeta) {
    return (
      <div className="min-h-screen bg-slate-100 p-4 sm:p-6 lg:p-8 flex flex-col justify-center">
        <ResultReleaseBanner
          testTitle={unreleasedMeta.testTitle}
          releasedAt={unreleasedMeta.releasedAt}
        />
      </div>
    );
  }

  if (!resultData) return null;

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        {/* 1. Result Hero */}
        <ResultHero
          testTitle={resultData.testTitle}
          testType={resultData.testType}
          attemptNumber={resultData.attemptNumber}
          attemptedAt={resultData.attemptedAt}
          totalScore={resultData.totalScore}
          maxScore={resultData.maxScore}
          percentage={resultData.percentage}
          passingMarks={resultData.passingMarks}
          isPassed={resultData.isPassed}
          rank={resultData.rank}
          percentile={resultData.percentile}
        />

        {/* 2. Top Metric Cards */}
        <ScoreSummaryCards
          correctCount={resultData.correctCount}
          incorrectCount={resultData.incorrectCount}
          skippedCount={resultData.skippedCount}
          accuracy={resultData.accuracy}
          accuracyInsight={resultData.accuracyInsight}
          totalTimeSeconds={resultData.totalTimeSeconds}
          durationMin={resultData.durationMin}
        />

        {/* 3. Section Breakdown */}
        {resultData.subjectBreakdown && resultData.subjectBreakdown.length > 0 && (
          <SubjectBreakdown sections={resultData.subjectBreakdown} />
        )}

        {/* 4. Time Analysis & Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TimeAnalysis
            totalTimeSeconds={resultData.totalTimeSeconds}
            durationMin={resultData.durationMin}
            avgTimePerQuestion={resultData.avgTimePerQuestion}
            totalQuestions={resultData.totalQuestions}
          />

          <PerformanceInsights
            accuracy={resultData.accuracy}
            accuracyInsight={resultData.accuracyInsight}
            sections={resultData.subjectBreakdown}
            incorrectCount={resultData.incorrectCount}
            skippedCount={resultData.skippedCount}
          />
        </div>

        {/* 5. Primary Actions */}
        <ResultActions
          testId={testId}
          attemptId={attemptId}
          canRetake={resultData.canRetake}
        />
      </div>
    </div>
  );
}
