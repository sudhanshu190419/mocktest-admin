/**
 * Storage Service
 *
 * Clean-architecture service layer encapsulating ALL interaction with
 * Supabase Storage, generalised to support every resource type — content,
 * question images, profile pictures, certificates, etc.
 *
 * Every public method returns a standardised response so that consumers
 * (services, hooks, screens) never need to handle raw Supabase Storage
 * exceptions or error formats.
 *
 * ## Architecture decisions
 *
 * 1. **Config-driven.** All bucket names, MIME types, size limits, path
 *    templates, and expiry values come from `src/config/storage.ts`.
 *    No hardcoded strings.
 *
 * 2. **Validation-first.** Every upload is validated via the pure utility
 *    functions in `src/utils/storage.ts` before any storage operation.
 *
 * 3. **Structured errors.** All Supabase Storage errors are caught,
 *    classified, and returned as structured `ApiResponse<T>` objects.
 *    No raw exceptions propagate to consumers.
 *
 * 4. **Retry with exponential backoff.** Transient upload failures are
 *    retried automatically using configured constants. 4xx client errors
 *    are not retried.
 *
 * 5. **Resource-agnostic.** The `uploadFile` and `uploadResource` methods
 *    both delegate to a shared internal `_performUpload` helper. The only
 *    difference is how they determine bucket/storage-path.
 *
 * @module storageService
 */

import { supabase } from '../../config/supabase';
import { extractErrorMessage } from '../../utils/supabase';
import {
  validateUpload,
  validateResourceUpload,
  buildStoragePath,
  buildResourceStoragePath,
  buildThumbnailPath,
  getBucketForContentType,
  getSignedUrlExpiry,
  sanitizeFileName,
} from '../../utils/storage';
import {
  CONTENT_THUMBNAILS,
  UPLOAD_MAX_RETRIES,
  UPLOAD_RETRY_BASE_DELAY_MS,
  UPLOAD_RETRY_MAX_DELAY_MS,
  THUMBNAIL_MIME_TYPES,
  THUMBNAIL_MAX_SIZE_BYTES,
  getResourceConfig,
} from '../../config/storage';
import type { ContentType } from '../../types/content';
import type { StorageResourceType } from '../../config/storage';
import type { ApiResponse } from '../../types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Shared Types (internal to this service)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of a successful file upload.
 */
export interface UploadResult {
  /** The bucket the file was uploaded to. */
  bucket: string;
  /** The full storage path within the bucket. */
  storagePath: string;
  /** File size in bytes as reported by the upload. */
  fileSize: number;
  /** IANA media type of the uploaded file. */
  mimeType: string;
}

/**
 * Parameters for content-type-based uploads (backward compatible).
 *
 * Used by the Content module. The bucket and storage path are derived
 * from `contentType`, `instituteId`, and `contentId`.
 */
