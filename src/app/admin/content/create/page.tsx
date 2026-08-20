'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCreateContent } from '@/hooks/content/useContent';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useChapters } from '@/hooks/academic/useChapters';
import { useStreams } from '@/hooks/academic/useStreams';
import { useAuth } from '@/context/AuthContext';
import { AddSubjectModal } from '@/features/question-bank/components/AddSubjectModal';
import { AddChapterModal } from '@/features/question-bank/components/AddChapterModal';
import { AddStreamModal } from '@/features/question-bank/components/AddStreamModal';
import { PageHeader } from '@/components/ui/PageHeader';
import type { Subject, Chapter, Stream } from '@/types/academic';

const CONTENT_TYPES = [
  { value: 'pdf', label: 'PDF Document' },
  { value: 'video', label: 'Video' },
  { value: 'notes', label: 'Notes' },
  { value: 'assignment', label: 'Assignment' },
];

interface FormData {
  title: string;
  description: string;
  contentType: string;
  subjectId: string;
  chapterId: string;
  streamId: string;
  isFreePreview: boolean;
  durationSeconds: number | null;
  pageCount: number | null;
}

const emptyForm: FormData = {
  title: '',
  description: '',
  contentType: 'pdf',
  subjectId: '',
  chapterId: '',
  streamId: '',
  isFreePreview: false,
  durationSeconds: null,
  pageCount: null,
};

