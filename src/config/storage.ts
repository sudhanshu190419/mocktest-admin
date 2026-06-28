/**
 * Storage Configuration
 *
 * Read-only configuration constants for Supabase Storage interactions
 * within the Content Management module.
 *
 * This file contains ONLY configuration — no Supabase client, no upload
 * logic, no helper functions, no React code, no services.
 *
 * Dependencies:
 * - Values align with supabase/migrations/022_storage_configuration.sql
 * - ContentType type imported from src/types/content.ts
 *
 * @module config/storage
 */

import type { ContentType } from '../types/content';

// ═══════════════════════════════════════════════════════════════════════════
//  1. Bucket Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Bucket for teacher-uploaded PDF documents (study notes, books, PYQ PDFs). */
export const CONTENT_PDFS = 'content-pdfs' as const;

/** Bucket for teacher-uploaded video recordings (lectures, course videos). */
export const CONTENT_VIDEOS = 'content-videos' as const;

/** Bucket for video thumbnails and content card preview images. PUBLIC bucket. */
export const CONTENT_THUMBNAILS = 'content-thumbnails' as const;

/** Bucket for student-uploaded assignment submissions and answer sheets. */
export const STUDENT_SUBMISSIONS = 'student-submissions' as const;

// ═══════════════════════════════════════════════════════════════════════════
//  2. Bucket Mapping (contentType → bucket)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps a content type enum value to its corresponding Supabase Storage
 * bucket name.
 *
 * - `pdf`, `notes`, `assignment` → `content-pdfs`  (shared bucket)
 * - `video`                      → `content-videos` (dedicated video bucket)
 *
 * @see CONTENT_PDFS
 * @see CONTENT_VIDEOS
 */
export const CONTENT_BUCKET_MAP: Record<ContentType, string> = {
  pdf: CONTENT_PDFS,
  video: CONTENT_VIDEOS,
  notes: CONTENT_PDFS,
  assignment: CONTENT_PDFS,
};

// ═══════════════════════════════════════════════════════════════════════════
//  3. MIME Type Allowlists
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Allowed MIME types for PDF content.
 * Only application/pdf is accepted.
 */
export const PDF_MIME_TYPES = ['application/pdf'] as const;

/**
 * Allowed MIME types for video content.
 * Supports MP4, WebM, and QuickTime MOV formats.
 */
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

/**
 * Allowed MIME types for notes content.
 * Supports PDF, plain text, DOC, and DOCX formats.
 */
export const NOTES_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/**
 * Allowed MIME types for assignment content.
 * Supports PDF, DOC, and DOCX formats.
 */
export const ASSIGNMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/**
 * Allowed MIME types for thumbnail images.
 * Supports JPEG, PNG, and WebP formats.
 */
export const THUMBNAIL_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Complete allowlist of all MIME types accepted across all content types.
 *
 * Centralised for quick allowlist-wide checks (e.g., at the API gateway
 * or middleware layer) before routing to type-specific validation.
 */
export const ALL_ALLOWED_MIME_TYPES: readonly string[] = [
  ...PDF_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...NOTES_MIME_TYPES,
  ...ASSIGNMENT_MIME_TYPES,
  ...THUMBNAIL_MIME_TYPES,
];

/**
 * Maps a content type to its corresponding MIME type allowlist.
 */
export const CONTENT_MIME_TYPE_MAP: Record<ContentType, readonly string[]> = {
  pdf: PDF_MIME_TYPES,
  video: VIDEO_MIME_TYPES,
  notes: NOTES_MIME_TYPES,
  assignment: ASSIGNMENT_MIME_TYPES,
};

// ═══════════════════════════════════════════════════════════════════════════
//  4. Maximum File Sizes (in bytes)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maximum file size for PDF content (100 MB).
 *
 * Aligned with the `content-pdfs` bucket file_size_limit in migration 022.
 */
export const PDF_MAX_SIZE_BYTES = 104_857_600;

/**
 * Maximum file size for video content (5 GB).
 *
 * Aligned with the `content-videos` bucket file_size_limit in migration 022.
 */
export const VIDEO_MAX_SIZE_BYTES = 5_368_709_120;

/**
 * Maximum file size for notes content (100 MB).
 *
 * Notes share the `content-pdfs` bucket; same limit applies.
 */
