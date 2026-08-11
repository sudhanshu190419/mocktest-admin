/**
 * Doubt System — Pure DB Row Mappers
 *
 * Pure snake_case → camelCase mapping functions for Domain 14 reads
 * (student_doubts, doubt_replies, doubt_attachments) and migration-117 RPC
 * results. Kept free of any Supabase import so they are unit-testable in the
 * Node vitest environment and shared by the doubt services.
 *
 * @module utils/doubtMappers
 */

import type {
  AssignDoubtResult,
  AttachDoubtFileResult,
  DoubtAttachment,
  DoubtAttachmentMime,
  DoubtReply,
  DoubtResourceType,
  DoubtStatus,
  DoubtTeacherOption,
  ReplyToDoubtResult,
  StudentDoubt,
  SubmitDoubtResult,
} from '@/types/doubt';

// ═══════════════════════════════════════════════════════════════════════════
//  Raw row shapes (snake_case, as returned by PostgREST with RLS applied)
// ═══════════════════════════════════════════════════════════════════════════

/** A to-one embedded relation — PostgREST may return an object or a 1-element array. */
export type EmbeddedOne<T> = T | T[] | null | undefined;

/** student_doubts row + optional joined display relations. */
export interface DbStudentDoubtRow {
  doubt_id: string;
  student_id: string;
  subject_id: string;
  chapter_id: string | null;
  topic_id: string | null;
  batch_subject_id: string | null;
  related_resource_type: string | null;
  related_resource_id: string | null;
  title: string;
  description: string;
  image_url: string | null;
  status: string;
  assigned_to: string | null;
  assigned_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  reopened_count: number | null;
  created_at: string;
  updated_at: string;

  // ── Joined display relations (RLS-scoped embeds) ─────────────────────
  subject?: EmbeddedOne<{ name: string }>;
  chapter?: EmbeddedOne<{ name: string }>;
  topic?: EmbeddedOne<{ name: string }>;
  batch_subject?: {
    batch_subject_id: string;
    batches?: EmbeddedOne<{
      name: string;
      course_batches?: EmbeddedOne<{
        course?: EmbeddedOne<{ title: string }>;
      }>;
    }>;
    subjects?: EmbeddedOne<{ name: string }>;
  } | null;
  assigned_teacher?: {
    teacher_id: string;
    profile?: EmbeddedOne<{ profile_id: string; name: string | null }>;
  } | null;
  student?: {
    student_id: string;
    enrollment_no: string | null;
    profile?: EmbeddedOne<{ profile_id: string; name: string | null }>;
  } | null;
  replies?: DbDoubtReplyRow[] | null;
  attachments?: DbDoubtAttachmentRow[] | null;
}

/** doubt_replies row + optional joined author display relations. */
export interface DbDoubtReplyRow {
  reply_id: string;
  doubt_id: string;
  author_profile_id: string;
  reply_text: string;
  image_url: string | null;
  is_accepted_answer: boolean;
  created_at: string;
  updated_at: string;

  author?: EmbeddedOne<{ profile_id: string; name: string | null; role: string | null }>;
  attachments?: DbDoubtAttachmentRow[] | null;
}

