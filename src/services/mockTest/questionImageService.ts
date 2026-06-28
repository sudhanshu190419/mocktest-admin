/**
 * Question Image Service
 *
 * Clean-architecture service layer encapsulating all QuestionImage CRUD
 * operations, storage orchestration, and the bulk replace/reorder workflows
 * used by the Question Editor.
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
 * 3. **Rollback pattern.** The `uploadQuestionImage` function performs
 *    upload → insert DB → rollback (delete uploaded file) if DB fails,
 *    matching the pattern established in `contentService.ts`.
 *
 * @module questionImageService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage } from '../../utils/supabase';
import {
  uploadResource as storageUploadFile,
  deleteFile as storageDeleteFile,
} from '../storage/storageService';
import type { ApiResponse } from '../../types/academic';
import type { QuestionImage } from '../../types/mockTest';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum number of images allowed per question. */
const MAX_IMAGES_PER_QUESTION = 10;

/** Valid image role values for placement within a question. */
const VALID_IMAGE_ROLES = [
  'stem',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'explanation',
] as const;

// ─── Database Row Shape ────────────────────────────────────────────────────

/**
 * Raw snake_case shape of the `question_images` table returned by Supabase.
 */
interface DbQuestionImage {
  image_id: string;
  question_id: string;
  institute_id: string;
  storage_bucket: string;
  storage_path: string;
  image_role: string;
  alt_text: string | null;
  order_sequence: number;
  created_at: string;
}

// ─── Input Types ────────────────────────────────────────────────────────────

/**
 * Parameters for uploading a question image.
 */
