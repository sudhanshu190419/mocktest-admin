'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  useDemoClassList,
  usePublishDemoClass,
  useArchiveDemoClass,
} from '@/hooks/admin/useDemoClassAdmin';
import { useStreams } from '@/hooks/academic/useStreams';
import { DemoClassFormModal } from '@/components/admin/demo-classes/DemoClassFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { getDemoClassThumbnailUrl } from '@/services/admin/demoClassAdminService';
import { Plus, PencilSimple, PaperPlaneTilt, ArchiveBoxIcon, VideoCamera } from '@phosphor-icons/react';
import type { DemoClass } from '@/types/demoClass';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminDemoClassesPage() {
  const { instituteId } = useAuth();

  // ── Filter state ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streamFilter, setStreamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // ── Modal / dialog state ─────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDemo, setEditingDemo] = useState<DemoClass | null>(null);
  // Changes on every open so the modal remounts with fresh form state.
  const [modalSession, setModalSession] = useState(0);
  const [archiveTarget, setArchiveTarget] = useState<DemoClass | null>(null);

  // ── Feedback state (toast pattern from admin pages) ──────────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(value), 400);
  }, []);

  const handleFilterChange = useCallback((setter: (val: string) => void, value: string) => {
    setter(value);
    setPage(1);
  }, []);

  // ── Streams (filter dropdown + modal share the same cached query) ────
  const { data: streamData } = useStreams(
    instituteId ? { instituteId, isActive: true } : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page: 1, pageSize: 100 },
  );
  const streamOptions = useMemo(
    () => (streamData?.data ?? []).map((s) => ({ value: s.streamId, label: s.name })),
    [streamData],
  );

  // ── Data fetching ────────────────────────────────────────────────────
  const filters = useMemo(
    () => ({
      instituteId: instituteId ?? undefined,
      streamId: streamFilter || undefined,
      status: (statusFilter || undefined) as DemoClass['status'] | undefined,
      search: debouncedSearch || undefined,
    }),
    [instituteId, streamFilter, statusFilter, debouncedSearch],
  );

  const { data, isLoading } = useDemoClassList(filters, { page, pageSize });

  // ── Mutations ────────────────────────────────────────────────────────
  const publishMutation = usePublishDemoClass();
  const archiveMutation = useArchiveDemoClass();

  const openCreate = useCallback(() => {
    setEditingDemo(null);
    setModalSession((s) => s + 1);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((demo: DemoClass) => {
    setEditingDemo(demo);
    setModalSession((s) => s + 1);
    setModalOpen(true);
  }, []);

  const handlePublish = useCallback(
    (demo: DemoClass) => {
      publishMutation.mutate(demo.demoClassId, {
        onSuccess: () => showToast('success', `"${demo.title}" is now published and visible to students.`),
        onError: (err) => showToast('error', err.message),
      });
    },
    [publishMutation, showToast],
  );

  const handleArchiveConfirm = useCallback(() => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    archiveMutation.mutate(target.demoClassId, {
      onSuccess: () => {
        showToast('success', `"${target.title}" archived. It is now hidden from students.`);
        setArchiveTarget(null);
      },
      onError: (err) => {
        showToast('error', err.message);
        setArchiveTarget(null);
      },
    });
  }, [archiveTarget, archiveMutation, showToast]);

  // ── Table columns ────────────────────────────────────────────────────
  const columns = useMemo<Column<DemoClass>[]>(
    () => [
      {
        key: 'thumbnail',
        header: 'Preview',
        render: (item) => {
          const url = getDemoClassThumbnailUrl(item);
          return url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={item.title}
              className="h-10 w-16 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
            />
          ) : (
            <div className="flex h-10 w-16 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
              <VideoCamera size={18} className="text-gray-400" />
            </div>
          );
        },
      },
      {
        key: 'title',
        header: 'Title',
        render: (item) => (
          <div className="max-w-xs">
            <p className="font-medium text-gray-900 dark:text-gray-100">{item.title}</p>
            {item.description && (
              <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                {item.description}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'streamName',
        header: 'Stream',
        render: (item) => (
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {item.streamName ?? '—'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <StatusBadge status={item.status} />,
      },
      {
        key: 'createdAt',
        header: 'Created',
        render: (item) => <span className="text-gray-600 dark:text-gray-400">{formatDate(item.createdAt)}</span>,
      },
      {
        key: 'publishedAt',
        header: 'Published',
        render: (item) => <span className="text-gray-600 dark:text-gray-400">{formatDate(item.publishedAt)}</span>,
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (item) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(item);
              }}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
            >
              <PencilSimple size={16} />
            </button>
            {(item.status === 'draft' || item.status === 'archived') && (
              <button
                type="button"
                title={item.status === 'archived' ? 'Republish' : 'Publish'}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePublish(item);
                }}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400"
              >
                <PaperPlaneTilt size={16} />
              </button>
            )}
            {item.status === 'published' && (
              <button
                type="button"
                title="Archive"
                onClick={(e) => {
                  e.stopPropagation();
                  setArchiveTarget(item);
                }}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
              >
                <ArchiveBoxIcon size={16} />
              </button>
            )}
          </div>
        ),
      },
    ],
    [handlePublish, openEdit],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Demo Classes"
        description="Manage stream-specific demo classes shown to students."
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <Plus size={16} />
            New Demo Class
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by title..."
          className="w-64"
        />
        <Select
          value={streamFilter}
          onChange={(v) => handleFilterChange(setStreamFilter, v)}
          options={streamOptions}
          placeholder="All Streams"
          className="w-48"
        />
        <Select
          value={statusFilter}
          onChange={(v) => handleFilterChange(setStatusFilter, v)}
          options={STATUS_OPTIONS}
          placeholder="All Statuses"
          className="w-44"
        />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        keyExtractor={(item) => item.demoClassId}
        isLoading={isLoading}
        totalCount={data?.count ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            icon={<VideoCamera size={32} />}
            title="No demo classes found"
            description={
              debouncedSearch || streamFilter || statusFilter
                ? 'Try adjusting the filters, or create a new demo class.'
                : 'Create your first stream-specific demo class to show new students a preview of your teaching.'
            }
            action={
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <Plus size={16} />
                New Demo Class
              </button>
            }
          />
        }
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg animate-[fadeIn_200ms_ease-out] ${
            toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
        >
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}

      {/* Create / Edit modal */}
      {modalOpen && (
        <DemoClassFormModal
          key={modalSession}
          open={modalOpen}
          mode={editingDemo ? 'edit' : 'create'}
          demo={editingDemo}
          onClose={() => setModalOpen(false)}
          onSuccess={() =>
            showToast(
              'success',
              editingDemo ? 'Demo class updated successfully.' : 'Demo class created as a draft.',
            )
          }
        />
      )}

      {/* Archive confirmation */}
      <ConfirmDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchiveConfirm}
        title="Archive demo class?"
        message={`"${archiveTarget?.title ?? ''}" will be hidden from students immediately. The video file is kept for admin history.`}
        confirmLabel="Archive"
        loading={archiveMutation.isPending}
        variant="warning"
      />
    </div>
  );
}
