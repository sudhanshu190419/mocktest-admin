/**
 * Doubt System Types
 *
 * Phase 7B — shared application contracts for the Doubt module (Domain 14,
 * enhanced by migration 117).
 *
 * ## Authority
 *
 * Migration-117 SECURITY DEFINER RPCs are the ONLY write path and the ONLY
 * source of truth for:
 *   - doubt ownership / visibility (doubt_visible_to_me)
 *   - institute scoping (derived server-side via student_details — never a
 *     client parameter)
 *   - status transitions (open → in_progress → resolved → archived, reopen)
 *   - teacher eligibility + assignment validation
 *   - attachment MIME/size validation
 *
 * The frontend never sends `instituteId`, teacher/student identity, or any
 * authorization decision. Reads are RLS-scoped through the authenticated
 * Supabase client; the UI only hides actions the backend will reject.
 *
 * @module types/doubt
 */

import type { PaginationParams } from './academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Enums / Unions (mirror migration-015 + migration-117 enums)
// ═══════════════════════════════════════════════════════════════════════════

/** `doubt_status_type` (migration 015). */
export type DoubtStatus = 'open' | 'in_progress' | 'resolved' | 'archived';

/** `resource_category_type` (migration 015) — polymorphic doubt context. */
export type DoubtResourceType =
  | 'content'
  | 'question'
  | 'live_class'
  | 'pyq_paper'
  | 'mock_test'
  | 'teacher';

/** Valid attachment MIME types (migration 117 bucket + table CHECK). */
export type DoubtAttachmentMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

/** Doubt list scopes (which RLS view is queried). */
export type DoubtListScope = 'student' | 'teacher' | 'admin';

// ═══════════════════════════════════════════════════════════════════════════
//  Models
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A student doubt row (`student_doubts`).
 *
 * DB snake_case columns are mapped to camelCase in the mapper layer. Joined
 * display fields (subjectName, chapterName, assignedTeacherName, etc.) are
 * populated from RLS-scoped embedded reads — never from direct writes.
 *
 * `replies` / `attachments` are populated on detail reads only.
 */
export interface StudentDoubt {
  /** student_doubts.doubt_id (PK). */
  doubtId: string;
  /** student_details.student_id of the asking student. */
  studentId: string;
  /** subjects.subject_id (required — every doubt has a subject). */
  subjectId: string;
  chapterId: string | null;
  topicId: string | null;
  /** batch_subjects.batch_subject_id — routing context when provided. */
  batchSubjectId: string | null;
  /** Polymorphic context (mock_test / question / live_class / …). */
  relatedResourceType: DoubtResourceType | null;
  relatedResourceId: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  status: DoubtStatus;
  /** teacher_details.teacher_id manually assigned by an academic admin. */
  assignedTo: string | null;
  assignedAt: string | null;
  /** Timestamp of the first teacher/admin reply. */
  firstResponseAt: string | null;
  resolvedAt: string | null;
  /** profiles.profile_id of the resolver (student / teacher / admin). */
  resolvedBy: string | null;
  /** Reopen counter (student self-reopen capped at 3 server-side). */
  reopenedCount: number;
  createdAt: string;
  updatedAt: string;

  // ── Joined display data (RLS-scoped embeds) ──────────────────────────
  subjectName?: string | null;
  chapterName?: string | null;
  topicName?: string | null;
  batchName?: string | null;
  /**
   * Course display name — derived via batch_subject → batches →
   * course_batches → courses (never stored on student_doubts).
   */
  courseName?: string | null;
  /** Student display name (admin reads; RLS-scoped for teachers). */
  studentName?: string | null;
  /** Student enrollment number (student_details.enrollment_no, RLS-scoped). */
  enrollmentNo?: string | null;
  /** Assigned teacher display name. */
  assignedTeacherName?: string | null;
  /** Reply count (populated by the service on detail reads). */
  replies?: DoubtReply[];
  /** Attachment rows (populated by the service on detail reads). */
  attachments?: DoubtAttachment[];
}

/**
 * A reply / follow-up message (`doubt_replies`).
 *
 * The conversation history — a doubt is never a single-answer column.
 */
export interface DoubtReply {
  replyId: string;
  doubtId: string;
  /** profiles.profile_id of the author (student owner / teacher / admin). */
  authorProfileId: string;
  replyText: string;
  imageUrl: string | null;
  /** The accepted answer (single-accepted invariant, app-layer enforced). */
  isAcceptedAnswer: boolean;
  createdAt: string;
  updatedAt: string;

  // ── Joined display data (RLS-scoped embeds) ──────────────────────────
  authorName?: string | null;
  /** profiles.role of the author ('student' | 'teacher' | 'admin'). */
  authorRole?: string | null;
  attachments?: DoubtAttachment[];
}

/**
 * An attachment row (`doubt_attachments`) for a doubt or a reply.
 *
 * `signedUrl` is NOT a database field — it is hydrated by the attachment
 * service (private bucket requires signed URLs).
 */
export interface DoubtAttachment {
  attachmentId: string;
  doubtId: string;
  /** Present when the attachment belongs to a reply, else NULL. */
  replyId: string | null;
  /** profiles.profile_id of the uploader. */
  uploadedBy: string;
  /** Always 'doubt-attachments' (table CHECK). */
  bucket: string;
  /** Storage path within the bucket ({institute}/{doubtId}/{file}). */
  storagePath: string;
  mimeType: DoubtAttachmentMime;
  sizeBytes: number;
  createdAt: string;

