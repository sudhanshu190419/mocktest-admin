'use client';

import { useState, useCallback, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useContent, useUpdateContent, useDeleteContent, usePublishContent, useArchiveContent, useRestoreContent } from '@/hooks/content/useContent';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useChapters } from '@/hooks/academic/useChapters';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

interface FormData {
  title: string;
  description: string;
  isFreePreview: boolean;
}

export default function EditContentPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: contentId } = use(params);
  const { canRestoreDeletedData } = usePermissions();

  const { data: content, isLoading, isError } = useContent(contentId);
  const updateContent = useUpdateContent();
  const deleteContent = useDeleteContent();
  const publishContent = usePublishContent();
  const archiveContent = useArchiveContent();
  const restoreContent = useRestoreContent();

  const [formData, setFormData] = useState<FormData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  useEffect(() => {
    if (content && !formData) {
      setFormData({
        title: content.title,
        description: content.description ?? '',
        isFreePreview: content.isFreePreview,
      });
    }
  }, [content, formData]);

  const handleChange = useCallback(
    (field: keyof FormData, value: string | boolean) => {
      setFormData((prev) => prev ? { ...prev, [field]: value } : prev);
      setErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const validate = useCallback((): boolean => {
    if (!formData) return false;
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) newErrors.title = 'Title is required.';
    else if (formData.title.trim().length < 3) newErrors.title = 'Title must be at least 3 characters.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData || !validate()) return;

      updateContent.mutate(
        {
          id: contentId,
          params: {
            title: formData.title.trim(),
            description: formData.description || null,
            isFreePreview: formData.isFreePreview,
            ...(file ? { file } : {}),
            ...(thumbnailFile ? { thumbnailFile } : {}),
          },
        },
        { onError: (error) => setErrors({ form: error.message }) },
      );
    },
    [formData, file, thumbnailFile, validate, updateContent, contentId],
  );

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return;
    switch (confirmAction) {
      case 'submit':
        publishContent.mutate(contentId);
        break;
      case 'archive':
        archiveContent.mutate(contentId);
        break;
      case 'restore':
        restoreContent.mutate(contentId);
        break;
      case 'delete':
        deleteContent.mutate(contentId, { onSuccess: () => router.push('/teacher/content/list') });
        break;
    }
    setConfirmAction(null);
  }, [confirmAction, contentId, publishContent, archiveContent, restoreContent, deleteContent, router]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Loading content details..." />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !content) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Content not found.</p>
        <Link href="/teacher/content/list" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          Back to My Content
        </Link>
      </div>
    );
  }

  if (!formData) return null;

  const showActions = content.status === 'draft' || content.status === 'rejected';

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={content.title}
        description="Edit content details"
        breadcrumbs={[
          { label: 'My Content', href: '/teacher/content' },
          { label: content.title },
        ]}
        actions={<StatusBadge status={content.status} />}
      />

      {/* Status management bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <span className="text-sm text-gray-500">Status:</span>
        <StatusBadge status={content.status} />
        <span className="mx-2 text-gray-300">|</span>
        {showActions && (
          <>
            <button type="button" onClick={() => setConfirmAction('submit')}
              className="rounded px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50">Submit for Approval</button>
            <button type="button" onClick={() => setConfirmAction('archive')}
              className="rounded px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">Archive</button>
          </>
        )}
        {content.status === 'pending_review' && (
          <span className="text-xs text-amber-600">Awaiting admin review</span>
        )}
        {content.status === 'approved' && (
          <>
            <Link href={`/teacher/content/${contentId}/preview`}
              className="rounded px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">Preview</Link>
            <button type="button" onClick={() => setConfirmAction('archive')}
              className="rounded px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">Archive</button>
          </>
        )}
        {content.status === 'archived' && (
          <button type="button" onClick={() => setConfirmAction('restore')}
            className="rounded px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">Restore to Draft</button>
        )}
      </div>

      {/* Content info card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Type</p>
            <p className="mt-0.5 font-medium text-gray-900 dark:text-gray-100 capitalize">{content.contentType}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Size</p>
            <p className="mt-0.5 font-medium text-gray-900 dark:text-gray-100">
              {content.fileSizeBytes ? `${(content.fileSizeBytes / 1024 / 1024).toFixed(2)} MB` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Views</p>
            <p className="mt-0.5 font-medium text-gray-900 dark:text-gray-100">{content.viewCount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Downloads</p>
            <p className="mt-0.5 font-medium text-gray-900 dark:text-gray-100">{content.downloadCount.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Basic Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Content Details</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Title *</label>
              <input type="text" value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                disabled={!showActions}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-800" />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
              <textarea value={formData.description} onChange={(e) => handleChange('description', e.target.value)}
                disabled={!showActions} rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-800" />
            </div>
          </div>
        </section>

        {/* File replacement (draft/rejected only) */}
        {showActions && (
          <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Replace File</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Current file</label>
                <p className="text-sm text-gray-500">{content.originalFileName}</p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Upload new file (optional)</label>
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-gray-500 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Replace thumbnail (optional)</label>
                <input type="file" accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setThumbnailFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-gray-500 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
              </div>
            </div>
          </section>
        )}

        {/* Settings */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Settings</h2>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={formData.isFreePreview}
              onChange={(e) => handleChange('isFreePreview', e.target.checked)}
              disabled={!showActions}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50" />
            <div>
              <p className="text-sm font-medium text-gray-700">Free Preview</p>
              <p className="text-xs text-gray-500">Allow students without subscription to preview this content</p>
            </div>
          </label>
        </section>

        {errors.form && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errors.form}</div>
        )}

        <div className="flex items-center gap-3 border-t border-gray-200 pt-6">
          {showActions && (
            <button type="submit" disabled={updateContent.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {updateContent.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          <Link href={`/teacher/content/${contentId}/preview`}
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
            Preview
          </Link>
          {content.status === 'archived' && canRestoreDeletedData && (
            <button type="button" onClick={() => setConfirmAction('delete')}
              className="ml-auto rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-300 hover:bg-red-50">
              Move to Recycle Bin
            </button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction === 'submit' ? 'Submit for Approval' :
          confirmAction === 'archive' ? 'Archive Content' :
          confirmAction === 'delete' ? 'Delete Content' : 'Restore Content'
        }
        message={
          confirmAction === 'submit' ? 'Submit this content for admin approval. It will be reviewed before being made available to students.' :
          confirmAction === 'archive' ? 'Archived content is hidden from students. Data is preserved.' :
          confirmAction === 'delete' ? 'This item will be moved to the Recycle Bin and can be restored later.' :
          'Restore this content to draft status for editing.'
        }
        confirmLabel={
          confirmAction === 'submit' ? 'Submit' :
          confirmAction === 'archive' ? 'Archive' :
          confirmAction === 'delete' ? 'Move to Recycle Bin' : 'Restore'
        }
        variant={confirmAction === 'archive' ? 'warning' : confirmAction === 'delete' ? 'danger' : 'default'}
      />
    </div>
  );
}
