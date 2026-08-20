'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/config/supabase';
import { useCreateCourse } from '@/hooks/admin/useCourseManagement';
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
}

interface CourseCreateModalProps {
  open: boolean;
  onClose: () => void;
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

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 300) || 'untitled';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function CourseCreateModal({ open, onClose, onSuccess }: CourseCreateModalProps) {
  const { instituteId } = useAuth();
  const createMutation = useCreateCourse();

  // ── Stream Options ─────────────────────────────────────────────────────
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
        setStreams((data ?? []).map((row: any) => ({
          streamId: row.stream_id,
          name: row.name,
        })));
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
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [streamId, setStreamId] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [discountedPrice, setDiscountedPrice] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [featured, setFeatured] = useState(false);
  const [trending, setTrending] = useState(false);
  const [sortOrder, setSortOrder] = useState('0');
  const [errors, setErrors] = useState<FormErrors>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Reset form on open/close ────────────────────────────────────────────
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) {
      // Modal just opened — reset form
      setTitle('');
      setSlug('');
      setSlugManuallyEdited(false);
      setStreamId('');
      setShortDescription('');
      setDescription('');
      setLanguage('');
      setOriginalPrice('');
      setDiscountedPrice('');
      setCurrency('INR');
      setFeatured(false);
      setTrending(false);
      setSortOrder('0');
      setShowAdvanced(false);
      setErrors({});
    }
    prevOpen.current = open;
  }, [open]);

  // ── Auto-generate slug from title ──────────────────────────────────────
  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
    if (!slugManuallyEdited) {
      setSlug(generateSlug(value));
    }
  }, [slugManuallyEdited]);

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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [title, streamId, originalPrice, discountedPrice]);

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    if (!instituteId) {
      setErrors((prev) => ({ ...prev, title: 'Institute ID not available. Please re-login.' }));
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        instituteId,
        streamId,
        title: title.trim(),
        slug: slug.trim() || undefined,
        shortDescription: shortDescription.trim() || null,
        description: description.trim() || null,
        language: language || null,
        difficultyLevel: null,
        duration: null,
        originalPrice: parseFloat(originalPrice),
        discountedPrice: discountedPrice ? parseFloat(discountedPrice) : null,
        currency,
        featured,
        trending,
        sortOrder: parseInt(sortOrder, 10) || 0,
      });

      if (!result.success) {
        setErrors((prev) => ({ ...prev, title: result.error ?? 'Failed to create course.' }));
        return;
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, title: err?.message ?? 'Failed to create course.' }));
    }
  }, [
    validate,
    instituteId,
    streamId,
    title,
    slug,
    shortDescription,
    description,
    language,
    originalPrice,
    discountedPrice,
    currency,
    featured,
    trending,
    sortOrder,
    createMutation,
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

  if (!open) return null;

  const isPending = createMutation.isPending;

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
        aria-labelledby="create-course-title"
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
              id="create-course-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Create Course
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Fill in the details to create a new course.
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
              onChange={(e) => handleTitleChange(e.target.value)}
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

          {/* Slug (inline) */}
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
                onChange={(e) => { setSlug(e.target.value); setSlugManuallyEdited(true); }}
                placeholder="auto-generated"
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
                Price <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={originalPrice}
                onChange={(e) => setOriginalPrice(e.target.value)}
                placeholder="e.g., 4999"
                className={cn(
                  'w-full rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                  errors.originalPrice
                    ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                  'text-gray-900 placeholder-gray-400 dark:text-gray-100 dark:placeholder-gray-500',
                )}
              />
              {errors.originalPrice && (
                <p className="text-[11px] text-red-500">{errors.originalPrice}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Discounted
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={discountedPrice}
                onChange={(e) => setDiscountedPrice(e.target.value)}
                placeholder="e.g., 2999"
                className={cn(
                  'w-full rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                  errors.discountedPrice
                    ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
                  'text-gray-900 placeholder-gray-400 dark:text-gray-100 dark:placeholder-gray-500',
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
              placeholder="Brief summary shown in course cards"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Full Description
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed course description, syllabus highlights, learning outcomes..."
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>

          {/* ── More Options (collapsible) ──────────────────────────────── */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <svg
                className={cn('h-3 w-3 transition-transform', showAdvanced && 'rotate-90')}
                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              More options
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                {/* Toggles */}
                <div className="flex items-center gap-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={featured}
                        onChange={(e) => setFeatured(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="h-4 w-8 rounded-full bg-gray-200 transition-colors peer-checked:bg-amber-500 dark:bg-gray-700" />
                      <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Featured</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={trending}
                        onChange={(e) => setTrending(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="h-4 w-8 rounded-full bg-gray-200 transition-colors peer-checked:bg-emerald-500 dark:bg-gray-700" />
                      <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Trending</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Sort:</span>
                    <input
                      type="number"
                      min={0}
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value)}
                      className="w-14 rounded border border-gray-200 px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
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
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending && <CircleNotch size={14} className="animate-spin" />}
            {isPending ? 'Creating...' : 'Create Course'}
          </button>
          <p className="text-[11px] text-gray-400">⌘↵ to submit</p>
        </div>
      </div>
    </div>
  );
}