export interface UploadFileParams {
  /** The file data to upload (File, Blob, or ArrayBuffer). */
  file: File | Blob | ArrayBuffer;
  /** The content type discriminator (determines bucket and validation rules). */
  contentType: ContentType;
  /** UUID of the owning institute. */
  instituteId: string;
  /** UUID of the content row. */
  contentId: string;
  /** Optional signal for upload cancellation. */
  signal?: AbortSignal;
  /** Optional progress callback receiving (loaded, total) bytes. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Parameters for resource-type-based uploads.
 *
 * Used by non-content modules (question images, profile pictures,
 * certificates, etc.). The bucket and storage path are derived from
 * `resourceType` and `pathParams` via the resource configuration.
 */
export interface UploadResourceParams {
  /** The file data to upload (File, Blob, or ArrayBuffer). */
  file: File | Blob | ArrayBuffer;
  /**
   * The resource type discriminator — determines bucket, validation
   * rules, and path template.
   */
  resourceType: StorageResourceType;
  /**
   * Path parameter values for template substitution.
   * Keys must match `{param}` placeholders in the resource type's
   * path template.
   *
   * @example `{ instituteId, questionId, imageId, ext }` for question images
   */
  pathParams: Record<string, string>;
  /** Optional progress callback receiving (loaded, total) bytes. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Parameters for the `generateSignedUrl` function.
 */
export interface SignedUrlParams {
  /** The bucket containing the file. */
  bucket: string;
  /** The storage path of the file within the bucket. */
  storagePath: string;
  /** The content type (determines default expiry). */
  contentType: ContentType;
  /** Optional custom expiry override in seconds. */
  expiresIn?: number;
}

/**
 * Parameters for the `retryUpload` callback.
 */
export type UploadOperation = () => Promise<{
  data: { path: string } | null;
  error: unknown;
}>;

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers — File Reading (React Native compatible)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reads a File or Blob into an ArrayBuffer.
 *
 * React Native's JavaScript engine does not support `Blob.arrayBuffer()`
 * or `File.arrayBuffer()`. This utility uses the `FileReader` API which
 * is available in all environments including React Native.
 *
 * @param blob - The File or Blob to read.
 * @returns The file contents as an ArrayBuffer.
 */
function readBlobAsArrayBuffer(blob: Blob | File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Extracts metadata from a File, Blob, or ArrayBuffer input.
 *
 * Returns a normalised `{ bytes, size, mimeType, fileName }` object
 * regardless of the input type.
 */
async function extractFileMetadata(
  file: File | Blob | ArrayBuffer,
): Promise<{
  bytes: ArrayBuffer;
  size: number;
  mimeType: string;
  fileName: string;
}> {
  if (file instanceof File) {
    const bytes = await readBlobAsArrayBuffer(file);
    return { bytes, size: file.size, mimeType: file.type, fileName: file.name };
  }

  if (file instanceof Blob) {
    const bytes = await readBlobAsArrayBuffer(file);
    return { bytes, size: file.size, mimeType: file.type, fileName: 'upload.bin' };
  }

  // ArrayBuffer
  return {
    bytes: file,
    size: file.byteLength,
    mimeType: 'application/octet-stream',
    fileName: 'upload.bin',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Error Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Checks whether an unknown error value has a Supabase StorageError-like
 * shape (i.e. has a `statusCode` property).
 *
 * Used instead of importing the `StorageError` class which may not be
 * available in all SDK versions.
 */
function isStorageErrorLike(error: unknown): error is { statusCode: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    'message' in error
  );
}

/**
 * Extracts a human-readable error message from a Supabase Storage error
 * or any other unknown error shape.
 *
 * Handles StorageError-like objects (with `statusCode`), standard `Error`
 * instances, and fallback strings.
 *
 * Known status codes:
 *   403 — Permission denied
 *   404 — File not found
 *   409 — Object already exists / duplicate
 *   413 — File too large
 *   5xx — Server errors (transient)
 */
function extractStorageError(error: unknown): string {
  if (isStorageErrorLike(error)) {
    switch (error.statusCode) {
      case '403':
        return 'Permission denied. You do not have access to this storage resource.';
      case '404':
        return 'The requested file was not found in storage.';
      case '409':
        return 'A file with the same name already exists in storage.';
      case '413':
        return 'The file exceeds the maximum allowed size.';
      default:
        return error.message;
    }
  }

  // Fall through to the shared error extractor for PostgrestError / Error
  return extractErrorMessage(error);
}

/**
 * Determines whether a storage error is transient (retriable).
 *
 * Transient errors: network timeouts, 5xx server errors, rate limits.
 * Non-transient errors: 4xx client errors (invalid MIME, file too large,
 * permission denied, bucket missing).
 */
function isTransientError(error: unknown): boolean {
  if (isStorageErrorLike(error)) {
    const code = error.statusCode;
    // 5xx server errors and rate limits (429) are transient
    if (code.startsWith('5') || code === '429') {
      return true;
    }
    // All other storage errors (403, 404, 409, 413) are not retriable
    return false;
  }

  // Network errors (TypeError: fetch failed, etc.) are transient
  if (error instanceof TypeError) {
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Retry Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Executes an upload operation with exponential backoff retry.
 *
 * Retry timing:
 *   Attempt 1: immediate
 *   Attempt 2: after {baseDelay} ms
 *   Attempt 3: after {baseDelay * 2} ms (capped at {maxDelay} ms)
 *
 * Only transient errors (network timeouts, 5xx) are retried.
 * 4xx client errors are returned immediately without retry.
 *
 * @param operation   - Async function that performs the upload.
 * @param maxRetries  - Maximum number of retry attempts (default from config).
 * @param baseDelayMs - Initial delay in ms (default from config).
 * @param maxDelayMs  - Maximum delay in ms (default from config).
 *
 * @returns The successful upload result, or the last error if all retries fail.
 */
export async function retryUpload(
  operation: UploadOperation,
  maxRetries: number = UPLOAD_MAX_RETRIES,
  baseDelayMs: number = UPLOAD_RETRY_BASE_DELAY_MS,
  maxDelayMs: number = UPLOAD_RETRY_MAX_DELAY_MS,
): Promise<{ data: { path: string } | null; error: unknown }> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await operation();

    if (result.error === null) {
      return result; // success
    }

    lastError = result.error;

    // If the error is not transient, don't retry
    if (!isTransientError(lastError)) {
      return result;
    }

    // Wait before next retry (exponential backoff)
    if (attempt < maxRetries) {
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await sleep(delay);
    }
  }

  // All retries exhausted
  return { data: null, error: lastError };
}

/**
 * Promise-based sleep for retry delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Upload Core
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal upload parameters — the normalised shape produced by both
 * `uploadFile` (content-type path) and `uploadResource` (resource-type
 * path) before delegating to the shared upload logic.
 */
interface InternalUploadParams {
  fileBytes: ArrayBuffer;
  fileSize: number;
  mimeType: string;
  bucket: string;
  storagePath: string;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Performs the actual Supabase Storage upload with retry and progress.
 *
 * This is the single internal point where the storage SDK is called.
 * Both `uploadFile` and `uploadResource` normalise their inputs and
 * delegate here.
 */
async function _performUpload(
  params: InternalUploadParams,
): Promise<ApiResponse<UploadResult>> {
  const { fileBytes, fileSize, mimeType, bucket, storagePath, onProgress } = params;

  try {
    const uploadResult = await retryUpload(async () => {
      return supabase.storage.from(bucket).upload(storagePath, fileBytes, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false,
        ...(onProgress ? { onUploadProgress: onProgress } : {}),
      });
    });

    if (uploadResult.error) {
      return { success: false, error: extractStorageError(uploadResult.error) };
    }

    return {
      success: true,
      data: { bucket, storagePath, fileSize, mimeType },
    };
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. uploadFile() — Content-Type-Based Upload (Backward Compatible)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uploads a file to Supabase Storage, determining the destination from
 * the content type and content ID.
 *
 * This is the backward-compatible API for the Content module. For new
 * modules, prefer `uploadResource()` with a resource type and path params.
 *
 * The upload destination (bucket and path) is determined entirely by the
 * content type and content ID — no client input influences the storage
 * location.
 *
 * Transient errors (network timeouts, 5xx) are retried with exponential
 * backoff. 4xx client errors are returned immediately.
 *
 * @param params - Upload parameters (file, contentType, instituteId, contentId,
 *                 optional progress callback).
 *
 * @returns Structured response with storage metadata on success.
 *
 * @example
 * ```ts
 * const result = await uploadFile({
 *   file: pdfFile,
 *   contentType: 'pdf',
 *   instituteId: 'inst-123',
 *   contentId: 'cont-456',
 *   onProgress: (loaded, total) => console.log(`${loaded}/${total}`),
 * });
 *
 * if (result.success) {
 *   // store result.data.bucket and result.data.storagePath on the content row
 * }
 * ```
 */
export async function uploadFile(
  params: UploadFileParams,
): Promise<ApiResponse<UploadResult>> {
  const { file, contentType, instituteId, contentId, onProgress } = params;

  try {
    // ── 1. Determine file metadata (React Native compatible) ─────────────
    const metadata = await extractFileMetadata(file);
    const { bytes: fileBytes, size: fileSize, mimeType, fileName: originalFileName } = metadata;

    // ── 2. Validate upload ───────────────────────────────────────────────
    const validation = validateUpload({
      fileName: originalFileName,
      mimeType,
      fileSizeBytes: fileSize,
      contentType,
    });

    if (!validation.valid) {
      const errors = [validation.mime.error, validation.extension.error, validation.size.error]
        .filter(Boolean)
        .join('; ');
      return { success: false, error: errors };
    }

    // ── 3. Determine destination ─────────────────────────────────────────
    const bucket = getBucketForContentType(contentType);
    const storagePath = buildStoragePath(instituteId, contentId, originalFileName);

    // ── 4. Upload via shared core ────────────────────────────────────────
    return _performUpload({ fileBytes, fileSize, mimeType, bucket, storagePath, onProgress });
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  1b. uploadResource() — Resource-Type-Based Upload
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uploads a file to Supabase Storage, determining the destination from
 * the resource type and path params.
 *
 * This is the generalised upload API usable by every module — content,
 * question images, profile pictures, certificates, etc. It:
 *
 * 1. Validates MIME type, file extension, and file size against the
 *    resource type's configuration.
 * 2. Builds the storage path from the resource type's path template
 *    and the provided path parameters.
 * 3. Delegates to the same internal upload core used by `uploadFile()`.
 *
 * @param params - Upload parameters (file, resourceType, pathParams,
 *                 optional progress callback).
 *
 * @returns Structured response with storage metadata on success.
 *
 * @example
 * ```ts
 * const result = await uploadResource({
 *   file: imageFile,
 *   resourceType: 'question_image',
 *   pathParams: {
 *     instituteId: 'inst-123',
 *     questionId: 'q-456',
 *     imageId: 'img-789',
 *     ext: 'png',
 *   },
 * });
 *
 * if (result.success) {
 *   // store result.data.bucket and result.data.storagePath on the image row
 * }
 * ```
 */
export async function uploadResource(
  params: UploadResourceParams,
): Promise<ApiResponse<UploadResult>> {
  const { file, resourceType, pathParams, onProgress } = params;

  try {
    // ── 1. Determine file metadata (React Native compatible) ─────────────
    const metadata = await extractFileMetadata(file);
    const { bytes: fileBytes, size: fileSize, mimeType, fileName: originalFileName } = metadata;

    // ── 2. Validate upload ───────────────────────────────────────────────
    const validation = validateResourceUpload({
      fileName: originalFileName,
      mimeType,
      fileSizeBytes: fileSize,
      resourceType,
    });

    if (!validation.valid) {
      const errors = [validation.mime.error, validation.extension.error, validation.size.error]
        .filter(Boolean)
        .join('; ');
      return { success: false, error: errors };
    }

    // ── 3. Determine destination ─────────────────────────────────────────
    const config = getResourceConfig(resourceType);
    const bucket = config.bucket;

    // Build path from resource template + caller-provided path params.
    // If the template has {sanitisedFileName}, derive it from the file name.
    let resolvedPathParams = { ...pathParams };
    if (!resolvedPathParams.sanitisedFileName && config.pathTemplate.includes('{sanitisedFileName}')) {
      resolvedPathParams.sanitisedFileName = sanitizeFileName(originalFileName);
    }

    const storagePath = buildResourceStoragePath(resourceType, resolvedPathParams);

    // ── 4. Upload via shared core ────────────────────────────────────────
    return _performUpload({ fileBytes, fileSize, mimeType, bucket, storagePath, onProgress });
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. deleteFile()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deletes a file from Supabase Storage.
 *
 * Supports batch deletion — pass a single path or an array of paths.
 *
 * @param bucket       - The storage bucket (e.g. 'content-pdfs').
 * @param storagePaths - One or more storage paths to delete.
 *
 * @returns Structured response indicating success or the specific error.
 *
 * @example
 * ```ts
 * const result = await deleteFile('content-pdfs', [
 *   'institutes/inst-123/content/cont-456/old-file.pdf',
 * ]);
 * ```
 */
export async function deleteFile(
  bucket: string,
  storagePaths: string | string[],
): Promise<ApiResponse<void>> {
  try {
    const paths = Array.isArray(storagePaths) ? storagePaths : [storagePaths];

    const { error } = await supabase.storage.from(bucket).remove(paths);

    if (error) {
      return { success: false, error: extractStorageError(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. replaceFile()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Replaces an existing file in storage with a new one.
 *
 * Workflow:
 *   1. Delete the old file (best-effort — the new file will be at a
 *      different path based on the new contentId)
 *   2. Upload the new file
 *   3. Return the new storage metadata
 *
 * If the upload fails after a successful delete, the error message will
 * indicate that the old file was deleted but the new one could not be
 * uploaded. The caller should handle this by either retrying or creating
 * a new content row.
 *
 * @param params          - Same as `uploadFile` parameters.
 * @param oldStorageBucket - The bucket of the existing file.
 * @param oldStoragePath   - The storage path of the existing file to replace.
 *
 * @returns Structured response with the new storage metadata.
 */
export async function replaceFile(
  params: UploadFileParams,
  oldStorageBucket: string,
  oldStoragePath: string,
): Promise<ApiResponse<UploadResult>> {
  try {
    // ── 1. Delete old file (best-effort) ─────────────────────────────────
    const deleteResult = await deleteFile(oldStorageBucket, oldStoragePath);

    // ── 2. Upload new file ───────────────────────────────────────────────
    const uploadResult = await uploadFile(params);

    if (!uploadResult.success) {
      const wasDeleted = deleteResult.success;
      return {
        success: false,
        error: wasDeleted
          ? `Old file was deleted but new upload failed: ${uploadResult.error}`
          : `Upload failed: ${uploadResult.error}`,
      };
    }

    return uploadResult;
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. generateSignedUrl()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates a short-lived signed URL for downloading or viewing a file.
 *
 * The expiry duration is determined by the content type unless overridden:
 *   - video: 60 seconds (streaming token)
 *   - pdf, notes, assignment: 300 seconds (document download)
 *
 * Signed URLs are generated at request time and must NOT be cached
 * server-side beyond their expiry window.
 *
 * @param params - The bucket, storage path, content type, and optional
 *                 custom expiry override.
 *
 * @returns An object containing the signed URL and its expiry timestamp.
 *
 * @example
 * ```ts
 * const result = await generateSignedUrl({
 *   bucket: 'content-pdfs',
 *   storagePath: 'institutes/.../content/.../file.pdf',
 *   contentType: 'pdf',
 * });
 *
 * if (result.success) {
 *   // Use result.data.signedUrl for the download link
 * }
 * ```
 */
export async function generateSignedUrl(
  params: SignedUrlParams,
): Promise<ApiResponse<{ signedUrl: string; expiresAt: number }>> {
  const { bucket, storagePath, contentType, expiresIn } = params;

  try {
    const expiry = expiresIn ?? getSignedUrlExpiry(contentType);

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiry);

    if (error) {
      return { success: false, error: extractStorageError(error) };
    }

    // Compute the absolute expiry timestamp (epoch seconds)
    const expiresAt = Math.floor(Date.now() / 1000) + expiry;

    return {
      success: true,
      data: { signedUrl: data.signedUrl, expiresAt },
    };
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. fileExists()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Checks whether a storage object exists at the given bucket and path.
 *
 * Uses `createSignedUrl` with a 1-second expiry as a lightweight
 * existence check. A successful signed URL generation means the object
 * exists; a 404 error means it does not.
 *
 * @param bucket      - The storage bucket.
 * @param storagePath - The storage path to check.
 *
 * @returns `true` if the object exists, `false` otherwise.
 *
 * @example
 * ```ts
 * const result = await fileExists('content-pdfs', 'institutes/.../file.pdf');
 * if (result.success && result.data) {
 *   // file exists — generate signed URL
 * }
 * ```
 */
export async function fileExists(
  bucket: string,
  storagePath: string,
): Promise<ApiResponse<boolean>> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 1);

    if (error) {
      // 404 means the object doesn't exist — not a real error
      if (isStorageErrorLike(error) && error.statusCode === '404') {
        return { success: true, data: false };
      }

      return { success: false, error: extractStorageError(error) };
    }

    return { success: true, data: !!data.signedUrl };
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. uploadThumbnail()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uploads a thumbnail image to the public thumbnails bucket.
 *
 * Thumbnails are stored in a PUBLIC bucket and served without signed URLs.
 * Validation checks MIME type (JPEG, PNG, WebP) and file size (max 10 MB).
 *
 * @param file        - The thumbnail image file (File, Blob, or ArrayBuffer).
 * @param instituteId - UUID of the owning institute.
 * @param contentId   - UUID of the content row.
 * @param onProgress  - Optional progress callback.
 *
 * @returns Structured response with the thumbnail storage metadata.
 *
 * @example
 * ```ts
 * const result = await uploadThumbnail(thumbnailBlob, 'inst-123', 'cont-456');
 * if (result.success) {
 *   // store result.data.bucket and result.data.storagePath on the content row
 * }
 * ```
 */
export async function uploadThumbnail(
  file: File | Blob | ArrayBuffer,
  instituteId: string,
  contentId: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ApiResponse<UploadResult>> {
  try {
    // ── 1. Determine file metadata ───────────────────────────────────────
    const metadata = await extractFileMetadata(file);
    const { bytes: fileBytes, size: fileSize, mimeType } = metadata;

    // ── 2. Validate MIME type against thumbnail allowlist ────────────────
    if (!(THUMBNAIL_MIME_TYPES as readonly string[]).includes(mimeType)) {
      return {
        success: false,
        error: `Thumbnail MIME type "${mimeType}" is not allowed. Accepted: ${THUMBNAIL_MIME_TYPES.join(', ')}`,
      };
    }

    // ── 3. Validate file size against thumbnail limit (10 MB) ────────────
    if (fileSize > THUMBNAIL_MAX_SIZE_BYTES) {
      return {
        success: false,
        error: `Thumbnail size ${fileSize} bytes exceeds maximum of ${THUMBNAIL_MAX_SIZE_BYTES} bytes.`,
      };
    }

    // ── 4. Build path and upload ─────────────────────────────────────────
    const bucket = CONTENT_THUMBNAILS;
    const storagePath = buildThumbnailPath(instituteId, contentId);

    const uploadResult = await retryUpload(async () => {
      return supabase.storage.from(bucket).upload(storagePath, fileBytes, {
        contentType: mimeType,
        cacheControl: '86400', // 24 hours — thumbnails change infrequently
        upsert: true, // Allow replacing an existing thumbnail
        ...(onProgress ? { onUploadProgress: onProgress } : {}),
      });
    });

    if (uploadResult.error) {
      return { success: false, error: extractStorageError(uploadResult.error) };
    }

    return {
      success: true,
      data: {
        bucket,
        storagePath,
        fileSize,
        mimeType,
      },
    };
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. deleteThumbnail()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deletes a thumbnail image from the thumbnails bucket.
 *
 * @param instituteId  - UUID of the owning institute.
 * @param contentId    - UUID of the content row.
 * @param thumbnailPath - Optional explicit path; if omitted, derives from
 *                        instituteId and contentId.
 *
 * @returns Structured response.
 *
 * @example
 * ```ts
 * const result = await deleteThumbnail('inst-123', 'cont-456');
 * ```
 */
export async function deleteThumbnail(
  instituteId: string,
  contentId: string,
  thumbnailPath?: string,
): Promise<ApiResponse<void>> {
  try {
    const path = thumbnailPath ?? buildThumbnailPath(instituteId, contentId);

    return deleteFile(CONTENT_THUMBNAILS, path);
  } catch (err) {
    return { success: false, error: extractStorageError(err) };
  }
}
