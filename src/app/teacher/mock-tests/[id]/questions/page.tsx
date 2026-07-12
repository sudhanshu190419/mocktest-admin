'use client';

import { useState, useCallback, useMemo, use } from 'react';
import Link from 'next/link';
import { useMockTest } from '@/hooks/mockTest/useMockTests';
import { useMockTestQuestions, useAddQuestionsToMockTest, useRemoveQuestionFromMockTest } from '@/hooks/mockTest/useMockTestQuestions';
import { useQuestions } from '@/hooks/mockTest/useQuestions';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

const PAGE_SIZE = 10;

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export default function MockTestQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: testId } = use(params);

  const { data: test, isLoading: testLoading } = useMockTest(testId);
  const { data: assignedQuestions, isLoading: assignedLoading } = useMockTestQuestions(testId);
  const addQuestions = useAddQuestionsToMockTest();
  const removeQuestion = useRemoveQuestionFromMockTest();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');

  const filters: any = {};
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

  // Track which questions are assigned already
  const assignedIds = useMemo(() => {
    if (!assignedQuestions) return new Set<string>();
    return new Set(assignedQuestions.map((a) => a.questionId));
  }, [assignedQuestions]);

  // Track questions being added/removed
  const [addingQuestions, setAddingQuestions] = useState<Set<string>>(new Set());
  const [removingQuestions, setRemovingQuestions] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const handleAddQuestion = useCallback((questionId: string, index: number) => {
    setAddingQuestions((prev) => new Set(prev).add(questionId));
    const nextOrder = (assignedQuestions?.length ?? 0) + 1;
    addQuestions.mutate(
      { testId, assignments: [{ questionId, orderSequence: nextOrder }] },
      {
        onSuccess: () => {
          setAddingQuestions((prev) => { const next = new Set(prev); next.delete(questionId); return next; });
        },
        onError: () => {
          setAddingQuestions((prev) => { const next = new Set(prev); next.delete(questionId); return next; });
        },
      },
    );
  }, [testId, assignedQuestions, addQuestions]);

  const handleRemoveQuestion = useCallback((questionId: string) => {
    setConfirmRemove(null);
    setRemovingQuestions((prev) => new Set(prev).add(questionId));
    removeQuestion.mutate(
      { testId, questionId },
      {
        onSuccess: () => {
          setRemovingQuestions((prev) => { const next = new Set(prev); next.delete(questionId); return next; });
        },
        onError: () => {
          setRemovingQuestions((prev) => { const next = new Set(prev); next.delete(questionId); return next; });
        },
      },
    );
  }, [testId, removeQuestion]);

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
      <div className="py-12 text-center">
        <p className="text-gray-500">Mock test not found.</p>
        <Link href="/teacher/mock-tests" className="mt-2 inline-block text-sm text-blue-600 hover:underline">Back to Mock Tests</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${test.title} — Questions`}
        description={`${assignedQuestions?.length ?? 0} question(s) assigned`}
        breadcrumbs={[
          { label: 'Mock Tests', href: '/teacher/mock-tests' },
          { label: test.title, href: `/teacher/mock-tests/${testId}/edit` },
          { label: 'Questions' },
        ]}
        actions={
          <Link href={`/teacher/mock-tests/${testId}/publish`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Continue to Publish
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Assigned questions */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900">Assigned Questions</h2>
            </div>
            <div className="max-h-[600px] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
              {(!assignedQuestions || assignedQuestions.length === 0) ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-gray-500">No questions assigned yet.</p>
                  <p className="mt-1 text-xs text-gray-400">Browse the question bank and add questions.</p>
                </div>
              ) : (
                assignedQuestions.map((aq, idx) => (
                  <div key={aq.questionId} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900">#{idx + 1}</p>
                      <p className="truncate text-[11px] text-gray-500">{aq.marks} marks</p>
                    </div>
                    <button
                      type="button"
                      disabled={removingQuestions.has(aq.questionId)}
                      onClick={() => setConfirmRemove(aq.questionId)}
                      className="ml-2 shrink-0 rounded px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      {removingQuestions.has(aq.questionId) ? '...' : 'Remove'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Question Bank browser */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }}
              placeholder="Search questions..." className="min-w-[200px] flex-1" />
            <select value={subjectFilter} onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }}
              className="min-w-[130px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
              <option value="">All Subjects</option>
              {subjects.map((s) => <option key={s.subjectId} value={s.subjectId}>{s.name}</option>)}
            </select>
            <select value={difficultyFilter} onChange={(e) => { setDifficultyFilter(e.target.value); setPage(1); }}
              className="min-w-[110px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
              <option value="">All Difficulties</option>
              {DIFFICULTY_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
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
              <EmptyState title="No questions found" description={search ? 'Try a different search term.' : 'Add questions to the question bank first.'} />
            ) : (
              questions.map((q, idx) => {
                const isAssigned = assignedIds.has(q.questionId);
                const isAdding = addingQuestions.has(q.questionId);
                return (
                  <div key={q.questionId}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      isAssigned ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10' : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-gray-900">{q.questionText}</p>
                        <StatusBadge status={q.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium uppercase dark:bg-gray-800">{q.questionType}</span>
                        <span>{q.difficulty}</span>
                        <span>{q.marks} marks</span>
                        {q.negativeMarks > 0 && <span>-{q.negativeMarks} neg.</span>}
                      </div>
                    </div>
                    {isAssigned ? (
                      <button type="button" onClick={() => setConfirmRemove(q.questionId)}
                        disabled={removingQuestions.has(q.questionId)}
                        className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
                        {removingQuestions.has(q.questionId) ? '...' : 'Remove'}
                      </button>
                    ) : (
                      <button type="button" onClick={() => handleAddQuestion(q.questionId, idx)}
                        disabled={isAdding}
                        className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40">
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
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40">Previous</button>
                <span className="text-xs text-gray-500">Page {page} of {Math.ceil(totalCount / PAGE_SIZE)}</span>
                <button type="button" disabled={page >= Math.ceil(totalCount / PAGE_SIZE)} onClick={() => setPage(page + 1)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
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
