'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuestions, usePublishQuestion, useArchiveQuestion, useRestoreQuestion, useDeleteQuestion } from '@/hooks/mockTest/useQuestions';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useChapters } from '@/hooks/academic/useChapters';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useQuestionFilters } from '@/features/question-bank/hooks/useQuestionFilters';
import { useQuestionBulkActions } from '@/features/question-bank/hooks/useQuestionBulkActions';
import type { Question, QuestionType, DifficultyLevel } from '@/types/mockTest';

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'MCQ',
  msq: 'MSQ (Multi)',
  numerical: 'Numerical',
  text_based: 'Text-Based',
  true_false: 'True/False',
  subjective: 'Subjective / Descriptive',
};

const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export default function QuestionListPage() {
  const router = useRouter();
  const { canRestoreDeletedData } = usePermissions();
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { filters, updateFilter, resetFilters, apiFilters, hasActiveFilters } = useQuestionFilters();
  const { selectedIds, setSelectedIds, clearSelection, selectionCount } = useQuestionBulkActions();

  const { data: subjectsData } = useSubjects();
  const subjectList = subjectsData?.data ?? [];

  const { data: chaptersData } = useChapters(filters.subjectId ? { subjectId: filters.subjectId } : undefined);
  const chapterList = chaptersData?.data ?? [];

  const { data: questionsData, isLoading } = useQuestions(
    apiFilters,
    { sortBy: 'updatedAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );
  const questions = questionsData?.data ?? [];
  const totalCount = questionsData?.count ?? 0;

  const { mutate: publishQuestion } = usePublishQuestion();
  const { mutate: archiveQuestion } = useArchiveQuestion();
  const { mutate: restoreQuestion } = useRestoreQuestion();
  const { mutate: deleteQuestion } = useDeleteQuestion();

  const [confirmAction, setConfirmAction] = useState<{ type: string; id?: string; label?: string } | null>(null);

  const handleBulkAction = useCallback(
    (action: string) => {
      if (selectedIds.size === 0) return;
      switch (action) {
        case 'publish':
          selectedIds.forEach((id) => publishQuestion(id));
          clearSelection();
          break;
        case 'archive':
          selectedIds.forEach((id) => archiveQuestion(id));
          clearSelection();
          break;
        case 'restore':
          selectedIds.forEach((id) => restoreQuestion(id));
          clearSelection();
          break;
        case 'delete':
          setConfirmAction({
            type: 'bulk-delete',
          });
          break;
      }
    },
    [selectedIds, publishQuestion, archiveQuestion, restoreQuestion, deleteQuestion, clearSelection],
  );

  const columns: Column<Question>[] = [
    {
      key: 'questionText',
      header: 'Question',
      sortable: true,
      render: (q) => (
        <div className="max-w-md truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {q.questionText}
        </div>
      ),
    },
    {
      key: 'questionType',
      header: 'Type',
      sortable: true,
      render: (q) => (
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {QUESTION_TYPE_LABELS[q.questionType] ?? q.questionType}
        </span>
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      sortable: true,
      render: (q) => {
        const colors: Record<string, string> = {
          easy: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
          medium: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
          hard: 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-400',
        };
        return (
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${colors[q.difficulty] ?? ''}`}>
            {DIFFICULTY_LABELS[q.difficulty] ?? q.difficulty}
          </span>
        );
      },
    },
    {
      key: 'marks',
      header: 'Marks',
      sortable: true,
      className: 'text-center',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (q) => <StatusBadge status={q.status} />,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      render: (q) => (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {new Date(q.updatedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (q) => (
        <div className="flex items-center gap-1">
          <Link
            href={`/teacher/questions/${q.questionId}/edit`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
          >
            Edit
          </Link>
          <Link
            href={`/teacher/questions/${q.questionId}/preview`}
            className="rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Preview
          </Link>
          {q.status === 'pending_approval' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                publishQuestion(q.questionId);
              }}
              className="rounded px-2 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
            >
              Publish
            </button>
          )}
          {q.status === 'published' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmAction({
                  type: 'archive',
                  id: q.questionId,
                  label: `archive question "${q.questionText.slice(0, 40)}..."`,
                });
              }}
              className="rounded px-2 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
            >
              Archive
            </button>
          )}
          {q.status === 'archived' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                restoreQuestion(q.questionId);
              }}
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Restore
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Questions"
        description={`${totalCount} question${totalCount !== 1 ? 's' : ''} in the bank`}
        breadcrumbs={[
          { label: 'Question Bank', href: '/teacher/questions' },
          { label: 'All Questions' },
        ]}
        actions={
          <Link
            href="/teacher/questions/create"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Question
          </Link>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBar
            value={filters.search}
            onChange={(v) => updateFilter('search', v)}
            placeholder="Search questions..."
            className="min-w-[240px] flex-1"
          />
          <select
            value={filters.subjectId}
            onChange={(e) => {
              updateFilter('subjectId', e.target.value);
              updateFilter('chapterId', '');
              updateFilter('topicId', '');
            }}
            className="min-w-[150px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">All Subjects</option>
            {subjectList.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>{s.name}</option>
            ))}
          </select>
          <select
            value={filters.chapterId}
            onChange={(e) => {
              updateFilter('chapterId', e.target.value);
              updateFilter('topicId', '');
            }}
            disabled={!filters.subjectId}
            className="min-w-[150px] rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">All Chapters</option>
            {chapterList.map((c) => (
              <option key={c.chapterId} value={c.chapterId}>{c.name}</option>
            ))}
          </select>
          <select
            value={filters.difficulty}
            onChange={(v) => updateFilter('difficulty', v.target.value)}
            className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">All Difficulty</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <select
            value={filters.questionType}
            onChange={(v) => updateFilter('questionType', v.target.value)}
            className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">All Types</option>
            <option value="mcq">MCQ</option>
            <option value="msq">MSQ</option>
            <option value="numerical">Numerical</option>
            <option value="true_false">True/False</option>
          </select>
          <select
            value={filters.status}
            onChange={(v) => updateFilter('status', v.target.value)}
            className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {selectionCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
            {selectionCount} selected
          </span>
          <button type="button" onClick={() => handleBulkAction('publish')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">Publish All</button>
          <button type="button" onClick={() => handleBulkAction('archive')} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">Archive All</button>
          <button type="button" onClick={() => handleBulkAction('restore')} className="rounded-lg bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">Restore All</button>
          {canRestoreDeletedData && (
            <button type="button" onClick={() => handleBulkAction('delete')} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700">Delete All</button>
          )}
          <button type="button" onClick={clearSelection} className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400">Clear Selection</button>
        </div>
      )}

      <DataTable<Question>
        columns={columns}
        data={questions}
        keyExtractor={(q) => q.questionId}
        onRowClick={(q) => router.push(`/teacher/questions/${q.questionId}/edit`)}
        isLoading={isLoading}
        sortable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No questions found"
            description={hasActiveFilters ? 'Try adjusting your filters or search query.' : 'Get started by creating your first question.'}
            action={
              <Link href="/teacher/questions/create" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Create Question
              </Link>
            }
          />
        }
      />

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.type === 'archive' && confirmAction.id) {
            archiveQuestion(confirmAction.id);
          } else if (confirmAction?.type === 'bulk-delete') {
            selectedIds.forEach((id) => deleteQuestion(id));
            clearSelection();
          }
          setConfirmAction(null);
        }}
        title={confirmAction?.type === 'bulk-delete' ? 'Delete Questions' : 'Confirm Archive'}
        message={confirmAction?.type === 'bulk-delete'
          ? `Are you sure you want to delete ${selectedIds.size} question(s)? These items will be moved to the Recycle Bin and can be restored later.`
          : 'Are you sure you want to archive this question?'}
        confirmLabel={confirmAction?.type === 'bulk-delete' ? 'Move to Recycle Bin' : 'Archive'}
        variant={confirmAction?.type === 'bulk-delete' ? 'danger' : 'warning'}
      />
    </div>
  );
}
