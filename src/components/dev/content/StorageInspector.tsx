'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';


/**
 * Storage Inspector — standalone dev panel for testing storage operations.
 *
 * Calls storageService functions directly (no hooks available for storage).
 */

export interface StorageDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHook: string;
  lastResponse: string;
  errorMessage: string | null;
}

interface StorageInspectorProps {
  onDebugInfo?: (info: StorageDebugInfo) => void;
}

export default function StorageInspector({ onDebugInfo }: StorageInspectorProps) {
  const { user } = useAuth();

  // -- Upload --
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBucket, setUploadBucket] = useState('content-pdfs');
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);

  // -- Thumbnail --
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbInstituteId, setThumbInstituteId] = useState(user?.instituteId ?? '');
  const [thumbContentId, setThumbContentId] = useState('');
  const [thumbResult, setThumbResult] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);

  // -- Signed URL --
  const [signedBucket, setSignedBucket] = useState('content-pdfs');
  const [signedPath, setSignedPath] = useState('');
  const [signedResult, setSignedResult] = useState<string | null>(null);
  const [signedLoading, setSignedLoading] = useState(false);

  // -- File exists --
  const [existsBucket, setExistsBucket] = useState('content-pdfs');
  const [existsPath, setExistsPath] = useState('');
  const [existsResult, setExistsResult] = useState<string | null>(null);
  const [existsLoading, setExistsLoading] = useState(false);

  // -- Delete --
  const [deleteBucket, setDeleteBucket] = useState('content-pdfs');
  const [deletePath, setDeletePath] = useState('');
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [commError, setCommError] = useState<string | null>(null);

  // ── Upload ──
  const handleUpload = async () => {
    if (!uploadFile) { setCommError('Select a file'); return; }
    setCommError(null);
    setUploadLoading(true);
    setUploadResult(null);
    try {
      const { uploadFile: storageUpload } = await import('@/services/storage/storageService');
      const result = await storageUpload({
        file: uploadFile,
        contentType: 'pdf',
        instituteId: user?.instituteId ?? '',
        contentId: crypto.randomUUID?.() ?? 'test-' + Date.now(),
      });
      if (result.success) {
        setUploadResult('Bucket: ' + result.data!.bucket + ' | Path: ' + result.data!.storagePath + ' | Size: ' + result.data!.fileSize);
      } else {
        setUploadResult('Error: ' + result.error);
      }
    } catch (err) {
      setUploadResult('Error: ' + String(err));
    } finally {
      setUploadLoading(false);
    }
  };

  // ── Thumbnail Upload ──
  const handleThumbnail = async () => {
    if (!thumbFile) { setCommError('Select an image'); return; }
    if (!thumbContentId) { setCommError('Content ID is required'); return; }
    setCommError(null);
    setThumbLoading(true);
    setThumbResult(null);
    try {
      const { uploadThumbnail } = await import('@/services/storage/storageService');
      const result = await uploadThumbnail(thumbFile, thumbInstituteId || (user?.instituteId ?? ''), thumbContentId);
      if (result.success) {
        setThumbResult('Bucket: ' + result.data!.bucket + ' | Path: ' + result.data!.storagePath);
      } else {
        setThumbResult('Error: ' + result.error);
      }
    } catch (err) {
      setThumbResult('Error: ' + String(err));
    } finally {
      setThumbLoading(false);
    }
  };

  // ── Signed URL ──
  const handleSignedUrl = async () => {
    if (!signedPath) { setCommError('Storage path is required'); return; }
    setCommError(null);
    setSignedLoading(true);
    setSignedResult(null);
    try {
      const { generateSignedUrl } = await import('@/services/storage/storageService');
      const result = await generateSignedUrl({ bucket: signedBucket, storagePath: signedPath, contentType: 'pdf' });
      if (result.success) {
        setSignedResult('URL: ' + result.data!.signedUrl + ' | Expires: ' + new Date(result.data!.expiresAt * 1000).toISOString());
      } else {
        setSignedResult('Error: ' + result.error);
      }
    } catch (err) {
      setSignedResult('Error: ' + String(err));
    } finally {
      setSignedLoading(false);
    }
  };

  // ── File Exists ──
  const handleExists = async () => {
    if (!existsPath) { setCommError('Storage path is required'); return; }
    setCommError(null);
    setExistsLoading(true);
    setExistsResult(null);
    try {
      const { fileExists } = await import('@/services/storage/storageService');
      const result = await fileExists(existsBucket, existsPath);
      if (result.success) {
        setExistsResult('Exists: ' + String(result.data));
      } else {
        setExistsResult('Error: ' + result.error);
      }
    } catch (err) {
      setExistsResult('Error: ' + String(err));
    } finally {
      setExistsLoading(false);
    }
  };

  // ── Delete ──
  const handleDelete = async () => {
    if (!deletePath) { setCommError('Storage path is required'); return; }
    if (!window.confirm('Delete this file from storage?')) return;
    setCommError(null);
    setDeleteLoading(true);
    setDeleteResult(null);
    try {
      const { deleteFile } = await import('@/services/storage/storageService');
      const result = await deleteFile(deleteBucket, deletePath);
      if (result.success) {
        setDeleteResult('Deleted successfully.');
      } else {
        setDeleteResult('Error: ' + result.error);
      }
    } catch (err) {
      setDeleteResult('Error: ' + String(err));
    } finally {
      setDeleteLoading(false);
    }
  };

  const fieldClass = 'rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 w-full mt-1';
  const labelClass = 'text-[10px] uppercase tracking-wider text-gray-500';

  return (
    <div className="space-y-4">
      {commError && <div className="text-xs text-red-400">{commError}</div>}

      {/* ── Upload ── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Upload File</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Bucket</label>
            <input className={fieldClass} value={uploadBucket} onChange={(e) => setUploadBucket(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>File</label>
            <input type="file" className="text-xs text-gray-400 mt-1 file:mr-2 file:rounded file:border-0 file:bg-gray-700 file:px-2 file:py-1 file:text-xs file:text-gray-200" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <button onClick={handleUpload} disabled={uploadLoading} className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50">
          {uploadLoading ? 'Uploading...' : 'Upload'}
        </button>
        {uploadResult && <div className="text-xs text-gray-300 break-all">{uploadResult}</div>}
      </div>

      {/* ── Thumbnail Upload ── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Upload Thumbnail</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Institute ID</label>
            <input className={fieldClass} value={thumbInstituteId} onChange={(e) => setThumbInstituteId(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Content ID</label>
            <input className={fieldClass} placeholder="UUID" value={thumbContentId} onChange={(e) => setThumbContentId(e.target.value)} />
          </div>
        </div>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="text-xs text-gray-400 file:mr-2 file:rounded file:border-0 file:bg-gray-700 file:px-2 file:py-1 file:text-xs file:text-gray-200" onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)} />
        <button onClick={handleThumbnail} disabled={thumbLoading} className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50">
          {thumbLoading ? 'Uploading...' : 'Upload Thumbnail'}
        </button>
        {thumbResult && <div className="text-xs text-gray-300 break-all">{thumbResult}</div>}
      </div>

      {/* ── Signed URL ── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Generate Signed URL</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Bucket</label>
            <input className={fieldClass} value={signedBucket} onChange={(e) => setSignedBucket(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Storage Path</label>
            <input className={fieldClass} placeholder="full/storage/path" value={signedPath} onChange={(e) => setSignedPath(e.target.value)} />
          </div>
        </div>
        <button onClick={handleSignedUrl} disabled={signedLoading} className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50">
          {signedLoading ? 'Generating...' : 'Generate'}
        </button>
        {signedResult && <div className="text-xs text-gray-300 break-all">{signedResult}</div>}
      </div>

      {/* ── File Exists ── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Check File Exists</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Bucket</label>
            <input className={fieldClass} value={existsBucket} onChange={(e) => setExistsBucket(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Storage Path</label>
            <input className={fieldClass} placeholder="full/storage/path" value={existsPath} onChange={(e) => setExistsPath(e.target.value)} />
          </div>
        </div>
        <button onClick={handleExists} disabled={existsLoading} className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50">
          {existsLoading ? 'Checking...' : 'Check'}
        </button>
        {existsResult && (
          <div className="text-xs break-all">
            {existsResult.includes('true')
              ? <span className="text-green-400">{existsResult}</span>
              : existsResult.includes('false')
                ? <span className="text-amber-400">{existsResult}</span>
                : <span className="text-red-400">{existsResult}</span>}
          </div>
        )}
      </div>

      {/* ── Delete ── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Delete File</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Bucket</label>
            <input className={fieldClass} value={deleteBucket} onChange={(e) => setDeleteBucket(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Storage Path</label>
            <input className={fieldClass} placeholder="full/storage/path" value={deletePath} onChange={(e) => setDeletePath(e.target.value)} />
          </div>
        </div>
        <button onClick={handleDelete} disabled={deleteLoading} className="rounded bg-red-700 px-4 py-1.5 text-xs text-white hover:bg-red-600 disabled:opacity-50">
          {deleteLoading ? 'Deleting...' : 'Delete'}
        </button>
        {deleteResult && (
          <div className={'text-xs break-all ' + (deleteResult.includes('Error') ? 'text-red-400' : 'text-green-400')}>{deleteResult}</div>
        )}
      </div>
    </div>
  );
}
