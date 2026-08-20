'use client';

import { useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useDemoClass,
  useDemoClassSignedUrl,
  usePublishDemoClass,
  useArchiveDemoClass,
  useDeleteDemoClass,
} from '@/hooks/admin/useDemoClassAdmin';
import { getDemoClassThumbnailUrl } from '@/services/admin/demoClassAdminService';
import { DemoClassFormModal } from '@/components/admin/demo-classes/DemoClassFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import {
  ArrowLeft,
  VideoCamera,
  CalendarBlank,
  Clock,
  PencilSimple,
  PaperPlaneTilt,
  ArchiveBoxIcon,
  CircleNotch,
  XCircle,
  ArrowSquareOut,
  DownloadSimple,
  HardDrives,
  GraduationCap,
  ListNumbers,
  Tag,
  Eye,
  Trash,
} from '@phosphor-icons/react';
import type { DemoClass } from '@/types/demoClass';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 text-xs">
      <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        {icon}
        {label}
      </span>
      <span className="font-medium text-gray-900 dark:text-gray-100 text-right">{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Detail Page
// ═══════════════════════════════════════════════════════════════════════════

export default function DemoClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id: demoClassId } = use(params);

  // ── Data Queries ──────────────────────────────────────────────────────────
  const { data: demoClass, isLoading, isError, error, refetch } = useDemoClass(demoClassId);
  const {
    data: signedUrlData,
    isLoading: signedUrlLoading,
    isError: signedUrlError,
    error: signedUrlErrorObj,
  } = useDemoClassSignedUrl(demoClass);

  // ── Modal & Dialog State ──────────────────────────────────────────────────
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [modalSession, setModalSession] = useState(0);
  const [confirmAction, setConfirmAction] = useState<'publish' | 'archive' | 'delete' | null>(null);

  // ── Toast Feedback ────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const publishMutation = usePublishDemoClass();
  const archiveMutation = useArchiveDemoClass();
  const deleteMutation = useDeleteDemoClass();

  const handleDelete = useCallback(() => {
    if (!demoClass) return;
    deleteMutation.mutate(
      { demoClassId: demoClass.demoClassId },
      {
        onSuccess: () => {
          setConfirmAction(null);
          router.push('/admin/demo-classes');
        },
        onError: (err) => {
          showToast('error', err.message);
          setConfirmAction(null);
        },
      },
    );
  }, [demoClass, deleteMutation, router, showToast]);

  const handlePublish = useCallback(() => {
    if (!demoClass) return;
    publishMutation.mutate(demoClass.demoClassId, {
      onSuccess: () => {
        showToast('success', `"${demoClass.title}" is now published.`);
        setConfirmAction(null);
      },
      onError: (err) => {
        showToast('error', err.message);
        setConfirmAction(null);
      },
    });
  }, [demoClass, publishMutation, showToast]);

  const handleArchive = useCallback(() => {
    if (!demoClass) return;
    archiveMutation.mutate(demoClass.demoClassId, {
      onSuccess: () => {
        showToast('success', `"${demoClass.title}" has been archived.`);
        setConfirmAction(null);
      },
      onError: (err) => {
        showToast('error', err.message);
        setConfirmAction(null);
      },
    });
  }, [demoClass, archiveMutation, showToast]);

  const thumbnailUrl = demoClass ? getDemoClassThumbnailUrl(demoClass) : null;

  // ── Loading Skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Skeleton className="h-96 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error State ───────────────────────────────────────────────────────────
  if (isError || !demoClass) {
    return (
      <div className="space-y-6">
        <Link
          href="/admin/demo-classes"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <ArrowLeft size={14} />
          Back to Demo Classes
        </Link>
        <EmptyState
          title="Demo class not found"
          description={error?.message || 'The requested demo class could not be loaded.'}
          action={
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              Try Again
            </button>
          }
        />
      </div>
    );
  }

  const isActionPending = publishMutation.isPending || archiveMutation.isPending;

  return (
    <div className="space-y-6">
      {/* ─── Toast Feedback ─────────────────────────────────────────── */}
      {toast && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm transition-all ${
            toast.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/admin/demo-classes"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 dark:hover:text-gray-300"
          >
            <ArrowLeft size={14} />
            Back to Demo Classes
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {demoClass.title}
            </h1>
            <StatusBadge status={demoClass.status} showDot={true} />
            {demoClass.streamName && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <GraduationCap size={13} />
                {demoClass.streamName}
              </span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setModalSession((s) => s + 1);
              setEditModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <PencilSimple size={14} />
            Edit
          </button>

          {(demoClass.status === 'draft' || demoClass.status === 'archived') && (
            <button
              type="button"
              onClick={() => setConfirmAction('publish')}
              disabled={isActionPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <PaperPlaneTilt size={14} />
              {demoClass.status === 'archived' ? 'Republish' : 'Publish'}
            </button>
          )}

          {demoClass.status === 'published' && (
            <button
              type="button"
              onClick={() => setConfirmAction('archive')}
              disabled={isActionPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3.5 py-2 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50 dark:border-amber-900/40 dark:bg-gray-900 dark:text-amber-400 dark:hover:bg-amber-900/20 disabled:opacity-50"
            >
              <ArchiveBoxIcon size={14} />
              Archive
            </button>
          )}

          <button
            type="button"
            onClick={() => setConfirmAction('delete')}
            disabled={isActionPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900/40 dark:bg-gray-900 dark:text-rose-400 dark:hover:bg-rose-900/20 disabled:opacity-50"
          >
            <Trash size={14} />
            Delete
          </button>

          {signedUrlData?.signedUrl && (
            <>
              <a
                href={signedUrlData.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ArrowSquareOut size={14} />
                Open in New Tab
              </a>
              <a
                href={signedUrlData.signedUrl}
                download={`${demoClass.title}.mp4`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <DownloadSimple size={14} />
                Download
              </a>
            </>
          )}
        </div>
      </div>

      {/* ─── Two-Column Layout ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ─── Left Column (Video Player + Description) ──────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Video Preview Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <VideoCamera size={18} weight="duotone" className="text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Demo Video Player
                </h2>
              </div>
              {signedUrlData?.signedUrl && (
                <div className="flex items-center gap-2">
                  <a
                    href={signedUrlData.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <ArrowSquareOut size={13} />
                    New Tab
                  </a>
                  <a
                    href={signedUrlData.signedUrl}
                    download={`${demoClass.title}.mp4`}
                    className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <DownloadSimple size={13} />
                    Download
                  </a>
                </div>
              )}
            </div>

            {/* Loading State */}
            {signedUrlLoading && (
              <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40">
                <CircleNotch size={28} className="animate-spin text-blue-600" />
                <p className="mt-2 text-xs text-gray-500">Generating secure video stream...</p>
              </div>
            )}

            {/* Error State */}
            {signedUrlError && (
              <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/40 dark:bg-red-900/10">
                <XCircle size={28} className="text-red-500" />
                <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">
                  Unable to load video stream.
                </p>
                <p className="mt-1 text-[11px] text-red-500">
                  {signedUrlErrorObj?.message || 'The storage object may be missing or inaccessible.'}
                </p>
              </div>
            )}

            {/* Video Player */}
            {signedUrlData?.signedUrl && (
              <div className="overflow-hidden rounded-lg bg-black shadow-inner">
                <video
                  controls
                  preload="metadata"
                  className="max-h-[520px] w-full"
                  src={signedUrlData.signedUrl}
                  poster={thumbnailUrl ?? undefined}
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            )}
          </div>

          {/* Description Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Description & Summary
            </h3>
            <p className="mt-2 whitespace-pre-line text-sm text-gray-600 dark:text-gray-400">
              {demoClass.description || 'No description provided for this demo class.'}
            </p>
          </div>
        </div>

        {/* ─── Right Column (Metadata & Details) ──────────────────────── */}
        <div className="space-y-6">
          {/* Quick Info / File Details Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <HardDrives size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Class Information
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<GraduationCap size={16} />}
                label="Stream"
                value={demoClass.streamName ?? '—'}
              />
              <InfoRow
                icon={<Tag size={16} />}
                label="Status"
                value={<StatusBadge status={demoClass.status} />}
              />
              <InfoRow
                icon={<Clock size={16} />}
                label="Duration"
                value={formatDuration(demoClass.durationSeconds)}
              />
              <InfoRow
                icon={<ListNumbers size={16} />}
                label="Display Order"
                value={demoClass.displayOrder}
              />
              <InfoRow
                icon={<CalendarBlank size={16} />}
                label="Created"
                value={formatDate(demoClass.createdAt)}
              />
              <InfoRow
                icon={<CalendarBlank size={16} />}
                label="Published"
                value={formatDate(demoClass.publishedAt)}
              />
              <InfoRow
                icon={<HardDrives size={16} />}
                label="Storage Bucket"
                value={demoClass.storageBucket}
              />
            </div>
          </div>

          {/* Thumbnail Card (if exists) */}
          {thumbnailUrl && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Thumbnail Preview
              </h3>
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl}
                  alt={demoClass.title}
                  className="h-44 w-full object-cover"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Edit Modal ─────────────────────────────────────────────── */}
      {editModalOpen && (
        <DemoClassFormModal
          key={modalSession}
          open={editModalOpen}
          mode="edit"
          demo={demoClass}
          onClose={() => setEditModalOpen(false)}
          onSuccess={() => {
            showToast('success', 'Demo class updated successfully.');
            setEditModalOpen(false);
            refetch();
          }}
        />
      )}

      {/* ─── Confirm Publish Dialog ─────────────────────────────────── */}
      <ConfirmDialog
        open={confirmAction === 'publish'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handlePublish}
        title="Publish Demo Class"
        message={`Are you sure you want to publish "${demoClass.title}"? It will become immediately visible to prospective students.`}
        confirmLabel="Publish"
        variant="default"
        loading={publishMutation.isPending}
      />

      {/* ─── Confirm Archive Dialog ─────────────────────────────────── */}
      <ConfirmDialog
        open={confirmAction === 'archive'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleArchive}
        title="Archive Demo Class"
        message={`Are you sure you want to archive "${demoClass.title}"? It will be hidden from students.`}
        confirmLabel="Archive"
        variant="warning"
        loading={archiveMutation.isPending}
      />

      {/* ─── Confirm Delete Dialog (Soft Delete) ────────────────────── */}
      <ConfirmDialog
        open={confirmAction === 'delete'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleDelete}
        title="Move to Recycle Bin?"
        message={`Are you sure you want to move "${demoClass.title}" to the Recycle Bin? You can restore it later.`}
        confirmLabel="Move to Trash"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
