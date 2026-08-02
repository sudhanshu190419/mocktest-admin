'use client';

import { useState, useCallback, useMemo, use } from 'react';
import Link from 'next/link';
import { usePyqPackage } from '@/hooks/pyq/usePyqPackages';
import { usePyqPaper } from '@/hooks/pyq/usePyqPapers';
import { usePyqMappings, useAddPyqMapping, useRemovePyqMapping } from '@/hooks/pyq/usePyqQuestionMappings';
import { usePyqMockMappingWithTest, useGeneratePyqMock, useRegeneratePyqMock } from '@/hooks/pyq/usePyqMockMapping';
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

export default function PyqManageQuestionsPage({
  params,
}: {
  params: Promise<{ id: string; paperId: string }>;
}) {
  const { id: packageId, paperId } = use(params);

  const { data: pkg, isLoading: pkgLoading } = usePyqPackage(packageId);
  const { data: paper, isLoading: paperLoading } = usePyqPaper(paperId);
  const { data: assignedMappings, isLoading: assignedLoading } = usePyqMappings(paperId);
  const addMapping = useAddPyqMapping();
  const removeMapping = useRemovePyqMapping();

  // Mock test generation
  const { data: mockData, isLoading: mockLoading } = usePyqMockMappingWithTest(paperId);
  const generateMock = useGeneratePyqMock();
  const regenerateMock = useRegeneratePyqMock();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // Question bank search/filter state
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');

  // Build filters for question bank query
  const filters: Record<string, unknown> = {};
  if (search) filters.search = search;
  if (subjectFilter) filters.subjectId = subjectFilter;
  if (difficultyFilter) filters.difficulty = difficultyFilter;

  const { data: questionsData, isLoading: questionsLoading } = useQuestions(
    Object.keys(filters).length > 0 ? (filters as any) : undefined,
    undefined,
    { page, pageSize: PAGE_SIZE },
  );
  const questions = questionsData?.data ?? [];
  const totalCount = questionsData?.count ?? 0;

  const { data: subjectsData } = useSubjects(
    undefined,
    undefined,
    { page: 1, pageSize: 200 },
  );
  const subjects = subjectsData?.data ?? [];

  // Track which questions are already assigned
  const assignedIds = useMemo(() => {
    if (!assignedMappings) return new Set<string>();
    return new Set(assignedMappings.map((m) => m.questionId));
  }, [assignedMappings]);

  // Track questions being added/removed (for loading UX)
  const [addingQuestions, setAddingQuestions] = useState<Set<string>>(new Set());
  const [removingQuestions, setRemovingQuestions] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // ── Add single question ────────────────────────────────────────────────

  const handleAddQuestion = useCallback((questionId: string) => {
    setAddingQuestions((prev) => new Set(prev).add(questionId));
    const nextOrder = (assignedMappings?.length ?? 0) + 1;
    addMapping.mutate(
      { paperId, questionId, orderSequence: nextOrder },
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
  }, [paperId, assignedMappings, addMapping]);

  // ── Remove single question ─────────────────────────────────────────────

  const handleRemoveQuestion = useCallback((questionId: string) => {
    setConfirmRemove(null);
    setRemovingQuestions((prev) => new Set(prev).add(questionId));
    removeMapping.mutate(
      { paperId, questionId },
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
  }, [paperId, removeMapping]);

  // Loading state
  const isLoading = pkgLoading || paperLoading || assignedLoading;
  if (isLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Loading question management..." />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!paper || !pkg) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Paper not found.</p>
        <Link href={`/teacher/pyq/packages/${packageId}/papers`} className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          Back to Papers
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${paper.title} — Manage Questions`}
        description={`${assignedMappings?.length ?? 0} question(s) assigned`}
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
          { label: pkg.name, href: `/teacher/pyq/packages/${packageId}/papers` },
          { label: 'Papers', href: `/teacher/pyq/packages/${packageId}/papers` },
          { label: paper.title, href: `/teacher/pyq/packages/${packageId}/papers/${paperId}/edit` },
          { label: 'Questions' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/pyq/packages/${packageId}/papers/${paperId}/edit`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
            >
              Back to Paper
            </Link>
          </div>
        }
      />

      {/* ── Mock Test Status ─────────────────────────────────────────────── */}
      {!mockLoading && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                mockData
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  {mockData ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  )}
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Mock Test
                </p>
                <p className="text-xs text-gray-500">
                  {mockData
                    ? `"${mockData.mockTest.title}" · ${assignedMappings?.length ?? 0} questions · Created ${new Date(mockData.mockMapping.createdAt).toLocaleDateString()}`
                    : 'Not yet generated'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mockData ? (
                <>
                  <Link
                    href={`/teacher/mock-tests/${mockData.mockTest.testId}/edit`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    View Mock Test
                  </Link>
                  <button
                    type="button"
                    onClick={() => setConfirmRegenerate(true)}
                    disabled={regenerateMock.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-4 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {regenerateMock.isPending ? 'Regenerating...' : 'Regenerate'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => generateMock.mutate(paperId)}
                  disabled={generateMock.isPending || !assignedMappings || assignedMappings.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generateMock.isPending ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating...
                    </>
                  ) : (
                    'Generate Mock Test'
                  )}
                </button>
              )}
            </div>
          </div>
          {/* Generate button disabled hint */}
          {!assignedMappings || assignedMappings.length === 0 ? (
            <p className="mt-2 text-xs text-amber-600">
              Assign at least one question before generating a mock test.
            </p>
          ) : generateMock.isError ? (
            <p className="mt-2 text-xs text-red-600">
              {generateMock.error?.message}
            </p>
          ) : regenerateMock.isError ? (
            <p className="mt-2 text-xs text-red-600">
              {regenerateMock.error?.message}
            </p>
          ) : null}
        </div>
      )}

      {/* Regenerate confirmation dialog */}
      <ConfirmDialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={() => {
          setConfirmRegenerate(false);
          regenerateMock.mutate(paperId);
        }}
        title="Regenerate Mock Test"
        message="This will delete the existing mock test and create a new one with the current set of mapped questions. Any attempt history on the existing mock test will be lost. Continue?"
        confirmLabel="Regenerate"
        variant="warning"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left: Assigned Questions ───────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900">Assigned Questions</h2>
            </div>
            <div className="max-h-[600px] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
              {(!assignedMappings || assignedMappings.length === 0) ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-gray-500">No questions assigned yet.</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Browse the question bank and add questions.
                  </p>
                </div>
              ) : (
                assignedMappings.map((m, idx) => (
                  <div key={m.questionId} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900">#{idx + 1}</p>
                      <p className="truncate text-[11px] text-gray-500">
                        {m.officialMarks ? `${m.officialMarks} marks` : '— marks'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={removingQuestions.has(m.questionId)}
                      onClick={() => setConfirmRemove(m.questionId)}
                      className="ml-2 shrink-0 rounded px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      {removingQuestions.has(m.questionId) ? '...' : 'Remove'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Question Bank Browser ───────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <SearchBar
              value={search}
              onChange={(v) => { setSearch(v); setPage(1); }}
              placeholder="Search questions..."
              className="min-w-[200px] flex-1"
            />
            <select
              value={subjectFilter}
              onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }}
              className="min-w-[130px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>{s.name}</option>
              ))}
            </select>
            <select
              value={difficultyFilter}
              onChange={(e) => { setDifficultyFilter(e.target.value); setPage(1); }}
              className="min-w-[110px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Difficulties</option>
              {DIFFICULTY_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Question cards */}
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
                description={
                  search
                    ? 'Try a different search term.'
                    : 'Add questions to the question bank first.'
                }
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
                        <p className="truncate text-sm font-medium text-gray-900">
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
                    {isAssigned ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(q.questionId)}
                        disabled={removingQuestions.has(q.questionId)}
                        className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >
                        {removingQuestions.has(q.questionId) ? '...' : 'Remove'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddQuestion(q.questionId)}
                        disabled={isAdding}
                        className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40"
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
              <p className="text-xs text-gray-500">
                {totalCount} question(s) total
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
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
                  className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Remove confirmation dialog */}
      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && handleRemoveQuestion(confirmRemove)}
        title="Remove Question"
        message="This question will be removed from this PYQ paper. The question itself is not deleted from the question bank."
        confirmLabel="Remove"
        variant="warning"
      />
    </div>
  );
}