export interface UploadQuestionImageParams {
  /** Parent question ID. */
  questionId: string;
  /** Institute that owns this image. */
  instituteId: string;
  /** The image file to upload. */
  file: File | Blob | ArrayBuffer;
  /** Where this image is used: `stem`, `option_a`–`option_d`, `explanation`. */
  imageRole: string;
  /** Accessibility description. */
  altText?: string | null;
  /** 1-indexed display order. Defaults to next available sequence. */
  orderSequence?: number;
  /** Optional upload progress callback. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Input for updating a question image.
 *
 * Metadata updates use `altText` which maps to the `alt_text` column.
 * A dedicated `caption` column requires a future schema migration.
 */
interface UpdateQuestionImageInput {
  /** Updated accessibility description. */
  altText?: string | null;
  /** Updated display order. */
  displayOrder?: number;
  /** Optional new file to replace the existing image. */
  file?: File | Blob | ArrayBuffer;
  /** Optional upload progress callback when replacing a file. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Image entry for the bulk replace workflow.
 */
interface ReplaceImageEntry {
  /** The image file to upload. */
  file: File | Blob | ArrayBuffer;
  /** Where this image is used. */
  imageRole: string;
  /** Accessibility description. */
  altText?: string | null;
  /** 1-indexed display order. */
  orderSequence: number;
}

/**
 * Reorder item for a single image.
 */
interface ReorderItem {
  /** The image to reorder. */
  imageId: string;
  /** New display order position. */
  displayOrder: number;
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Checks if a string is a valid image role.
 */
function isValidImageRole(role: string): boolean {
  return (VALID_IMAGE_ROLES as readonly string[]).includes(role);
}

// ─── UUID Generation ────────────────────────────────────────────────────────

/**
 * Generates a UUID v4 string without relying on `crypto.randomUUID()`
 * (which is unavailable in React Native's JavaScript engine).
 *
 * Uses `Math.random()` as a fallback entropy source. This is suitable for
 * generating unique image IDs for storage path construction — not for
 * cryptographic security.
 *
 * @see contentService.ts generateUUID() — identical pattern.
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

// ─── Mapping Helpers ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case database row into a camelCase `QuestionImage`.
 */
function mapQuestionImage(db: DbQuestionImage): QuestionImage {
  return {
    imageId: db.image_id,
    questionId: db.question_id,
    instituteId: db.institute_id,
    storageBucket: db.storage_bucket,
    storagePath: db.storage_path,
    imageRole: db.image_role,
    altText: db.alt_text,
    orderSequence: db.order_sequence,
    createdAt: db.created_at,
  };
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

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all images for a given question, ordered by display order ascending.
 *
 * @param questionId - The UUID of the parent question.
 *
 * @example
 * const result = await getQuestionImages('question-uuid');
 * if (result.success) {
 *   console.log(result.data); // QuestionImage[]
 * }
 */
export async function getQuestionImages(
  questionId: string,
): Promise<ApiResponse<QuestionImage[]>> {
  try {
    validateUUID(questionId, 'questionId');

    const { data, error } = await supabase
      .from('question_images')
      .select('*')
      .eq('question_id', questionId)
      .order('order_sequence', { ascending: true });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const images = (data ?? []).map(mapQuestionImage);
    return { success: true, data: images };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch a single question image by its ID.
 *
 * @param imageId - The UUID of the image to retrieve.
 *
 * @example
 * const result = await getQuestionImageById('uuid-here');
 * if (result.success) {
 *   console.log(result.data.storagePath);
 * }
 */
export async function getQuestionImageById(
  imageId: string,
): Promise<ApiResponse<QuestionImage>> {
  try {
    validateUUID(imageId, 'imageId');

    const { data, error } = await supabase
      .from('question_images')
      .select('*')
      .eq('image_id', imageId)
      .single<DbQuestionImage>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Question image not found: ${imageId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestionImage(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Upload a new question image.
 *
 * Workflow:
 *   1. Validate the image file (MIME type, file size).
 *   2. Generate a unique imageId.
 *   3. Upload to Supabase Storage.
 *   4. Insert the DB row with storage metadata.
 *   5. If the DB insert fails, delete the uploaded file (rollback).
 *
 * @param params - Upload parameters.
 *
 * @example
 * const result = await uploadQuestionImage({
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   file: imageFile,
 *   imageRole: 'stem',
 *   altText: 'Diagram showing Newton's First Law',
 * });
 */
export async function uploadQuestionImage(
  params: UploadQuestionImageParams,
): Promise<ApiResponse<QuestionImage>> {
  const { questionId, instituteId, file, imageRole, altText, orderSequence, onProgress } = params;

  try {
    // ── Validate required fields ────────────────────────────────────────
    if (!questionId) {
      return { success: false, error: 'questionId is required.' };
    }
    if (!instituteId) {
      return { success: false, error: 'instituteId is required.' };
    }
    if (!file) {
      return { success: false, error: 'Image file is required.' };
    }
    if (!imageRole) {
      return { success: false, error: 'imageRole is required.' };
    }

    if (!isValidImageRole(imageRole)) {
      return {
        success: false,
        error: `Invalid imageRole: "${imageRole}". Accepted: ${VALID_IMAGE_ROLES.join(', ')}`,
      };
    }

    // ── Validate UUIDs ──────────────────────────────────────────────────
    validateUUID(questionId, 'questionId');
    validateUUID(instituteId, 'instituteId');

    // ── 1. Generate image ID ────────────────────────────────────────────
    const imageId = generateUUID();

    // ── 2. Upload to storage via storageService ─────────────────────────
    const ext = getFileExtension(file);

    const uploadResult = await storageUploadFile({
      file,
      resourceType: 'question_image',
      pathParams: {
        instituteId,
        questionId,
        imageId,
        ext,
      },
      onProgress,
    });

    if (!uploadResult.success || !uploadResult.data) {
      return { success: false, error: `Image upload failed: ${uploadResult.error}` };
    }

    const { bucket: storageBucket, storagePath } = uploadResult.data;

    // ── 3. Determine order sequence ─────────────────────────────────────
    let finalOrderSequence = orderSequence ?? 1;

    if (orderSequence === undefined) {
      const existing = await getQuestionImages(questionId);
      if (existing.success && existing.data && existing.data.length > 0) {
        const maxOrder = Math.max(...existing.data.map((img) => img.orderSequence));
        finalOrderSequence = maxOrder + 1;
      }
    }

    // ── 4. Insert DB record ─────────────────────────────────────────────
    const dbRecord: Record<string, unknown> = {
      image_id: imageId,
      question_id: questionId,
      institute_id: instituteId,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      image_role: imageRole,
      alt_text: altText ?? null,
      order_sequence: finalOrderSequence,
    };

    const { data: dbData, error: dbError } = await supabase
      .from('question_images')
      .insert(dbRecord)
      .select()
      .single<DbQuestionImage>();

    // ── 5. Rollback on DB failure ───────────────────────────────────────
    if (dbError) {
      // Delete the uploaded file to prevent orphaned storage objects
      await storageDeleteFile(storageBucket, storagePath);

      if (dbError.code === '23503') {
        return {
          success: false,
          error: 'Cannot upload image: the referenced question does not exist.',
        };
      }

      return { success: false, error: extractErrorMessage(dbError) };
    }

    return { success: true, data: mapQuestionImage(dbData) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update an existing question image metadata or replace the image file.
 *
 * Supports metadata-only updates (altText, displayOrder) and optional image
 * file replacement. When a new file is provided, the old image is deleted
 * from storage first, then the new one is uploaded.
 *
 * @param imageId - The UUID of the image to update.
 * @param input   - The fields to update (all optional).
 *
 * @example
 * // Update metadata only
 * const result = await updateQuestionImage('uuid-here', {
 *   altText: 'Updated accessibility description',
 *   displayOrder: 2,
 * });
 *
 * @example
 * // Replace the image file
 * const result = await updateQuestionImage('uuid-here', {
 *   file: newImageFile,
 *   altText: 'Replaced diagram',
 * });
 */
export async function updateQuestionImage(
  imageId: string,
  input: UpdateQuestionImageInput,
): Promise<ApiResponse<QuestionImage>> {
  try {
    validateUUID(imageId, 'imageId');

    // ── Fetch existing image ────────────────────────────────────────────
    const existing = await getQuestionImageById(imageId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Question image not found: ${imageId}` };
    }

    const current = existing.data as QuestionImage;

    // ── Build DB update payload ─────────────────────────────────────────
    const dbUpdate: Record<string, unknown> = {};

    if (input.altText !== undefined) {
      dbUpdate.alt_text = input.altText;
    }

    if (input.displayOrder !== undefined) {
      if (input.displayOrder < 1) {
        return { success: false, error: 'displayOrder must be 1 or greater.' };
      }
      dbUpdate.order_sequence = input.displayOrder;
    }

    // ── Handle file replacement ─────────────────────────────────────────
    if (input.file) {
      // Delete the old storage file
      await storageDeleteFile(current.storageBucket, current.storagePath);

      // Upload the new image via storageService
      const ext = getFileExtension(input.file);

      const uploadResult = await storageUploadFile({
        file: input.file,
        resourceType: 'question_image',
        pathParams: {
          instituteId: current.instituteId,
          questionId: current.questionId,
          imageId,
          ext,
        },
        onProgress: input.onProgress,
      });

      if (!uploadResult.success || !uploadResult.data) {
        return { success: false, error: `Image replacement failed: ${uploadResult.error}` };
      }

      dbUpdate.storage_bucket = uploadResult.data.bucket;
      dbUpdate.storage_path = uploadResult.data.storagePath;
    }

    // ── If nothing to update, return current ────────────────────────────
    if (Object.keys(dbUpdate).length === 0) {
      return { success: true, data: current };
    }

    // ── Execute update ──────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('question_images')
      .update(dbUpdate)
      .eq('image_id', imageId)
      .select()
      .single<DbQuestionImage>();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: `Question image not found: ${imageId}` };
      }
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: mapQuestionImage(data) };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Delete a question image and its associated storage file.
 *
 * Workflow:
 *   1. Fetch the image row to get storage metadata.
 *   2. Delete the storage object (best-effort via storageService).
 *   3. Delete the database row.
 *
 * @param imageId - The UUID of the image to delete.
 *
 * @example
 * const result = await deleteQuestionImage('uuid-here');
 * if (result.success) {
 *   // image and storage file removed
 * }
 */
export async function deleteQuestionImage(imageId: string): Promise<ApiResponse<void>> {
  try {
    validateUUID(imageId, 'imageId');

    // ── Fetch existing image for storage path ───────────────────────────
    const existing = await getQuestionImageById(imageId);
    if (!existing.success || !existing.data) {
      return { success: false, error: `Question image not found: ${imageId}` };
    }

    const current = existing.data as QuestionImage;

    // ── Delete storage file (best-effort) ───────────────────────────────
    await storageDeleteFile(current.storageBucket, current.storagePath);

    // ── Delete DB row ───────────────────────────────────────────────────
    const { error } = await supabase
      .from('question_images')
      .delete()
      .eq('image_id', imageId);

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update the display order of question images in a single operation.
 *
 * Accepts an array of `{ imageId, displayOrder }` pairs and updates only
 * the `order_sequence` column for each specified image. All inputs are
 * validated before any mutations are performed.
 *
 * Each `displayOrder` must be 1 or greater, and no duplicate orders are
 * allowed within the same batch.
 *
 * @param items - Array of image ID to display order mappings.
 *
 * @example
 * const result = await reorderQuestionImages([
 *   { imageId: 'uuid-a', displayOrder: 2 },
 *   { imageId: 'uuid-b', displayOrder: 1 },
 *   { imageId: 'uuid-c', displayOrder: 3 },
 * ]);
 */
export async function reorderQuestionImages(
  items: ReorderItem[],
): Promise<ApiResponse<void>> {
  try {
    if (items.length === 0) {
      return { success: false, error: 'At least one item is required for reordering.' };
    }

    // ── Validate all inputs before mutating ─────────────────────────────
    for (const item of items) {
      validateUUID(item.imageId, 'imageId');

      if (item.displayOrder < 1) {
        return {
          success: false,
          error: `displayOrder must be 1 or greater for image: ${item.imageId}`,
        };
      }
    }

    // Check for duplicate display orders
    const orders = items.map((i) => i.displayOrder);
    const uniqueOrders = new Set(orders);
    if (uniqueOrders.size !== orders.length) {
      return {
        success: false,
        error: 'Duplicate display order values detected. Each image must have a unique order.',
      };
    }

    // ── Execute updates ─────────────────────────────────────────────────
    for (const item of items) {
      const { error } = await supabase
        .from('question_images')
        .update({ order_sequence: item.displayOrder })
        .eq('image_id', item.imageId);

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

/**
 * Synchronise the image collection for a question.
 *
 * This is the primary editor API. It replaces all existing images with a
 * new set. The workflow:
 *   1. Fetch existing images (to get their storage paths for deletion).
 *   2. Delete all existing storage files.
 *   3. Delete all existing DB rows.
 *   4. Upload and insert each new image (reuses `uploadQuestionImage`).
 *   5. If any upload fails, previously uploaded images are NOT rolled back
 *      (the caller should retry or verify the final state).
 *
 * Each entry requires an image file — this is a full replacement, not a
 * metadata-only operation.
 *
 * @param questionId  - The UUID of the question.
 * @param instituteId - The UUID of the institute.
 * @param entries     - The new set of image entries.
 *
 * @example
 * const result = await replaceQuestionImages(
 *   'question-uuid',
 *   'institute-uuid',
 *   [
 *     { file: img1, imageRole: 'stem', orderSequence: 1 },
 *     { file: img2, imageRole: 'explanation', orderSequence: 2 },
 *   ],
 * );
 */
export async function replaceQuestionImages(
  questionId: string,
  instituteId: string,
  entries: ReplaceImageEntry[],
): Promise<ApiResponse<QuestionImage[]>> {
  try {
    validateUUID(questionId, 'questionId');
    validateUUID(instituteId, 'instituteId');

    if (entries.length > MAX_IMAGES_PER_QUESTION) {
      return {
        success: false,
        error: `Maximum ${MAX_IMAGES_PER_QUESTION} images allowed per question. Received ${entries.length}.`,
      };
    }

    // ── Validate all entries before mutating ────────────────────────────
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (!entry.imageRole) {
        return {
          success: false,
          error: `Image at position ${i + 1} is missing imageRole.`,
        };
      }
      if (!isValidImageRole(entry.imageRole)) {
        return {
          success: false,
          error: `Image at position ${i + 1} has invalid imageRole: "${entry.imageRole}".`,
        };
      }
      if (entry.orderSequence < 1) {
        return {
          success: false,
          error: `Image at position ${i + 1} has invalid orderSequence: ${entry.orderSequence}. Must be >= 1.`,
        };
      }

      // File validation is handled by storageService.uploadResource()
    }

    // Check for duplicate order sequences
    const sequences = entries.map((e) => e.orderSequence);
    const uniqueSequences = new Set(sequences);
    if (uniqueSequences.size !== sequences.length) {
      return {
        success: false,
        error: 'Duplicate order sequence values detected. Each image must have a unique order.',
      };
    }

    // ── 1. Fetch existing images ────────────────────────────────────────
    const existing = await getQuestionImages(questionId);
    const existingImages = existing.success && existing.data ? existing.data : [];

    // ── 2. Delete existing storage files ────────────────────────────────
    for (const img of existingImages) {
      await storageDeleteFile(img.storageBucket, img.storagePath);
    }

    // ── 3. Delete existing DB rows ──────────────────────────────────────
    const { error: deleteError } = await supabase
      .from('question_images')
      .delete()
      .eq('question_id', questionId);

    if (deleteError) {
      return { success: false, error: extractErrorMessage(deleteError) };
    }

    // ── 4. Upload and insert each new image ─────────────────────────────
    const results: QuestionImage[] = [];

    for (const entry of entries) {
      const uploadResult = await uploadQuestionImage({
        questionId,
        instituteId,
        file: entry.file,
        imageRole: entry.imageRole,
        altText: entry.altText ?? null,
        orderSequence: entry.orderSequence,
      });

      if (!uploadResult.success || !uploadResult.data) {
        return {
          success: false,
          error: `Failed to upload image at position ${results.length + 1}: ${uploadResult.error}`,
        };
      }

      results.push(uploadResult.data);
    }

    // ── 5. Return results ordered by orderSequence ──────────────────────
    results.sort((a, b) => a.orderSequence - b.orderSequence);
    return { success: true, data: results };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
