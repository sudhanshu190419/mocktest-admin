/**
 * Doubt Attachment Service
 *
 * Phase 7B — upload/access for doubt attachments against the private
 * `doubt-attachments` bucket (migration 117).
 *
 * ## Flow (upload → attach)
 *
 *   1. Validate the file client-side as a UX courtesy (MIME + size). The
 *      database RPC + bucket config remain authoritative.
 *   2. Upload to `doubt-attachments` at `{instituteId}/{doubtId}/{file}`
 *      (the migration-117 folder convention; the storage INSERT policy
 *      authorizes the folder via `doubt_visible_to_me(doubtId)`).
 *   3. Record the attachment row through the canonical
 *      `attach_doubt_file` RPC (also ownership-checked).
 *
 * If the RPC fails after a successful upload, the uploaded object is
 * best-effort deleted so no orphaned file remains (mirrors the
 * `replaceFile` pattern in storageService).
 *
 * ## Reads
 *
 * The bucket is private — never `getPublicUrl()`. Reads go through short-
 * lived signed URLs generated after the storage SELECT policy passes
 * (`doubt_visible_to_me`). Same convention as questionImageService.
 *
 * No client-side authorization is duplicated: the database/storage policies
 * are authoritative. The client never sends `instituteId` as an
 * authorization input — it is used only for path construction.
 *
 * @module services/doubtAttachmentService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import { sanitizeFileName } from '@/utils/storage';
import { doubtService } from './doubtService';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import type { ApiResponse } from '@/types/academic';
import type { DoubtAttachmentMime } from '@/types/doubt';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants (mirror migration-117 bucket config)
// ═══════════════════════════════════════════════════════════════════════════

/** Private bucket created in migration 117. */
export const DOUBT_ATTACHMENTS_BUCKET = 'doubt-attachments' as const;

/** MIME allowlist (bucket + table CHECK + RPC validation). */
export const DOUBT_ATTACHMENT_MIME_TYPES: readonly DoubtAttachmentMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

/** Maximum file size (25 MB — bucket file_size_limit + table CHECK). */
export const DOUBT_ATTACHMENT_MAX_SIZE_BYTES = 25 * 1024 * 1024;

/** Signed URL default expiry (5 minutes — document download convention). */
const SIGNED_URL_EXPIRY_SECONDS = 300;

// ═══════════════════════════════════════════════════════════════════════════
//  Upload
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uploads a doubt attachment and records it via attach_doubt_file.
 *
 * @param params.file        - The file to upload (File/Blob).
 * @param params.instituteId - Institute UUID — used ONLY for storage path
 *                             construction, never for authorization.
 * @param params.doubtId     - student_doubts.doubt_id (authorizes the folder).
 * @param params.replyId     - Optional doubt_replies.reply_id when attaching
 *                             to a reply.
 *
 * @returns The attachment_id + storage metadata on success.
 */
export async function uploadDoubtAttachment(params: {
  file: File | Blob;
  instituteId: string;
  doubtId: string;
  replyId?: string | null;
}): Promise<
  ApiResponse<{
    attachmentId: string;
    bucket: string;
    storagePath: string;
    mimeType: DoubtAttachmentMime;
    sizeBytes: number;
  }>
> {
  const { file, instituteId, doubtId, replyId } = params;

  try {
    validateUUID(instituteId, 'instituteId');
    validateUUID(doubtId, 'doubtId');
    if (replyId) validateUUID(replyId, 'replyId');

    const sizeBytes = file.size;

    // ── MIME resolution ────────────────────────────────────────────────
    // Blob/File.type may be empty (e.g. React Native picks). Fall back to
    // the file extension before rejecting. The DB/bucket remain
    // authoritative regardless.
    const resolvedMime = resolveMimeType(file);
    if (!resolvedMime) {
      return {
        success: false,
        error: 'Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.',
      };
    }
    const mimeType: DoubtAttachmentMime = resolvedMime;
    if (sizeBytes < 1 || sizeBytes > DOUBT_ATTACHMENT_MAX_SIZE_BYTES) {
      return {
        success: false,
        error: 'Files must be between 1 byte and 25 MB.',
      };
    }

    // ── Upload (folder convention {instituteId}/{doubtId}/{file}) ────────
    // File.name only exists on File (not Blob) — fall back for Blob inputs.
    const originalName = file instanceof File ? file.name : 'attachment';
    const storagePath = `${instituteId}/${doubtId}/${sanitizeFileName(originalName)}`;

    const { error: uploadError } = await supabase.storage
      .from(DOUBT_ATTACHMENTS_BUCKET)
      .upload(storagePath, file, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      return { success: false, error: extractErrorMessage(uploadError) };
    }

    // ── Record via canonical RPC (also ownership-checked) ────────────────
    const attachResult = await doubtService.attachDoubtFile({
      doubtId,
      storagePath,
      mimeType,
      sizeBytes,
      replyId: replyId ?? null,
    });

    if (!attachResult.success || !attachResult.data) {
      // Best-effort cleanup of the orphaned object.
      await supabase.storage.from(DOUBT_ATTACHMENTS_BUCKET).remove([storagePath]);
      return { success: false, error: attachResult.error };
    }

    return {
      success: true,
      data: {
        attachmentId: attachResult.data.attachmentId,
        bucket: DOUBT_ATTACHMENTS_BUCKET,
        storagePath,
        mimeType,
        sizeBytes,
      },
    };
  } catch (err) {
    return { success: false, error: doubtErrorMessage(extractErrorMessage(err)) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Reads (private bucket → signed URLs only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates a short-lived signed URL for a doubt attachment (private bucket).
 *
 * The storage SELECT policy (`doubt_visible_to_me`) is enforced by the
 * database before the URL is issued — the client never authorizes itself.
 *
 * @param bucket      - The bucket (defaults to doubt-attachments).
 * @param storagePath - The object path within the bucket.
 * @param expiresIn   - Optional expiry override in seconds.
 *
 * @returns The signed URL, or null on failure.
 */
export async function getDoubtAttachmentSignedUrl(
  bucket: string = DOUBT_ATTACHMENTS_BUCKET,
  storagePath: string,
  expiresIn: number = SIGNED_URL_EXPIRY_SECONDS,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      console.error(
        `[doubtAttachmentService] Failed to generate signed URL for bucket="${bucket}" path="${storagePath}":`,
        error.message,
      );
      return null;
    }

    return data?.signedUrl ?? null;
  } catch (err) {
    console.error(
      `[doubtAttachmentService] Unexpected error generating signed URL for bucket="${bucket}" path="${storagePath}":`,
      err,
    );
    return null;
  }
}

/**
 * Resolve the MIME type of a File/Blob, falling back to the file-name
 * extension when `file.type` is empty (common for Blob inputs / RN picks).
 *
 * @returns A valid DoubtAttachmentMime, or '' when unresolvable.
 */
function resolveMimeType(file: File | Blob): DoubtAttachmentMime | '' {
  const declared = file.type.trim().toLowerCase();
  if ((DOUBT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(declared)) {
    return declared as DoubtAttachmentMime;
  }

  const name = file instanceof File ? file.name : '';
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    default:
      return '';
  }
}

/** Service object (matches the `xxxService` convention). */
export const doubtAttachmentService = {
  uploadDoubtAttachment,
  getDoubtAttachmentSignedUrl,
};
