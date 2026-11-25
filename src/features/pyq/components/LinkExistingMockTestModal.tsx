'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAvailableMockTestsQuery, useAssignExistingMockTestMutation } from '@/hooks/pyq/usePyqMockMapping';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import type { AvailableMockTestItem } from '@/services/pyq/pyqMockMappingService';

interface LinkExistingMockTestModalProps {
  open: boolean;
  onClose: () => void;
  paperId: string;
  paperTitle: string;
  paperStreamId?: string;
  instituteId: string;
}

const PAGE_SIZE = 6;

export function LinkExistingMockTestModal({
  open,
  onClose,
  paperId,
  paperTitle,
  paperStreamId,
  instituteId,
}: LinkExistingMockTestModalProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset selection on open / close
  useEffect(() => {
    if (open) {
      setSelectedTestId(null);
      setActionError(null);
      setSearch('');
      setDebouncedSearch('');
      setPage(1);
    }
  }, [open]);

  const {
    data: paginatedData,
    isLoading,
    isError,
    error,
    refetch,
  } = useAvailableMockTestsQuery(open ? instituteId : undefined, {
    search: debouncedSearch,
    page,
    pageSize: PAGE_SIZE,
  });

  const assignMutation = useAssignExistingMockTestMutation();

  const tests = useMemo(() => paginatedData?.data ?? [], [paginatedData]);
  const totalCount = paginatedData?.count ?? 0;
  const pageCount = paginatedData?.pageCount ?? (totalCount > 0 ? Math.ceil(totalCount / PAGE_SIZE) : 1);

  const selectedTest = useMemo<AvailableMockTestItem | null>(() => {
    if (!selectedTestId) return null;
    return tests.find((t) => t.testId === selectedTestId) ?? null;
  }, [selectedTestId, tests]);

  if (!open) return null;

  const handleLink = async () => {
    if (!selectedTestId) return;
    setActionError(null);

    try {
      await assignMutation.mutateAsync({
        paperId,
        testId: selectedTestId,
      });
      onClose();
    } catch (err: any) {
      setActionError(err.message ?? 'Failed to link mock test to this paper.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div>
            <h3 id="modal-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Select Existing Mock Test
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Link an already-created mock test to paper &ldquo;{paperTitle}&rdquo;.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-gray-100 px-6 py-3 dark:border-gray-800">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by test title, subject, or stream..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-xs outline-none transition focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Action Error Banner */}
        {actionError && (
          <div className="mx-6 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-400">
            {actionError}
          </div>
        )}

        {/* Test List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <div className="py-8 text-center">
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {error?.message ?? 'Failed to load available mock tests.'}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 text-xs font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
              >
                Try again
              </button>
            </div>
          ) : tests.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <p className="mt-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                No eligible mock tests found
              </p>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {debouncedSearch
                  ? 'Try a different search query.'
                  : 'Only published mock tests with at least one question that are not already assigned to another paper can be linked.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tests.map((test) => {
                const isSelected = selectedTestId === test.testId;
                const streamDiffers = paperStreamId && test.streamId && test.streamId !== paperStreamId;

                return (
                  <label
                    key={test.testId}
                    htmlFor={`mock-test-${test.testId}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/60 shadow-sm dark:border-blue-500 dark:bg-blue-950/20'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50 dark:hover:border-gray-700'
                    }`}
                  >
                    <input
                      type="radio"
                      id={`mock-test-${test.testId}`}
                      name="selectedMockTest"
                      checked={isSelected}
                      onChange={() => setSelectedTestId(test.testId)}
                      className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {test.title}
                        </p>
                        <StatusBadge status={test.status} />
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                        {test.streamName && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                            {test.streamName}
                          </span>
                        )}
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
                          {test.subjectName ?? 'All Subjects'}
                        </span>
                        <span>•</span>
                        <span>{test.durationMin} min</span>
                        <span>•</span>
                        <span>{test.totalMarks} marks</span>
                        <span>•</span>
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          {test.questionCount} question{test.questionCount !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {streamDiffers && (
                        <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                          Note: Test stream differs from this paper&apos;s stream.
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-gray-100 px-6 py-2.5 dark:border-gray-800">
            <span className="text-[11px] text-gray-500">
              Showing {tests.length} of {totalCount} test{totalCount !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
              >
                Previous
              </button>
              <span className="text-xs text-gray-500">
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Selected Test Summary Preview */}
        {selectedTest && (
          <div className="border-t border-blue-100 bg-blue-50/40 px-6 py-2.5 dark:border-blue-900/30 dark:bg-blue-950/10">
            <p className="text-[11px] text-gray-600 dark:text-gray-300">
              Selected: <strong className="font-semibold text-gray-900 dark:text-gray-100">{selectedTest.title}</strong>{' '}
              ({selectedTest.questionCount} questions · {selectedTest.totalMarks} marks)
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-gray-100 px-6 py-3.5 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            disabled={assignMutation.isPending}
            className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleLink}
            disabled={!selectedTestId || assignMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {assignMutation.isPending ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Linking Mock Test...
              </>
            ) : (
              'Link Mock Test'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

