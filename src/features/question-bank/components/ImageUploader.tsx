'use client';

import { useCallback, useRef } from 'react';

interface ImageItem {
  id: string;
  file?: File;
  preview: string;
  imageRole: string;
  altText: string;
}

interface ImageUploaderProps {
  images: ImageItem[];
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
  onRoleChange: (id: string, role: string) => void;
  onAltTextChange: (id: string, altText: string) => void;
  maxImages?: number;
}

export function ImageUploader({
  images,
  onAdd,
  onRemove,
  onRoleChange,
  onAltTextChange,
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
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Images
        <span className="ml-1.5 text-[11px] font-normal text-gray-400">
          ({images.length}/{maxImages})
        </span>
      </label>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <img
                src={img.preview}
                alt={img.altText || 'Question image'}
                className="h-28 w-full object-cover"
              />
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onRemove(img.id)}
                  className="self-end rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-1 border-t border-gray-100 p-2 dark:border-gray-700">
                <select
                  value={img.imageRole}
                  onChange={(e) => onRoleChange(img.id, e.target.value)}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[10px] dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="question">Stem</option>
                  <option value="option_a">Option A</option>
                  <option value="option_b">Option B</option>
                  <option value="option_c">Option C</option>
                  <option value="option_d">Option D</option>
                  <option value="explanation">Explanation</option>
                </select>
                <input
                  type="text"
                  value={img.altText}
                  onChange={(e) => onAltTextChange(img.id, e.target.value)}
                  placeholder="Alt text..."
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[10px] placeholder-gray-400 dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload area */}
      {remaining > 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 py-6 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:hover:border-gray-500"
        >
          <svg className="mb-2 h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="font-medium">Upload images</span>
          <span className="mt-1 text-xs">Drag & drop or click to browse</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => e.target.files && onAdd(e.target.files)}
        className="hidden"
      />
    </div>
  );
}
