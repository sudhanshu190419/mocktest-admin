/**
 * Question Option Image Service
 *
 * Clean-architecture service layer encapsulating all question_option_images
 * CRUD operations, storage orchestration, and reorder workflows.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to handle raw Supabase
 * exceptions or error formats.
 *
 * ## Key design points
 *
 * 1. **Storage orchestration.** All storage operations (upload, delete,
 *    replacement) are delegated to `storageService` — this service never
 *    calls `supabase.storage` directly.
 *
 * 2. **No orphaned uploads.** If the file upload succeeds but the subsequent
 *    DB insert fails, the uploaded file is immediately deleted via
 *    `storageService.deleteFile()` (rollback).
 *
 * 3. **RLS is respected.** All queries use the anon key — RLS policies in
 *    the database control row-level access. No service-role key.
 *
 * 4. **No throw statements.** All errors are returned as structured
 *    `ApiResponse<T>` objects.
 *
 * 5. **Completely independent.** This service knows nothing about React,
 *    React Query, UI components, forms, or the Question Editor.
 *
 * @module questionOptionImageService
 */

import { supabase } from '../config/supabase';
import { validateUUID, extractErrorMessage } from '../utils/supabase';
import {
  uploadResource as storageUploadFile,
  deleteFile as storageDeleteFile,
} from './storage/storageService';
import type { ApiResponse } from '../types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Public Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An image associated with a specific question option.
 *
 * Mirrors the `question_option_images` table in PostgreSQL.
 */
export interface OptionImage {
  /** Primary key. */
  optionImageId: string;
  /** Parent option (FK → question_options.option_id). */
  optionId: string;
  /** Institute that owns this image (FK → institutes.institute_id). */
  instituteId: string;
  /** Supabase Storage bucket name. */
  storageBucket: string;
  /** Object path within `storageBucket`. Signed URL generated dynamically. */
  storagePath: string;
  /** Accessibility description. NULL during draft authoring. */
  altText: string | null;
  /** 1-indexed display order within the option. */
  displayOrder: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. */
  updatedAt: string;
}

/**
 * Parameters for uploading a new option image.
 */
export interface UploadOptionImageInput {
  /** Parent option ID. */
  optionId: string;
  /** Parent question ID (used for storage path construction). */
  questionId: string;
  /** Institute that owns this image. */
  instituteId: string;
  /** The image file to upload. */
  file: File | Blob | ArrayBuffer;
  /** Accessibility description. */
  altText?: string | null;
  /** 1-indexed display order. Defaults to next available sequence. */
  displayOrder?: number;
  /** Optional upload progress callback. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Input for replacing an option image file while preserving metadata.
 */
export interface ReplaceOptionImageInput {
  /** The new image file. */
  file: File | Blob | ArrayBuffer;
  /** Parent question ID (used for storage path construction). Optional — if omitted, resolved via DB query. */
  questionId?: string;
  /** Updated accessibility description (optional). */
  altText?: string | null;
  /** Optional upload progress callback. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Reorder item for a single option image.
 */
export interface ReorderItem {
  /** The image to reorder. */
  imageId: string;
  /** New display order position. */
  displayOrder: number;
}

/**
 * Convenience type alias for option image API responses.
 */
export type OptionImageResponse = ApiResponse<OptionImage>;

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw snake_case shape of the `question_option_images` table returned by Supabase.
 */
interface DbOptionImage {
  option_image_id: string;
  option_id: string;
  institute_id: string;
  storage_bucket: string;
  storage_path: string;
  alt_text: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Valid image MIME types accepted for option images. */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
];

/** Maximum file size for option images (10 MB, same as question images). */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates a UUID v4 string without relying on `crypto.randomUUID()`.
 *
 * Uses `Math.random()` as a fallback entropy source. Suitable for generating
 * unique image IDs for storage path construction — not for cryptographic security.
 */
function generateUUID(): string {
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4) | 8];
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

/**
 * Extracts the file extension from a File, Blob, or ArrayBuffer.
 *
 * For File objects, uses the file name. For Blob/ArrayBuffer, defaults
 * to `png` since there's no name to parse.
 */
function getFileExtension(file: File | Blob | ArrayBuffer): string {
  if (file instanceof File) {
    const nameParts = file.name.split('.');
    if (nameParts.length > 1) {
      return nameParts[nameParts.length - 1].toLowerCase();
    }
  }
  return 'png';
}

/**
 * Validates that a file's MIME type and size are acceptable for option images.
 *
 * Reuses the same limits already established for question images.
 * Returns an error message string when validation fails, or `null` when valid.
 */
function validateImageFile(file: File | Blob | ArrayBuffer): string | null {
  if (file instanceof File || file instanceof Blob) {
    // Validate MIME type
    if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Unsupported image type: "${file.type}". Accepted: ${ALLOWED_MIME_TYPES.join(', ')}`;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File size ${file.size} bytes exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes.`;
    }
  } else if (file instanceof ArrayBuffer) {
    // ArrayBuffer has no type info — validate size only
    if (file.byteLength > MAX_FILE_SIZE_BYTES) {
      return `File size ${file.byteLength} bytes exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes.`;
    }
  }

