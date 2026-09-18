'use client';

import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { QuestionType } from '@/types/mockTest';
import {
  ImageProfile,
  formatBytes,
  optimizeImage,
} from '@/utils/imageOptimizer';

export interface OptionImageEntry {
  id: string;
  file?: File;
  rawFile?: File;
  preview: string;
  altText: string;
  imageProfile?: ImageProfile;
  originalSizeBytes?: number;
  optimizedSizeBytes?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  savingsPercent?: number;
  isOptimizing?: boolean;
}

export interface Option {
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

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

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

  const updateOption = <K extends keyof Option>(id: string, field: K, value: Option[K]) => {
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

  // ─── Image handlers ─────────────────────────────────────────────

  const handleOptionImageUpload = useCallback(
    async (optionId: string, files: FileList) => {
      const rawFiles = Array.from(files);
      const optimizedEntries: OptionImageEntry[] = await Promise.all(
        rawFiles.map(async (rawFile, i) => {
          const optResult = await optimizeImage(rawFile, 'simple_diagram');
          return {
            id: `opt-img-${Date.now()}-${i}`,
            file: optResult.file,
            rawFile,
            preview: optResult.previewUrl,
            altText: '',
            imageProfile: 'simple_diagram',
            originalSizeBytes: optResult.originalSizeBytes,
            optimizedSizeBytes: optResult.optimizedSizeBytes,
            width: optResult.width,
            height: optResult.height,
            mimeType: optResult.mimeType,
            savingsPercent: optResult.savingsPercent,
          };
        }),
      );

      const updated = options.map((o) => {
        if (o.id !== optionId) return { ...o, images: o.images ?? [] };
        return { ...o, images: [...(o.images ?? []), ...optimizedEntries] };
      });
      onChange(updated);
    },
    [options, onChange],
  );

  const handleRemoveOptionImage = useCallback(
    (optionId: string, imageId: string) => {
      const updated = options.map((o) => {
        if (o.id !== optionId) return { ...o, images: o.images ?? [] };
        const removed = (o.images ?? []).find((img) => img.id === imageId);
        if (removed) {
          URL.revokeObjectURL(removed.preview);
        }
        return {
          ...o,
          images: (o.images ?? []).filter((img) => img.id !== imageId),
        };
      });
      onChange(updated);
    },
    [options, onChange],
  );

  const handleOptionImageProfileChange = useCallback(
    async (optionId: string, imageId: string, profile: ImageProfile) => {
      const targetOption = options.find((o) => o.id === optionId);
      const targetImg = targetOption?.images?.find((img) => img.id === imageId);
      if (!targetImg) return;

      const sourceFile = targetImg.rawFile || targetImg.file;
      if (!sourceFile) return;

      const optResult = await optimizeImage(sourceFile, profile);
      URL.revokeObjectURL(targetImg.preview);

      const updated = options.map((o) => {
        if (o.id !== optionId) return { ...o, images: o.images ?? [] };
        return {
          ...o,
          images: (o.images ?? []).map((img) => {
            if (img.id !== imageId) return img;
            return {
              ...img,
              file: optResult.file,
              preview: optResult.previewUrl,
              imageProfile: profile,
              originalSizeBytes: optResult.originalSizeBytes,
              optimizedSizeBytes: optResult.optimizedSizeBytes,
              width: optResult.width,
              height: optResult.height,
              mimeType: optResult.mimeType,
              savingsPercent: optResult.savingsPercent,
            };
          }),
        };
      });
      onChange(updated);
    },
    [options, onChange],
  );

  const labels = OPTION_LABELS.slice(0, options.length);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Options ({options.length})
          {isSingleCorrect && questionType !== 'true_false' && (
            <span className="ml-1.5 text-[11px] text-gray-400">(Select the correct answer)</span>
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
            {/* Option header row */}
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
            </div>

            {/* Option images section */}
            <div className="ml-10 mt-2 space-y-2">
              {/* Image preview grid */}
              {(option.images ?? []).length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(option.images ?? []).map((img) => (
                    <div
                      key={img.id}
                      className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="relative flex h-24 w-full items-center justify-center p-1">
                        <img
                          src={img.preview}
                          alt={img.altText || 'Option image'}
                          className="max-h-full max-w-full object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveOptionImage(option.id, img.id)}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/90 text-white shadow hover:bg-red-600"
                          title="Remove image"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {/* Size & Profile stats badge */}
                      <div className="border-t border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
                        <div className="flex items-center justify-between text-[9px] text-gray-500 dark:text-gray-400">
                          <span>
                            {img.originalSizeBytes && img.optimizedSizeBytes
                              ? `${formatBytes(img.optimizedSizeBytes)}`
                              : 'WebP'}
                          </span>
                          {img.savingsPercent !== undefined && img.savingsPercent > 0 && (
                            <span className="font-semibold text-emerald-500">
                              -${img.savingsPercent}%
                            </span>
                          )}
                        </div>
                        <select
                          value={img.imageProfile || 'simple_diagram'}
                          onChange={(e) =>
                            handleOptionImageProfileChange(
                              option.id,
                              img.id,
                              e.target.value as ImageProfile,
                            )
                          }
                          className="mt-1 w-full rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[9px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        >
                          <option value="simple_diagram">Simple Diagram</option>
                          <option value="detailed_image">Detailed Image</option>
                        </select>
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:border-blue-500 hover:text-blue-600 dark:border-gray-600 dark:hover:border-blue-400 dark:hover:text-blue-400"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Upload Option Image
                </button>
                <span className="text-[10px] text-gray-400">
                  Auto-optimized
                </span>
                <input
                  ref={setFileInputRef(option.id)}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleOptionImageUpload(option.id, e.target.files);
                      e.target.value = '';
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