  /** Hydrated short-lived signed URL (set by doubtAttachmentService). */
  signedUrl?: string | null;
}

/** Full detail assembly for one doubt: header + replies + attachments. */
export interface StudentDoubtDetail {
  doubt: StudentDoubt;
  replies: DoubtReply[];
  attachments: DoubtAttachment[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Filters + pagination
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Doubt list filters. Undefined = no filter applied.
 *
 * `search` maps to a PostgREST `or(title.ilike.%term%,description.ilike.%term%)`
 * filter — powered by the migration-117 pg_trgm GIN indexes. No vector/embedding
 * search in V1.
 */
export interface DoubtFilters {
  /** open | in_progress | resolved | archived. */
  status?: DoubtStatus;
  /** subjects.subject_id. */
  subjectId?: string;
  /** batch_subjects.batch_subject_id. */
  batchSubjectId?: string;
  /** Filter by assigned teacher (teacher_details.teacher_id). */
  assignedTeacherId?: string;
  /** Doubts with NO teacher assigned yet (assigned_to IS NULL). */
  unassigned?: boolean;
  /** Full-text-ish search over title/description (ILIKE '%term%'). */
  search?: string;
  /** Doubts created on/after this date (YYYY-MM-DD). */
  fromDate?: string;
  /** Doubts created on/before this date (YYYY-MM-DD). */
  toDate?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPC params + results (migration-117 contracts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * submit_student_doubt(p_subject_id, p_chapter_id, p_topic_id,
 *                      p_batch_subject_id, p_title, p_description,
 *                      p_related_resource_type default null,
 *                      p_related_resource_id default null)
 *
 * chapterId/topicId/batchSubjectId are positional but nullable — pass `null`
 * when not applicable (the 42P13 fix removed their defaults; callers must
 * pass them explicitly). Supports every academic context:
 *   A. general subject doubt       (subjectId only)
 *   B. chapter/topic doubt         (+ chapterId / topicId)
 *   C. mock-test/question doubt    (+ relatedResourceType/id)
 *   D. live-class doubt            (+ relatedResourceType/id = live_class)
 *   E. material/homework doubt     (+ relatedResourceType/id = content)
 */
export interface SubmitDoubtInput {
  /** subjects.subject_id (required). */
  subjectId: string;
  /** chapters.chapter_id — must belong to the subject. */
  chapterId?: string | null;
  /** topics.topic_id — requires chapterId. */
  topicId?: string | null;
  /** batch_subjects.batch_subject_id — must match subject + student's batch. */
  batchSubjectId?: string | null;
  /** 5–200 characters (server-validated). */
  title: string;
  /** Required (server-validated). */
  description: string;
  relatedResourceType?: DoubtResourceType | null;
  relatedResourceId?: string | null;
}

export interface SubmitDoubtResult {
  success: boolean;
  doubtId: string;
  status: DoubtStatus;
}

/** reply_to_doubt(p_doubt_id, p_reply_text, p_image_url default null). */
export interface ReplyToDoubtInput {
  doubtId: string;
  replyText: string;
  imageUrl?: string | null;
}

export interface ReplyToDoubtResult {
  success: boolean;
  replyId: string;
}

/** accept_doubt_answer(p_doubt_id, p_reply_id). */
export interface AcceptDoubtAnswerInput {
  doubtId: string;
  replyId: string;
}

/** resolve_doubt(p_doubt_id) — direct resolution (no accepted answer needed). */
export interface ResolveDoubtInput {
  doubtId: string;
}

/** reopen_doubt(p_doubt_id). */
export interface ReopenDoubtInput {
  doubtId: string;
}

/** assign_doubt(p_doubt_id, p_teacher_id) — first assignment AND reassignment. */
export interface AssignDoubtInput {
  doubtId: string;
  teacherId: string;
}

export interface AssignDoubtResult {
  success: boolean;
  doubtId: string;
  assignedTo: string;
  reassigned: boolean;
}

/** archive_doubt(p_doubt_id). */
export interface ArchiveDoubtInput {
  doubtId: string;
}

/**
 * attach_doubt_file(p_doubt_id, p_storage_path, p_mime_type, p_size_bytes,
 *                   p_reply_id default null)
 *
 * Records an attachment AFTER the file has been uploaded to the
 * doubt-attachments bucket. The service performs upload → RPC in sequence.
 */
export interface AttachDoubtFileInput {
  doubtId: string;
  storagePath: string;
  mimeType: DoubtAttachmentMime;
  sizeBytes: number;
  replyId?: string | null;
}

export interface AttachDoubtFileResult {
  success: boolean;
  attachmentId: string;
}

/** Common result shape for status-transition RPCs (accept/resolve/reopen/archive). */
export interface DoubtStatusResult {
  success: boolean;
  status: DoubtStatus;
}

/**
 * A teacher the admin may assign to a doubt (assign_doubt picker).
 *
 * Mirrors the RPC's eligibility check: teachers assigned to the doubt's
 * batch_subject ∪ teachers with a specialization matching the doubt's
 * subject. The RPC re-validates institute + eligibility before writing, so
 * this list is a UI convenience only — never an authorization decision.
 */
export interface DoubtTeacherOption {
  /** teacher_details.teacher_id (what assign_doubt expects). */
  teacherId: string;
  /** Teacher display name (profiles.name). */
  name: string;
  /**
   * True when the teacher is assigned to the doubt's batch_subject
   * (preferred routing source — shown first / highlighted).
   */
  isBatchSubjectAssigned: boolean;
}

export type { PaginationParams };
