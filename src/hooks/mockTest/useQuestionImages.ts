/**
 * Question Image Hooks
 *
 * React Query hooks wrapping the questionImageService API calls.
 * Provides cached queries and mutations with automatic cache invalidation,
 * covering CRUD, file upload, bulk replace, and reorder operations.
 *
 * ## Exports
 *
 * | Hook                          | Type     | Description                                   |
 * |-------------------------------|----------|-----------------------------------------------|
 * | `useQuestionImages`           | Query    | All images for a question (ordered)           |
 * | `useUploadQuestionImage`      | Mutation | Upload a new image (file + DB metadata)       |
 * | `useUpdateQuestionImage`      | Mutation | Update image metadata or replace the file     |
 * | `useDeleteQuestionImage`      | Mutation | Delete an image and its storage file          |
 * | `useReplaceQuestionImages`    | Mutation | Replace all images for a question             |
 * | `useReorderQuestionImages`    | Mutation | Update display order of images                |
 *
 * @module hooks/mockTest/useQuestionImages
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { questionKeys } from './queryKeys';
import {
  getQuestionImages,
  uploadQuestionImage,
  updateQuestionImage,
  deleteQuestionImage,
  replaceQuestionImages,
  reorderQuestionImages,
} from '../../services/mockTest/questionImageService';
import type { QuestionImage } from '../../types/mockTest';

// ─── Mutation Parameter Types ───────────────────────────────────────────────

/** Parameters for uploading a question image. */
export interface UploadImageParams {
  questionId: string;
  instituteId: string;
  file: File | Blob | ArrayBuffer;
  imageRole: string;
  altText?: string | null;
  orderSequence?: number;
  onProgress?: (loaded: number, total: number) => void;
}

/** Input for updating a question image. */
export interface UpdateImageParams {
  altText?: string | null;
  displayOrder?: number;
  file?: File | Blob | ArrayBuffer;
  onProgress?: (loaded: number, total: number) => void;
}

/** Entry for the bulk replace workflow. */
export interface ReplaceImageEntry {
  file: File | Blob | ArrayBuffer;
  imageRole: string;
  altText?: string | null;
  orderSequence: number;
}

/** Item for reordering a single image. */
export interface ReorderImageItem {
  imageId: string;
  displayOrder: number;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch all images for a given question, ordered by display order ascending.
 *
 * The query is disabled when `questionId` is falsy.
 *
 * @param questionId - The UUID of the parent question.
 *
 * @example
 * const { data: images, isLoading } = useQuestionImages(questionId);
 */
export function useQuestionImages(questionId: string | undefined | null) {
  return useQuery<QuestionImage[]>({
    queryKey: questionKeys.images.list(questionId ?? undefined),
    queryFn: async () => {
      const result = await getQuestionImages(questionId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question images.');
      }
      return result.data!;
    },
    enabled: !!questionId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Upload a new question image.
 *
 * Workflow: validates the file, uploads to Supabase Storage, inserts the
 * DB metadata row, and rolls back the storage upload if the DB insert fails.
 *
 * On success, invalidates the image list for the question and the question
 * detail cache.
 *
 * @example
 * const { mutate, isPending } = useUploadQuestionImage();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   file: imageFile,
 *   imageRole: 'stem',
 *   altText: 'Diagram showing Newton's First Law',
 * });
 */
export function useUploadQuestionImage() {
  const queryClient = useQueryClient();

  return useMutation<QuestionImage, Error, UploadImageParams>({
    mutationFn: async (input) => {
      const result = await uploadQuestionImage(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to upload question image.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.images.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Update an existing question image's metadata or replace the image file.
 *
 * Supports metadata-only updates (altText, displayOrder) and optional image
 * file replacement. When a new file is provided, the old storage object is
 * deleted before the new one is uploaded.
 *
 * On success, invalidates the image list and question detail caches.
 *
 * @example
 * // Update metadata only
 * mutate({
 *   questionId: 'question-uuid',
 *   imageId: 'image-uuid',
 *   input: { altText: 'Updated description', displayOrder: 2 },
 * });
 *
 * @example
 * // Replace the image file
 * mutate({
 *   questionId: 'question-uuid',
 *   imageId: 'image-uuid',
 *   input: { file: newImageFile, altText: 'Replaced diagram' },
 * });
 */
export function useUpdateQuestionImage() {
  const queryClient = useQueryClient();

  return useMutation<
    QuestionImage,
    Error,
    { questionId: string; imageId: string; input: UpdateImageParams }
  >({
    mutationFn: async ({ imageId, input }) => {
      const result = await updateQuestionImage(imageId, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update question image.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.images.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Delete a question image and its associated storage file.
 *
 * On success, invalidates the image list and question detail caches.
 *
 * @example
 * const { mutate, isPending } = useDeleteQuestionImage();
 *
 * mutate({ questionId: 'question-uuid', imageId: 'image-uuid' });
 */
export function useDeleteQuestionImage() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { questionId: string; imageId: string }>({
    mutationFn: async ({ imageId }) => {
      const result = await deleteQuestionImage(imageId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete question image.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.images.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Synchronise the image collection for a question.
 *
 * This is the primary editor API. It replaces all existing images with a
 * new set: deletes old storage files, deletes old DB rows, then uploads
 * and inserts each new image.
 *
 * On success, invalidates the image list and question detail caches.
 *
 * @example
 * const { mutate, isPending } = useReplaceQuestionImages();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   entries: [
 *     { file: img1, imageRole: 'stem', altText: 'Diagram 1', orderSequence: 1 },
 *     { file: img2, imageRole: 'explanation', altText: 'Diagram 2', orderSequence: 2 },
 *   ],
 * });
 */
export function useReplaceQuestionImages() {
  const queryClient = useQueryClient();

  return useMutation<
    QuestionImage[],
    Error,
    {
      questionId: string;
      instituteId: string;
      entries: ReplaceImageEntry[];
    }
  >({
    mutationFn: async ({ questionId, instituteId, entries }) => {
      const result = await replaceQuestionImages(questionId, instituteId, entries);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to replace question images.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.images.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Update the display order of question images in a single operation.
 *
 * Accepts an array of `{ imageId, displayOrder }` pairs and updates only
 * the `order_sequence` column for each specified image.
 *
 * On success, invalidates the image list for the parent question.
 *
 * @example
 * const { mutate, isPending } = useReorderQuestionImages();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   items: [
 *     { imageId: 'uuid-a', displayOrder: 2 },
 *     { imageId: 'uuid-b', displayOrder: 1 },
 *   ],
 * });
 */
export function useReorderQuestionImages() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { questionId: string; items: ReorderImageItem[] }
  >({
    mutationFn: async ({ items }) => {
      const result = await reorderQuestionImages(items);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reorder question images.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.images.list(variables.questionId) });
    },
  });
}
