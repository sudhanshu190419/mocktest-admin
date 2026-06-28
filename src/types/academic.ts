/**
 * Academic Module Types
 *
 * Production-ready type definitions for the Academic Module — streams,
 * subjects, chapters, topics, and batches.
 *
 * These types mirror the PostgreSQL schema exactly (Domain 02 — Academic
 * Structure & Batch Management in supabase/migrations/003_domain_02_academic_structure.sql),
 * mapping snake_case database columns to camelCase TypeScript properties.
 *
 * Dependencies:
 * - Consumed by academic service layer, React Query hooks, and UI screens.
 * - Compatible with Supabase JS client.
 *
 * @module types/academic
 */

// ─── Common Response Types ──────────────────────────────────────────────────

/**
 * Standardised API response shape for all academic operations.
 *
 * Every service function returns this structure so that consumers never
 * need to handle raw Supabase exceptions or error shapes.
 *
 * @template T - The shape of the data payload on success.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /**
   * Non-fatal warning carried alongside a successful response.
   *
   * Use this for side-effect failures that don't prevent the primary
   * operation from succeeding.
   */
  warning?: string;
}

/**
 * Paginated list response wrapping an array of items with metadata.
 *
 * @template T - The shape of each item in the data array.
 */
export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// ─── Pagination & Sorting ───────────────────────────────────────────────────

/**
 * Pagination query parameters for list endpoints.
 *
 * Both fields are optional — the service layer applies sensible defaults
 * (typically page = 1, pageSize = 20).
 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/**
 * Sort direction for list queries.
 *
 * - `asc`: ascending order (A-Z, 0-9, earliest first)
 * - `desc`: descending order (Z-A, 9-0, latest first)
 */
export type SortDirection = 'asc' | 'desc';

// ─── Enums ──────────────────────────────────────────────────────────────────

/**
 * Batch lifecycle status.
 *
 * Mirrors the `batch_status` PostgreSQL enum.
 *
 * - `upcoming`:   Batch is created but not yet started.
 * - `active`:     Batch is currently running.
 * - `completed`:  Batch session has ended.
 * - `archived`:   Batch has been archived for historical reference.
 *
 * @see public.batches.status column
 */
export type BatchStatus = 'upcoming' | 'active' | 'completed' | 'archived';

// ═══════════════════════════════════════════════════════════════════════════
//  Stream
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A major examination or academic programme offered by an institute
 * (e.g. NEET, JEE-Mains). Top node of the academic hierarchy.
 *
 * Mirrors the `streams` table in PostgreSQL.
 *
 * @see supabase/migrations/003_domain_02_academic_structure.sql
 */
export interface Stream {
  /** Primary key. */
  streamId: string;
  /** Institute that owns this stream (FK → public.institutes). */
  instituteId: string;
  /** Display name (e.g. "NEET", "JEE Mains"). Must be ≥ 2 characters. */
  name: string;
  /** Short uppercase identifier (e.g. NEET, JEE-M). Unique per institute. Immutable. */
  code: string;
  /** Optional description shown in the admin interface. */
  description: string | null;
  /** Inactive streams are hidden from students/teachers. Historical data preserved. */
  isActive: boolean;
  /** Controls dropdown/navigation order. Use increments of 10 for gap-friendly sequencing. */
  displayOrder: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /** Admin who created this stream (FK → public.profiles). SET NULL on profile soft-delete. */
  createdBy: string | null;
  /** Admin who last modified this stream (FK → public.profiles). */
  updatedBy: string | null;
}

/**
 * Input required to create a new stream.
 *
 * All required fields correspond to NOT NULL columns in the `streams` table.
 */
export interface CreateStreamInput {
  /** Institute that owns this stream. */
  instituteId: string;
  /** Display name. */
  name: string;
  /** Short uppercase identifier (e.g. NEET, JEE-M). Must be ≥ 2 chars. */
  code: string;
  /** Optional description. */
  description?: string | null;
  /** Defaults to `true` when not provided. */
  isActive?: boolean;
  /** Defaults to `0` when not provided. */
  displayOrder?: number;
  /** Admin creating the stream. Typically set by the service layer. */
  createdBy?: string | null;
}

/**
 * Input required to update an existing stream.
 *
 * All fields are optional — only provided fields are included in the UPDATE.
 */
export interface UpdateStreamInput {
  name?: string;
  code?: string;
  description?: string | null;
  isActive?: boolean;
  displayOrder?: number;
  /** Admin performing the update. */
  updatedBy?: string | null;
}

/**
 * Filters available when querying the streams list.
 */
export interface StreamFilters {
  instituteId?: string;
  isActive?: boolean;
  /** Searches across name and code (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific stream IDs. */
  ids?: string[];
}

/**
 * Sort options for streams list queries.
 */
