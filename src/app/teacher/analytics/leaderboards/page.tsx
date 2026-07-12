'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherLeaderboard } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { LeaderboardCard } from '@/components/analytics/LeaderboardCard';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters, LeaderboardEntry, BatchLeaderboardEntry, SubjectLeaderboardEntry, ScoreLeaderboardEntry } from '@/types/analytics-extended';

export default function LeaderboardsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const { data, isLoading } = useTeacherLeaderboard(instituteId, filters);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Leaderboards" description="Top performers, rankings, and consistency scores" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showExport showBatch />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const topStudents = data?.topStudents ?? [];
  const topBatches = data?.topBatches ?? [];
  const topSubjects = data?.topSubjects ?? [];
  const highestScores = data?.highestScores ?? [];
  const mostImproved = data?.mostImproved ?? [];
  const consistencyRanking = data?.consistencyRanking ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboards"
        description="Track top performers, most improved students, and consistency rankings"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} showExport showBatch />

      {/* Top Performer Spotlight */}
      {topStudents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ScoreCard
            title="Top Student"
            score={topStudents[0].value}
            percentage={topStudents[0].value}
            maxScore={100}
            subtitle={topStudents[0].name}
            color="#F59E0B"
            trend="up"
            trendLabel={`${topStudents[0].testsAttempted} tests`}
          />
          <ScoreCard
            title="Most Consistent"
            score={consistencyRanking.length > 0 ? consistencyRanking[0].value : 0}
            percentage={consistencyRanking.length > 0 ? consistencyRanking[0].value : 0}
            maxScore={100}
            subtitle={consistencyRanking.length > 0 ? consistencyRanking[0].name : '—'}
            color="#3B82F6"
            trend="stable"
          />
          <ScoreCard
            title="Most Improved"
            score={mostImproved.length > 0 ? mostImproved[0].value : 0}
            percentage={Math.min(Math.abs(mostImproved.length > 0 ? mostImproved[0].value : 0), 100)}
            subtitle={mostImproved.length > 0 ? mostImproved[0].name : '—'}
            color="#8B5CF6"
            trend="up"
            trendLabel={mostImproved.length > 0 ? `${mostImproved[0].value}${mostImproved[0].unit} improvement` : undefined}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {/* Top Students */}
        <LeaderboardCard
          title="Top Students"
          entries={topStudents.map((s: LeaderboardEntry) => ({
            rank: s.rank,
            id: s.id,
            name: s.name,
            value: s.value,
            unit: s.unit,
            change: s.change,
            metadata: `${s.testsAttempted} tests`,
          }))}
          valueLabel="Avg %"
          emptyMessage="No student data available"
        />

        {/* Top Batches */}
        <LeaderboardCard
          title="Top Batches"
          entries={topBatches.map((b: BatchLeaderboardEntry) => ({
            rank: b.rank,
            id: b.batchId,
            name: b.batchName,
            value: b.averagePercentage,
            unit: '%',
            change: b.change,
            metadata: `${b.studentCount} students · ${b.testsAttempted} tests`,
          }))}
          valueLabel="Avg %"
          emptyMessage="No batch data available"
        />

        {/* Top Subjects */}
        <LeaderboardCard
          title="Top Subjects"
          entries={topSubjects.map((s: SubjectLeaderboardEntry) => ({
            rank: s.rank,
            id: s.subjectId,
            name: s.subjectName,
            value: s.averagePercentage,
            unit: '%',
            metadata: `${s.totalStudents} students · ${s.totalAttempts} attempts`,
          }))}
          valueLabel="Avg %"
          emptyMessage="No subject data available"
        />

        {/* Highest Scores */}
        <LeaderboardCard
          title="Highest Scores"
          entries={highestScores.map((s: ScoreLeaderboardEntry) => ({
            rank: s.rank,
            id: s.studentId,
            name: s.studentName,
            value: s.percentage,
            unit: '%',
            metadata: `${s.score}/${s.maxScore} · ${new Date(s.achievedAt).toLocaleDateString()}`,
          }))}
          valueLabel="Score"
          emptyMessage="No score data available"
        />

        {/* Most Improved */}
        <LeaderboardCard
          title="Most Improved"
          entries={mostImproved.map((s: LeaderboardEntry) => ({
            rank: s.rank,
            id: s.id,
            name: s.name,
            value: s.value,
            unit: s.unit,
            change: s.change,
            changeValue: s.changeValue,
            metadata: `${s.testsAttempted} tests`,
          }))}
          valueLabel="Improvement"
          emptyMessage="Not enough data yet (need 3+ tests)"
        />

        {/* Consistency Ranking */}
        <LeaderboardCard
          title="Consistency Ranking"
          entries={consistencyRanking.map((s: LeaderboardEntry) => ({
            rank: s.rank,
            id: s.id,
            name: s.name,
            value: s.value,
            unit: s.unit,
            metadata: `${s.testsAttempted} tests`,
          }))}
          valueLabel="Score"
          emptyMessage="Not enough data yet (need 3+ tests)"
        />
      </div>
    </div>
  );
}
