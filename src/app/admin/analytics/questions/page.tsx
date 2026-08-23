'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherQuestionAnalytics } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { BarChart } from '@/components/analytics/BarChart';
import { PieChart } from '@/components/analytics/PieChart';
import { ProgressRing } from '@/components/analytics/ProgressRing';
import { LeaderboardCard } from '@/components/analytics/LeaderboardCard';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { formatDuration } from '@/utils/mockResults';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters, QuestionAnalyticsItem, DifficultyBreakdownItem, QuestionTypeDistributionItem } from '@/types/analytics-extended';

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#6366F1'];

export default function QuestionAnalyticsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const { data, isLoading } = useTeacherQuestionAnalytics(instituteId, filters);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Question Analytics" description="Analyze question-level performance across all tests" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showDifficulty showSubject showMockTest showExport />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const stats = data?.overallStats;
  const missed = data?.mostMissedQuestions ?? [];
  const solved = data?.mostSolvedQuestions ?? [];
  const skipped = data?.mostSkippedQuestions ?? [];
  const longest = data?.longestTimeQuestions ?? [];
  const difficultyBreakdown = data?.difficultyBreakdown ?? [];
  const typeDist = data?.questionTypeDistribution ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Question Analytics"
        description="Analyze question-level performance, difficulty, and student responses"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} showDifficulty showSubject showMockTest showExport />

      {/* Overall Stats */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Questions" value={stats.totalQuestions} color="blue" />
          <MetricCard label="Total Attempts" value={stats.totalAttempts} color="purple" />
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
            <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500">Overall Accuracy</p>
            <ProgressRing
              percentage={stats.overallAccuracy ?? 0}
              size={72}
              color={(stats.overallAccuracy ?? 0) >= 60 ? '#10B981' : (stats.overallAccuracy ?? 0) >= 40 ? '#F59E0B' : '#EF4444'}
              label="accuracy"
            />
          </div>
          <ScoreCard
            title="Avg Time"
            score={formatDuration(stats.averageTimeSeconds)}
            color="#6366F1"
            size="sm"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Difficulty Breakdown */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Difficulty Breakdown</h3>
          <BarChart
            data={difficultyBreakdown.map((d: DifficultyBreakdownItem) => ({
              label: d.difficulty.charAt(0).toUpperCase() + d.difficulty.slice(1),
              value: d.accuracy ?? 0,
              color: d.difficulty === 'easy' ? '#10B981' : d.difficulty === 'medium' ? '#F59E0B' : '#EF4444',
            }))}
            height={160}
          />
          <div className="mt-3 grid grid-cols-3 gap-4">
            {difficultyBreakdown.map((d: DifficultyBreakdownItem) => (
              <div key={d.difficulty} className="text-center">
                <p className="text-xs text-gray-500 capitalize">{d.difficulty}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{d.totalQuestions}</p>
                <p className="text-[10px] text-gray-400">{d.totalAttempts} attempts</p>
              </div>
            ))}
          </div>
        </div>

        {/* Question Type Distribution */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Question Type Distribution</h3>
          <PieChart
            data={typeDist.map((t: QuestionTypeDistributionItem, i: number) => ({
              label: t.questionType.toUpperCase(),
              value: t.count,
              color: PIE_COLORS[i % PIE_COLORS.length],
            }))}
            size={180}
            innerRadius={45}
          />
        </div>
      </div>

      {/* Question Rankings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <LeaderboardCard
          title="Most Missed Questions"
          entries={missed.map((q: QuestionAnalyticsItem, i: number) => ({
            rank: i + 1,
            id: q.questionId,
            name: q.questionText.length > 30 ? q.questionText.slice(0, 30) + '…' : q.questionText,
            value: q.accuracy ?? 0,
            unit: '%',
            metadata: `${q.correctCount}/${q.totalAttempts} correct · ${q.difficulty}`,
          }))}
          valueLabel="Accuracy"
          emptyMessage="No question data available"
        />

        <LeaderboardCard
          title="Most Solved Questions"
          entries={solved.map((q: QuestionAnalyticsItem, i: number) => ({
            rank: i + 1,
            id: q.questionId,
            name: q.questionText.length > 30 ? q.questionText.slice(0, 30) + '…' : q.questionText,
            value: q.accuracy ?? 0,
            unit: '%',
            metadata: `${q.correctCount}/${q.totalAttempts} correct`,
          }))}
          valueLabel="Accuracy"
          emptyMessage="No question data available"
        />

        <LeaderboardCard
          title="Most Skipped Questions"
          entries={skipped.map((q: QuestionAnalyticsItem, i: number) => ({
            rank: i + 1,
            id: q.questionId,
            name: q.questionText.length > 30 ? q.questionText.slice(0, 30) + '…' : q.questionText,
            value: q.skippedCount,
            unit: '',
            metadata: `${(q.skippedCount / Math.max(q.totalAttempts, 1) * 100).toFixed(0)}% skipped`,
          }))}
          valueLabel="Skipped"
          emptyMessage="No question data available"
        />

        <LeaderboardCard
          title="Longest Time Taken"
          entries={longest.map((q: QuestionAnalyticsItem, i: number) => ({
            rank: i + 1,
            id: q.questionId,
            name: q.questionText.length > 30 ? q.questionText.slice(0, 30) + '…' : q.questionText,
            value: roundToTime(q.averageTimeSeconds),
            unit: 's',
            metadata: `${q.difficulty} · ${q.totalAttempts} attempts`,
          }))}
          valueLabel="Avg Time"
          emptyMessage="No question data available"
        />
      </div>
    </div>
  );
}

function roundToTime(seconds: number): number {
  return Math.round(seconds);
}
