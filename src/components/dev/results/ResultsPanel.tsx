'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useResults,
  useMockResult,
  useStudentResults,
  useMockTestResults,
  useInstituteResults,
  useReleaseResult,
  useHideResult,
  useDeleteResult,
} from '@/hooks/mockTest/useMockResults';
import { useAuth } from '@/hooks/useAuth';
import type { MockResult, MockResultFilters, MockResultSortOptions } from '@/types/mockTest';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface ResultsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface ResultsPanelProps {
  onDebugInfo?: (info: ResultsDebugInfo) => void;
}

type ResultsViewMode = 'all' | 'student' | 'test' | 'institute';

const SORT_FIELDS = [
  { value: 'generatedAt', label: 'Latest' },
  { value: 'totalScore', label: 'Highest Score' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'rank', label: 'Rank' },
  { value: 'correctCount', label: 'Correct Count' },
  { value: 'totalTimeSeconds', label: 'Total Time' },
  { value: 'releasedAt', label: 'Released At' },
] as const;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function ResultsPanel({ onDebugInfo }: ResultsPanelProps) {
  const { user } = useAuth();

  // ── View mode ────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ResultsViewMode>('all');
  const [studentId, setStudentId] = useState('');
  const [testId, setTestId] = useState('');
  const [instituteId, setInstituteId] = useState(user?.instituteId ?? '');

  // ── Filter/Pagination/Sort state ──────────────────────────────────────
  const [searchAttemptId, setSearchAttemptId] = useState('');
  const [searchResultId, setSearchResultId] = useState('');
  const [filterReleased, setFilterReleased] = useState('');
  const [filterMinScore, setFilterMinScore] = useState('');
  const [filterMaxScore, setFilterMaxScore] = useState('');
  const [filterMinPercentage, setFilterMinPercentage] = useState('');
  const [filterMaxPercentage, setFilterMaxPercentage] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filters, setFilters] = useState<MockResultFilters>({});
  const [sortField, setSortField] = useState<string>('generatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // ── Detail state ─────────────────────────────────────────────────────
  const [detailResultId, setDetailResultId] = useState<string | null>(null);

  // ── Operation feedback ───────────────────────────────────────────────
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  // ── Debug state ──────────────────────────────────────────────────────
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ────────────────────────────────────────────────────────────
  const sort: MockResultSortOptions = {
    sortBy: sortField as MockResultSortOptions['sortBy'],
    sortDirection: sortDir,
  };

  const isAllView = viewMode === 'all';
  const isSingleEntity = !isAllView;
  const hasValidId = isAllView || (viewMode === 'student' ? !!studentId : viewMode === 'test' ? !!testId : !!instituteId);

  const appliedFilters = Object.keys(filters).length > 0 ? filters : undefined;

  const {
    data: allResults,
    isLoading: allLoading,
    isFetching: allFetching,
    isStale: allStale,
    refetch: allRefetch,
  } = useResults(isAllView ? appliedFilters : undefined, sort, { page, pageSize }, isAllView);

  const {
    data: studentResults,
    isLoading: studentLoading,
    refetch: studentRefetch,
  } = useStudentResults(isAllView ? null : viewMode === 'student' ? studentId : null, filters as Omit<MockResultFilters, 'studentId'>, sort, { page, pageSize });

  const {
    data: testResults,
    isLoading: testLoading,
    refetch: testRefetch,
  } = useMockTestResults(isAllView ? null : viewMode === 'test' ? testId : null, filters as Omit<MockResultFilters, 'testId'>, sort, { page, pageSize });

  const {
    data: instituteResults,
    isLoading: instituteLoading,
    refetch: instituteRefetch,
  } = useInstituteResults(
    isAllView ? null : viewMode === 'institute' ? instituteId : null,
    filters as Omit<MockResultFilters, 'instituteId'>,
    sort,
    { page, pageSize },
  );

  const { data: detailResult, isLoading: detailLoading } = useMockResult(detailResultId);
  const releaseMutation = useReleaseResult();
  const hideMutation = useHideResult();
  const deleteMutation = useDeleteResult();

  const isLoading = isAllView ? allLoading : isSingleEntity && hasValidId
    ? (viewMode === 'student' ? studentLoading : viewMode === 'test' ? testLoading : instituteLoading)
    : false;

  const isMutating =
    releaseMutation.isPending || hideMutation.isPending || deleteMutation.isPending;

  const currentData = isAllView ? allResults
    : viewMode === 'student' ? studentResults
    : viewMode === 'test' ? testResults
    : instituteResults;

  const currentRefetch = isAllView ? allRefetch
    : viewMode === 'student' ? studentRefetch
    : viewMode === 'test' ? testRefetch
    : instituteRefetch;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: detailResultId,
      cacheStatus: allStale ? 'stale' : 'fresh',
      queryStatus: allFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: operationError,
    });
  });

  // ── Filter handlers ───────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const newFilters: MockResultFilters = {};

    if (searchAttemptId.trim()) {
      newFilters.attemptId = searchAttemptId.trim();
    }

    if (searchResultId.trim()) {
      newFilters.ids = [searchResultId.trim()];
    }

    if (filterReleased !== '') {
      newFilters.isReleased = filterReleased === 'true';
    }

    if (filterMinScore !== '') {
      newFilters.minScore = Number(filterMinScore);
    }

    if (filterMaxScore !== '') {
      newFilters.maxScore = Number(filterMaxScore);
    }

    if (filterMinPercentage !== '') {
      (newFilters as Record<string, unknown>).percentageMin = Number(filterMinPercentage);
    }

    if (filterMaxPercentage !== '') {
      (newFilters as Record<string, unknown>).percentageMax = Number(filterMaxPercentage);
    }

    if (dateFrom) {
      newFilters.generatedAfter = new Date(dateFrom).toISOString();
    }

    if (dateTo) {
      newFilters.generatedBefore = new Date(dateTo).toISOString();
    }

    if (viewMode === 'all' && user?.instituteId) {
      newFilters.instituteId = user.instituteId;
    }

    setFilters(newFilters);
    setPage(1);
    setLastHookCalled('search applied');
    setOperationMessage('Filters applied');
    setOperationError(null);
  }, [
    searchAttemptId, searchResultId, filterReleased,
    filterMinScore, filterMaxScore, filterMinPercentage, filterMaxPercentage,
    dateFrom, dateTo, viewMode, user,
  ]);

  const handleResetFilters = useCallback(() => {
    setSearchAttemptId('');
    setSearchResultId('');
    setFilterReleased('');
    setFilterMinScore('');
    setFilterMaxScore('');
    setFilterMinPercentage('');
    setFilterMaxPercentage('');
    setDateFrom('');
    setDateTo('');
    setFilters({});
    setPage(1);
    setLastHookCalled('reset filters');
    setOperationMessage('Filters reset');
    setOperationError(null);
  }, []);

  const handleRefetch = useCallback(() => {
    currentRefetch().catch(() => {});
    setLastHookCalled('refetch');
  }, [currentRefetch]);

  // ── Action handlers ──────────────────────────────────────────────────
  const handleRelease = useCallback((result: MockResult) => {
    setLastHookCalled('useReleaseResult');
    setOperationError(null);
    releaseMutation.mutate(result.resultId, {
      onSuccess: (data) => {
        setLastApiResponse(JSON.stringify(data));
        setOperationMessage(`Result ${result.resultId.slice(0, 8)}... released`);
        setOperationError(null);
      },
      onError: (err) => {
        setOperationError(err.message);
        setLastApiResponse(err.message);
      },
    });
  }, [releaseMutation]);

  const handleHide = useCallback((result: MockResult) => {
    setLastHookCalled('useHideResult');
    setOperationError(null);
    hideMutation.mutate(result.resultId, {
      onSuccess: (data) => {
        setLastApiResponse(JSON.stringify(data));
        setOperationMessage(`Result ${result.resultId.slice(0, 8)}... hidden`);
        setOperationError(null);
      },
      onError: (err) => {
        setOperationError(err.message);
        setLastApiResponse(err.message);
      },
    });
  }, [hideMutation]);

  const handleDelete = useCallback((result: MockResult) => {
    if (!window.confirm(`Are you sure you want to delete result ${result.resultId.slice(0, 8)}...?\n\nStudent: ${result.studentId.slice(0, 8)}...\nScore: ${result.totalScore}/${result.maxScore}\n\nThis action is for Developer Console only.`)) return;

    setLastHookCalled('useDeleteResult');
    setOperationError(null);
    deleteMutation.mutate(result.resultId, {
      onSuccess: () => {
        setLastApiResponse(JSON.stringify({ deleted: result.resultId }));
        setOperationMessage(`Result ${result.resultId.slice(0, 8)}... deleted`);
        setOperationError(null);
        if (detailResultId === result.resultId) setDetailResultId(null);
      },
      onError: (err) => {
        setOperationError(err.message);
        setLastApiResponse(err.message);
      },
    });
  }, [deleteMutation, detailResultId]);

  const handleViewDetail = useCallback((resultId: string) => {
    setDetailResultId(resultId);
    setLastHookCalled('useMockResult [detail]');
  }, []);

  // ── Styling helpers ──────────────────────────────────────────────────
  const scoreColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-400';
    if (percentage >= 60) return 'text-blue-400';
    if (percentage >= 40) return 'text-amber-400';
    return 'text-red-400';
  };

  const statusVariant = (isReleased: boolean): 'success' | 'warning' => {
    return isReleased ? 'success' : 'warning';
  };

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Results</h2>
          <p className="text-xs text-gray-500 mt-0.5">View, release, hide, delete — search by attempt/result ID, student, test, institute</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(currentData?.count ?? 0) + ' results'} variant="info" />
        </div>
      </div>

      {/* ── Operation feedback ──────────────────────────────────────────── */}
      {operationMessage && !operationError && (
        <div className="rounded border border-green-700/50 bg-green-950/30 px-4 py-2.5">
          <span className="text-xs text-green-400 font-medium">{operationMessage}</span>
        </div>
      )}
      {operationError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{operationError}</span>
        </div>
      )}

      {/* ── View Mode Selector ──────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1">View:</span>
          {(['all', 'student', 'test', 'institute'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setViewMode(mode);
                setPage(1);
                setDetailResultId(null);
                setOperationMessage(null);
                setOperationError(null);
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === mode
                  ? 'bg-blue-700 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {mode === 'all' ? 'All Results' : mode === 'student' ? 'By Student' : mode === 'test' ? 'By Test' : 'By Institute'}
            </button>
          ))}
        </div>

        {viewMode !== 'all' && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {viewMode === 'student' && (
              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-gray-500">Student ID</label>
                <input
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="UUID"
                  className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[280px]"
                />
              </div>
            )}
            {viewMode === 'test' && (
              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-gray-500">Test ID</label>
                <input
                  type="text"
                  value={testId}
                  onChange={(e) => setTestId(e.target.value)}
                  placeholder="UUID"
                  className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[280px]"
                />
              </div>
            )}
            {viewMode === 'institute' && (
              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-gray-500">Institute ID</label>
                <input
                  type="text"
                  value={instituteId}
                  onChange={(e) => setInstituteId(e.target.value)}
                  placeholder="UUID"
                  className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[280px]"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => { setPage(1); handleSearch(); }}
              className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white"
            >
              Load
            </button>
          </div>
        )}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Attempt ID</label>
            <input
              type="text"
              value={searchAttemptId}
              onChange={(e) => setSearchAttemptId(e.target.value)}
              placeholder="UUID"
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
          <div className="space-y-1 min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Result ID</label>
            <input
              type="text"
              value={searchResultId}
              onChange={(e) => setSearchResultId(e.target.value)}
              placeholder="UUID"
              className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Released</label>
            <select
              value={filterReleased}
              onChange={(e) => setFilterReleased(e.target.value)}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              <option value="">All</option>
              <option value="true">Released</option>
              <option value="false">Hidden</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Min Score</label>
            <input
              type="number"
              value={filterMinScore}
              onChange={(e) => setFilterMinScore(e.target.value)}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[80px]"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Max Score</label>
            <input
              type="number"
              value={filterMaxScore}
              onChange={(e) => setFilterMaxScore(e.target.value)}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[80px]"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Min %</label>
            <input
              type="number"
              value={filterMinPercentage}
              onChange={(e) => setFilterMinPercentage(e.target.value)}
              min={0}
              max={100}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[70px]"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Max %</label>
            <input
              type="number"
              value={filterMaxPercentage}
              onChange={(e) => setFilterMaxPercentage(e.target.value)}
              min={0}
              max={100}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[70px]"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Sort</label>
            <div className="flex gap-1">
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value)}
                className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
              >
                {SORT_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                className="rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 w-16"
              >
                <option value="desc">DESC</option>
                <option value="asc">ASC</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSearch}
            className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={handleResetFilters}
            className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleRefetch}
            className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Results Table ────────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Student</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Test</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Score</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Rank</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">C/W/S</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Time</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Generated</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentData && currentData.data.length > 0 ? currentData.data.map((r) => (
                <tr key={r.resultId} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleViewDetail(r.resultId)}
                      className="font-mono text-[10px] text-gray-400 hover:text-blue-400 transition-colors text-left"
                    >
                      {r.studentId.slice(0, 8)}...
                    </button>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-gray-500">
                    {r.testId.slice(0, 8)}...
                  </td>
                  <td className={`px-3 py-2.5 text-right font-medium ${scoreColor(r.percentage)}`}>
                    {r.totalScore}/{r.maxScore}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-medium ${scoreColor(r.percentage)}`}>
                    {r.percentage.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-300">
                    {r.rank ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-400">
                    <span className="text-green-400">{r.correctCount}</span>/
                    <span className="text-red-400">{r.wrongCount}</span>/
                    <span className="text-gray-600">{r.skippedCount}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-500 whitespace-nowrap">
                    {formatTime(r.totalTimeSeconds)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge
                      label={r.isReleased ? 'Released' : 'Hidden'}
                      variant={statusVariant(r.isReleased)}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-[10px]">
                    {new Date(r.generatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleViewDetail(r.resultId)}
                        className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700"
                      >
                        View
                      </button>
                      {!r.isReleased ? (
                        <button
                          type="button"
                          onClick={() => handleRelease(r)}
                          disabled={releaseMutation.isPending}
                          className="rounded bg-green-900/50 px-2 py-1 text-[11px] text-green-300 hover:bg-green-900/70 disabled:opacity-40"
                        >
                          Release
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleHide(r)}
                          disabled={hideMutation.isPending}
                          className="rounded bg-amber-900/50 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/70 disabled:opacity-40"
                        >
                          Hide
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        disabled={deleteMutation.isPending}
                        className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 disabled:opacity-40"
                      >
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-600">
                    {isLoading ? 'Loading...' : 'No results found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {currentData && currentData.pageCount > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-700 bg-gray-800/30">
            <span className="text-[11px] text-gray-500">
              Page {currentData.page} of {currentData.pageCount} ({currentData.count} total)
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={page >= currentData.pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="rounded bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Detail View ──────────────────────────────────────────────────── */}
      {detailResultId && (
        <div className="rounded border border-blue-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-blue-700/50 bg-blue-950/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-300">
              Result Detail: {detailResultId.slice(0, 8)}...
            </span>
            <button
              type="button"
              onClick={() => setDetailResultId(null)}
              className="text-[11px] text-gray-500"
            >
              Close
            </button>
          </div>
          <div className="p-4 max-h-[600px] overflow-y-auto">
            {detailLoading ? (
              <LoadingIndicator label="Loading detail..." />
            ) : detailResult ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div className="col-span-2">
                  <h3 className="text-sm font-semibold text-gray-100 mb-2">Result Overview</h3>
                </div>
                <div><span className="text-gray-500">Result ID:</span> <span className="font-mono text-gray-300">{detailResult.resultId}</span></div>
                <div><span className="text-gray-500">Attempt ID:</span> <span className="font-mono text-gray-300">{detailResult.attemptId}</span></div>
                <div><span className="text-gray-500">Test ID:</span> <span className="font-mono text-gray-300">{detailResult.testId}</span></div>
                <div><span className="text-gray-500">Student ID:</span> <span className="font-mono text-gray-300">{detailResult.studentId}</span></div>
                <div><span className="text-gray-500">Institute ID:</span> <span className="font-mono text-gray-300">{detailResult.instituteId}</span></div>

                <div className="col-span-2 mt-3">
                  <h3 className="text-sm font-semibold text-gray-100 mb-2">Scores</h3>
                </div>
                <div>
                  <span className="text-gray-500">Total Score:</span>{' '}
                  <span className={`font-semibold ${scoreColor(detailResult.percentage)}`}>
                    {detailResult.totalScore}
                  </span>
                </div>
                <div><span className="text-gray-500">Max Score:</span> <span className="text-gray-300">{detailResult.maxScore}</span></div>
                <div>
                  <span className="text-gray-500">Percentage:</span>{' '}
                  <span className={`font-semibold ${scoreColor(detailResult.percentage)}`}>
                    {detailResult.percentage.toFixed(2)}%
                  </span>
                </div>
                <div><span className="text-gray-500">Rank:</span> <span className="text-gray-300">{detailResult.rank ?? '(not computed)'}</span></div>
                <div><span className="text-gray-500">Percentile:</span> <span className="text-gray-300">{detailResult.percentile != null ? `${detailResult.percentile.toFixed(2)}%` : '(not computed)'}</span></div>

                <div className="col-span-2 mt-3">
                  <h3 className="text-sm font-semibold text-gray-100 mb-2">Answer Breakdown</h3>
                </div>
                <div><span className="text-green-400">Correct:</span> <span className="text-gray-300 font-semibold">{detailResult.correctCount}</span></div>
                <div><span className="text-red-400">Wrong:</span> <span className="text-gray-300 font-semibold">{detailResult.wrongCount}</span></div>
                <div><span className="text-gray-500">Skipped:</span> <span className="text-gray-300 font-semibold">{detailResult.skippedCount}</span></div>
                <div>
                  <span className="text-gray-500">Accuracy:</span>{' '}
                  <span className="text-gray-300">
                    {detailResult.correctCount + detailResult.wrongCount > 0
                      ? `${((detailResult.correctCount / (detailResult.correctCount + detailResult.wrongCount)) * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                </div>

                <div className="col-span-2 mt-3">
                  <h3 className="text-sm font-semibold text-gray-100 mb-2">Time</h3>
                </div>
                <div><span className="text-gray-500">Total Time:</span> <span className="text-gray-300">{formatTime(detailResult.totalTimeSeconds)}</span></div>
                <div><span className="text-gray-500">Avg Time/Question:</span> <span className="text-gray-300">{detailResult.avgTimePerQuestion.toFixed(1)}s</span></div>

                <div className="col-span-2 mt-3">
                  <h3 className="text-sm font-semibold text-gray-100 mb-2">Status &amp; Timestamps</h3>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>{' '}
                  <StatusBadge
                    label={detailResult.isReleased ? 'Released' : 'Hidden'}
                    variant={statusVariant(detailResult.isReleased)}
                  />
                </div>
                <div></div>
                <div><span className="text-gray-500">Generated At:</span> <span className="text-gray-300">{new Date(detailResult.generatedAt).toLocaleString()}</span></div>
                <div><span className="text-gray-500">Released At:</span> <span className="text-gray-300">{detailResult.releasedAt ? new Date(detailResult.releasedAt).toLocaleString() : '—'}</span></div>

                {detailResult.subjectBreakdown && detailResult.subjectBreakdown.length > 0 && (
                  <div className="col-span-2 mt-3">
                    <h3 className="text-sm font-semibold text-gray-100 mb-2">Subject Breakdown</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="text-left px-2 py-1 text-gray-500">Subject</th>
                            <th className="text-right px-2 py-1 text-green-400">C</th>
                            <th className="text-right px-2 py-1 text-red-400">W</th>
                            <th className="text-right px-2 py-1 text-gray-500">S</th>
                            <th className="text-right px-2 py-1 text-gray-500">Score</th>
                            <th className="text-right px-2 py-1 text-gray-500">Max</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailResult.subjectBreakdown.map((sb) => (
                            <tr key={sb.subjectId} className="border-b border-gray-800">
                              <td className="px-2 py-1.5 text-gray-300">{sb.subjectName}</td>
                              <td className="px-2 py-1.5 text-right text-green-400">{sb.correct}</td>
                              <td className="px-2 py-1.5 text-right text-red-400">{sb.wrong}</td>
                              <td className="px-2 py-1.5 text-right text-gray-600">{sb.skipped}</td>
                              <td className="px-2 py-1.5 text-right text-gray-300">{sb.score}</td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{sb.maxScore}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {detailResult.chapterBreakdown && detailResult.chapterBreakdown.length > 0 && (
                  <div className="col-span-2 mt-3">
                    <h3 className="text-sm font-semibold text-gray-100 mb-2">Chapter Breakdown</h3>
                    <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="text-left px-2 py-1 text-gray-500">Chapter</th>
                            <th className="text-right px-2 py-1 text-green-400">C</th>
                            <th className="text-right px-2 py-1 text-red-400">W</th>
                            <th className="text-right px-2 py-1 text-gray-500">S</th>
                            <th className="text-right px-2 py-1 text-gray-500">Score</th>
                            <th className="text-right px-2 py-1 text-gray-500">Max</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailResult.chapterBreakdown.map((cb) => (
                            <tr key={cb.chapterId} className="border-b border-gray-800">
                              <td className="px-2 py-1.5 text-gray-300">{cb.chapterName}</td>
                              <td className="px-2 py-1.5 text-right text-green-400">{cb.correct}</td>
                              <td className="px-2 py-1.5 text-right text-red-400">{cb.wrong}</td>
                              <td className="px-2 py-1.5 text-right text-gray-600">{cb.skipped}</td>
                              <td className="px-2 py-1.5 text-right text-gray-300">{cb.score}</td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{cb.maxScore}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-xs text-gray-500">Result not found or failed to load.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
