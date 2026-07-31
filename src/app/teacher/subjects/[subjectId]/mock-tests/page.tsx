'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMemo } from 'react';
import {
  useBSAssignedMockTests,
} from '@/hooks/admin/useBatchSubjectMockTestAssignment';
import { useBatchSubjectDetail } from '@/hooks/admin/useBatchSubjectContentAssignment';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import type { AssignedBatchSubjectMockTest } from '@/services/admin/batchSubjectMockTestService';
import {
  ClipboardText,
  Eye,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getAssignmentStatus(
  availableFrom: string | null,
  availableUntil: string | null,
): { label: string; color: string } {
  const now = new Date();
  if (availableFrom && new Date(availableFrom) > now) {
    return { label: 'Upcoming', color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400' };
  }
  if (availableUntil && new Date(availableUntil) < now) {
    return { label: 'Expired', color: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400' };
  }
  return { label: 'Active', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function TeacherBatchSubjectMockTestsPage() {
  const params = useParams();
  const router = useRouter();
  const batchSubjectId = params.subjectId as string;

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: subjectDetail, isLoading: detailLoading } = useBatchSubjectDetail(batchSubjectId);
  const { data: assignedTests, isLoading: testsLoading } = useBSAssignedMockTests(batchSubjectId);

  // ── Columns ──────────────────────────────────────────────────────────
  const columns: Column<AssignedBatchSubjectMockTest>[] = useMemo(
    () => [
      {
        key: 'title',
        header: 'Mock Test',
        render: (item) => (
          <div className="flex items-center gap-3 max-w-[240px]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20 dark:text-indigo-400">
              <ClipboardText size={18} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.title}
              </p>
              <span className="text-[10px] uppercase text-gray-500">{item.testType}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <StatusBadge status={item.status} showDot />,
      },
      {
        key: 'duration',
        header: 'Duration',
        render: (item) => (
          <span className="text-xs text-gray-600 dark:text-gray-400">{item.durationMin} min</span>
        ),
      },
      {
        key: 'totalMarks',
        header: 'Marks',
        render: (item) => (
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.totalMarks}</span>
        ),
      },
      {
        key: 'availability',
        header: 'Availability',
        render: (item) => {
          const status = getAssignmentStatus(item.availableFrom, item.availableUntil);
          return (
            <div className="flex flex-col gap-0.5">
              <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}>
                {status.label}
              </span>
              <span className="text-[10px] text-gray-400">
                {item.availableFrom ? formatDate(item.availableFrom) : 'Always'} —
                {item.availableUntil ? formatDate(item.availableUntil) : 'Always'}
              </span>
            </div>
          );
        },
      },
      {
        key: 'attemptLimit',
        header: 'Attempts',
        render: (item) => (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {item.attemptLimit ?? '∞'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: '80px',
        render: (item) => (
          <button
            type="button"
            onClick={() => router.push(`/teacher/mock-tests/${item.mockTestId}/edit`)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
          >
            <Eye size={13} />
            View
          </button>
        ),
      },
    ],
    [router],
  );

  // ── Stats ────────────────────────────────────────────────────────────
  const activeCount = assignedTests?.filter((t) => {
    const now = new Date();
    const from = t.availableFrom ? new Date(t.availableFrom) : null;
    const until = t.availableUntil ? new Date(t.availableUntil) : null;
    if (from && from > now) return false;
    if (until && until < now) return false;
    return true;
  }).length ?? 0;

  // ═════════════════════════════════════════════════════════════════════
  //  Loading / Error
  // ═════════════════════════════════════════════════════════════════════
  if (detailLoading) {
    return (
      <div>
        <PageHeader
          title="Loading..."
          breadcrumbs={[
            { label: 'Dashboard', href: '/teacher' },
            { label: 'My Subjects', href: '/teacher/subjects' },
            { label: 'Loading...' },
          ]}
        />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!subjectDetail) {
    return (
      <div>
        <PageHeader
          title="Not Found"
          breadcrumbs={[
            { label: 'Teacher', href: '/teacher' },
            { label: 'Subjects', href: '/teacher/subjects' },
          ]}
        />
        <EmptyState
          title="Batch Subject not found"
          description="This subject may not be available or you may not have access."
        />
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
        description={`${subjectDetail.batchName} · Mock Tests`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/teacher' },
          { label: 'My Subjects', href: '/teacher/subjects' },
          { label: subjectDetail.subjectName, href: `/teacher/subjects/${batchSubjectId}/content` },
          { label: 'Mock Tests' },
        ]}
        actions={
          <Link
            href={`/teacher/subjects/${batchSubjectId}/content`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            ← Content
          </Link>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {assignedTests?.length ?? 0}
          </p>
          <p className="text-xs text-gray-500">Total Tests</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
          <p className="text-xs text-gray-500">Active</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {assignedTests?.reduce((acc, t) => acc + (t.durationMin ?? 0), 0) ?? 0}
          </p>
          <p className="text-xs text-gray-500">Total Minutes</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {assignedTests?.reduce((acc, t) => acc + (t.totalMarks ?? 0), 0) ?? 0}
          </p>
          <p className="text-xs text-gray-500">Total Marks</p>
        </div>
      </div>

      {/* Assigned Mock Tests */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Assigned Mock Tests
            {assignedTests && assignedTests.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-500">({assignedTests.length})</span>
            )}
          </h3>
        </div>

        {testsLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : assignedTests && assignedTests.length > 0 ? (
          <DataTable<AssignedBatchSubjectMockTest>
            columns={columns}
            data={assignedTests}
            keyExtractor={(item) => item.assignmentId}
            isLoading={false}
            emptyState={
              <EmptyState
                icon={<ClipboardText size={32} weight="thin" />}
                title="No mock tests assigned"
                description="No tests have been assigned to this subject yet."
              />
            }
          />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<ClipboardText size={32} weight="thin" />}
              title="No mock tests assigned"
              description="No tests have been assigned to this subject yet. Contact your admin to assign mock tests."
            />
          </div>
        )}
      </div>
    </div>
  );
}
