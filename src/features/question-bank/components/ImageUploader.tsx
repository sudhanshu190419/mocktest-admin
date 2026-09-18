'use client';

import { useCallback, useRef } from 'react';
import {
  ImageProfile,
  formatBytes,
} from '@/utils/imageOptimizer';

export interface ImageItem {
  id: string;
  file?: File;
  rawFile?: File;
  preview: string;
  imageRole: string;
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

export interface ImageUploaderProps {
  images: ImageItem[];
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
  onRoleChange: (id: string, role: string) => void;
  onAltTextChange: (id: string, altText: string) => void;
  onProfileChange?: (id: string, profile: ImageProfile) => void;
  maxImages?: number;
}

export function ImageUploader({
  images,
  onAdd,
  onRemove,
  onRoleChange,
  onAltTextChange,
  onProfileChange,
  maxImages = 10,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        onAdd(e.dataTransfer.files);
      }
    },
    [onAdd],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const remaining = maxImages - images.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Question Stem &amp; Explanation Images
          <span className="ml-1.5 text-[11px] font-normal text-gray-400">
            ({images.length}/{maxImages})
          </span>
        </label>
        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
          ⚡ Auto-optimized
        </span>
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img) => {
            const currentProfile = img.imageProfile || 'simple_diagram';
            const isSimple = currentProfile === 'simple_diagram';

            return (
              <div
                key={img.id}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-all hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800"
              >
                {/* Image preview area with aspect-ratio containment */}
                <div className="relative flex h-36 w-full items-center justify-center bg-gray-50 p-2 dark:bg-gray-900/50">
                  <img
                    src={img.preview}
                    alt={img.altText || 'Question image'}
                    className="max-h-full max-w-full object-contain"
                  />

                  {/* Top-right delete button */}
                  <button
                    type="button"
                    onClick={() => onRemove(img.id)}
                    className="absolute right-2 top-2 rounded-full bg-red-500/90 p-1 text-white shadow hover:bg-red-600"
                    title="Remove image"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  {/* Top-left profile pill */}
                  <div className="absolute left-2 top-2">
                    <span
                      className={
                        isSimple
                          ? 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                          : 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
                      }
                    >
                      {isSimple ? 'Simple Diagram' : 'Detailed Image'}
                    </span>
                  </div>

                  {/* Bottom size comparison badge */}
                  {img.originalSizeBytes !== undefined && img.optimizedSizeBytes !== undefined && (
                    <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between rounded bg-black/75 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
                      <span className="truncate">
                        {formatBytes(img.originalSizeBytes)} →{' '}
                        <strong className="text-emerald-400">
                          {formatBytes(img.optimizedSizeBytes)}
                        </strong>
                      </span>
                      <span className="font-semibold text-emerald-400">
                        {img.savingsPercent !== undefined && img.savingsPercent > 0
                          ? `-${img.savingsPercent}%`
                          : ''}
                      </span>
                    </div>
                  )}
                </div>

                {/* Controls below image */}
                <div className="space-y-2 border-t border-gray-100 p-2.5 dark:border-gray-700">
                  {/* Profile Selection */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      Quality Profile
                    </label>
                    <select
                      value={currentProfile}
                      onChange={(e) => onProfileChange?.(img.id, e.target.value as ImageProfile)}
                      className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                    >
                      <option value="simple_diagram">
                        Simple Diagram — Fast &amp; Light
                      </option>
                      <option value="detailed_image">
                        Detailed Image — High Detail
                      </option>
                    </select>
                  </div>

                  {/* Placement (Role) */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      Placement
                    </label>
                    <select
                      value={img.imageRole}
                      onChange={(e) => onRoleChange(img.id, e.target.value)}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                    >
                      <option value="question">Stem (Question Prompt)</option>
                      <option value="option_a">Option A</option>
                      <option value="option_b">Option B</option>
                      <option value="option_c">Option C</option>
                      <option value="option_d">Option D</option>
                      <option value="explanation">Explanation (Solution)</option>
                    </select>
                  </div>

                  <input
                    type="text"
                    value={img.altText}
                    onChange={(e) => onAltTextChange(img.id, e.target.value)}
                    placeholder="Alt text / description..."
                    className="w-full rounded border border-gray-200 px-2 py-1 text-[11px] placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload area */}
      {remaining > 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 py-6 text-sm text-gray-500 transition-colors hover:border-blue-500 hover:text-blue-600 dark:border-gray-600 dark:hover:border-blue-400 dark:hover:text-blue-400"
        >
          <svg className="mb-2 h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="font-medium">Upload Question Images</span>
          <span className="mt-1 text-xs text-gray-400">
            Drag &amp; drop PNG, JPEG, WebP (auto-optimized before upload)
          </span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onAdd(e.target.files);
            e.target.value = '';
          }
        }}
        className="hidden"
      />
    </div>
  );
}