/** doubt_attachments row. */
export interface DbDoubtAttachmentRow {
  attachment_id: string;
  doubt_id: string;
  reply_id: string | null;
  uploaded_by: string;
  bucket: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPC result raw shapes (migration-117 JSONB returns)
// ═══════════════════════════════════════════════════════════════════════════

/** Raw JSONB result of submit_student_doubt. */
export interface DbSubmitDoubtResult {
  success: boolean;
  doubt_id: string;
  status: string;
}

/** Raw JSONB result of reply_to_doubt. */
export interface DbReplyToDoubtResult {
  success: boolean;
  reply_id: string;
}

/** Raw JSONB result of accept_doubt_answer / resolve_doubt / reopen_doubt / archive_doubt. */
export interface DbDoubtStatusResult {
  success: boolean;
  status: string;
}

/** Raw JSONB result of assign_doubt. */
export interface DbAssignDoubtResult {
  success: boolean;
  doubt_id: string;
  assigned_to: string;
  reassigned: boolean;
}

/** Raw JSONB result of attach_doubt_file. */
export interface DbAttachDoubtFileResult {
  success: boolean;
  attachment_id: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Unwrap a PostgREST to-one relation (object or 1-element array) → object|null. */
export function pickOne<T>(value: EmbeddedOne<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Row mappers
// ═══════════════════════════════════════════════════════════════════════════

export function mapDoubtRow(row: DbStudentDoubtRow): StudentDoubt {
  const batchSubject = row.batch_subject;
  const batch = pickOne(batchSubject?.batches);
  // course_batches is a to-many embed (a batch can map to multiple courses);
  // pick the first course row — display-only, never authorization data.
  const course = pickOne(pickOne(batch?.course_batches)?.course);
  const assignedProfile = pickOne(row.assigned_teacher?.profile);
  const studentProfile = pickOne(row.student?.profile);

  return {
    doubtId: row.doubt_id,
    studentId: row.student_id,
    subjectId: row.subject_id,
    chapterId: row.chapter_id,
    topicId: row.topic_id,
    batchSubjectId: row.batch_subject_id,
    relatedResourceType: (row.related_resource_type as DoubtResourceType | null) ?? null,
    relatedResourceId: row.related_resource_id,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    status: row.status as DoubtStatus,
    assignedTo: row.assigned_to,
    assignedAt: row.assigned_at,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    reopenedCount: row.reopened_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    subjectName: pickOne(row.subject)?.name ?? null,
    chapterName: pickOne(row.chapter)?.name ?? null,
    topicName: pickOne(row.topic)?.name ?? null,
    batchName: batch?.name ?? null,
    courseName: course?.title ?? null,
    studentName: studentProfile?.name ?? null,
    enrollmentNo: row.student?.enrollment_no ?? null,
    assignedTeacherName: assignedProfile?.name ?? null,

    replies: row.replies?.map(mapDoubtReplyRow),
    attachments: row.attachments?.map(mapDoubtAttachmentRow),
  };
}

export function mapDoubtReplyRow(row: DbDoubtReplyRow): DoubtReply {
  const author = pickOne(row.author);

  return {
    replyId: row.reply_id,
    doubtId: row.doubt_id,
    authorProfileId: row.author_profile_id,
    replyText: row.reply_text,
    imageUrl: row.image_url,
    isAcceptedAnswer: row.is_accepted_answer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    authorName: author?.name ?? null,
    authorRole: author?.role ?? null,

    attachments: row.attachments?.map(mapDoubtAttachmentRow),
  };
}

export function mapDoubtAttachmentRow(row: DbDoubtAttachmentRow): DoubtAttachment {
  return {
    attachmentId: row.attachment_id,
    doubtId: row.doubt_id,
    replyId: row.reply_id,
    uploadedBy: row.uploaded_by,
    bucket: row.bucket,
    storagePath: row.storage_path,
    mimeType: row.mime_type as DoubtAttachmentMime,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPC result mappers
// ═══════════════════════════════════════════════════════════════════════════

export function mapSubmitDoubtResult(row: DbSubmitDoubtResult): SubmitDoubtResult {
  return {
    success: row.success,
    doubtId: row.doubt_id,
    status: row.status as DoubtStatus,
  };
}

export function mapReplyToDoubtResult(row: DbReplyToDoubtResult): ReplyToDoubtResult {
  return {
    success: row.success,
    replyId: row.reply_id,
  };
}

export function mapDoubtStatusResult(row: DbDoubtStatusResult): {
  success: boolean;
  status: DoubtStatus;
} {
  return {
    success: row.success,
    status: row.status as DoubtStatus,
  };
}

export function mapAssignDoubtResult(row: DbAssignDoubtResult): AssignDoubtResult {
  return {
    success: row.success,
    doubtId: row.doubt_id,
    assignedTo: row.assigned_to,
    reassigned: row.reassigned,
  };
}

export function mapAttachDoubtFileResult(row: DbAttachDoubtFileResult): AttachDoubtFileResult {
  return {
    success: row.success,
    attachmentId: row.attachment_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Admin assign-picker (Phase 7F)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw flat candidate-teacher row before merging (either source).
 *
 * Produced by the service from `batch_subject_teachers` and
 * `teacher_specializations` embeds — normalized here so the merge stays
 * purely presentational and unit-testable.
 */
export interface DbDoubtTeacherOptionRow {
  /** teacher_details.teacher_id. */
  teacherId: string;
  /** Teacher display name (profiles.name) — may be null when RLS hides it. */
  name: string | null;
  /** Where the candidate came from. */
  source: 'batch_subject' | 'specialization';
}

/**
 * Merge candidate teachers from `batch_subject_teachers` ∪
 * `teacher_specializations` into a deduped, ordered option list.
 *
 * Dedupe by teacher_id. A teacher present in the batch-subject source is
 * marked `isBatchSubjectAssigned: true` (preferred routing source) and
 * bubbles to the front. The first non-null name is kept.
 *
 * @param rows - Flat candidate rows from both queries (any order).
 * @returns Deduped options, batch-subject teachers first.
 */
export function mergeDoubtTeacherOptions(
  rows: DbDoubtTeacherOptionRow[],
): DoubtTeacherOption[] {
  const byTeacher = new Map<string, DoubtTeacherOption>();

  for (const row of rows) {
    const existing = byTeacher.get(row.teacherId);
    if (!existing) {
      byTeacher.set(row.teacherId, {
        teacherId: row.teacherId,
        name: row.name ?? '',
        isBatchSubjectAssigned: row.source === 'batch_subject',
      });
      continue;
    }
    existing.isBatchSubjectAssigned =
      existing.isBatchSubjectAssigned || row.source === 'batch_subject';
    if (!existing.name && row.name) {
      existing.name = row.name;
    }
  }

  return Array.from(byTeacher.values()).sort(
    (a, b) => Number(b.isBatchSubjectAssigned) - Number(a.isBatchSubjectAssigned),
  );
}
