/**
 * Question Image Storage Service
 *
 * Reusable service for generating signed URLs for question images stored in
 * Supabase Storage.  Handles both `question_images` (stem / explanation) and
 * `question_option_images` (option) image records.
 *
 * ## Why signed URLs instead of public URLs?
 *
 * The `question-images` Storage bucket is **private** (public = FALSE).
 * `getPublicUrl()` generates URLs that return 403 Forbidden on private
 * buckets.  Signed URLs use a short-lived JWT token that authorises access
 * to the private bucket for a configurable duration.
 *
 * ## Usage
 *
 * ```ts
 * import { getSignedImageUrl, getSignedImageUrls } from '@/services/storage/questionImageService';
 *
 * // Single image
 * const url = await getSignedImageUrl('question-images', 'questions/.../img.png');
 *
 * // Batch — returns a Map of original key → signed URL
 * const urlMap = await getSignedImageUrls(images.map((img, i) => ({
 *   key: `stem-${i}`,
 *   bucket: img.storageBucket,
 *   path: img.storagePath,
 * })));
 * ```
 *
 * @module services/storage/questionImageService
 */

import { supabase } from '@/config/supabase';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Default signed URL expiry: 5 minutes (300 seconds). */
const DEFAULT_EXPIRY_SECONDS = 300;

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** Input descriptor for a single image URL request. */
export interface ImageUrlRequest {
  /** Unique key used to correlate the result in the returned map. */
  key: string;
  /** Supabase Storage bucket name (e.g. 'question-images'). */
  bucket: string;
  /** Storage path within the bucket (e.g. 'questions/.../img.png'). */
  path: string;
}

/** Result of a single signed URL generation (success or failure). */
export interface ImageUrlResult {
  /** The original request key for correlation. */
  key: string;
  /** The signed URL, or null if generation failed. */
  url: string | null;
  /** Error message if generation failed. */
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a signed URL for a single image.
 *
 * @param bucket      - Supabase Storage bucket name.
 * @param storagePath - Object path within the bucket.
 * @param expiresIn   - Signed URL lifetime in seconds (default: 300).
 *
 * @returns The signed URL string, or `null` if generation failed.
 *
 * @example
 * ```ts
 * const url = await getSignedImageUrl('question-images', 'questions/.../img.png');
 * if (url) {
 *   // Use the signed URL in an <img> src
 * }
 * ```
 */
export async function getSignedImageUrl(
  bucket: string,
  storagePath: string,
  expiresIn: number = DEFAULT_EXPIRY_SECONDS,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      console.error(
        `[questionImageService] Failed to generate signed URL for bucket="${bucket}" path="${storagePath}":`,
        error.message,
      );
      return null;
    }

    return data?.signedUrl ?? null;
  } catch (err) {
    console.error(
      `[questionImageService] Unexpected error generating signed URL for bucket="${bucket}" path="${storagePath}":`,
      err,
    );
    return null;
  }
}

/**
 * Generate signed URLs for multiple images in parallel.
 *
 * Each image descriptor in the input produces one `ImageUrlResult` in the
 * output.  Failed URLs have `url: null` and a descriptive `error` — they
 * do NOT prevent other URLs from being generated.
 *
 * @param requests - Array of image URL requests.
 * @param expiresIn - Signed URL lifetime in seconds (default: 300).
 *
 * @returns Array of results, one per input request, in the same order.
 *
 * @example
 * ```ts
 * const results = await getSignedImageUrls([
 *   { key: 'stem-0', bucket: img.storageBucket, path: img.storagePath },
 * ]);
 * for (const r of results) {
 *   if (r.url) { /* use r.url *\/ }
 * }
 * ```
 */
export async function getSignedImageUrls(
  requests: ImageUrlRequest[],
  expiresIn: number = DEFAULT_EXPIRY_SECONDS,
): Promise<ImageUrlResult[]> {
  if (requests.length === 0) return [];

  const results = await Promise.allSettled(
    requests.map(async (req) => {
      const url = await getSignedImageUrl(req.bucket, req.path, expiresIn);
      return {
        key: req.key,
        url,
        error: url === null ? `Failed to generate signed URL for "${req.path}"` : null,
      } satisfies ImageUrlResult;
    }),
  );

  return results.map((r, idx) => {
    if (r.status === 'fulfilled') {
      return r.value;
    }
    // Promise.allSettled should not reject for our implementation since
    // getSignedImageUrl catches all errors internally, but handle it defensively.
    return {
      key: requests[idx].key,
      url: null,
      error: r.reason instanceof Error ? r.reason.message : 'Unknown error',
    } satisfies ImageUrlResult;
  });
}

/**
 * Convenience function that builds a Map<string, string> from the results
 * of `getSignedImageUrls`, with `key → signedUrl` mappings.
 *
 * Failed URLs are omitted from the map — check `results` directly if you
 * need error details.
 *
 * @param requests - Array of image URL requests.
 * @param expiresIn - Signed URL lifetime in seconds (default: 300).
 *
 * @returns A Map of key → signed URL.  Failed URLs are not included.
 */
export async function getSignedImageUrlMap(
  requests: ImageUrlRequest[],
  expiresIn: number = DEFAULT_EXPIRY_SECONDS,
): Promise<Map<string, string>> {
  const results = await getSignedImageUrls(requests, expiresIn);
  const map = new Map<string, string>();
  for (const r of results) {
    if (r.url) {
      map.set(r.key, r.url);
    }
  }
  return map;
}