export interface StreamSortOptions {
  sortBy?: 'name' | 'code' | 'displayOrder' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Subject
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An academic discipline within a stream (e.g. Physics within NEET).
 * Second level of the content hierarchy. Resolves institute via the stream FK.
 *
 * Mirrors the `subjects` table in PostgreSQL.
 *
 * @see supabase/migrations/003_domain_02_academic_structure.sql
 */
export interface Subject {
  /** Primary key. */
  subjectId: string;
  /** Parent stream (FK → public.streams). */
  streamId: string;
  /** Display name (e.g. "Physics", "Chemistry"). Must be ≥ 2 characters. */
  name: string;
  /** Short identifier (e.g. PHY, CHEM). Unique within a stream. */
  code: string;
  /** Controls ordering within a stream. Lower number appears first. */
  displayOrder: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /** Admin who created this subject (FK → public.profiles). */
  createdBy: string | null;
  /** Admin who last modified this subject (FK → public.profiles). */
  updatedBy: string | null;
}

/**
 * Input required to create a new subject.
 */
export interface CreateSubjectInput {
  /** Parent stream ID. */
  streamId: string;
  /** Display name. */
  name: string;
  /** Short identifier (e.g. PHY). Must be ≥ 2 chars, uppercase. */
  code: string;
  /** Defaults to `0` when not provided. */
  displayOrder?: number;
  /** Admin creating the subject. Typically set by the service layer. */
  createdBy?: string | null;
}

/**
 * Input required to update an existing subject.
 */
export interface UpdateSubjectInput {
  name?: string;
  code?: string;
  displayOrder?: number;
  /** Admin performing the update. */
  updatedBy?: string | null;
}

/**
 * Filters available when querying the subjects list.
 */
export interface SubjectFilters {
  streamId?: string;
  /** Searches across name and code (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific subject IDs. */
  ids?: string[];
}

/**
 * Sort options for subjects list queries.
 */
export interface SubjectSortOptions {
  sortBy?: 'name' | 'code' | 'displayOrder' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Chapter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A named unit of the syllabus within a subject (e.g. "Laws of Motion").
 * Primary content-tagging unit — content, questions, and live classes
 * reference chapters.
 *
 * Mirrors the `chapters` table in PostgreSQL.
 *
 * @see supabase/migrations/003_domain_02_academic_structure.sql
 */
export interface Chapter {
  /** Primary key. */
  chapterId: string;
  /** Parent subject (FK → public.subjects). */
  subjectId: string;
  /** Display name. Must be ≥ 2 characters. Unique within a subject. */
  name: string;
  /** Optional syllabus description or learning objectives. */
  description: string | null;
  /** Controls ordering within a subject. Follows standard syllabus sequence. */
  displayOrder: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /** Admin who created this chapter (FK → public.profiles). */
  createdBy: string | null;
  /** Admin who last modified this chapter (FK → public.profiles). */
  updatedBy: string | null;
}

/**
 * Input required to create a new chapter.
 */
export interface CreateChapterInput {
  /** Parent subject ID. */
  subjectId: string;
  /** Display name. */
  name: string;
  /** Optional description. */
  description?: string | null;
  /** Defaults to `0` when not provided. */
  displayOrder?: number;
  /** Admin creating the chapter. Typically set by the service layer. */
  createdBy?: string | null;
}

/**
 * Input required to update an existing chapter.
 */
export interface UpdateChapterInput {
  name?: string;
  description?: string | null;
  displayOrder?: number;
  /** Admin performing the update. */
  updatedBy?: string | null;
}

/**
 * Filters available when querying the chapters list.
 */
export interface ChapterFilters {
  subjectId?: string;
  /** Searches across name (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific chapter IDs. */
  ids?: string[];
}

/**
 * Sort options for chapters list queries.
 */
export interface ChapterSortOptions {
  sortBy?: 'name' | 'displayOrder' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Topic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Optional sub-chapter granularity for content tagging
 * (e.g. "Newton's First Law" under "Laws of Motion").
 * Fourth level of the academic hierarchy. Not all institutes use topics.
 *
 * Mirrors the `topics` table in PostgreSQL.
 *
 * @see supabase/migrations/003_domain_02_academic_structure.sql
 */
export interface Topic {
  /** Primary key. */
  topicId: string;
  /** Parent chapter (FK → public.chapters). */
  chapterId: string;
  /** Display name. Must be ≥ 2 characters. Unique within a chapter. */
  name: string;
  /** Controls ordering within a chapter. */
  displayOrder: number;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /** Admin who created this topic (FK → public.profiles). */
  createdBy: string | null;
  /** Admin who last modified this topic (FK → public.profiles). */
  updatedBy: string | null;
}

/**
 * Input required to create a new topic.
 */
export interface CreateTopicInput {
  /** Parent chapter ID. */
  chapterId: string;
  /** Display name. */
  name: string;
  /** Defaults to `0` when not provided. */
  displayOrder?: number;
  /** Admin creating the topic. Typically set by the service layer. */
  createdBy?: string | null;
}

/**
 * Input required to update an existing topic.
 */
export interface UpdateTopicInput {
  name?: string;
  displayOrder?: number;
  /** Admin performing the update. */
  updatedBy?: string | null;
}

/**
 * Filters available when querying the topics list.
 */
export interface TopicFilters {
  chapterId?: string;
  /** Searches across name (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific topic IDs. */
  ids?: string[];
}

/**
 * Sort options for topics list queries.
 */
export interface TopicSortOptions {
  sortBy?: 'name' | 'displayOrder' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Batch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The operational unit of student delivery within a stream.
 * Students receive live classes, content, and mock tests through
 * batch membership.
 *
 * Mirrors the `batches` table in PostgreSQL.
 *
 * @see supabase/migrations/003_domain_02_academic_structure.sql
 */
export interface Batch {
  /** Primary key. */
  batchId: string;
  /** Institute that owns this batch (FK → public.institutes). */
  instituteId: string;
  /** Parent stream (FK → public.streams). */
  streamId: string;
  /** Display name. Must be ≥ 3 characters. */
  name: string;
  /** Short admin-facing code (e.g. NEET26-MOR-A). Unique per institute. */
  batchCode: string;
  /** Academic year in YYYY-YY format (e.g. "2025-26"). */
  academicYear: string;
  /** First day of the batch session. */
  startDate: string;
  /** Last day of the batch session. Must be strictly after startDate. */
  endDate: string;
  /** Maximum student capacity. NULL means unlimited. */
  maxSeats: number | null;
  /** Batch lifecycle status. */
  status: BatchStatus;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /** Admin who created this batch (FK → public.profiles). */
  createdBy: string | null;
  /** Admin who last modified this batch (FK → public.profiles). */
  updatedBy: string | null;
  /** Soft-delete timestamp. NULL = active. Never hard-delete batches. */
  deletedAt: string | null;
}

/**
 * Input required to create a new batch.
 */
export interface CreateBatchInput {
  /** Institute that owns this batch. */
  instituteId: string;
  /** Parent stream ID. */
  streamId: string;
  /** Display name. */
  name: string;
  /** Short admin-facing code (e.g. NEET26-MOR-A). Must be ≥ 2 chars. */
  batchCode: string;
  /** Academic year in YYYY-YY format (e.g. "2025-26"). */
  academicYear: string;
  /** First day of the batch session. */
  startDate: string;
  /** Last day of the batch session. Must be strictly after startDate. */
  endDate: string;
  /** Maximum student capacity. NULL for unlimited. */
  maxSeats?: number | null;
  /** Defaults to `'upcoming'` when not provided. */
  status?: BatchStatus;
  /** Admin creating the batch. Typically set by the service layer. */
  createdBy?: string | null;
}

/**
 * Input required to update an existing batch.
 */
export interface UpdateBatchInput {
  name?: string;
  batchCode?: string;
  academicYear?: string;
  startDate?: string;
  endDate?: string;
  maxSeats?: number | null;
  status?: BatchStatus;
  /** Admin performing the update. */
  updatedBy?: string | null;
}

/**
 * Filters available when querying the batches list.
 *
 * By default, soft-deleted batches (`deletedAt IS NOT NULL`) are excluded.
 * Set `includeDeleted: true` to include them.
 */
export interface BatchFilters {
  instituteId?: string;
  streamId?: string;
  status?: BatchStatus;
  academicYear?: string;
  /** If true, includes only non-deleted batches. Default behaviour excludes deleted. */
  includeDeleted?: boolean;
  /** Searches across name and batchCode (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific batch IDs. */
  ids?: string[];
}

/**
 * Sort options for batches list queries.
 */
export interface BatchSortOptions {
  sortBy?: 'name' | 'batchCode' | 'academicYear' | 'startDate' | 'endDate' | 'status' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Entity Lookup & Include Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nested relation includes for hierarchical academic queries.
 *
 * Allows fetching related entities in a single request to avoid N+1 queries.
 * Each boolean flag, when `true`, instructs the service layer to JOIN
 * and populate the corresponding relation on the parent entity.
 *
 * @example
 * ```ts
 * const includes: AcademicIncludes = { subjects: true, chapters: true };
 * // Returns a stream with its subjects and chapters nested.
 * ```
 */
export interface AcademicIncludes {
  /** Include subjects nested under each stream. */
  subjects?: boolean;
  /** Include chapters nested under each subject. */
  chapters?: boolean;
  /** Include topics nested under each chapter. */
  topics?: boolean;
  /** Include the parent stream on a subject. */
  stream?: boolean;
  /** Include the parent subject on a chapter. */
  subject?: boolean;
  /** Include the parent chapter on a topic. */
  chapter?: boolean;
}
