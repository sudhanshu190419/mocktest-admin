'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useQuestionImages,
  useUploadQuestionImage,
  useUpdateQuestionImage,
  useDeleteQuestionImage,
  useReorderQuestionImages,
} from '@/hooks/mockTest/useQuestionImages';
import { useAuth } from '@/hooks/useAuth';
import type { QuestionImage } from '@/types/mockTest';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface ImagesDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface ImagesPanelProps {
  onDebugInfo?: (info: ImagesDebugInfo) => void;
}

const IMAGE_ROLES = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'explanation'];

export default function ImagesPanel({ onDebugInfo }: ImagesPanelProps) {
  const { user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────
  const [questionId, setQuestionId] = useState('');
  const [loadedQuestionId, setLoadedQuestionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Upload form
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadAltText, setUploadAltText] = useState('');
  const [uploadImageRole, setUploadImageRole] = useState('question');
  const [uploadOrderSequence, setUploadOrderSequence] = useState(1);

  // Replace metadata
  const [editImageId, setEditImageId] = useState<string | null>(null);
  const [editAltText, setEditAltText] = useState('');
  const [editDisplayOrder, setEditDisplayOrder] = useState(1);

  // Reorder
  const [showReorderForm, setShowReorderForm] = useState(false);
  const [reorderItems, setReorderItems] = useState<{ imageId: string; displayOrder: number }[]>([]);

  // Preview
  const [previewImage, setPreviewImage] = useState<QuestionImage | null>(null);

  // Debug
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ──────────────────────────────────────────────────────────────
  const { data: images, isLoading, isFetching, isStale, refetch } = useQuestionImages(loadedQuestionId);
  const uploadMutation = useUploadQuestionImage();
  const updateMutation = useUpdateQuestionImage();
  const deleteMutation = useDeleteQuestionImage();
  const reorderMutation = useReorderQuestionImages();

  const isMutating =
    uploadMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    reorderMutation.isPending;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: editImageId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleLoad = useCallback(() => {
    if (!questionId.trim()) { setFormError('Question ID is required.'); return; }
    setLoadedQuestionId(questionId.trim());
    setShowUploadForm(false);
    setShowReorderForm(false);
    setPreviewImage(null);
    setEditImageId(null);
    setFormError(null);
    setLastHookCalled('useQuestionImages [load]');
  }, [questionId]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!loadedQuestionId) { setFormError('Load a question first.'); return; }
    if (!user?.instituteId) { setFormError('No institute ID.'); return; }

    setLastHookCalled('useUploadQuestionImage');
    uploadMutation.mutate(
      {
        questionId: loadedQuestionId,
        instituteId: user.instituteId,
        file,
        imageRole: uploadImageRole,
        altText: uploadAltText.trim() || null,
        orderSequence: uploadOrderSequence,
      },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); setShowUploadForm(false); setUploadAltText(''); e.target.value = ''; },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedQuestionId, user, uploadImageRole, uploadAltText, uploadOrderSequence, uploadMutation]);

  const handleUpdateMetadata = useCallback((image: QuestionImage) => {
    if (!loadedQuestionId) return;
    setLastHookCalled('useUpdateQuestionImage');
    updateMutation.mutate(
      {
        questionId: loadedQuestionId,
        imageId: image.imageId,
        input: { altText: editAltText.trim() || null, displayOrder: editDisplayOrder },
      },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); setEditImageId(null); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedQuestionId, editAltText, editDisplayOrder, updateMutation]);

  const handleDelete = useCallback((image: QuestionImage) => {
    if (!window.confirm(`Delete image "${image.imageId.slice(0, 8)}..."?`)) return;
    if (!loadedQuestionId) return;
    setLastHookCalled('useDeleteQuestionImage');
    deleteMutation.mutate(
      { questionId: loadedQuestionId, imageId: image.imageId },
      {
        onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: image.imageId })); if (previewImage?.imageId === image.imageId) setPreviewImage(null); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedQuestionId, deleteMutation, previewImage]);

  const openReorder = useCallback(() => {
    if (!images) return;
    setReorderItems(images.map((img) => ({ imageId: img.imageId, displayOrder: img.orderSequence })));
    setShowReorderForm(true);
    setShowUploadForm(false);
  }, [images]);

  const handleReorder = useCallback(() => {
    if (!loadedQuestionId) return;
    setLastHookCalled('useReorderQuestionImages');
    reorderMutation.mutate(
      { questionId: loadedQuestionId, items: reorderItems },
      {
        onSuccess: () => { setLastApiResponse(JSON.stringify({ reordered: true })); setShowReorderForm(false); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedQuestionId, reorderItems, reorderMutation]);

  const updateReorderItem = useCallback((index: number, displayOrder: number) => {
    setReorderItems((prev) => prev.map((item, i) => i === index ? { ...item, displayOrder } : item));
  }, []);

  const handleReplaceFile = useCallback((image: QuestionImage, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !loadedQuestionId) return;
    setLastHookCalled('useUpdateQuestionImage [replace]');
    updateMutation.mutate(
      {
        questionId: loadedQuestionId,
        imageId: image.imageId,
        input: { file, altText: image.altText },
      },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
    e.target.value = '';
  }, [loadedQuestionId, updateMutation]);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Question Images</h2>
          <p className="text-xs text-gray-500 mt-0.5">Upload, replace, delete, reorder, and preview images</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(images?.length ?? 0) + ' images'} variant={images && images.length > 0 ? 'info' : 'neutral'} />
        </div>
      </div>

      {!user?.instituteId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400 font-medium">⚠ No Institute assigned. Upload operations disabled.</span>
        </div>
      )}

      {formError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{String(formError)}</span>
        </div>
      )}

      {/* ── Question ID selector ────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[300px] flex-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Question UUID</label>
            <input type="text" value={questionId} onChange={(e) => setQuestionId(e.target.value)} placeholder="Paste question UUID..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <button type="button" onClick={handleLoad} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Load Images</button>
          <button type="button" onClick={() => { if (loadedQuestionId) refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
          {loadedQuestionId && (
            <>
              <button type="button" onClick={() => { setShowUploadForm(!showUploadForm); setShowReorderForm(false); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">
                {showUploadForm ? 'Cancel Upload' : 'Upload Image'}
              </button>
              <button type="button" onClick={openReorder} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">
                Reorder
              </button>
            </>
          )}
        </div>
        {loadedQuestionId && (
          <div className="mt-2 text-[11px] text-gray-500">Loaded: <span className="font-mono text-gray-400">{loadedQuestionId}</span></div>
        )}
      </div>

      {/* ── Upload Form ──────────────────────────────────────────────────── */}
      {showUploadForm && loadedQuestionId && (
        <div className="rounded border border-green-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-green-700/50 bg-green-950/30">
            <span className="text-xs font-semibold text-green-300">Upload New Image</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Image Role</label>
                <select value={uploadImageRole} onChange={(e) => setUploadImageRole(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                  {IMAGE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Order Sequence</label>
                <input type="number" value={uploadOrderSequence} onChange={(e) => setUploadOrderSequence(Number(e.target.value))} min={1} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Alt Text (accessibility)</label>
                <input type="text" value={uploadAltText} onChange={(e) => setUploadAltText(e.target.value)} placeholder="Description of the image..." className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Image File</label>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadMutation.isPending}
                  onChange={handleFileUpload}
                  className="w-full text-xs text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-amber-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-amber-100 hover:file:bg-amber-700 disabled:opacity-40"
                />
              </div>
            </div>
            {uploadMutation.isPending && <LoadingIndicator label="Uploading..." />}
          </div>
        </div>
      )}

      {/* ── Reorder Form ─────────────────────────────────────────────────── */}
      {showReorderForm && loadedQuestionId && (
        <div className="rounded border border-blue-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-blue-700/50 bg-blue-950/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-300">Reorder Images</span>
            <button type="button" onClick={() => setShowReorderForm(false)} className="text-[11px] text-gray-500">Cancel</button>
          </div>
          <div className="p-4 space-y-3">
            {reorderItems.map((item, index) => (
              <div key={item.imageId} className="flex items-center gap-3">
                <span className="text-[11px] text-gray-500 w-6">{index + 1}.</span>
                <input
                  type="number"
                  value={item.displayOrder}
                  onChange={(e) => updateReorderItem(index, Number(e.target.value))}
                  min={1}
                  className="w-16 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
                />
                <span className="text-xs text-gray-400 font-mono truncate">{item.imageId.slice(0, 8)}...</span>
              </div>
            ))}
            <button
              type="button"
              disabled={isMutating}
              onClick={handleReorder}
              className="rounded bg-blue-800 px-4 py-2 text-xs font-medium text-blue-100 disabled:opacity-40"
            >
              {reorderMutation.isPending ? 'Reordering...' : 'Apply Reorder'}
            </button>
          </div>
        </div>
      )}

      {/* ── Image List ───────────────────────────────────────────────────── */}
      {loadedQuestionId && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-800/50">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Order</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Role</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Alt Text</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Image ID</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Preview</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {images && images.length > 0 ? images.map((img) => (
                  <tr key={img.imageId} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-3 py-2.5 text-gray-400">{img.orderSequence}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge label={img.imageRole} variant="info" />
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 max-w-[200px] truncate">{img.altText ?? '(no alt text)'}</td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-[10px]">{img.imageId.slice(0, 8)}...</td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setPreviewImage(previewImage?.imageId === img.imageId ? null : img)}
                        className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700"
                      >
                        {previewImage?.imageId === img.imageId ? 'Hide' : 'Preview'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {editImageId === img.imageId ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editAltText}
                              onChange={(e) => setEditAltText(e.target.value)}
                              placeholder="Alt text"
                              className="w-24 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200"
                            />
                            <input
                              type="number"
                              value={editDisplayOrder}
                              onChange={(e) => setEditDisplayOrder(Number(e.target.value))}
                              min={1}
                              className="w-12 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200"
                            />
                            <button type="button" onClick={() => handleUpdateMetadata(img)} disabled={updateMutation.isPending} className="rounded bg-green-900/50 px-2 py-1 text-[11px] text-green-300">Save</button>
                            <button type="button" onClick={() => setEditImageId(null)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300">X</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => { setEditImageId(img.imageId); setEditAltText(img.altText ?? ''); setEditDisplayOrder(img.orderSequence); }} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700">Meta</button>
                        )}
                        <label className="cursor-pointer rounded bg-amber-900/50 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/70">
                          Replace
                          <input type="file" accept="image/*" onChange={(e) => handleReplaceFile(img, e)} className="hidden" />
                        </label>
                        <button type="button" onClick={() => handleDelete(img)} disabled={deleteMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 disabled:opacity-40">Del</button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No images found. Upload one above.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Image Preview ────────────────────────────────────────────────── */}
      {previewImage && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-200">Image Preview: {previewImage.imageId.slice(0, 8)}...</span>
            <button type="button" onClick={() => setPreviewImage(null)} className="text-[11px] text-gray-500">Close</button>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-4 text-[11px] text-gray-400">
              <span>Bucket: <span className="font-mono text-gray-300">{previewImage.storageBucket}</span></span>
              <span>Path: <span className="font-mono text-gray-300">{previewImage.storagePath}</span></span>
              <span>Role: {previewImage.imageRole}</span>
              <span>Order: {previewImage.orderSequence}</span>
            </div>
            {previewImage.altText && (
              <div className="text-[11px] text-gray-500">Alt: {previewImage.altText}</div>
            )}
            <div className="bg-gray-950 rounded border border-gray-700 p-4 flex items-center justify-center min-h-[120px]">
              <span className="text-xs text-gray-500 italic">
                Image stored at: {previewImage.storageBucket}/{previewImage.storagePath}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
