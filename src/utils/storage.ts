/**
 * Storage Utilities
 *
 * Pure utility functions for Content Management storage operations.
 * These functions have NO side effects — they accept inputs, return
 * structured results, and throw NO exceptions.
 *
 * All configuration is imported from src/config/storage.ts. No Supabase
 * client, no React, no services, no side effects.
 *
 * Dependencies:
 * - src/config/storage.ts (bucket names, MIME types, size limits, paths)
 * - src/types/content.ts (ContentType)
 *
 * @module utils/storage
 */

import type { ContentType } from '../types/content';
import type { StorageResourceType, ResourceConfig } from '../config/storage';
import {
  CONTENT_BUCKET_MAP,
  CONTENT_EXPIRY_MAP,
  CONTENT_MAX_SIZE_MAP,
  CONTENT_MIME_TYPE_MAP,
  CONTENT_EXTENSIONS_MAP,
  CONTENT_PATH_TEMPLATE,
  THUMBNAIL_PATH_TEMPLATE,
  THUMBNAIL_EXTENSION,
  getResourceConfig,
  RESOURCE_CONFIG_MAP,
} from '../config/storage';

// ═══════════════════════════════════════════════════════════════════════════
//  Shared Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of a validation check.
 *
 * Every validation function in this module returns this structure —
 * no exceptions are thrown.
 */
export interface ValidationResult {
  /** Whether the validation passed. */
  valid: boolean;
  /** Human-readable error message when `valid` is false. */
  error?: string;
}

/**
 * Result of a composite upload validation (MIME + extension + size).
 */