  return null;
}

/**
 * Converts a raw snake_case database row into a camelCase `OptionImage`.
 */
function mapOptionImage(db: DbOptionImage): OptionImage {
  return {
    optionImageId: db.option_image_id,
    optionId: db.option_id,
    instituteId: db.institute_id,
    storageBucket: db.storage_bucket,
    storagePath: db.storage_path,
    altText: db.alt_text,
    displayOrder: db.display_order,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. getOptionImages()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all images for a given option, ordered by display_order ascending.
 *
 * @param optionId - The UUID of the parent option.
 *
 * @example
 * const result = await getOptionImages('option-uuid');
 * if (result.success) {
 *   console.log(result.data); // OptionImage[]
 * }
 */
export async function getOptionImages(
  optionId: string,
): Promise<ApiResponse<OptionImage[]>> {
  try {
    validateUUID(optionId, 'optionId');

    const { data, error } = await supabase
      .from('question_option_images')
      .select('*')
      .eq('option_id', optionId)
      .order('display_order', { ascending: true });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const images = (data ?? []).map(mapOptionImage);
    return { success: true, data: images };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. getOptionImageById()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a single option image by its ID.
 *
 * @param imageId - The UUID of the image to retrieve.
 *
 * @example
 * const result = await getOptionImageById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.storagePath);
 * }
 */
export async function getOptionImageById(
  imageId: string,
): Promise<ApiResponse<OptionImage>> {
  try {
    validateUUID(imageId, 'imageId');

    const { data, error } = await supabase
      .from('question_option_images')
      .select('*')
      .eq('option_image_id', imageId)
      .single<DbOptionImage>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Option image not found: ${imageId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapOptionImage(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. uploadOptionImage()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upload a new option image.
 *
 * Workflow:
 *   1. Validate the image file (MIME type, file size).
 *   2. Generate a unique optionImageId.
 *   3. Upload to Supabase Storage via storageService.
 *   4. Insert the DB row with storage metadata.
 *   5. If the DB insert fails, delete the uploaded file (rollback).
 *
 * @param input - Upload parameters.
 *
 * @example
 * const result = await uploadOptionImage({
 *   optionId: 'option-uuid',
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   file: imageFile,
 *   altText: 'Diagram showing cell structure',
 * });
 */
export async function uploadOptionImage(
  input: UploadOptionImageInput,
): Promise<ApiResponse<OptionImage>> {
  const { optionId, questionId, instituteId, file, altText, displayOrder, onProgress } = input;

  try {
    // ── Validate required fields ────────────────────────────────────────
    if (!optionId) {
      return { success: false, error: 'optionId is required.' };
    }
    if (!questionId) {
      return { success: false, error: 'questionId is required.' };
    }
    if (!instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }
    if (!file) {
      return { success: false, error: 'Image file is required.' };
    }

    // ── Validate UUIDs ──────────────────────────────────────────────────
    validateUUID(optionId, 'optionId');
    validateUUID(questionId, 'questionId');
    validateUUID(instituteId, 'instituteId');

    // ── Validate image file ─────────────────────────────────────────────
    const validationError = validateImageFile(file);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // ── 1. Generate image ID ────────────────────────────────────────────
    const optionImageId = generateUUID();

    // ── 2. Upload to storage via storageService ─────────────────────────
    const ext = getFileExtension(file);

    const uploadResult = await storageUploadFile({
      file,
      resourceType: 'question_option_image',
      pathParams: {
        instituteId,
        questionId,
        optionId,
        optionImageId,
        ext,
      },
      onProgress,
    });

    if (!uploadResult.success || !uploadResult.data) {
      return { success: false, error: `Image upload failed: ${uploadResult.error}` };
    }

    const { bucket: storageBucket, storagePath } = uploadResult.data;

    // ── 3. Determine display order ──────────────────────────────────────
    let finalDisplayOrder = displayOrder ?? 1;

    if (displayOrder === undefined) {
      const existing = await getOptionImages(optionId);
      if (existing.success && existing.data && existing.data.length > 0) {
        const maxOrder = Math.max(...existing.data.map((img) => img.displayOrder));
        finalDisplayOrder = maxOrder + 1;
      }
    }

    // ── 4. Insert DB record ─────────────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      option_image_id: optionImageId,
      option_id: optionId,
      institute_id: instituteId,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      alt_text: altText ?? null,
      display_order: finalDisplayOrder,
    };

    const { data: dbData, error: dbError } = await supabase
      .from('question_option_images')
      .insert(dbRecord)
      .select()
      .single<DbOptionImage>();

    // ── 5. Rollback on DB failure ───────────────────────────────────────
    if (dbError) {
      // Delete the uploaded file to prevent orphaned storage objects
      await storageDeleteFile(storageBucket, storagePath);

      if (dbError.code === '23503') {
        return {
          success: false,
          error: 'Cannot upload image: the referenced option does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(dbError) };
    }

    return { success: true, data: mapOptionImage(dbData) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. deleteOptionImage()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete an option image and its associated storage file.
 *
 * Workflow:
 *   1. Fetch the image row to get storage metadata.
 *   2. Delete the storage object (best-effort via storageService).
 *   3. Delete the database row.
 *
 * @param imageId - The UUID of the image to delete.
 *
 * @example
 * const result = await deleteOptionImage('uuid-here');
 * if (result.success) {
 *   // image and storage file removed
 * }
 */
export async function deleteOptionImage(imageId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(imageId, 'imageId');

    // ── Fetch existing image for storage path ───────────────────────────
    const existing = await getOptionImageById(imageId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Option image not found: ${imageId}` };
    }

    const current = existing.data as OptionImage;

    // ── Delete storage file (best-effort) ───────────────────────────────
    await storageDeleteFile(current.storageBucket, current.storagePath);

    // ── Delete DB row ───────────────────────────────────────────────────
    const { error } = await supabase
      .from('question_option_images')
      .delete()
      .eq('option_image_id', imageId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. replaceOptionImage()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Replace an existing option image file while preserving metadata.
 *
 * Workflow:
 *   1. Fetch the existing image to get storage metadata and current fields.
 *   2. Delete the old storage object.
 *   3. Upload the new image via storageService.
 *   4. Update the DB row with the new storage_path (preserving display_order).
 *
 * @param imageId - The UUID of the image to replace.
 * @param input   - The new file and optional updated altText.
 *
 * @example
 * const result = await replaceOptionImage('uuid-here', {
 *   file: newImageFile,
 *   altText: 'Updated accessibility description',
 * });
 */
export async function replaceOptionImage(
  imageId: string,
  input: ReplaceOptionImageInput,
): Promise<ApiResponse<OptionImage>> {
  const { file, questionId: inputQuestionId, altText, onProgress } = input;

  try {
    validateUUID(imageId, 'imageId');

    // ── Validate image file ─────────────────────────────────────────────
    if (!file) {
      return { success: false, error: 'Replacement image file is required.' };
    }

    const validationError = validateImageFile(file);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // ── Fetch existing image ────────────────────────────────────────────
    const existing = await getOptionImageById(imageId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Option image not found: ${imageId}` };
    }

    const current = existing.data as OptionImage;

    // ── Delete the old storage file ─────────────────────────────────────
    await storageDeleteFile(current.storageBucket, current.storagePath);

    // ── Resolve questionId (prefer caller-provided, fall back to DB query) ─
    let questionId: string;
    if (inputQuestionId) {
      questionId = inputQuestionId;
    } else {
      const { data: optionRow } = await supabase
        .from('question_options')
        .select('question_id')
        .eq('option_id', current.optionId)
        .single<{ question_id: string }>();
      questionId = optionRow?.question_id ?? 'unknown';
    }

    const ext = getFileExtension(file);

    const uploadResult = await storageUploadFile({
      file,
      resourceType: 'question_option_image',
      pathParams: {
        instituteId: current.instituteId,
        questionId,
        optionId: current.optionId,
        optionImageId: imageId,
        ext,
      },
      onProgress,
    });

    if (!uploadResult.success || !uploadResult.data) {
      return { success: false, error: `Image replacement failed: ${uploadResult.error}` };
    }

    const { bucket: storageBucket, storagePath } = uploadResult.data;

    // ── Build DB update payload ─────────────────────────────────────────
    const dbUpdate: Record<string, unknown> = {
      storage_bucket: storageBucket,
      storage_path: storagePath,
    };

    // Preserve existing display_order — only update alt_text if provided
    if (altText !== undefined) {
      dbUpdate.alt_text = altText;
    }

    // ── Execute update ──────────────────────────────────────────────────
    const { data: dbData, error: dbError } = await supabase
      .from('question_option_images')
      .update(dbUpdate)
      .eq('option_image_id', imageId)
      .select()
      .single<DbOptionImage>();

    if (dbError) {
      return { success: false, error: extractErrorMessage(dbError) };
    }

    return { success: true, data: mapOptionImage(dbData) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. reorderOptionImages()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update the display_order for all images of an option inside a single
 * operation.
 *
 * Accepts an array of `{ imageId, displayOrder }` pairs and updates only
 * the `display_order` column for each specified image. All inputs are
 * validated before any mutations are performed.
 *
 * Each `displayOrder` must be 1 or greater, and no duplicate orders are
 * allowed within the same batch.
 *
 * @param optionId  - The UUID of the parent option (used for verification).
 * @param imageOrder - Array of image ID to display order mappings.
 *
 * @example
 * const result = await reorderOptionImages('option-uuid', [
 *   { imageId: 'uuid-a', displayOrder: 2 },
 *   { imageId: 'uuid-b', displayOrder: 1 },
 *   { imageId: 'uuid-c', displayOrder: 3 },
 * ]);
 */
export async function reorderOptionImages(
  optionId: string,
  imageOrder: ReorderItem[],
): Promise<ApiResponse<void>> {
  try {
    validateUUID(optionId, 'optionId');

    if (imageOrder.length === 0) {
      return { success: false, error: 'At least one item is required for reordering.' };
    }

    // ── Validate all inputs before mutating ─────────────────────────────
    for (const item of imageOrder) {
      validateUUID(item.imageId, 'imageId');

      if (item.displayOrder < 1) {
        return {
          success: false,
          error: `displayOrder must be 1 or greater for image: ${item.imageId}`,
        };
      }
    }

    // Check for duplicate display orders
    const orders = imageOrder.map((i) => i.displayOrder);
    const uniqueOrders = new Set(orders);
    if (uniqueOrders.size !== orders.length) {
      return {
        success: false,
        error: 'Duplicate display order values detected. Each image must have a unique order.',
      };
    }

    // ── Execute updates ─────────────────────────────────────────────────
    // Note: These updates are NOT wrapped in a DB transaction. Sequential
    // updates without rollback mean a partial failure is possible (some
    // images updated, others not). This matches the existing pattern in
    // questionImageService.reorderQuestionImages() and is accepted because
    // Supabase JS client does not natively support multi-statement
    // transactions through its REST API. Callers should retry on failure.
    for (const item of imageOrder) {
      const { error } = await supabase
        .from('question_option_images')
        .update({ display_order: item.displayOrder })
        .eq('option_image_id', item.imageId)
        .eq('option_id', optionId);

      if (error) {
        if (error.code === 'PGRST116') {
          return {
            success: false,
            error: `Image not found: ${item.imageId}. Reordering stopped.`,
          };
        }

        return { success: false, error: extractErrorMessage(error) };
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
