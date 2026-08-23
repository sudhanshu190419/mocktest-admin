'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MagnifyingGlass, User, ArrowSquareOut, CaretLeft, CaretRight, GraduationCap } from '@phosphor-icons/react';
import { useStudentBucketDrilldown } from '@/hooks/analytics/useTeacherAnalyticsService';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

import type { AnalyticsFilters } from '@/types/analytics-extended';

interface StudentBucketDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  instituteId?: string | null;
  type: 'score' | 'accuracy' | 'weekly' | 'monthly';
  bucketRange: string;
  min?: number;
  max?: number;
  periodStart?: string;
  periodEnd?: string;
  filters?: AnalyticsFilters;
  dateRange?: { from?: string; to?: string; preset?: string };
  baseRoute?: string; // default: '/admin/students'
}

export function StudentBucketDrawer({
  isOpen,
  onClose,
  instituteId,
  type,
  bucketRange,
  min,
  max,
  periodStart,
  periodEnd,
  filters,
  dateRange,
  baseRoute = '/admin/students',
}: StudentBucketDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  // Reset pagination & search when bucket or type changes
  useEffect(() => {
    setSearchQuery('');
    setPage(1);
  }, [type, bucketRange, min, max, periodStart, periodEnd]);

  const { data, isLoading, isError } = useStudentBucketDrilldown(
    instituteId,
    isOpen
      ? {
          type,
          min,
          max,
          periodStart,
          periodEnd,
          filters,
          dateRange,
          searchQuery,
          page,
          pageSize: 10,
        }
      : null,
    { enabled: isOpen },
  );

  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getHeaderColor = () => {
    switch (type) {
      case 'score':
        return 'bg-emerald-500';
      case 'accuracy':
        return 'bg-blue-500';
      case 'weekly':
        return 'bg-indigo-500';
      case 'monthly':
        return 'bg-purple-500';
    }
  };

  const getHeaderTitle = () => {
    switch (type) {
      case 'score':
        return `Score Range: ${bucketRange}%`;
      case 'accuracy':
        return `Accuracy Range: ${bucketRange}%`;
      case 'weekly':
        return `Weekly Activity: ${bucketRange}`;
      case 'monthly':
        return `Monthly Activity: ${bucketRange}`;
    }
  };

  const getHeaderSubtitle = () => {
    switch (type) {
      case 'score':
        return 'Students whose average test percentage falls in this range';
      case 'accuracy':
        return 'Students whose cumulative accuracy falls in this range';
      case 'weekly':
      case 'monthly':
        return 'Students active with completed mock test results during this period';
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Slide-over Panel */}
          <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
            <motion.div
              className="w-screen max-w-2xl bg-white shadow-2xl flex flex-col dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-5 dark:border-gray-800">
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className={`h-2.5 w-2.5 rounded-full ${getHeaderColor()}`} />
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {getHeaderTitle()}
                    </h2>
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {totalCount} {totalCount === 1 ? 'student' : 'students'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {getHeaderSubtitle()}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
                  aria-label="Close panel"
                >
                  <X size={20} weight="bold" />
                </button>
              </div>

              {/* Search Bar */}
              <div className="border-b border-gray-100 px-6 py-3.5 dark:border-gray-800/60 bg-gray-50/50 dark:bg-gray-900/50">
                <div className="relative">
                  <MagnifyingGlass
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search students by name, email, or batch..."
                    className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-xs text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                </div>
              </div>

              {/* Body: Student List */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-xl border border-gray-200 p-4 dark:border-gray-800"
                      >
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-9 w-9 rounded-full" />
                          <div>
                            <Skeleton className="mb-1 h-3.5 w-32" />
                            <Skeleton className="h-2.5 w-44" />
                          </div>
                        </div>
                        <Skeleton className="h-7 w-20 rounded-lg" />
                      </div>
                    ))}
                  </div>
                ) : isError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-xs text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">
                    Failed to load students for this period. Please try again.
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400">
                      <GraduationCap size={24} weight="duotone" />
                    </div>
                    <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                      No students found
                    </p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {searchQuery
                        ? 'No student matches your search query.'
                        : 'No student test activity was recorded during this period.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {items.map((student) => (
                      <div
                        key={student.studentId}
                        className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3.5 transition-all hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                      >
                        {/* Student Info */}
                        <div className="flex items-center gap-3 min-w-0 flex-1 pr-4">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-xs text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                            {student.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                                {student.name}
                              </span>
                              {student.batchName && student.batchName !== 'Unassigned' && (
                                <span className="inline-block shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                  {student.batchName}
                                </span>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                              {student.email || 'No email provided'}
                            </p>
                          </div>
                        </div>

                        {/* Performance Badges */}
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                              Avg Score
                            </p>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100">
                              {student.averageScore}%
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                              Accuracy
                            </p>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100">
                              {student.accuracy != null ? `${student.accuracy}%` : '—'}
                            </p>
                          </div>

                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                              Tests Taken
                            </p>
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                              {student.testsAttempted}
                            </p>
                          </div>

                          {/* View Profile Action */}
                          <Link
                            href={`${baseRoute}/${student.profileId || student.studentId}`}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100 transition-colors"
                          >
                            <span>Profile</span>
                            <ArrowSquareOut size={13} />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer / Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3.5 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Page <span className="font-semibold text-gray-900 dark:text-gray-100">{page}</span> of{' '}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{totalPages}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                    >
                      <CaretLeft size={14} />
                      <span>Prev</span>
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                    >
                      <span>Next</span>
                      <CaretRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
