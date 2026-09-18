/**
 * Doubt File Validation Helpers
 *
 * Pure client-side validation utilities for doubt attachments.
 * Validates file sizes, allowed MIME formats (JPEG, PNG, WEBP, PDF),
 * and generates human-readable file sizes.
 *
 * The migration-117 bucket and table checks remain the ultimate authority.
 *
 * @module utils/doubtFileValidation
 */

/** Maximum attachment size (fallback upper limit: 25 MB). */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

/** Maximum image attachment size (5 MB). */
export const MAX_IMAGE_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum PDF attachment size (10 MB). */
export const MAX_PDF_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

/** Allowed MIME types (migration-117 allowlist). */
export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

/** Extension to MIME map for fallback when browser/file-picker omits type. */
const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/**
 * Resolve the MIME type of an uploaded file, falling back to the extension.
 *
 * @returns The resolved MIME type, or '' when unresolvable.
 */
export function resolvePickedMime(name: string, type?: string | null): string {
  const declared = (type ?? '').trim().toLowerCase();
  if (ALLOWED_ATTACHMENT_MIME_TYPES.includes(declared)) {
    return declared;
  }
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return EXTENSION_MIME_MAP[ext] ?? '';
}

/**
 * Validate an attachment file against migration-117 rules.
 *
 * @returns An error message string, or null when the file is valid.
 */
export function validatePickedFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!file.name.trim()) {
    return 'Please choose a valid file.';
  }
  const mime = resolvePickedMime(file.name, file.type);
  if (!mime) {
    return 'Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.';
  }
  if (file.size < 1 || file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return 'Files must be between 1 byte and 25 MB.';
  }
  if (mime === 'application/pdf') {
    if (file.size > MAX_PDF_ATTACHMENT_SIZE_BYTES) {
      return 'PDF files must be 10 MB or smaller.';
    }
  } else {
    if (file.size > MAX_IMAGE_ATTACHMENT_SIZE_BYTES) {
      return 'Images must be 5 MB or smaller.';
    }
  }
  return null;
}

/**
 * Format bytes into clean human-readable text (e.g. "2.4 MB", "450 KB").
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