export const NOTES_MAX_SIZE_BYTES = 104_857_600;

/**
 * Maximum file size for assignment content (100 MB).
 *
 * Assignments share the `content-pdfs` bucket; same limit applies.
 */
export const ASSIGNMENT_MAX_SIZE_BYTES = 104_857_600;

/**
 * Maximum file size for thumbnail images (10 MB).
 *
 * Aligned with the `content-thumbnails` bucket file_size_limit in migration 022.
 */
export const THUMBNAIL_MAX_SIZE_BYTES = 10_485_760;

/**
 * Maps a content type to its corresponding maximum file size in bytes.
 */
export const CONTENT_MAX_SIZE_MAP: Record<ContentType, number> = {
  pdf: PDF_MAX_SIZE_BYTES,
  video: VIDEO_MAX_SIZE_BYTES,
  notes: NOTES_MAX_SIZE_BYTES,
  assignment: ASSIGNMENT_MAX_SIZE_BYTES,
};

// ═══════════════════════════════════════════════════════════════════════════
//  5. Storage Path Templates
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Template for the primary content file storage path.
 *
 * Segments are joined with `/`:
 *   institutes/{instituteId}/content/{contentId}/{sanitisedFileName}
 *
 * @example `institutes/a1b2c3/content/x4y5z6/chapter-5-thermodynamics.pdf`
 */
export const CONTENT_PATH_TEMPLATE =
  'institutes/{instituteId}/content/{contentId}/{sanitisedFileName}' as const;

/**
 * Template for the thumbnail storage path.
 *
 * Segments are joined with `/`:
 *   institutes/{instituteId}/content/{contentId}/{sanitisedFileName}
 *
 * @example `institutes/a1b2c3/content/x4y5z6/thumb_1200.jpg`
 */
export const THUMBNAIL_PATH_TEMPLATE =
  'institutes/{instituteId}/content/{contentId}/{sanitisedFileName}' as const;

// ═══════════════════════════════════════════════════════════════════════════
//  6. Signed URL Expiry Constants (in seconds)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Signed URL expiry for video streaming start tokens.
 *
 * Short-lived (60 seconds) to prevent token sharing. The video player
 * requests a new token as needed during playback.
 */
export const VIDEO_STREAM_EXPIRY_SECONDS = 60;

/**
 * Signed URL expiry for document downloads (PDF, notes, assignments).
 *
 * 300 seconds (5 minutes) — sufficient for a single download without
 * being long enough for widespread sharing.
 */
export const DOCUMENT_DOWNLOAD_EXPIRY_SECONDS = 300;

// ═══════════════════════════════════════════════════════════════════════════
//  7. Thumbnail Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default thumbnail width in pixels.
 *
 * 1200px wide at 16:9 aspect ratio yields 675px height.
 * Sufficient for content cards, list views, and grid layouts.
 */
export const THUMBNAIL_WIDTH = 1200;

/**
 * Default thumbnail aspect ratio (width / height).
 *
 * 16:9 is the standard for video and document previews.
 */
export const THUMBNAIL_ASPECT_RATIO = 16 / 9;

/**
 * Default thumbnail quality for JPEG/WebP encoding (1–100).
 *
 * 80 provides a good balance between visual quality and file size.
 */
export const THUMBNAIL_QUALITY = 80;

/**
 * Thumbnail file extension. JPEG is universally supported.
 */
export const THUMBNAIL_EXTENSION = 'jpg' as const;

/**
 * The thumbnail bucket is PUBLIC — objects are accessible without
 * authentication. Signed URLs are not needed for thumbnails.
 */
export const THUMBNAIL_BUCKET = CONTENT_THUMBNAILS;

// ═══════════════════════════════════════════════════════════════════════════
//  8. Upload Retry Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maximum number of upload attempts for transient errors.
 *
 * Transient errors include network timeouts and 5xx responses from
 * Supabase Storage. 4xx client errors (invalid MIME, file too large)
 * are not retried.
 */
export const UPLOAD_MAX_RETRIES = 3;

/**
 * Initial retry delay in milliseconds (exponential backoff).
 *
 * Retry timing: 1s → 2s → 4s (doubles each attempt, capped at 10s).
 */
export const UPLOAD_RETRY_BASE_DELAY_MS = 1_000;

