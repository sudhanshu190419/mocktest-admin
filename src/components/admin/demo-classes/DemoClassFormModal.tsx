'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useStreams } from '@/hooks/academic/useStreams';
import {
  useCreateDemoClass,
  useUpdateDemoClass,
} from '@/hooks/admin/useDemoClassAdmin';
import { cn } from '@/lib/utils';
import { CircleNotch, X } from '@phosphor-icons/react';
import type { DemoClass } from '@/types/demoClass';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface FormState {
  streamId: string;
  title: string;
  description: string;
  displayOrder: string;
  durationSeconds: string;
}

interface FormErrors {
  streamId?: string;
  title?: string;
  video?: string;
  submit?: string;
}

interface DemoClassFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** The demo being edited (null for create). */
  demo?: DemoClass | null;
  onClose: () => void;
  onSuccess?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Accepted video formats — mirrors the `content_video` storage config. */
const VIDEO_ACCEPT = '.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime';
/** Accepted thumbnail formats — mirrors THUMBNAIL_MIME_TYPES. */
const THUMBNAIL_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function DemoClassFormModal({
  open,
  mode,
  demo,
  onClose,
  onSuccess,
}: DemoClassFormModalProps) {
  const { instituteId, user } = useAuth();

  // ── Stream selector (reused hook — RLS keeps it scoped to the institute) ─
  const { data: streamData, isLoading: streamsLoading } = useStreams(
    instituteId ? { instituteId, isActive: true } : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page: 1, pageSize: 100 },
  );
  const streamOptions =
    streamData?.data.map((s) => ({ value: s.streamId, label: s.name })) ?? [];

  // ── Form state ─────────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState>({
    streamId: demo?.streamId ?? '',
    title: demo?.title ?? '',
    description: demo?.description ?? '',
    displayOrder: demo ? String(demo.displayOrder) : '0',
    durationSeconds: demo?.durationSeconds != null ? String(demo.durationSeconds) : '',
  });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  const createMutation = useCreateDemoClass();
  const updateMutation = useUpdateDemoClass();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // React Compiler handles memoization — no manual useCallback needed.
  const handleChange =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Validate ───────────────────────────────────────────────────────
    const nextErrors: FormErrors = {};
    if (!form.streamId) nextErrors.streamId = 'Select a stream.';
    if (!form.title.trim() || form.title.trim().length < 3) {
      nextErrors.title = 'Title must be at least 3 characters.';
    }
    if (mode === 'create' && !videoFile) {
      nextErrors.video = 'Select a demo video file.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const duration = form.durationSeconds.trim() ? parseInt(form.durationSeconds, 10) : null;

    if (mode === 'create') {
      // Unreachable after validation above, but satisfies TS narrowing.
      if (!videoFile) return;

      createMutation.mutate(
        {
          instituteId: instituteId ?? '',
          streamId: form.streamId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          file: videoFile,
          thumbnailFile: thumbnailFile ?? undefined,
          durationSeconds: duration && duration > 0 ? duration : null,
          displayOrder: parseInt(form.displayOrder || '0', 10) || 0,
          createdBy: user?.id ?? '',
        },
        {
          onSuccess: () => {
            onSuccess?.();
            onClose();
          },
          onError: (err) => {
            setErrors((prev) => ({ ...prev, submit: err.message }));
          },
        },
      );
      return;
    }

    // edit mode
    updateMutation.mutate(
      {
        demoClassId: demo!.demoClassId,
        input: {
          streamId: form.streamId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          file: videoFile ?? undefined,
          thumbnailFile: thumbnailFile ?? undefined,
          durationSeconds: duration && duration > 0 ? duration : null,
          displayOrder: parseInt(form.displayOrder || '0', 10) || 0,
        },
      },
      {
        onSuccess: () => {
          onSuccess?.();
          onClose();
        },
        onError: (err) => {
          setErrors((prev) => ({ ...prev, submit: err.message }));
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-form-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-xl animate-[fadeIn_200ms_ease-out] dark:border-gray-700 dark:bg-gray-900"
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="demo-form-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {mode === 'create' ? 'Create Demo Class' : 'Edit Demo Class'}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {mode === 'create'
                ? 'Demo classes are created as drafts — publish later to go live.'
                : 'Update metadata or replace the video/thumbnail.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Stream */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Stream <span className="text-rose-500">*</span>
            </label>
            <select
              value={form.streamId}
              onChange={handleChange('streamId')}
              disabled={streamsLoading}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 dark:bg-gray-900 dark:text-gray-100',
                errors.streamId
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
                  : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 dark:border-gray-700',
              )}
            >
              <option value="">{streamsLoading ? 'Loading streams…' : 'Select stream'}</option>
              {streamOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.streamId && (
              <p className="mt-1 text-xs text-rose-500">{errors.streamId}</p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={handleChange('title')}
              placeholder="e.g. JEE 2026 Demo Class"
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-sm text-gray-900 transition-colors focus:outline-none focus:ring-2 dark:bg-gray-900 dark:text-gray-100',
                errors.title
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
                  : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 dark:border-gray-700',
              )}
            />
            {errors.title && <p className="mt-1 text-xs text-rose-500">{errors.title}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={handleChange('description')}
              rows={3}
              placeholder="Short description shown to students (optional)"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>

          {/* Video file */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {mode === 'create' ? 'Demo Video' : 'Replace Video'} {mode === 'create' && <span className="text-rose-500">*</span>}
            </label>
            <label
              className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm transition-colors',
                errors.video
                  ? 'border-rose-400 text-rose-500'
                  : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400',
              )}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="truncate">
                {videoFile
                  ? videoFile.name
                  : mode === 'create'
                    ? 'Select video (MP4, WebM, MOV — up to 5 GB)'
                    : 'Select a new video to replace the current one (optional)'}
              </span>
              <input
                type="file"
                accept={VIDEO_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setVideoFile(file);
                  setErrors((prev) => ({ ...prev, video: undefined }));
                }}
              />
            </label>
            {errors.video && <p className="mt-1 text-xs text-rose-500">{errors.video}</p>}
          </div>

          {/* Thumbnail */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Thumbnail (optional)
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <span className="truncate">
                {thumbnailFile ? thumbnailFile.name : 'Select thumbnail image (JPEG, PNG, WebP)'}
              </span>
              <input
                type="file"
                accept={THUMBNAIL_ACCEPT}
                className="hidden"
                onChange={(e) => setThumbnailFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {/* Display order + duration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Display Order
              </label>
              <input
                type="number"
                min={0}
                value={form.displayOrder}
                onChange={handleChange('displayOrder')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <p className="mt-1 text-[11px] text-gray-400">Admin ordering hint only — does not affect student selection.</p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Duration (seconds)
              </label>
              <input
                type="number"
                min={1}
                value={form.durationSeconds}
                onChange={handleChange('durationSeconds')}
                placeholder="Optional"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Submit error */}
          {errors.submit && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-300">
              {errors.submit}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting && <CircleNotch size={16} className="animate-spin" />}
              {mode === 'create' ? 'Create Draft' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
