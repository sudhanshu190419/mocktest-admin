'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useMockTest } from '@/hooks/mockTest/useMockTests';
import {
  useMockTestQuestions,
  useAddQuestionsToMockTest,
  useRemoveQuestionFromMockTest,
} from '@/hooks/mockTest/useMockTestQuestions';
import { useQuestions } from '@/hooks/mockTest/useQuestions';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { Lock } from '@phosphor-icons/react';

const PAGE_SIZE = 10;

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export interface MockTestQuestionManagerProps {
  testId: string;
  roleContext: 'teacher' | 'admin';
  baseRoute: string;
  onCompleteHref: string;
  onCompleteLabel: string;
}

export function MockTestQuestionManager({
  testId,
  roleContext,
  baseRoute,
  onCompleteHref,
  onCompleteLabel,
}: MockTestQuestionManagerProps) {
  const { data: test, isLoading: testLoading } = useMockTest(testId);
  const { data: assignedQuestions, isLoading: assignedLoading } = useMockTestQuestions(testId);
  const addQuestions = useAddQuestionsToMockTest();
  const removeQuestion = useRemoveQuestionFromMockTest();

  const isPublished = test?.status === 'published';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');

  const filters: Record<string, string> = {};
  if (search) filters.search = search;
  if (subjectFilter) filters.subjectId = subjectFilter;
  if (difficultyFilter) filters.difficulty = difficultyFilter;

  const { data: questionsData, isLoading: questionsLoading } = useQuestions(
    Object.keys(filters).length > 0 ? filters : undefined,
    undefined,
    { page, pageSize: PAGE_SIZE },
  );
  const questions = questionsData?.data ?? [];
  const totalCount = questionsData?.count ?? 0;

  const { data: subjectsData } = useSubjects(undefined, undefined, { page: 1, pageSize: 200 });
  const subjects = subjectsData?.data ?? [];

  // Track assigned question IDs
  const assignedIds = useMemo(() => {
    if (!assignedQuestions) return new Set<string>();
    return new Set(assignedQuestions.map((a) => a.questionId));
  }, [assignedQuestions]);

  // Track in-flight additions/removals
  const [addingQuestions, setAddingQuestions] = useState<Set<string>>(new Set());
  const [removingQuestions, setRemovingQuestions] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const handleAddQuestion = useCallback((questionId: string) => {
    if (isPublished) return;

    setAddingQuestions((prev) => new Set(prev).add(questionId));
    const maxOrder = (assignedQuestions ?? []).reduce(
      (max, q) => Math.max(max, q.orderSequence || 0),
      0,
    );
    const nextOrder = maxOrder + 1;

    console.log('[MOCK_ORDER_DEBUG] UI_ADD', {
      testId,
      questionId,
      assignedCount: assignedQuestions?.length ?? 0,
      assignedOrderSequences: (assignedQuestions ?? []).map((q) => q.orderSequence),
      maxOrder,
      calculatedNextOrder: nextOrder,
      timestamp: new Date().toISOString(),
    });

    addQuestions.mutate(
      { testId, assignments: [{ questionId, orderSequence: nextOrder }] },
      {
        onSuccess: () => {
          setAddingQuestions((prev) => {
            const next = new Set(prev);
            next.delete(questionId);
            return next;
          });
        },
        onError: () => {
          setAddingQuestions((prev) => {
            const next = new Set(prev);
            next.delete(questionId);
            return next;
          });
        },
      },
    );
  }, [testId, assignedQuestions, addQuestions, isPublished]);

  const handleRemoveQuestion = useCallback((questionId: string) => {
    if (isPublished) return;

    setConfirmRemove(null);
    setRemovingQuestions((prev) => new Set(prev).add(questionId));
    removeQuestion.mutate(
      { testId, questionId },
      {
        onSuccess: () => {
          setRemovingQuestions((prev) => {
            const next = new Set(prev);
            next.delete(questionId);
            return next;
          });
        },
        onError: () => {
          setRemovingQuestions((prev) => {
            const next = new Set(prev);
            next.delete(questionId);
            return next;
          });
        },
      },
    );
  }, [testId, removeQuestion, isPublished]);

  if (testLoading || assignedLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Loading question selection..." />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!test) {
    return (
      <EmptyState
        title="Mock Test Not Found"
        description="The mock test you are looking for does not exist."
        action={
          <Link
            href={baseRoute}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Back to Mock Tests
          </Link>
        }
      />
    );
  }

  const breadcrumbs =
    roleContext === 'admin'
      ? [
          { label: 'Admin', href: '/admin' },
          { label: 'Mock Tests', href: '/admin/mock-tests' },
          { label: test.title, href: `/admin/mock-tests/${testId}` },
          { label: 'Questions' },
        ]
      : [
          { label: 'Teacher', href: '/teacher' },
          { label: 'Mock Tests', href: '/teacher/mock-tests' },
          { label: test.title, href: `/teacher/mock-tests/${testId}/preview` },
          { label: 'Questions' },
        ];

  return (
    <div>
      <PageHeader
        title={`${test.title} - Questions`}
        description={`${assignedQuestions?.length ?? 0} question(s) assigned`}
        breadcrumbs={breadcrumbs}
        actions={
          <Link
            href={onCompleteHref}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {onCompleteLabel}
          </Link>
        }
      />

      {/* Published Lock Notice */}
      {isPublished && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            <Lock size={22} weight="fill" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Published — Questions Locked
            </h4>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              This mock test is published. Questions cannot be added, removed, or reordered while the test is active.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Assigned questions */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Assigned Questions</h2>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {assignedQuestions?.length ?? 0}
                </span>
              </div>
            </div>
            <div className="max-h-[600px] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
              {!assignedQuestions || assignedQuestions.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-gray-500">No questions assigned yet.</p>
                  <p className="mt-1 text-xs text-gray-400">Browse the question bank and add questions.</p>
                </div>
              ) : (
                assignedQuestions.map((aq, idx) => (
                  <div key={aq.questionId} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100">#{idx + 1}</p>
                      <p className="truncate text-[11px] text-gray-500">{aq.marks} marks</p>
                    </div>
                    {!isPublished && (
                      <button
                        type="button"
                        disabled={removingQuestions.has(aq.questionId)}
                        onClick={() => setConfirmRemove(aq.questionId)}
                        className="ml-2 shrink-0 rounded px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-900/20"
                      >
                        {removingQuestions.has(aq.questionId) ? '...' : 'Remove'}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Question Bank browser */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search questions..."
              className="min-w-[200px] flex-1"
            />
            <select
              value={subjectFilter}
              onChange={(e) => {
                setSubjectFilter(e.target.value);
                setPage(1);
              }}
              className="min-w-[130px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={difficultyFilter}
              onChange={(e) => {
                setDifficultyFilter(e.target.value);
                setPage(1);
              }}
              className="min-w-[110px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Difficulties</option>
              {DIFFICULTY_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            {questionsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : questions.length === 0 ? (
              <EmptyState
                title="No questions found"
                description={search ? 'Try a different search term.' : 'Add questions to the question bank first.'}
              />
            ) : (
              questions.map((q) => {
                const isAssigned = assignedIds.has(q.questionId);
                const isAdding = addingQuestions.has(q.questionId);
                return (
                  <div
                    key={q.questionId}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      isAssigned
                        ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10'
                        : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {q.questionText}
                        </p>
                        <StatusBadge status={q.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium uppercase dark:bg-gray-800">
                          {q.questionType}
                        </span>
                        <span>{q.difficulty}</span>
                        <span>{q.marks} marks</span>
                        {q.negativeMarks > 0 && <span>-{q.negativeMarks} neg.</span>}
                      </div>
                    </div>
                    {isPublished ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        <Lock size={12} weight="bold" />
                        Locked
                      </span>
                    ) : isAssigned ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(q.questionId)}
                        disabled={removingQuestions.has(q.questionId)}
                        className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-900/20"
                      >
                        {removingQuestions.has(q.questionId) ? '...' : 'Remove'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddQuestion(q.questionId)}
                        disabled={isAdding}
                        className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:hover:bg-blue-900/20"
                      >
                        {isAdding ? 'Adding...' : 'Add'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalCount > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-gray-500">{totalCount} question(s) total</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500">
                  Page {page} of {Math.ceil(totalCount / PAGE_SIZE)}
                </span>
                <button
                  type="button"
                  disabled={page >= Math.ceil(totalCount / PAGE_SIZE)}
                  onClick={() => setPage(page + 1)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!isPublished && !!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && handleRemoveQuestion(confirmRemove)}
        title="Remove Question"
        message="This question will be removed from this mock test. The question itself is not deleted."
        confirmLabel="Remove"
        variant="warning"
      />
    </div>
  );
}