export default function AdminCreateContentPage() {
  const router = useRouter();
  const { instituteId } = useAuth();
  const createContent = useCreateContent();

  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState(0);

  // ── Streams ─────────────────────────────────────────────────────────────
  const { data: streamsData } = useStreams(
    instituteId ? { instituteId } : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page: 1, pageSize: 50 },
  );
  const streams = streamsData?.data ?? [];
  const rawStreams: Stream[] = streamsData?.data ?? [];

  const [showAddStream, setShowAddStream] = useState(false);
  const [addStreamFeedback, setAddStreamFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // ── Subjects ────────────────────────────────────────────────────────────
  const { data: subjectsData } = useSubjects(
    formData.streamId ? { streamId: formData.streamId } : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page: 1, pageSize: 200 },
  );
  const subjects = subjectsData?.data ?? [];
  const rawSubjects: Subject[] = subjectsData?.data ?? [];

  const [showAddSubject, setShowAddSubject] = useState(false);
  const [addSubjectFeedback, setAddSubjectFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // ── Chapters ────────────────────────────────────────────────────────────
  const { data: chaptersData } = useChapters(
    formData.subjectId ? { subjectId: formData.subjectId } : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page: 1, pageSize: 200 },
  );
  const chapters = chaptersData?.data ?? [];
  const rawChapters: Chapter[] = chaptersData?.data ?? [];

  const [showAddChapter, setShowAddChapter] = useState(false);
  const [addChapterFeedback, setAddChapterFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const handleChange = useCallback(
    (field: keyof FormData, value: string | number | boolean | null) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const handleSubjectCreated = useCallback((newSubject: Subject) => {
    setShowAddSubject(false);
    setFormData((prev) => ({ ...prev, subjectId: newSubject.subjectId }));
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Subject "${newSubject.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  const handleChapterCreated = useCallback((newChapter: Chapter) => {
    setShowAddChapter(false);
    setFormData((prev) => ({ ...prev, chapterId: newChapter.chapterId }));
    setAddChapterFeedback({
      type: 'success',
      message: `✓ Chapter "${newChapter.name}" created successfully.`,
    });
    setTimeout(() => setAddChapterFeedback(null), 4000);
  }, []);

  const handleStreamCreated = useCallback((newStream: Stream) => {
    setShowAddStream(false);
    setFormData((prev) => ({ ...prev, streamId: newStream.streamId }));
    setAddStreamFeedback({
      type: 'success',
      message: `✓ Stream "${newStream.name}" created successfully.`,
    });
    setTimeout(() => setAddStreamFeedback(null), 4000);
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) newErrors.title = 'Title is required.';
    else if (formData.title.trim().length < 3) newErrors.title = 'Title must be at least 3 characters.';

    if (!formData.streamId) newErrors.streamId = 'Stream is required.';
    if (!formData.subjectId) newErrors.subjectId = 'Subject is required.';
    if (!formData.chapterId) newErrors.chapterId = 'Chapter is required.';

    if (!file) newErrors.file = 'A file is required.';

    if (formData.contentType === 'video') {
      if (!formData.durationSeconds || formData.durationSeconds <= 0) {
        newErrors.durationSeconds = 'Duration is required for videos.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, file]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      if (!instituteId) {
        setErrors({ form: 'Institute not found. Please ensure you have an institute assigned to your profile.' });
        return;
      }

      if (!file) return;

      createContent.mutate(
        {
          instituteId,
          chapterId: formData.chapterId,
          title: formData.title.trim(),
          description: formData.description || null,
          contentType: formData.contentType as any,
          file,
          thumbnailFile: thumbnailFile || undefined,
          durationSeconds: formData.durationSeconds,
          pageCount: formData.pageCount,
          isFreePreview: formData.isFreePreview,
          onProgress: (loaded, total) => {
            setUploadProgress(Math.round((loaded / total) * 100));
          },
        },
        {
          onSuccess: () => {
            router.push('/admin/content/review?status=approved');
          },
          onError: (error) => {
            setErrors({ form: error.message });
          },
        },
      );
    },
    [formData, file, thumbnailFile, validate, createContent, instituteId, router],
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Upload Content"
        description="Upload academic study materials, lecture videos, and notes directly to the institute catalog"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Content', href: '/admin/content' },
          { label: 'Upload' },
        ]}
      />

      {addSubjectFeedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            addSubjectFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {addSubjectFeedback.message}
        </div>
      )}

      {addStreamFeedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            addStreamFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {addStreamFeedback.message}
        </div>
      )}

      {addChapterFeedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            addChapterFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {addChapterFeedback.message}
        </div>
      )}

      <AddStreamModal
        isOpen={showAddStream}
        existingStreams={rawStreams}
        onClose={() => setShowAddStream(false)}
        onCreated={handleStreamCreated}
      />

      <AddSubjectModal
        isOpen={showAddSubject}
        existingSubjects={rawSubjects}
        onClose={() => setShowAddSubject(false)}
        onCreated={handleSubjectCreated}
      />

      <AddChapterModal
        isOpen={showAddChapter}
        subjectId={formData.subjectId}
        existingChapters={rawChapters}
        onClose={() => setShowAddChapter(false)}
        onCreated={handleChapterCreated}
      />

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">Basic Information</h2>
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                placeholder="e.g. Thermodynamics - Chapter Notes"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Brief summary of the content..."
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            {/* Stream + Subject + Chapter */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Stream *</label>
                <select
                  value={formData.streamId}
                  onChange={(e) => {
                    if (e.target.value === '__add_new__') {
                      setShowAddStream(true);
                      return;
                    }
                    handleChange('streamId', e.target.value);
                    handleChange('subjectId', '');
                    handleChange('chapterId', '');
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Select a stream...</option>
                  {streams.map((s) => (
                    <option key={s.streamId} value={s.streamId}>{s.name}</option>
                  ))}
                  <option disabled className="border-t border-gray-200" value="__divider__">──────────────</option>
                  <option value="__add_new__" className="font-medium text-blue-600 dark:text-blue-400">
                    + Add New Stream
                  </option>
                </select>
                {errors.streamId && <p className="mt-1 text-xs text-red-500">{errors.streamId}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Subject *</label>
                <select
                  value={formData.subjectId}
                  onChange={(e) => {
                    if (e.target.value === '__add_new__') {
                      setShowAddSubject(true);
                      return;
                    }
                    handleChange('subjectId', e.target.value);
                    handleChange('chapterId', '');
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Select a subject...</option>
                  {subjects.map((s) => (
                    <option key={s.subjectId} value={s.subjectId}>{s.name}</option>
                  ))}
                  <option disabled className="border-t border-gray-200" value="__divider__">──────────────</option>
                  <option value="__add_new__" className="font-medium text-blue-600 dark:text-blue-400">
                    + Add New Subject
                  </option>
                </select>
                {errors.subjectId && <p className="mt-1 text-xs text-red-500">{errors.subjectId}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Chapter *</label>
                <select
                  value={formData.chapterId}
                  onChange={(e) => {
                    if (e.target.value === '__add_new__') {
                      setShowAddChapter(true);
                      return;
                    }
                    handleChange('chapterId', e.target.value);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Select a chapter...</option>
                  {chapters.map((c) => (
                    <option key={c.chapterId} value={c.chapterId}>{c.name}</option>
                  ))}
                  <option disabled className="border-t border-gray-200" value="__divider__">──────────────</option>
                  <option value="__add_new__" className="font-medium text-blue-600 dark:text-blue-400">
                    + Add New Chapter
                  </option>
                </select>
                {errors.chapterId && <p className="mt-1 text-xs text-red-500">{errors.chapterId}</p>}
              </div>
            </div>

            {/* Content Type */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Content Type *</label>
                <select
                  value={formData.contentType}
                  onChange={(e) => {
                    handleChange('contentType', e.target.value);
                    if (e.target.value !== 'video') handleChange('durationSeconds', null);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {CONTENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Duration (video) */}
              {formData.contentType === 'video' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Duration (seconds) *</label>
                  <input
                    type="number"
                    value={formData.durationSeconds ?? ''}
                    onChange={(e) => handleChange('durationSeconds', parseInt(e.target.value) || null)}
                    min={1}
                    placeholder="e.g. 300"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                  {errors.durationSeconds && <p className="mt-1 text-xs text-red-500">{errors.durationSeconds}</p>}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* File Upload */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">File Upload</h2>
          <div className="space-y-4">
            {/* Primary file */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Upload File *</label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files.length > 0) {
                    setFile(e.dataTransfer.files[0]);
                    setErrors((prev) => ({ ...prev, file: '' }));
                  }
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 py-8 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:hover:border-gray-500"
                onClick={() => document.getElementById('admin-file-input')?.click()}
              >
                {file ? (
                  <div className="text-center">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{file.name}</p>
                    <p className="mt-1 text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    <p className="mt-2 text-xs text-blue-600">Click to change file</p>
                  </div>
                ) : (
                  <>
                    <svg className="mb-2 h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="font-medium">Click or drag to upload</span>
                    <span className="mt-1 text-xs">Supported: PDF, MP4, WebM, DOC, DOCX, TXT</span>
                  </>
                )}
              </div>
              <input
                id="admin-file-input"
                type="file"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    setFile(e.target.files[0]);
                    setErrors((prev) => ({ ...prev, file: '' }));
                  }
                }}
                className="hidden"
              />
              {errors.file && <p className="mt-1 text-xs text-red-500">{errors.file}</p>}
            </div>

            {/* Thumbnail */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Thumbnail (optional)</label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files.length > 0) {
                    setThumbnailFile(e.dataTransfer.files[0]);
                  }
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 py-6 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:hover:border-gray-500"
                onClick={() => document.getElementById('admin-thumbnail-input')?.click()}
              >
                {thumbnailFile ? (
                  <div className="text-center">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{thumbnailFile.name}</p>
                    <p className="mt-2 text-xs text-blue-600">Click to change thumbnail</p>
                  </div>
                ) : (
                  <>
                    <svg className="mb-2 h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                    <span className="font-medium">Add thumbnail image</span>
                    <span className="mt-1 text-xs">JPEG, PNG, or WebP</span>
                  </>
                )}
              </div>
              <input
                id="admin-thumbnail-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  if (e.target.files?.[0]) setThumbnailFile(e.target.files[0]);
                }}
                className="hidden"
              />
            </div>

            {/* Upload progress */}
            {createContent.isPending && uploadProgress > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Settings */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={formData.isFreePreview}
              onChange={(e) => handleChange('isFreePreview', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Free Preview</p>
              <p className="text-xs text-gray-500">Allow students without subscription to preview this content</p>
            </div>
          </label>
        </section>

        {/* Form error */}
        {errors.form && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {errors.form}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 border-t border-gray-200 pt-6 dark:border-gray-700">
          <button
            type="submit"
            disabled={createContent.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {createContent.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading...
              </>
            ) : (
              'Publish Content'
            )}
          </button>
          <Link
            href="/admin/content"
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
