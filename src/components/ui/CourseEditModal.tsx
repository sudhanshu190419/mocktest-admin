'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/config/supabase';
import { useUpdateCourse } from '@/hooks/admin/useCourseManagement';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { CircleNotch } from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface StreamOption {
  streamId: string;
  name: string;
}

interface FormErrors {
  title?: string;
  streamId?: string;
  originalPrice?: string;
  discountedPrice?: string;
  duration?: string;
}

export interface CourseEditModalCourseData {
  courseId: string;
  title: string;
  slug?: string;
  streamId?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  language?: string | null;
  difficultyLevel?: string | null;
  duration?: number | null;
  originalPrice: number;
  discountedPrice?: number | null;
  currency?: string;
  featured?: boolean;
  trending?: boolean;
  sortOrder?: number;
}

export interface CourseEditModalProps {
  open: boolean;
  onClose: () => void;
  course: CourseEditModalCourseData | null;
  onSuccess?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const CURRENCY_OPTIONS = [
  { value: 'INR', label: 'INR (₹)' },
  { value: 'USD', label: 'USD ($)' },
];

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Select Language' },
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'tamil', label: 'Tamil' },
  { value: 'telugu', label: 'Telugu' },
  { value: 'kannada', label: 'Kannada' },
  { value: 'malayalam', label: 'Malayalam' },
  { value: 'bengali', label: 'Bengali' },
  { value: 'marathi', label: 'Marathi' },
  { value: 'gujarati', label: 'Gujarati' },
];

