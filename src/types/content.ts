/**
 * Content Management Module Types
 *
 * Production-ready type definitions for the Content Management module —
 * content, tags, content_tag junction, and approval requests.
 *
 * These types mirror the PostgreSQL schema exactly (Domain 03 — Content
 * Management in supabase/migrations/004_domain_03_content_management.sql),
 * mapping snake_case database columns to camelCase TypeScript properties.
 *
 * Dependencies:
 * - Consumed by content service layer, React Query hooks, and UI screens.
 * - Reuses shared types from src/types/academic.ts (ApiResponse,
 *   PaginatedResponse, PaginationParams, SortDirection).
 * - Compatible with Supabase JS client.
 *
 * @module types/content
 */

import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from './academic';

// ─── Re-exports for consumer convenience ────────────────────────────────────
// Consumers import { Content, ApiResponse, PaginatedResponse, ... }
// from './content' — no need to know the source.

export type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection };

// ═══════════════════════════════════════════════════════════════════════════
//  Enums
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discriminator for the type of learning material.
 *
 * Mirrors the `content_type` PostgreSQL enum.
 *
 * - `pdf`:        PDF document (page_count applies)
 * - `video`:      Video file (duration_seconds applies)
 * - `notes`:      Text-based study notes
 * - `assignment`: Assignment submission
 *
 * Immutable after creation — changing type requires a new upload.
 *
 * @see public.content.content_type column
 */
export type ContentType = 'pdf' | 'video' | 'notes' | 'assignment';

/**
 * Lifecycle status for content and other resources.
 *
 * Mirrors the `lifecycle_status` PostgreSQL enum.
 *
 * - `draft`:           Content created but not submitted for review.
 * - `pending_review`:  Content submitted, awaiting admin approval.
 * - `approved`:        Content approved and visible to students.
 * - `rejected`:        Content rejected; teacher may revise and resubmit.
 * - `archived`:        Content retired; excluded from student queries.
 *
 * Valid transitions:
 *   draft → pending_review (teacher submits)
 *   pending_review → approved (admin approves)
 *   pending_review → rejected (admin rejects)
 *   rejected → draft (teacher revises)
 *   approved → archived (admin retires)
 *   draft → archived (teacher discards)
 *
 * @see public.content.status column
 */
export type LifecycleStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';

/**
 * Discriminator for the polymorphic approval resource type.
 *
 * Mirrors the `approval_resource_type` PostgreSQL enum.
 *
 * - `content`:   The approval request targets a content row.
 * - `mock_test`: The approval request targets a mock test row.
 *
 * @see public.approval_requests.resource_type column
 */
export type ApprovalResourceType = 'content' | 'mock_test';

/**
 * Review decision for an approval request.
 *
 * Mirrors the `approval_status` PostgreSQL enum.
 *
 * - `pending`:  Awaiting admin review.
 * - `approved`: Admin has approved the submission.
 * - `rejected`: Admin has rejected the submission.
 *
 * @see public.approval_requests.status column
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// ═══════════════════════════════════════════════════════════════════════════
//  Content
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Central store for all teacher-uploaded learning materials.
 *
 * A single row represents one piece of content regardless of its type —
 * PDF, video, notes, or assignment. The `contentType` enum discriminates
 * the row and determines which metadata columns are relevant (e.g.
 * `durationSeconds` applies to video; `pageCount` applies to PDF).
 *
 * Content is always authored by a teacher, categorised to exactly one
 * chapter, and must pass an approval workflow before students can access
 * it. Unpublished or rejected content is invisible to students.
 *
 * Mirrors the `content` table in PostgreSQL.
 *
 * @see supabase/migrations/004_domain_03_content_management.sql
 */
