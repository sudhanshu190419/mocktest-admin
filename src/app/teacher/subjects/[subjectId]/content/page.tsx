'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useBatchSubjectDetail, useBatchSubjectContent, useUpdateBatchSubjectContentAssignment } from '@/hooks/admin/useBatchSubjectContentAssignment';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import type { AssignedBatchSubjectContent } from '@/services/admin/batchSubjectContentService';
import { BookOpen, FileText, Trash, ArrowUp, ArrowDown, PlayCircle } from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getContentIcon(contentType: string): React.ReactNode {
  const icons: Record<string, React.ReactNode> = {
    pdf: <FileText size={14} />,
    video: <PlayCircle size={14} />,
    notes: <BookOpen size={14} />,
    assignment: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  };
  return icons[contentType] ?? <FileText size={14} />;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function TeacherBatchSubjectContentPage() {
  const params = useParams();
  const router = useRouter();
  const batchSubjectId = params.subjectId as string;

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: subjectDetail, isLoading: detailLoading } = useBatchSubjectDetail(batchSubjectId);
  const { data: assignedContent, isLoading: contentLoading } = useBatchSubjectContent(batchSubjectId);
  const updateMutation = useUpdateBatchSubjectContentAssignment();

  // ── State ────────────────────────────────────────────────────────────
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearFeedback = useCallback(() => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setActionFeedback(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleToggleOptional = async (item: AssignedBatchSubjectContent) => {
    const result = await updateMutation.mutateAsync({
      batchSubjectContentId: item.batchSubjectContentId,
      updates: { isOptional: !item.isOptional },
    });
    if (result.success) {
      setActionFeedback({ type: 'success', message: `"${item.title}" updated.` });
    } else {
      setActionFeedback({ type: 'error', message: result.error ?? 'Update failed.' });
    }
    clearFeedback();
  };

  const handleViewContent = (contentId: string) => {
    router.push(`/teacher/content/${contentId}/edit`);
  };

  // ── Columns ──────────────────────────────────────────────────────────
  const columns: Column<AssignedBatchSubjectContent>[] = useMemo(() => [
    {
      key: 'orderSequence',
      header: '#',
      width: '40px',
      render: (item) => (
        <span className="text-xs font-medium text-gray-400">{item.orderSequence}</span>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (item) => (
        <div className="flex items-center gap-3 max-w-[240px]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {getContentIcon(item.contentType)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {item.title}
            </p>
            <span className="text-[10px] text-gray-500 uppercase">{item.contentType}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'chapterName',
      header: 'Chapter',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.chapterName ?? '—'}
        </span>
      ),
    },
    {
      key: 'sectionName',
      header: 'Section',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.sectionName ?? '—'}
        </span>
      ),
    },
    {
      key: 'isOptional',
      header: 'Type',
      render: (item) => (
        <button
          type="button"
          onClick={() => handleToggleOptional(item)}
          disabled={updateMutation.isPending}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
            item.isOptional
              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400'
          }`}
        >
          {item.isOptional ? 'Optional' : 'Required'}
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <StatusBadge status={item.status} showDot={true} />,
    },
    {
      key: 'assignedAt',
      header: 'Added',
      render: (item) => (
        <span className="text-xs text-gray-500">{formatDate(item.assignedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      render: (item) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleViewContent(item.contentId)}
            className="rounded p-1.5 text-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
            title="View/Edit"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
          </button>
        </div>
      ),
    },
  ], [updateMutation.isPending]);

  // ═════════════════════════════════════════════════════════════════════
  //  Loading / Error States
  // ═════════════════════════════════════════════════════════════════════
  if (detailLoading) {
    return (
      <div>
        <PageHeader title="Loading..." breadcrumbs={[{ label: 'Teacher', href: '/teacher' }, { label: 'Subjects', href: '/teacher/subjects' }, { label: 'Loading...' }]} />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!subjectDetail) {
    return (
      <div>
        <PageHeader title="Not Found" breadcrumbs={[{ label: 'Teacher', href: '/teacher' }, { label: 'Subjects', href: '/teacher/subjects' }]} />
        <EmptyState title="Batch Subject not found" description="This subject may not be available or you may not have access." />
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      <PageHeader
        title={subjectDetail.subjectName}
        description={`${subjectDetail.batchName} · ${subjectDetail.subjectCode}`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/teacher' },
          { label: 'My Subjects', href: '/teacher/subjects' },
          { label: subjectDetail.subjectName },
        ]}
        actions={
          <Link
            href="/teacher/content/create"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Upload New Content
          </Link>
        }
      />

      {/* Action Feedback */}
      {actionFeedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            actionFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {actionFeedback.message}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {assignedContent?.length ?? 0}
          </p>
          <p className="text-xs text-gray-500">Total Content</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-emerald-600">
            {assignedContent?.filter((c) => !c.isOptional).length ?? 0}
          </p>
          <p className="text-xs text-gray-500">Required</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-amber-600">
            {assignedContent?.filter((c) => c.isOptional).length ?? 0}
          </p>
          <p className="text-xs text-gray-500">Optional</p>
        </div>
      </div>

      {/* Content List */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Assigned Content
          </h3>
        </div>

        {contentLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : assignedContent && assignedContent.length > 0 ? (
          <DataTable<AssignedBatchSubjectContent>
            columns={columns}
            data={assignedContent}
            keyExtractor={(item) => item.batchSubjectContentId}
            isLoading={false}
            emptyState={
              <EmptyState
                icon={<BookOpen size={32} weight="thin" />}
                title="No content assigned"
                description="No content has been assigned to this subject yet."
                action={
                  <Link
                    href="/teacher/content/create"
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Upload Content
                  </Link>
                }
              />
            }
          />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<BookOpen size={32} weight="thin" />}
              title="No content assigned"
              description="No content has been assigned to this subject yet. Upload new content or ask your admin to assign existing content."
              action={
                <Link
                  href="/teacher/content/create"
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Upload Content
                </Link>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