/**
 * Maximum retry delay in milliseconds.
 *
 * Prevents the backoff from growing beyond a reasonable wait time
 * for an interactive upload operation.
 */
export const UPLOAD_RETRY_MAX_DELAY_MS = 10_000;

/**
 * Maximum number of delete attempts for transient errors.
 */
export const DELETE_MAX_RETRIES = 2;

/**
 * Initial delete retry delay in milliseconds (linear backoff).
 *
 * Retry timing: 1s → 2s.
 */
export const DELETE_RETRY_BASE_DELAY_MS = 1_000;

// ═══════════════════════════════════════════════════════════════════════════
//  9. Supported File Extensions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * File extensions accepted for PDF content.
 */
export const PDF_EXTENSIONS = ['.pdf'] as const;

/**
 * File extensions accepted for video content.
 */
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'] as const;

/**
 * File extensions accepted for notes content.
 */
export const NOTES_EXTENSIONS = ['.pdf', '.txt', '.doc', '.docx'] as const;

/**
 * File extensions accepted for assignment content.
 */
export const ASSIGNMENT_EXTENSIONS = ['.pdf', '.doc', '.docx'] as const;

/**
 * File extensions accepted for thumbnail images.
 */
export const THUMBNAIL_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/**
 * Maps a content type to its corresponding file extensions.
 */
export const CONTENT_EXTENSIONS_MAP: Record<ContentType, readonly string[]> = {
  pdf: PDF_EXTENSIONS,
  video: VIDEO_EXTENSIONS,
  notes: NOTES_EXTENSIONS,
  assignment: ASSIGNMENT_EXTENSIONS,
};

// ═══════════════════════════════════════════════════════════════════════════
//  10. Helper Constants (Lookups)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps a content type to its signed URL expiry in seconds.
 *
 * - `video`: 60 seconds (streaming token)
 * - `pdf`, `notes`, `assignment`: 300 seconds (download)
 */
export const CONTENT_EXPIRY_MAP: Record<ContentType, number> = {
  pdf: DOCUMENT_DOWNLOAD_EXPIRY_SECONDS,
  video: VIDEO_STREAM_EXPIRY_SECONDS,
  notes: DOCUMENT_DOWNLOAD_EXPIRY_SECONDS,
  assignment: DOCUMENT_DOWNLOAD_EXPIRY_SECONDS,
};

/**
 * Maps a content type to its maximum allowed page count (if applicable).
 *
 * Page counts are advisory — they help the UI decide whether to show
 * paginated vs. scroll-based document viewers. NULL means no limit
 * is enforced at the application layer (DB CHECK enforces > 0).
 */
export const CONTENT_MAX_PAGE_COUNT: Partial<Record<ContentType, number | null>> = {
  pdf: 500,
  notes: 200,
  video: null,
  assignment: null,
};

// ═══════════════════════════════════════════════════════════════════════════
//  11. Generalized Resource Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discriminator for all storage resource types across every module.
 *
 * Each value maps to a complete `ResourceConfig` that defines the bucket,
 * validation rules, path template, and expiry for that resource type.
 *
 * Adding a new resource type requires:
 * 1. Adding the literal here
 * 2. Adding a config entry in `RESOURCE_CONFIG_MAP`
 *
 * @example
 * ```ts
 * const config = getResourceConfig('question_image');
 * // => { bucket: 'question-images', allowedMimeTypes: [...], ... }
 * ```
 */
export type StorageResourceType =
  | 'content_pdf'
  | 'content_video'
  | 'content_thumbnail'
  | 'question_image'
  | 'student_submission'
  | 'profile_image'
  | 'certificate'
  | 'product_image'
  | 'institute_logo';

/**
 * Complete configuration for a single storage resource type.
 *
 * Every upload is validated against these rules before any storage
 * operation. The path template supports `{param}` placeholders that
 * are substituted at upload time via `buildResourceStoragePath()`.
 */
export interface ResourceConfig {
  /** Supabase Storage bucket name. */
  bucket: string;
  /** Allowed IANA media types (e.g. 'image/jpeg'). */
  allowedMimeTypes: readonly string[];
  /** Allowed file extensions including the dot (e.g. '.jpg'). */
  allowedExtensions: readonly string[];
  /** Maximum file size in bytes. */
  maxFileSizeBytes: number;
  /** Default signed URL expiry in seconds. Undefined = signed URLs not used. */
  signedUrlExpirySeconds?: number;
  /**
   * Storage path template with `{param}` placeholders.
   *
   * @example `questions/{instituteId}/{questionId}/{imageId}.{ext}`
   */
  pathTemplate: string;
}

