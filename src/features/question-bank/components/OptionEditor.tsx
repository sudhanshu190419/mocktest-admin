'use client';

import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { QuestionType } from '@/types/mockTest';

interface OptionImageEntry {
  id: string;
  file?: File;
  preview: string;
  altText: string;
}

interface Option {
  id: string;
  optionText: string;
  isCorrect: boolean;
  orderSequence: number;
  images?: OptionImageEntry[];
}

interface OptionEditorProps {
  options: Option[];
  questionType: QuestionType;
  onChange: (options: Option[]) => void;
  error?: string;
}

export function OptionEditor({ options, questionType, onChange, error }: OptionEditorProps) {
  const isSingleCorrect = questionType === 'mcq' || questionType === 'true_false';

  // Refs for file inputs per option
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const setFileInputRef = useCallback((optionId: string) => (el: HTMLInputElement | null) => {
    fileInputRefs.current[optionId] = el;
  }, []);

  const addOption = () => {
    if (options.length >= 8) return;
    const newOption: Option = {
      id: `opt-${Date.now()}`,
      optionText: '',
      isCorrect: false,
      orderSequence: options.length + 1,
      images: [],
    };
    onChange([...options, newOption]);
  };

  const removeOption = (id: string) => {
    if (options.length <= 2) return;
    // Clean up object URLs before removing
    const option = options.find((o) => o.id === id);
    if (option) {
      (option.images ?? []).forEach((img) => URL.revokeObjectURL(img.preview));
    }
    const filtered = options
      .filter((o) => o.id !== id)
      .map((o, i) => ({ ...o, orderSequence: i + 1, images: o.images ?? [] }));
    onChange(filtered);
  };

  const updateOption = (id: string, field: keyof Option, value: any) => {
    const updated = options.map((o) => {
      if (o.id !== id) return { ...o, images: o.images ?? [] };

      // For single-correct types, deselect all other options when marking as correct
      if (field === 'isCorrect' && value === true && isSingleCorrect) {
        return { ...o, images: o.images ?? [], isCorrect: true };
      }
      return { ...o, images: o.images ?? [], [field]: value };
    });

    // For single-correct, ensure only the selected one is correct
    if (field === 'isCorrect' && value === true && isSingleCorrect) {
      const final = updated.map((o) => ({
        ...o,
        isCorrect: o.id === id,
      }));
      onChange(final);
    } else {
      onChange(updated);
    }
  };

  // ── Image handlers ──────────────────────────────────────────────────────

  const handleOptionImageUpload = useCallback(
    (optionId: string, files: FileList) => {
      const newImages: OptionImageEntry[] = Array.from(files).map((file, i) => ({
        id: `opt-img-${Date.now()}-${i}`,
        file,
        preview: URL.createObjectURL(file),
        altText: '',
      }));

      const updated = options.map((o) => {
        if (o.id !== optionId) return { ...o, images: o.images ?? [] };
        return { ...o, images: [...(o.images ?? []), ...newImages] };
      });

      onChange(updated);
    },
    [options, onChange],
  );

  const handleRemoveOptionImage = useCallback(
    (optionId: string, imageId: string) => {
      const option = options.find((o) => o.id === optionId);
      const image = (option?.images ?? []).find((i) => i.id === imageId);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }

      const updated = options.map((o) => {
        if (o.id !== optionId) return { ...o, images: o.images ?? [] };
        return { ...o, images: (o.images ?? []).filter((i) => i.id !== imageId) };
      });

      onChange(updated);
    },
    [options, onChange],
  );

  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Options
          {questionType === 'mcq' && (
            <span className="ml-1.5 text-[11px] text-gray-400">(Select one correct answer)</span>
          )}
          {questionType === 'msq' && (
            <span className="ml-1.5 text-[11px] text-gray-400">(Select all correct answers)</span>
          )}
          {questionType === 'true_false' && (
            <span className="ml-1.5 text-[11px] text-gray-400">(True / False)</span>
          )}
        </label>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="space-y-2">
        {options.map((option, index) => (
          <div
            key={option.id}
            className={cn(
              'rounded-lg border p-3 transition-colors',
              option.isCorrect
                ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20'
                : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900',
            )}
          >
            {/* ── Option header row: label, textarea, toggles ───────────── */}
            <div className="flex items-start gap-3">
              {/* Label */}
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {labels[index]}
              </div>

              {/* Option text */}
              <div className="flex-1">
                <textarea
                  value={option.optionText}
                  onChange={(e) => updateOption(option.id, 'optionText', e.target.value)}
                  placeholder={`Enter option ${labels[index]}...`}
                  rows={2}
                  className="w-full resize-none rounded-lg border-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:text-gray-100 dark:placeholder-gray-500"
                />
              </div>

              {/* Correct toggle */}
              <button
                type="button"
                onClick={() =>
                  updateOption(option.id, 'isCorrect', !option.isCorrect)
                }
                className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border transition-colors',
                  option.isCorrect
                    ? 'border-emerald-400 bg-emerald-500 text-white'
                    : 'border-gray-300 text-gray-400 hover:border-gray-400 dark:border-gray-600',
                )}
                title={isSingleCorrect ? 'Mark as correct answer' : 'Toggle correct answer'}
              >
                {option.isCorrect && (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>

              {/* Remove */}
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(option.id)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>              {/* ── Option images section ───────────────────────────── */}
            <div className="ml-10 mt-2 space-y-2">
              {/* Image preview grid */}
              {(option.images ?? []).length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {(option.images ?? []).map((img) => (
                    <div
                      key={img.id}
                      className="group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600"
                    >
                      <img
                        src={img.preview}
                        alt={img.altText || 'Option image'}
                        className="h-16 w-full object-cover"
                      />
                      {/* Dark overlay with remove button — visible on hover */}
                      <div className="absolute inset-0 flex items-start justify-end bg-black/40 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => handleRemoveOptionImage(option.id, img.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                          title="Remove image"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {/* Filename */}
                      <div className="truncate px-1 py-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                        {img.file?.name ?? 'Image'}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload button */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRefs.current[option.id]?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:hover:border-gray-500"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Upload Image
                </button>
                <span className="text-[10px] text-gray-400">
                  jpg, jpeg, png, svg, webp (max 10 MB)
                </span>
                <input
                  ref={setFileInputRef(option.id)}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleOptionImageUpload(option.id, e.target.files);
                      e.target.value = ''; // Allow re-selecting the same files
                    }
                  }}
                  className="hidden"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {options.length < 8 && (
        <button
          type="button"
          onClick={addOption}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-2.5 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:hover:border-gray-500"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Option
        </button>
      )}
    </div>
  );
}