const DIFFICULTY_OPTIONS = [
  { value: '', label: 'Select Difficulty' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'all_levels', label: 'All Levels' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function CourseEditModal({
  open,
  onClose,
  course,
  onSuccess,
}: CourseEditModalProps) {
  const { user } = useAuth();
  const updateMutation = useUpdateCourse();

  // ── Stream data ────────────────────────────────────────────────────────
  const [streams, setStreams] = useState<StreamOption[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setStreamsLoading(true);

    const fetchStreams = async () => {
      try {
        const { data, error } = await supabase
          .from('streams')
          .select('stream_id, name')
          .order('name', { ascending: true });

        if (cancelled) return;

        if (error) {
          console.error('Failed to fetch streams:', error.message);
          setStreams([]);
          return;
        }
        setStreams(
          (data ?? []).map((row: any) => ({
            streamId: row.stream_id,
            name: row.name,
          })),
        );
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch streams:', err);
          setStreams([]);
        }
      } finally {
        if (!cancelled) {
          setStreamsLoading(false);
        }
      }
    };

    fetchStreams();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // ── Form State ─────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [streamId, setStreamId] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('');
  const [difficultyLevel, setDifficultyLevel] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [discountedPrice, setDiscountedPrice] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [duration, setDuration] = useState('');
  const [featured, setFeatured] = useState(false);
  const [trending, setTrending] = useState(false);
  const [sortOrder, setSortOrder] = useState('0');
  const [errors, setErrors] = useState<FormErrors>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Populate form fields when course changes or modal opens ──────────
  useEffect(() => {
    if (open && course) {
      setTitle(course.title || '');
      setSlug(course.slug || '');
      setStreamId(course.streamId || '');
      setShortDescription(course.shortDescription || '');
      setDescription(course.description || '');
      setLanguage(course.language || '');
      setDifficultyLevel(course.difficultyLevel || '');
      setOriginalPrice(course.originalPrice !== undefined ? String(course.originalPrice) : '');
      setDiscountedPrice(
        course.discountedPrice !== null && course.discountedPrice !== undefined
          ? String(course.discountedPrice)
          : '',
      );
      setCurrency(course.currency || 'INR');
      setDuration(
        course.duration !== null && course.duration !== undefined
          ? String(course.duration)
          : '',
      );
      setFeatured(course.featured ?? false);
      setTrending(course.trending ?? false);
      setSortOrder(course.sortOrder !== undefined ? String(course.sortOrder) : '0');
      setShowAdvanced(false);
      setErrors({});
    }
  }, [open, course]);

  // ── Validation ─────────────────────────────────────────────────────────
  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!title.trim()) {
      newErrors.title = 'Title is required.';
    } else if (title.trim().length < 3) {
      newErrors.title = 'Title must be at least 3 characters.';
    }

    if (!streamId) {
      newErrors.streamId = 'Stream is required.';
    }

    const price = parseFloat(originalPrice);
    if (!originalPrice || isNaN(price) || price < 0) {
      newErrors.originalPrice = 'Valid price (≥ 0) is required.';
    }

    if (discountedPrice) {
      const disc = parseFloat(discountedPrice);
      if (isNaN(disc) || disc < 0) {
        newErrors.discountedPrice = 'Discounted price must be ≥ 0.';
      } else if (!isNaN(price) && disc > price) {
        newErrors.discountedPrice = 'Discounted price cannot exceed original price.';
      }
    }

    if (duration) {
      const dur = parseInt(duration, 10);
      if (isNaN(dur) || dur < 0) {
        newErrors.duration = 'Duration must be a positive number.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [title, streamId, originalPrice, discountedPrice, duration]);

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!validate() || !course?.courseId) return;

    try {
      const result = await updateMutation.mutateAsync({
        courseId: course.courseId,
        input: {
          streamId,
          title: title.trim(),
          slug: slug.trim() || undefined,
          shortDescription: shortDescription.trim() || null,
          description: description.trim() || null,
          language: language || null,
          difficultyLevel: difficultyLevel || null,
          duration: duration ? parseInt(duration, 10) : null,
          originalPrice: parseFloat(originalPrice),
          discountedPrice: discountedPrice ? parseFloat(discountedPrice) : null,
          currency,
          featured,
          trending,
          sortOrder: parseInt(sortOrder, 10) || 0,
          updatedBy: user?.id ?? null,
        },
      });

      if (!result.success) {
        setErrors((prev) => ({ ...prev, title: result.error ?? 'Failed to update course.' }));
        return;
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, title: err?.message ?? 'Failed to update course.' }));
    }
  }, [
    validate,
    course,
    streamId,
    title,
    slug,
    shortDescription,
    description,
    language,
    difficultyLevel,
    duration,
    originalPrice,
    discountedPrice,
    currency,
    featured,
    trending,
    sortOrder,
    user?.id,
    updateMutation,
    onSuccess,
    onClose,
  ]);

  // ── Keyboard shortcut ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, handleSubmit]);

  if (!open || !course) return null;

  const isPending = updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={isPending ? undefined : onClose}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-course-title"
        className={cn(
          'relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl',
          'animate-[fadeIn_200ms_ease-out]',
          'dark:border-gray-700 dark:bg-gray-900',
        )}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div>
            <h2
              id="edit-course-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Edit Course
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Update course metadata, pricing, stream, and catalog properties.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Body (scrollable) ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 min-h-0">
          {/* Title */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Course Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., JEE Advanced 2026 Physics"
              className={cn(
                'w-full rounded-lg border px-3 py-1.5 text-sm transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                errors.title
                  ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                'text-gray-900 placeholder-gray-400 dark:text-gray-100 dark:placeholder-gray-500',
              )}
            />
            {errors.title && (
              <p className="text-[11px] text-red-500">{errors.title}</p>
            )}
          </div>

          {/* Slug */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Slug
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-gray-400">
                /
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="course-slug"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-6 pr-3 py-1.5 text-sm text-gray-600 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              />
            </div>
          </div>

          {/* Stream & Language row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Stream <span className="text-red-500">*</span>
              </label>
              <select
                value={streamId}
                onChange={(e) => setStreamId(e.target.value)}
                disabled={streamsLoading}
                className={cn(
                  'w-full rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                  errors.streamId
                    ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                  'text-gray-900 dark:text-gray-100',
                )}
              >
                <option value="">
                  {streamsLoading ? 'Loading streams...' : 'Select Stream'}
                </option>
                {streams.map((s) => (
                  <option key={s.streamId} value={s.streamId}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.streamId && (
                <p className="text-[11px] text-red-500">{errors.streamId}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Pricing row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Original Price <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={originalPrice}
                onChange={(e) => setOriginalPrice(e.target.value)}
                placeholder="999"
                className={cn(
                  'w-full rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                  errors.originalPrice
                    ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                  'text-gray-900 placeholder-gray-400 dark:text-gray-100',
                )}
              />
              {errors.originalPrice && (
                <p className="text-[11px] text-red-500">{errors.originalPrice}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Discounted Price
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discountedPrice}
                onChange={(e) => setDiscountedPrice(e.target.value)}
                placeholder="499 (optional)"
                className={cn(
                  'w-full rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                  errors.discountedPrice
                    ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                  'text-gray-900 placeholder-gray-400 dark:text-gray-100',
                )}
              />
              {errors.discountedPrice && (
                <p className="text-[11px] text-red-500">{errors.discountedPrice}</p>
              )}
            </div>
          </div>

          {/* Short Description */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Short Description
            </label>
            <input
              type="text"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Brief one-line summary for cards"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Full Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Detailed course description, syllabus overview, prerequisites..."
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {/* ── Collapsible Advanced Section ──────────────────────────── */}
          <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              <svg
                className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-90')}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-1">
                {/* Difficulty & Duration */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Difficulty Level
                    </label>
                    <select
                      value={difficultyLevel}
                      onChange={(e) => setDifficultyLevel(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    >
                      {DIFFICULTY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                      Duration (Days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      placeholder="e.g., 90"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                    {errors.duration && (
                      <p className="text-[11px] text-red-500">{errors.duration}</p>
                    )}
                  </div>
                </div>

                {/* Sort Order */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                    Sort Order
                  </label>
                  <input
                    type="number"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                {/* Checkboxes: Featured, Trending */}
                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={featured}
                      onChange={(e) => setFeatured(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    Featured Course
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trending}
                      onChange={(e) => setTrending(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                    Trending Course
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            {isPending && <CircleNotch size={14} className="animate-spin" />}
            {isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