// ─── Resource-Specific Buckets ─────────────────────────────────────────────

/**
 * Bucket for question images (diagrams, graphs embedded in question stems).
 */
export const QUESTION_IMAGES_BUCKET = 'question-images' as const;

/**
 * Bucket for student profile / avatar images.
 */
export const PROFILE_IMAGES_BUCKET = 'profile-images' as const;

/**
 * Bucket for generated certificates.
 */
export const CERTIFICATES_BUCKET = 'certificates' as const;

/**
 * Bucket for course/product thumbnail images.
 */
export const PRODUCT_IMAGES_BUCKET = 'product-images' as const;

/**
 * Bucket for institute logos.
 */
export const INSTITUTE_LOGOS_BUCKET = 'institute-logos' as const;

// ─── Resource-Specific MIME Allowlists ─────────────────────────────────────

/**
 * Allowed MIME types for question images.
 */
export const QUESTION_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

/**
 * Allowed MIME types for profile images, product images, and institute logos.
 */
export const STANDARD_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/**
 * Allowed MIME types for certificates (PDF only).
 */
export const CERTIFICATE_MIME_TYPES = ['application/pdf'] as const;

// ─── Resource-Specific Extension Allowlists ────────────────────────────────

/**
 * File extensions accepted for question images.
 */
export const QUESTION_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'] as const;

/**
 * File extensions accepted for standard images.
 */
export const STANDARD_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/**
 * File extensions accepted for certificates.
 */
export const CERTIFICATE_EXTENSIONS = ['.pdf'] as const;

// ─── Resource-Specific Size Limits ─────────────────────────────────────────

/** Maximum file size for question images (10 MB). */
export const QUESTION_IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum file size for profile images / logos (5 MB). */
export const STANDARD_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum file size for certificates (2 MB). */
export const CERTIFICATE_MAX_SIZE_BYTES = 2 * 1024 * 1024;

// ─── Resource-Specific Path Templates ──────────────────────────────────────

/**
 * Template for question image storage paths.
 *
 * Path pattern:
 *   questions/{instituteId}/{questionId}/{imageId}.{ext}
 *
 * @example `questions/inst-a1b2/q-x4y5z6/img-m7n8o9.png`
 */
export const QUESTION_IMAGE_PATH_TEMPLATE =
  'questions/{instituteId}/{questionId}/{imageId}.{ext}' as const;

/**
 * Template for profile image storage paths.
 *
 * Path pattern:
 *   profiles/{instituteId}/{profileId}/{fileName}
 *
 * @example `profiles/inst-a1b2/prof-x4y5z6/avatar.jpg`
 */
export const PROFILE_IMAGE_PATH_TEMPLATE =
  'profiles/{instituteId}/{profileId}/{sanitisedFileName}' as const;

/**
 * Template for certificate storage paths.
 *
 * Path pattern:
 *   certificates/{instituteId}/{userId}/{certId}.pdf
 *
 * @example `certificates/inst-a1b2/user-x4y5z6/cert-m7n8o9.pdf`
 */
export const CERTIFICATE_PATH_TEMPLATE =
  'certificates/{instituteId}/{userId}/{certId}.{ext}' as const;

/**
 * Template for product image storage paths.
 */
export const PRODUCT_IMAGE_PATH_TEMPLATE =
  'products/{instituteId}/{productId}/{sanitisedFileName}' as const;

/**
 * Template for institute logo storage paths.
 */
export const INSTITUTE_LOGO_PATH_TEMPLATE =
  'institutes/{instituteId}/logo/{sanitisedFileName}' as const;

// ─── Resource Config Map ───────────────────────────────────────────────────

/**
 * Complete mapping from resource type to its full configuration.
 *
 * This is the single source of truth for all storage resource types.
 * Every upload goes through this map to determine bucket, validation
 * rules, path template, and signed URL expiry.
 *
 * @see StorageResourceType
 * @see ResourceConfig
 */