export interface Content {
  /** Primary key. */
  contentId: string;
  /** Institute that owns this content (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /** Teacher who authored and uploaded this content (FK → public.teacher_details). */
  teacherId: string;
  /** Chapter this content belongs to (FK → public.chapters). Exactly one per content. */
  chapterId: string;
  /** Subject derived from the chapter (FK → public.subjects). Denormalized for analytics. */
  subjectId: string;
  /**
   * Self-referencing FK to the immediately preceding version.
   * NULL for the original upload. When a revised version is created,
   * this column links to the row it supersedes.
   */
  parentContentId: string | null;
  /** Display title shown to students. Minimum 3 characters. */
  title: string;
  /** Optional summary or learning objectives for this content. */
  description: string | null;
  /** Content type discriminator. Immutable after creation. */
  contentType: ContentType;
  /**
   * Supabase Storage bucket name where the primary file is stored.
   * Part of durable storage identity — signed URLs are generated dynamically.
   */
  storageBucket: string;
  /**
   * Object path within the bucket. Together with storageBucket, uniquely
   * identifies the file in storage. Signed URLs generated dynamically.
   */
  storagePath: string;
  /** IANA media type of the uploaded file (e.g. application/pdf, video/mp4). */
  mimeType: string;
  /**
   * File name as submitted by the teacher. Never used for storage path
   * construction (paths use UUIDs). Displayed in download dialogs.
   */
  originalFileName: string;
  /** Supabase Storage bucket for the thumbnail image. NULL if no thumbnail. */
  thumbnailBucket: string | null;
  /** Object path for the thumbnail within thumbnailBucket. NULL if no thumbnail. */
  thumbnailPath: string | null;
  /** Applicable to video content only. Total video duration in seconds. */
  durationSeconds: number | null;
  /** Applicable to PDF and notes content only. NULL for video and assignments. */
  pageCount: number | null;
  /**
   * Raw file size in bytes. Populated on upload. Used for storage quota
   * enforcement and display.
   */
  fileSizeBytes: number | null;
  /**
   * Running total of student view events. Eventually-consistent —
   * buffered and flushed by background job to avoid lock contention.
   */
  viewCount: number;
  /** Running total of download events. Eventually-consistent display metric. */
  downloadCount: number;
  /**
   * Lifecycle status. Only `approved` content is visible to students.
   * Default: `draft`.
   */
  status: LifecycleStatus;
  /**
   * When TRUE, students without an active subscription can access this
   * content. Used for trial and demo material.
   */
  isFreePreview: boolean;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
  /**
   * UTC timestamp when status transitioned to `approved`.
   * Set by the approval workflow, never by the client. NULL until approved.
   */
  publishedAt: string | null;
}

/**
 * Input required to create a new content record.
 *
 * All required fields correspond to NOT NULL columns in the `content` table.
 * Server-set fields (contentId, viewCount, downloadCount, status, createdAt,
 * updatedAt, publishedAt) are excluded — they have DB defaults or are set
 * by the server.
 */
export interface CreateContentInput {
  /** Institute that owns this content. */
  instituteId: string;
  /** Teacher uploading this content. */
  teacherId: string;
  /** Chapter this content belongs to. */
  chapterId: string;
  /**
   * For versioned uploads: the content row this revision supersedes.
   * NULL for the original upload.
   */
  parentContentId?: string | null;
  /** Display title. Minimum 3 characters. */
  title: string;
  /** Optional summary or learning objectives. */
  description?: string | null;
  /** Content type discriminator. Immutable after creation. */
  contentType: ContentType;
  /** Supabase Storage bucket name. */
  storageBucket: string;
  /** Object path within the bucket (globally unique, use contentId in path). */
  storagePath: string;
  /** IANA media type. Validated against an allowlist at the API layer. */
  mimeType: string;
  /** File name as submitted by the teacher. */
  originalFileName: string;
  /** Thumbnail storage bucket. */
  thumbnailBucket?: string | null;
  /** Thumbnail object path. */
  thumbnailPath?: string | null;
  /** Video duration in seconds (required when contentType = 'video'). */
  durationSeconds?: number | null;
  /** Page count (applicable to PDF and notes). */
  pageCount?: number | null;
  /** File size in bytes. */
  fileSizeBytes?: number | null;
  /** Defaults to `false` when not provided. */
  isFreePreview?: boolean;
}