export interface UploadValidationResult {
  /** Whether all validations passed. */
  valid: boolean;
  /** Individual MIME type validation result. */
  mime: ValidationResult;
  /** Individual file extension validation result. */
  extension: ValidationResult;
  /** Individual file size validation result. */
  size: ValidationResult;
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. validateMimeType
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates that `mimeType` is in the allowed list for the given
 * `contentType`.
 *
 * Uses the MIME type allowlists from the storage configuration.
 * Returns a structured `ValidationResult` — never throws.
 *
 * @param mimeType   - The IANA media type to validate (e.g. "application/pdf").
 * @param contentType - The content type to validate against.
 *
 * @example
 * ```ts
 * validateMimeType('application/pdf', 'pdf');
 * // => { valid: true }
 *
 * validateMimeType('image/gif', 'pdf');
 * // => { valid: false, error: 'MIME type "image/gif" is not allowed for pdf. Accepted: application/pdf' }
 * ```
 */
export function validateMimeType(mimeType: string, contentType: ContentType): ValidationResult {
  const allowed = CONTENT_MIME_TYPE_MAP[contentType];

  if (!allowed.includes(mimeType)) {
    return {
      valid: false,
      error: `MIME type "${mimeType}" is not allowed for ${contentType}. Accepted: ${allowed.join(', ')}`,
    };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. validateFileSize
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates that `fileSizeBytes` does not exceed the configured maximum
 * for the given `contentType`.
 *
 * Uses the max size map from the storage configuration.
 * Returns a structured `ValidationResult` — never throws.
 *
 * @param fileSizeBytes - The file size in bytes to validate.
 * @param contentType   - The content type whose size limit applies.
 *
 * @example
 * ```ts
 * validateFileSize(1_000_000, 'pdf');
 * // => { valid: true }
 *
 * validateFileSize(200_000_000, 'pdf');
 * // => { valid: false, error: 'File size 200000000 bytes exceeds maximum of 104857600 bytes for pdf.' }
 * ```
 */
export function validateFileSize(fileSizeBytes: number, contentType: ContentType): ValidationResult {
  const maxSize = CONTENT_MAX_SIZE_MAP[contentType];

  if (fileSizeBytes > maxSize) {
    return {
      valid: false,
      error: `File size ${fileSizeBytes} bytes exceeds maximum of ${maxSize} bytes for ${contentType}.`,
    };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. sanitizeFileName
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitises a file name for safe storage path construction.
 *
 * Transformations applied:
 * 1. Extract the base name and extension from the original file name
 * 2. Remove unsafe characters (anything except alphanumeric, `.`, `-`, `_`)
 * 3. Replace spaces and consecutive separators with single hyphens
 * 4. Convert to lowercase
 * 5. Truncate base name to ensure total length ≤ 200 characters
 *
 * The extension is preserved exactly as-is (including case) so that
 * storage objects retain their original MIME-suggestive suffix.
 *
 * @param originalFileName - The raw file name submitted by the user.
 *
 * @returns The sanitised file name, safe for use in storage paths.
 *
 * @example
 * ```ts
 * sanitizeFileName('Chapter 5 - Thermodynamics (2024).pdf');
 * // => 'chapter-5-thermodynamics-2024.pdf'
 *
 * sanitizeFileName('../../../etc/passwd');
 * // => 'passwd'  (path traversal characters removed)
 * ```
 */
export function sanitizeFileName(originalFileName: string): string {
  // Find the last dot to separate base name from extension
  const dotIndex = originalFileName.lastIndexOf('.');

  let baseName: string;
  let extension: string;

  if (dotIndex > 0) {
    baseName = originalFileName.slice(0, dotIndex);
    extension = originalFileName.slice(dotIndex); // includes the dot
  } else {
    baseName = originalFileName;
    extension = '';
  }

  // Remove unsafe characters — keep only alphanumeric, dots, hyphens, underscores
  let cleaned = baseName.replace(/[^a-zA-Z0-9._-]/g, ' ');

  // Replace spaces and consecutive separators with single hyphens
  cleaned = cleaned.replace(/[\s_]+/g, '-').replace(/-+/g, '-');

  // Collapse consecutive dots into a single hyphen (prevents path traversal
  // patterns like ".." from appearing in the sanitised output)
  cleaned = cleaned.replace(/\.{2,}/g, '-');

  // Remove leading and trailing dots and hyphens
  cleaned = cleaned.replace(/^[-.]+|[-.]+$/g, '');

  // Convert to lowercase
  cleaned = cleaned.toLowerCase();

  // Truncate base name to ensure total length ≤ 200 chars
  const maxBaseLength = 200 - extension.length;
  if (maxBaseLength > 0 && cleaned.length > maxBaseLength) {
    cleaned = cleaned.slice(0, maxBaseLength);
  }

  // If after sanitisation the base name is empty, use a fallback
  if (cleaned.length === 0) {
    cleaned = 'untitled';
  }

  return `${cleaned}${extension}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. buildStoragePath
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Constructs the canonical Supabase Storage path for a content file.
 *
 * Pattern:
 *   institutes/{instituteId}/content/{contentId}/{sanitisedFileName}
 *
 * The path is globally unique because it includes the content UUID.
 * The original file name is sanitised before being appended — the raw
 * user-facing name is stored separately in the `original_file_name` column
 * and is never used for path construction.
 *
 * @param instituteId      - UUID of the owning institute.
 * @param contentId        - UUID of the content row (used for uniqueness and debugging).
 * @param originalFileName - The original file name as submitted by the user.
 *
 * @returns The storage path string.
 *
 * @example
 * ```ts
 * buildStoragePath('inst-123', 'cont-456', 'Chapter 5 - Thermodynamics.pdf');
 * // => 'institutes/inst-123/content/cont-456/chapter-5-thermodynamics.pdf'
 * ```
 */
export function buildStoragePath(
  instituteId: string,
  contentId: string,
  originalFileName: string,
): string {
  const sanitised = sanitizeFileName(originalFileName);

  return CONTENT_PATH_TEMPLATE
    .replace('{instituteId}', instituteId)
    .replace('{contentId}', contentId)
    .replace('{sanitisedFileName}', sanitised);
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. buildThumbnailPath
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Constructs the canonical Supabase Storage path for a content thumbnail.
 *
 * Pattern:
 *   institutes/{instituteId}/content/{contentId}/{contentId}_thumb.jpg
 *
 * The thumbnail filename uses the content ID for collision resistance
 * and debuggability, avoiding the need for a DB lookup to find the
 * thumbnail path.
 *
 * @param instituteId - UUID of the owning institute.
 * @param contentId   - UUID of the content row.
 *
 * @returns The thumbnail storage path string.
 *
 * @example
 * ```ts
 * buildThumbnailPath('inst-123', 'cont-456');
 * // => 'institutes/inst-123/content/cont-456/cont-456_thumb.jpg'
 * ```
 */
export function buildThumbnailPath(instituteId: string, contentId: string): string {
  const thumbFileName = `${contentId}_thumb.${THUMBNAIL_EXTENSION}`;

  return THUMBNAIL_PATH_TEMPLATE
    .replace('{instituteId}', instituteId)
    .replace('{contentId}', contentId)
    .replace('{sanitisedFileName}', thumbFileName);
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. getBucketForContentType
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the Supabase Storage bucket name for the given content type.
 *
 * @param contentType - The content type to look up.
 *
 * @returns The storage bucket name.
 *
 * @example
 * ```ts
 * getBucketForContentType('video');
 * // => 'content-videos'
 *
 * getBucketForContentType('pdf');
 * // => 'content-pdfs'
 * ```
 */
export function getBucketForContentType(contentType: ContentType): string {
  return CONTENT_BUCKET_MAP[contentType];
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. getSignedUrlExpiry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the signed URL expiry duration in seconds for the given
 * content type.
 *
 * - `video`: 60 seconds (short-lived streaming token)
 * - `pdf`, `notes`, `assignment`: 300 seconds (document download)
 *
 * @param contentType - The content type to look up.
 *
 * @returns Expiry in seconds.
 *
 * @example
 * ```ts
 * getSignedUrlExpiry('video');
 * // => 60
 *
 * getSignedUrlExpiry('pdf');
 * // => 300
 * ```
 */
export function getSignedUrlExpiry(contentType: ContentType): number {
  return CONTENT_EXPIRY_MAP[contentType];
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. getAllowedMimeTypes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the MIME type allowlist for the given content type.
 *
 * @param contentType - The content type to look up.
 *
 * @returns Readonly array of accepted MIME type strings.
 *
 * @example
 * ```ts
 * getAllowedMimeTypes('video');
 * // => ['video/mp4', 'video/webm', 'video/quicktime']
 * ```
 */
export function getAllowedMimeTypes(contentType: ContentType): readonly string[] {
  return CONTENT_MIME_TYPE_MAP[contentType];
}

// ═══════════════════════════════════════════════════════════════════════════
//  9. getMaximumFileSize
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the maximum allowed file size in bytes for the given content type.
 *
 * @param contentType - The content type to look up.
 *
 * @returns Maximum file size in bytes.
 *
 * @example
 * ```ts
 * getMaximumFileSize('video');
 * // => 5368709120
 * ```
 */
export function getMaximumFileSize(contentType: ContentType): number {
  return CONTENT_MAX_SIZE_MAP[contentType];
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. getAllowedExtensions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the allowed file extensions for the given content type.
 *
 * @param contentType - The content type to look up.
 *
 * @returns Readonly array of accepted extension strings (including the dot).
 *
 * @example
 * ```ts
 * getAllowedExtensions('video');
 * // => ['.mp4', '.webm', '.mov']
 * ```
 */
export function getAllowedExtensions(contentType: ContentType): readonly string[] {
  return CONTENT_EXTENSIONS_MAP[contentType];
}

// ═══════════════════════════════════════════════════════════════════════════
//  11. Resource-Based Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the full resource configuration for a given resource type.
 *
 * Convenience wrapper around `getResourceConfig()` from config that
 * avoids importing the config module directly in service files.
 *
 * @param resourceType - The storage resource type.
 * @returns The complete resource configuration.
 */
export function getResourceConfigForType(resourceType: StorageResourceType): ResourceConfig {
  return getResourceConfig(resourceType);
}

/**
 * Returns the Supabase Storage bucket name for the given resource type.
 *
 * @param resourceType - The resource type to look up.
 * @returns The storage bucket name.
 *
 * @example
 * ```ts
 * getBucketForResource('question_image');
 * // => 'question-images'
 * ```
 */
export function getBucketForResource(resourceType: StorageResourceType): string {
  return RESOURCE_CONFIG_MAP[resourceType].bucket;
}

/**
 * Returns the MIME type allowlist for the given resource type.
 *
 * @param resourceType - The resource type to look up.
 * @returns Readonly array of accepted MIME type strings.
 *
 * @example
 * ```ts
 * getAllowedMimeTypesForResource('question_image');
 * // => ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
 * ```
 */
export function getAllowedMimeTypesForResource(resourceType: StorageResourceType): readonly string[] {
  return RESOURCE_CONFIG_MAP[resourceType].allowedMimeTypes;
}

/**
 * Returns the maximum allowed file size in bytes for the given resource type.
 *
 * @param resourceType - The resource type to look up.
 * @returns Maximum file size in bytes.
 */
export function getMaximumFileSizeForResource(resourceType: StorageResourceType): number {
  return RESOURCE_CONFIG_MAP[resourceType].maxFileSizeBytes;
}

/**
 * Returns the allowed file extensions for the given resource type.
 *
 * @param resourceType - The resource type to look up.
 * @returns Readonly array of accepted extension strings (including the dot).
 */
export function getAllowedExtensionsForResource(resourceType: StorageResourceType): readonly string[] {
  return RESOURCE_CONFIG_MAP[resourceType].allowedExtensions;
}

/**
 * Returns the default signed URL expiry in seconds for the given resource type.
 *
 * @param resourceType - The resource type to look up.
 * @returns Expiry in seconds, or `undefined` if the resource type does not
 *          support signed URLs.
 */
export function getResourceSignedUrlExpiry(resourceType: StorageResourceType): number | undefined {
  return RESOURCE_CONFIG_MAP[resourceType].signedUrlExpirySeconds;
}

/**
 * Validates that `mimeType` is in the allowed list for the given resource type.
 *
 * Uses the MIME type allowlist from the resource configuration.
 * Returns a structured `ValidationResult` — never throws.
 *
 * @param mimeType     - The IANA media type to validate.
 * @param resourceType - The resource type to validate against.
 */
export function validateResourceMimeType(
  mimeType: string,
  resourceType: StorageResourceType,
): ValidationResult {
  const allowed = RESOURCE_CONFIG_MAP[resourceType].allowedMimeTypes;

  if (!allowed.includes(mimeType)) {
    return {
      valid: false,
      error: `MIME type "${mimeType}" is not allowed for ${resourceType}. Accepted: ${allowed.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Validates that `fileSizeBytes` does not exceed the configured maximum
 * for the given resource type.
 *
 * @param fileSizeBytes - The file size in bytes to validate.
 * @param resourceType  - The resource type whose size limit applies.
 */
export function validateResourceFileSize(
  fileSizeBytes: number,
  resourceType: StorageResourceType,
): ValidationResult {
  const maxSize = RESOURCE_CONFIG_MAP[resourceType].maxFileSizeBytes;

  if (fileSizeBytes > maxSize) {
    return {
      valid: false,
      error: `File size ${fileSizeBytes} bytes exceeds maximum of ${maxSize} bytes for ${resourceType}.`,
    };
  }

  return { valid: true };
}

/**
 * Builds a storage path from a template by substituting `{param}`
 * placeholders with the provided values.
 *
 * Template placeholders use curly brace syntax:
 *   `institutes/{instituteId}/content/{contentId}/{sanitisedFileName}`
 *
 * Unknown placeholders are left as-is (not removed).
 *
 * @param template - The path template with `{param}` placeholders.
 * @param params   - Record of placeholder values to substitute.
 *
 * @returns The constructed path string.
 *
 * @example
 * ```ts
 * const path = buildPathFromTemplate(
 *   'questions/{instituteId}/{questionId}/{imageId}.{ext}',
 *   { instituteId: 'a', questionId: 'b', imageId: 'c', ext: 'png' },
 * );
 * // => 'questions/a/b/c.png'
 * ```
 */
export function buildPathFromTemplate(
  template: string,
  params: Record<string, string>,
): string {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return path;
}

/**
 * Builds the canonical Supabase Storage path for a resource type using
 * its configured template and the provided path parameters.
 *
 * @param resourceType - The resource type whose path template to use.
 * @param pathParams   - Record of `{param: value}` pairs for template
 *                       substitution. Must include all placeholders
 *                       required by the resource type's path template.
 *
 * @returns The storage path string.
 *
 * @example
 * ```ts
 * buildResourceStoragePath('question_image', {
 *   instituteId: 'inst-123',
 *   questionId: 'q-456',
 *   imageId: 'img-789',
 *   ext: 'png',
 * });
 * // => 'questions/inst-123/q-456/img-789.png'
 * ```
 */
export function buildResourceStoragePath(
  resourceType: StorageResourceType,
  pathParams: Record<string, string>,
): string {
  const template = RESOURCE_CONFIG_MAP[resourceType].pathTemplate;
  return buildPathFromTemplate(template, pathParams);
}

/**
 * Composite resource upload validator.
 *
 * Runs all three validators (MIME type, file extension, file size) against
 * the resource type's configuration and returns a single structured result.
 *
 * All validators must pass for the aggregate result to be `valid`.
 * This function never throws.
 *
 * @param params.fileName      - The original file name (used for extension check).
 * @param params.mimeType      - The IANA media type of the file.
 * @param params.fileSizeBytes - The file size in bytes.
 * @param params.resourceType  - The target resource type.
 *
 * @returns A composite validation result with individual and aggregate fields.
 */
export function validateResourceUpload(params: {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  resourceType: StorageResourceType;
}): UploadValidationResult {
  const { fileName, mimeType, fileSizeBytes, resourceType } = params;

  const mimeResult = validateResourceMimeType(mimeType, resourceType);
  const sizeResult = validateResourceFileSize(fileSizeBytes, resourceType);

  // Extract file extension from the file name
  const dotIndex = fileName.lastIndexOf('.');
  const fileExtension = dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : '';

  const allowedExtensions = RESOURCE_CONFIG_MAP[resourceType].allowedExtensions;
  const extensionValid = allowedExtensions.includes(fileExtension);
  const extensionResult: ValidationResult = extensionValid
    ? { valid: true }
    : {
        valid: false,
        error: `File extension "${fileExtension}" is not allowed for ${resourceType}. Accepted: ${allowedExtensions.join(', ')}`,
      };

  return {
    valid: mimeResult.valid && sizeResult.valid && extensionResult.valid,
    mime: mimeResult,
    extension: extensionResult,
    size: sizeResult,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  12. validateUpload (Content-Type-Based — Backward Compatible)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Composite upload validator.
 *
 * Runs all three validators (MIME type, file extension, file size) and
 * returns a single structured result with individual fields for each
 * check, plus an aggregate `valid` flag.
 *
 * All validators must pass for the aggregate result to be `valid`.
 * If any validator fails, the aggregate result is `{ valid: false }`
 * and the individual fields contain the specific error messages.
 *
 * This function never throws — all three sub-validators return
 * `ValidationResult` structures.
 *
 * @param params.fileName    - The original file name (used for extension check).
 * @param params.mimeType    - The IANA media type of the file.
 * @param params.fileSizeBytes - The file size in bytes.
 * @param params.contentType - The target content type.
 *
 * @returns A composite validation result with individual and aggregate fields.
 *
 * @example
 * ```ts
 * const result = validateUpload({
 *   fileName: 'lecture.pdf',
 *   mimeType: 'application/pdf',
 *   fileSizeBytes: 5_000_000,
 *   contentType: 'pdf',
 * });
 *
 * if (!result.valid) {
 *   console.log(result.mime.error);   // undefined (passed)
 *   console.log(result.extension.error); // undefined (passed)
 *   console.log(result.size.error);   // undefined (passed)
 * }
 * ```
 */
export function validateUpload(params: {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  contentType: ContentType;
}): UploadValidationResult {
  const { fileName, mimeType, fileSizeBytes, contentType } = params;

  const mimeResult = validateMimeType(mimeType, contentType);
  const sizeResult = validateFileSize(fileSizeBytes, contentType);

  // Extract file extension from the file name
  const dotIndex = fileName.lastIndexOf('.');
  const fileExtension = dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : '';

  const allowedExtensions = getAllowedExtensions(contentType);
  const extensionValid = allowedExtensions.includes(fileExtension);
  const extensionResult: ValidationResult = extensionValid
    ? { valid: true }
    : {
        valid: false,
        error: `File extension "${fileExtension}" is not allowed for ${contentType}. Accepted: ${allowedExtensions.join(', ')}`,
      };

  return {
    valid: mimeResult.valid && sizeResult.valid && extensionResult.valid,
    mime: mimeResult,
    extension: extensionResult,
    size: sizeResult,
  };
}