export const RESOURCE_CONFIG_MAP: Record<StorageResourceType, ResourceConfig> = {
  content_pdf: {
    bucket: CONTENT_PDFS,
    allowedMimeTypes: PDF_MIME_TYPES,
    allowedExtensions: PDF_EXTENSIONS,
    maxFileSizeBytes: PDF_MAX_SIZE_BYTES,
    signedUrlExpirySeconds: DOCUMENT_DOWNLOAD_EXPIRY_SECONDS,
    pathTemplate: CONTENT_PATH_TEMPLATE,
  },
  content_video: {
    bucket: CONTENT_VIDEOS,
    allowedMimeTypes: VIDEO_MIME_TYPES,
    allowedExtensions: VIDEO_EXTENSIONS,
    maxFileSizeBytes: VIDEO_MAX_SIZE_BYTES,
    signedUrlExpirySeconds: VIDEO_STREAM_EXPIRY_SECONDS,
    pathTemplate: CONTENT_PATH_TEMPLATE,
  },
  content_thumbnail: {
    bucket: CONTENT_THUMBNAILS,
    allowedMimeTypes: THUMBNAIL_MIME_TYPES,
    allowedExtensions: THUMBNAIL_EXTENSIONS,
    maxFileSizeBytes: THUMBNAIL_MAX_SIZE_BYTES,
    pathTemplate: THUMBNAIL_PATH_TEMPLATE,
  },
  question_image: {
    bucket: QUESTION_IMAGES_BUCKET,
    allowedMimeTypes: QUESTION_IMAGE_MIME_TYPES,
    allowedExtensions: QUESTION_IMAGE_EXTENSIONS,
    maxFileSizeBytes: QUESTION_IMAGE_MAX_SIZE_BYTES,
    signedUrlExpirySeconds: DOCUMENT_DOWNLOAD_EXPIRY_SECONDS,
    pathTemplate: QUESTION_IMAGE_PATH_TEMPLATE,
  },
  student_submission: {
    bucket: STUDENT_SUBMISSIONS,
    allowedMimeTypes: PDF_MIME_TYPES,
    allowedExtensions: PDF_EXTENSIONS,
    maxFileSizeBytes: PDF_MAX_SIZE_BYTES,
    pathTemplate: CONTENT_PATH_TEMPLATE,
  },
  profile_image: {
    bucket: PROFILE_IMAGES_BUCKET,
    allowedMimeTypes: STANDARD_IMAGE_MIME_TYPES,
    allowedExtensions: STANDARD_IMAGE_EXTENSIONS,
    maxFileSizeBytes: STANDARD_IMAGE_MAX_SIZE_BYTES,
    pathTemplate: PROFILE_IMAGE_PATH_TEMPLATE,
  },
  certificate: {
    bucket: CERTIFICATES_BUCKET,
    allowedMimeTypes: CERTIFICATE_MIME_TYPES,
    allowedExtensions: CERTIFICATE_EXTENSIONS,
    maxFileSizeBytes: CERTIFICATE_MAX_SIZE_BYTES,
    pathTemplate: CERTIFICATE_PATH_TEMPLATE,
  },
  product_image: {
    bucket: PRODUCT_IMAGES_BUCKET,
    allowedMimeTypes: STANDARD_IMAGE_MIME_TYPES,
    allowedExtensions: STANDARD_IMAGE_EXTENSIONS,
    maxFileSizeBytes: STANDARD_IMAGE_MAX_SIZE_BYTES,
    pathTemplate: PRODUCT_IMAGE_PATH_TEMPLATE,
  },
  institute_logo: {
    bucket: INSTITUTE_LOGOS_BUCKET,
    allowedMimeTypes: STANDARD_IMAGE_MIME_TYPES,
    allowedExtensions: STANDARD_IMAGE_EXTENSIONS,
    maxFileSizeBytes: STANDARD_IMAGE_MAX_SIZE_BYTES,
    pathTemplate: INSTITUTE_LOGO_PATH_TEMPLATE,
  },
};

/**
 * Returns the full resource configuration for a given resource type.
 *
 * @param resourceType - The storage resource type.
 * @returns The complete resource configuration.
 */
export function getResourceConfig(resourceType: StorageResourceType): ResourceConfig {
  return RESOURCE_CONFIG_MAP[resourceType];
}