/**
 * Input required to update an existing content record.
 *
 * All fields are optional — only provided fields are included in the UPDATE.
 * Certain fields are immutable after creation (contentType, storage details).
 */
export interface UpdateContentInput {
  title?: string;
  description?: string | null;
  /** Only mutable when status is `draft` or `rejected`. */
  storageBucket?: string;
  /** Only mutable when status is `draft` or `rejected`. */
  storagePath?: string;
  mimeType?: string;
  originalFileName?: string;
  thumbnailBucket?: string | null;
  thumbnailPath?: string | null;
  durationSeconds?: number | null;
  pageCount?: number | null;
  fileSizeBytes?: number | null;
  isFreePreview?: boolean;
}

/**
 * Filters available when querying the content list.
 */
export interface ContentFilters {
  instituteId?: string;
  teacherId?: string;
  chapterId?: string;
  subjectId?: string;
  contentType?: ContentType;
  status?: LifecycleStatus;
  isFreePreview?: boolean;
  parentContentId?: string | null;
  /**
   * When true, include content that has no parent (original uploads).
   * When false, include only versioned content.
   * When omitted, both are included.
   */
  isOriginal?: boolean;
  /** Searches across title and description (case-insensitive LIKE). */
  search?: string;
  /** Filter by specific content IDs. */
  ids?: string[];
}

/**
 * Sort options for content list queries.
 */
