'use client';

import { use } from 'react';
import Link from 'next/link';
import { useContent } from '@/hooks/content/useContent';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CONTENT_TYPE_ICONS: Record<string, string> = {
  pdf: '📄',
  video: '🎥',
  notes: '📝',
  assignment: '📋',
};

export default function PreviewContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: contentId } = use(params);
  const { data: content, isLoading, isError } = useContent(contentId);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Preview" />
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
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

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Preview Content"
        breadcrumbs={[
          { label: 'My Content', href: '/teacher/content' },
          { label: content.title, href: `/teacher/content/${contentId}/edit` },
          { label: 'Preview' },
        ]}
        actions={
          <Link href={`/teacher/content/${contentId}/edit`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Edit
          </Link>
        }
      />

      {/* Content header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start gap-4">
          {/* Thumbnail */}
          <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-3xl text-white shadow-sm">
            {CONTENT_TYPE_ICONS[content.contentType] ?? '📄'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{content.title}</h1>
              <StatusBadge status={content.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500">{content.description || 'No description provided.'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {CONTENT_TYPE_ICONS[content.contentType]} {content.contentType.charAt(0).toUpperCase() + content.contentType.slice(1)}
              </span>
              <span>{formatFileSize(content.fileSizeBytes)}</span>
              {content.contentType === 'video' && content.durationSeconds && (
                <span>{Math.floor(content.durationSeconds / 60)} min {content.durationSeconds % 60}s</span>
              )}
              {content.pageCount && <span>{content.pageCount} pages</span>}
              {content.isFreePreview && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                  Free Preview
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Details grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* File info */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">File Information</h3>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            <div className="flex justify-between py-2">
              <span className="text-xs text-gray-500">Original Name</span>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{content.originalFileName}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-xs text-gray-500">MIME Type</span>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{content.mimeType}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-xs text-gray-500">Size</span>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{formatFileSize(content.fileSizeBytes)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-xs text-gray-500">Views</span>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{content.viewCount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Timestamps */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Timeline</h3>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            <div className="flex justify-between py-2">
              <span className="text-xs text-gray-500">Created</span>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {new Date(content.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-xs text-gray-500">Updated</span>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {new Date(content.updatedAt).toLocaleString()}
              </span>
            </div>
            {content.publishedAt && (
              <div className="flex justify-between py-2">
                <span className="text-xs text-gray-500">Published</span>
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                  {new Date(content.publishedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