export interface ContentSortOptions {
  sortBy?:
    | 'title'
    | 'contentType'
    | 'status'
    | 'viewCount'
    | 'downloadCount'
    | 'createdAt'
    | 'updatedAt'
    | 'publishedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tag
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A flat, institute-scoped label that can be attached to content for
 * filtering and search. Tags allow students and teachers to find related
 * content across chapters (e.g. all content tagged "thermodynamics"
 * regardless of which chapter it lives in).
 *
 * Tags are not shared across institutes. Each institute maintains its own
 * tag vocabulary. Tags are immutable after creation — name changes require
 * delete + recreate.
 *
 * Mirrors the `tags` table in PostgreSQL.
 *
 * @see supabase/migrations/004_domain_03_content_management.sql
 */
export interface Tag {
  /** Primary key. */
  tagId: string;
  /** Institute that owns this tag (FK → public.institutes). Tags are scoped per institute. */
  instituteId: string;
  /**
   * Tag label. Case-insensitive — lowercase enforced at DB level.
   * Examples: "thermodynamics", "organic-chemistry", "jee-advanced".
   */
  name: string;
  /** UTC timestamp of tag creation. */
  createdAt: string;
  /**
   * Admin or teacher who created this tag (FK → public.profiles).
   * Nullable to support seeded/system-created tags.
   */
  createdBy: string | null;
}

/**
 * Input required to create a new tag.
 *
 * Tag names must be unique per institute and are normalised to lowercase
 * before insert. Use `INSERT ... ON CONFLICT DO NOTHING RETURNING tag_id`
 * pattern to atomically get-or-create a tag.
 */
export interface CreateTagInput {
  /** Institute that owns this tag. */
  instituteId: string;
  /** Tag label. Will be normalised to lowercase. Must be 1–100 characters. */
  name: string;
  /** Profile of the creator. Optional for system-created tags. */
  createdBy?: string | null;
}

/**
 * Input required to update an existing tag.
 *
 * Tags are immutable after creation. Renaming a tag requires deleting it
 * and creating a new one. This interface is provided for completeness but
 * should not be used in normal operation.
 */
export interface UpdateTagInput {
  name?: string;
}

/**
 * Filters available when querying the tags list.
 */
export interface TagFilters {
  instituteId?: string;
  /** Filter by the profile who created the tag. */
  createdBy?: string;
  /** Searches across name (case-insensitive prefix match). */
  search?: string;
  /** Filter by specific tag IDs. */
  ids?: string[];
}

/**
 * Sort options for tags list queries.
 */
export interface TagSortOptions {
  sortBy?: 'name' | 'createdAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ContentTag (Junction)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Many-to-many junction table linking content to tags.
 *
 * One piece of content can have multiple tags; one tag can be applied to
 * many content rows. Carries no attributes beyond the relationship itself.
 *
 * Mirrors the `content_tag` table in PostgreSQL.
 *
 * @see supabase/migrations/004_domain_03_content_management.sql
 */
export interface ContentTag {
  /** FK → public.content. Part of composite primary key. */
  contentId: string;
  /** FK → public.tags. Part of composite primary key. */
  tagId: string;
  /** UTC timestamp when this tag was applied to this content. */
  taggedAt: string;
  /** Profile who applied the tag (FK → public.profiles). Nullable for bulk/system tagging. */
  taggedBy: string | null;
}

/**
 * Input required to tag content.
 *
 * Both FKs use CASCADE on delete — if content or tag is removed, the
 * junction row is automatically cleaned up.
 */
export interface CreateContentTagInput {
  /** Content to tag. */
  contentId: string;
  /** Tag to apply. */
  tagId: string;
  /** Profile applying the tag. Optional for bulk/system tagging. */
  taggedBy?: string | null;
}

/**
 * Input for bulk tagging multiple tags to a single content record.
 *
 * All tags are applied in a single `INSERT ... ON CONFLICT DO NOTHING`
 * statement. Duplicate (contentId, tagId) pairs are silently ignored.
 */
export interface BulkTagContentInput {
  /** Content to tag. */
  contentId: string;
  /** Tags to apply. */
  tagIds: string[];
  /** Profile applying the tags. */
  taggedBy?: string | null;
}

/**
 * Update input for content_tag junction rows is intentionally not provided.
 *
 * The `content_tag` table is a pure junction with no mutable columns beyond
 * the composite PK. Tags are added (INSERT) and removed (DELETE) — they are
 * never updated in place. To change a tag association, delete the old row
 * and insert a new one.
 *
 * @see ContentTag interface for the read shape
 * @see CreateContentTagInput for adding a tag association
 */
export type UpdateContentTagInput = never;

/**
 * Filters available when querying content_tag.
 */
export interface ContentTagFilters {
  contentId?: string;
  tagId?: string;
  taggedBy?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Approval Request
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Polymorphic workflow table for content and mock test approval.
 *
 * When a teacher submits content or a mock test for admin review, an
 * approval_request row is created. Admins review the submission and either
 * approve or reject it. This table is the system of record for the approval
 * audit trail — every decision is persisted permanently.
 *
 * Mirrors the `approval_requests` table in PostgreSQL.
 *
 * @see supabase/migrations/004_domain_03_content_management.sql
 */
export interface ApprovalRequest {
  /** Primary key. */
  approvalId: string;
  /** Institute that owns this request (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /**
   * Polymorphic discriminator: `content` or `mock_test`.
   * Identifies the type of the referenced resource.
   */
  resourceType: ApprovalResourceType;
  /**
   * The content_id or test_id of the item being reviewed.
   * No FK constraint possible on polymorphic reference — integrity enforced
   * via trigger.
   */
  resourceId: string;
  /**
   * Teacher (or admin) who submitted the item for review
   * (FK → public.profiles).
   */
  requestedBy: string;
  /**
   * Denormalized from requestedBy → profiles → teacher_details.
   * Enables teacher dashboard queries without joining through profiles.
   */
  teacherId: string;
  /**
   * Admin who approved or rejected (FK → public.profiles).
   * NULL until a review decision is made.
   */
  reviewedBy: string | null;
  /**
   * Current review decision: pending, approved, or rejected.
   * Default: `pending`.
   */
  status: ApprovalStatus;
  /**
   * Admin review notes. Required when status = 'rejected' (enforced at
   * application layer). Optional for approvals.
   */
  remarks: string | null;
  /**
   * Submission version counter. Increments on each resubmission after a
   * rejection. Tracks revision history. Default: 1.
   */
  version: number;
  /** UTC timestamp when the approval request was created (item submitted). */
  requestedAt: string;
  /**
   * UTC timestamp when the admin recorded their decision.
   * NULL until reviewed.
   */
  reviewedAt: string | null;
}

/**
 * Input required to create an approval request (submit for review).
 *
 * The corresponding resource (content or mock_test) must exist. The
 * `status` is always `'pending'` on creation — enforced via DB default.
 */
export interface CreateApprovalRequestInput {
  /** Institute that owns this request. */
  instituteId: string;
  /** Polymorphic discriminator. */
  resourceType: ApprovalResourceType;
  /** The content_id or test_id of the item being submitted for review. */
  resourceId: string;
  /** Profile of the submitting teacher. */
  requestedBy: string;
  /** Teacher ID (denormalized from requestedBy → profiles → teacher_details). */
  teacherId: string;
}

/**
 * Input required to update an approval request (record an admin's review
 * decision).
 *
 * Only admins may update approval requests. When status is `'approved'`,
 * the corresponding resource's status must also be updated atomically.
 *
 * Only two fields are mutable after creation: status, remarks, and their
 * associated audit fields (reviewedBy, reviewedAt). All other fields are
 * immutable once the request is created.
 */
export interface UpdateApprovalRequestInput {
  /** Admin's decision: approve or reject. */
  status: 'approved' | 'rejected';
  /** Admin's profile ID. */
  reviewedBy: string;
  /** Review notes. Required when rejecting (enforce at application layer). */
  remarks?: string | null;
  /**
   * UTC timestamp of the decision. Server-set — never accepted from client.
   * If omitted, defaults to `new Date().toISOString()` in the service layer.
   */
  reviewedAt?: string;
}

/**
 * @deprecated Use `UpdateApprovalRequestInput` instead.
 */
export type ReviewApprovalInput = UpdateApprovalRequestInput;

/**
 * Filters available when querying the approval requests list.
 */
export interface ApprovalRequestFilters {
  instituteId?: string;
  teacherId?: string;
  resourceType?: ApprovalResourceType;
  resourceId?: string;
  status?: ApprovalStatus;
  reviewedBy?: string;
  /** Filter requests submitted after this date (inclusive). */
  requestedAfter?: string;
  /** Filter requests submitted before this date (inclusive). */
  requestedBefore?: string;
  /** Filter requests reviewed after this date (inclusive). */
  reviewedAfter?: string;
  /** Filter requests reviewed before this date (inclusive). */
  reviewedBefore?: string;
  /** Searches across remarks (case-insensitive LIKE). */
  search?: string;
}

/**
 * Sort options for approval requests list queries.
 */
export interface ApprovalRequestSortOptions {
  sortBy?: 'status' | 'version' | 'requestedAt' | 'reviewedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Content with Relations (Lookup)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nested relation includes for content queries.
 *
 * Allows fetching related entities in a single request to avoid N+1 queries.
 * Each boolean flag, when `true`, instructs the service layer to JOIN
 * and populate the corresponding relation on the content entity.
 */
export interface ContentIncludes {
  /** Include the parent chapter. */
  chapter?: boolean;
  /** Include the parent subject. */
  subject?: boolean;
  /** Include the teacher who authored this content. */
  teacher?: boolean;
  /** Include tags attached to this content. */
  tags?: boolean;
  /** Include the latest approval request for this content. */
  approvalRequest?: boolean;
  /** Include all approval requests (full revision history). */
  approvalHistory?: boolean;
  /** Include the parent content (previous version). */
  parentContent?: boolean;
  /** Include child versions (revisions that supersede this content). */
  childVersions?: boolean;
}
