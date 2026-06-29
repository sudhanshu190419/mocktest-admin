# EdTech Platform — Database Schema Specification
## Domain 3: Content Management
### Tables: Content · Tag · ContentTag · ApprovalRequest

**Document version:** 1.1
**ERD reference:** ERD v2.0 (Frozen)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes

---

## Domain Context

Domain 3 covers the content management subsystem. Teachers upload learning materials — PDFs, videos, notes, and assignments — which are categorised to a chapter and subject. Each upload flows through an approval workflow before becoming visible to students.

The v2 ERD consolidates what were three separate child tables in v1 (`PDFContent`, `VideoContent`, `StudyMaterial`) into a single `content` table discriminated by the `content_type` enum. This eliminates three-way joins and simplifies the API significantly.

`ApprovalRequest` is a shared workflow entity used by both `content` and `mock_test`. Its `resource_type` + `resource_id` polymorphic pair targets the correct parent record. This table lives in Domain 3 because content is its primary consumer; it is reused by Domain 9 (Mock Test Engine).

---

## Table 1: `content`

### Purpose

Central store for all teacher-uploaded learning materials. A single row represents one piece of content regardless of its type — PDF, video, notes, or assignment. The `content_type` enum column discriminates the row and determines which metadata columns are relevant (e.g., `duration_seconds` applies to video; `page_count` applies to PDF).

Content is always authored by a teacher, categorised to exactly one chapter, and must pass an approval workflow (`lifecycle_status`) before students can access it. Unpublished or rejected content is invisible to students at the RLS level.

File storage is modelled as four explicit columns (`storage_bucket`, `storage_path`, `mime_type`, `original_file_name`) rather than a single pre-signed `file_url`. Signed URLs are generated dynamically at request time by the API layer using the bucket and path. This separates durable storage identity from ephemeral access URLs, allows bucket-level policy changes without touching DB rows, and prevents stale signed URLs from persisting in the database.

A `parent_content_id` self-referencing FK supports content version history: when a teacher uploads a revised version of an existing approved file, the new row links back to the original. The original row is archived; the new row becomes the active version. This preserves the full revision lineage without overwriting any row.

This table is one of the most-read tables in the system. Students browse and stream content constantly. Index design and RLS performance are critical.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `content_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized from `teacher_details → profiles`. Required for RLS performance and multi-tenant index isolation |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `teacher_details.teacher_id`. The teacher who authored and uploaded this content |
| `chapter_id` | `UUID` | NOT NULL | — | FK → `chapters.chapter_id`. Academic categorisation. Every piece of content belongs to exactly one chapter |
| `subject_id` | `UUID` | NOT NULL | — | FK → `subjects.subject_id`. Denormalized from chapter for analytics and filtering without an extra join |
| `parent_content_id` | `UUID` | NULL | `NULL` | Self-referencing FK → `content.content_id`. Points to the immediately preceding version of this content. NULL for the original upload. When a revised version is created, this column links to the row it supersedes. Enables full revision lineage traversal |
| `title` | `VARCHAR(500)` | NOT NULL | — | Display title shown to students. Enforced minimum length at application layer |
| `description` | `TEXT` | NULL | `NULL` | Optional summary or learning objectives for this content |
| `content_type` | `content_type` | NOT NULL | — | PostgreSQL enum: `pdf`, `video`, `notes`, `assignment`. Immutable after creation — changing type requires a new upload |
| `storage_bucket` | `VARCHAR(100)` | NOT NULL | — | Supabase Storage bucket name where the primary file is stored. Example: `content-files`. Bucket names are stable configuration values — not user input |
| `storage_path` | `TEXT` | NOT NULL | — | Object path within the bucket. Example: `institutes/abc-uuid/content/xyz-uuid/lecture-notes.pdf`. Together with `storage_bucket`, uniquely identifies the file in storage. Signed URLs are generated dynamically from this path at request time |
| `mime_type` | `VARCHAR(127)` | NOT NULL | — | IANA media type of the uploaded file. Examples: `application/pdf`, `video/mp4`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Validated at upload time against an allowlist |
| `original_file_name` | `VARCHAR(500)` | NOT NULL | — | The file name as submitted by the teacher. Example: `Chapter-5-Thermodynamics-Notes.pdf`. Displayed in download dialogs and the teacher dashboard. Never used for storage path construction (path uses UUIDs) |
| `thumbnail_bucket` | `VARCHAR(100)` | NULL | `NULL` | Supabase Storage bucket for the thumbnail image. Null if no thumbnail has been generated |
| `thumbnail_path` | `TEXT` | NULL | `NULL` | Object path for the thumbnail within `thumbnail_bucket`. Signed URL generated dynamically. NULL for content without a thumbnail |
| `duration_seconds` | `INTEGER` | NULL | `NULL` | Applicable to `content_type = 'video'` only. Total video duration in seconds. NULL for non-video content |
| `page_count` | `INTEGER` | NULL | `NULL` | Applicable to `content_type = 'pdf'` or `'notes'` only. NULL for video and assignment |
| `file_size_bytes` | `BIGINT` | NULL | `NULL` | Raw file size in bytes. Populated on upload. Used for storage quota enforcement and display |
| `view_count` | `BIGINT` | NOT NULL | `0` | Running total of student view events for this content. Incremented by the API layer on each view. Not guaranteed to be exact under high concurrency — used for display and ranking, not billing |
| `download_count` | `BIGINT` | NOT NULL | `0` | Running total of download events. Incremented on each completed download. NULL-safe default of 0 ensures aggregations never require COALESCE |
| `status` | `lifecycle_status` | NOT NULL | `'draft'` | PostgreSQL enum: `draft`, `pending_review`, `approved`, `rejected`, `archived`. Controls student visibility. Only `approved` content is accessible to students |
| `is_free_preview` | `BOOLEAN` | NOT NULL | `FALSE` | When TRUE, students without an active subscription can access this content. Used for trial/demo material |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of row creation |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp of last modification. Maintained by trigger |
| `published_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when status transitioned to `approved`. Set by the approval workflow, not by the teacher |

---

### Primary Key

```
PRIMARY KEY (content_id)
```

---

### Foreign Keys

```
institute_id       → institutes.institute_id        ON DELETE RESTRICT   ON UPDATE RESTRICT
teacher_id         → teacher_details.teacher_id     ON DELETE RESTRICT   ON UPDATE RESTRICT
chapter_id         → chapters.chapter_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
subject_id         → subjects.subject_id            ON DELETE RESTRICT   ON UPDATE RESTRICT
parent_content_id  → content.content_id             ON DELETE RESTRICT   ON UPDATE RESTRICT
```

> `parent_content_id` uses `RESTRICT` on delete intentionally. A parent content row must not be deleted (or hard-removed) while a child version references it. Since content is never hard-deleted in this system (only archived), this constraint will never fire in normal operation — it is a safety net against accidental direct deletes via service_role.

---

### Unique Constraints

```
UNIQUE (storage_bucket, storage_path)
```

> Every file object in storage must be referenced by exactly one `content` row. This prevents two content rows from pointing at the same physical file, which would create a dependency conflict when either row is archived or the storage object is cleaned up. The application must generate a unique storage path per upload (using the `content_id` UUID in the path is the recommended pattern).

---

### CHECK Constraints

```
CHECK (char_length(title) >= 3)
CHECK (duration_seconds IS NULL OR duration_seconds > 0)
CHECK (page_count IS NULL OR page_count > 0)
CHECK (file_size_bytes IS NULL OR file_size_bytes > 0)
CHECK (view_count >= 0)
CHECK (download_count >= 0)
CHECK (char_length(storage_bucket) >= 1)
CHECK (char_length(storage_path) >= 1)
CHECK (mime_type ~ '^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$')
CHECK (parent_content_id IS NULL OR parent_content_id != content_id)
CHECK (
  (content_type = 'video' AND duration_seconds IS NOT NULL)
  OR (content_type != 'video')
)
CHECK (published_at IS NULL OR published_at >= created_at)
```

> **`mime_type` regex** enforces basic IANA type/subtype format (e.g., `application/pdf`, `video/mp4`). The allowlist of permitted MIME types is enforced at the API layer (Zod/Joi) where it can be updated without a migration. The DB constraint only blocks structurally malformed values.

> **`parent_content_id != content_id`** prevents a row from being its own parent, which would create a trivial cycle. Longer cycles (A → B → A) cannot be prevented by a simple CHECK — detect these at the application layer before insert if the version chain depth is bounded (recommended: max 50 versions per content lineage).

> The cross-column CHECK enforces that video content always carries a `duration_seconds`. This cannot be enforced purely at the application layer because direct inserts (via Edge Functions or admin tools) bypass application validation. All other type-specific columns (e.g., `page_count`) are nullable and not cross-column checked — their presence is enforced at the API layer where the content type is known.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_content_institute_status` | `(institute_id, status)` | B-tree | Primary student browse query: all approved content in this institute |
| `idx_content_chapter_status` | `(chapter_id, status)` | B-tree | Chapter page: all approved content for a given chapter |
| `idx_content_teacher` | `(teacher_id)` | B-tree | Teacher dashboard: all content uploaded by this teacher |
| `idx_content_institute_type_status` | `(institute_id, content_type, status)` | B-tree | Filter by type (e.g., "show all PDFs") within an institute |
| `idx_content_subject_status` | `(subject_id, status)` | B-tree | Subject-level content listing in analytics |
| `idx_content_published_at` | `(published_at DESC NULLS LAST)` | B-tree | "Recently published" feed; admin review timeline |
| `idx_content_parent_content_id` | `(parent_content_id)` | B-tree | Traverse forward from a parent to all its child versions; partial index `WHERE parent_content_id IS NOT NULL` reduces index size |
| `idx_content_storage` | `(storage_bucket, storage_path)` | B-tree (covered by UNIQUE) | Already covered by the unique constraint; no additional index needed |
| `idx_content_institute_view_count` | `(institute_id, view_count DESC)` | B-tree | "Most viewed content" ranking query per institute for the admin dashboard |

> All indexes that filter on `status` intentionally include it as a trailing or leading column because the overwhelming majority of production queries filter to `status = 'approved'`. Partial indexes `WHERE status = 'approved'` are an alternative that reduces index size further — evaluate after measuring query plans in staging.

---

### Soft Delete Strategy

`content` does not use a `deleted_at` column. Use `status = 'archived'` to retire content. Archived content is excluded from all student-facing queries.

Hard deletion is forbidden because:
- `content_tag.content_id` would orphan
- `approval_requests` reference `content_id` as `resource_id`
- `teacher_upload.content_id` references this row in the teacher dashboard domain
- Audit logs may reference this content by ID
- Child version rows reference this row via `parent_content_id`

To retire content: set `status = 'archived'` via an admin or teacher action. The corresponding storage object at `(storage_bucket, storage_path)` must **not** be deleted when a row is archived — the file must remain accessible for admin review, audit, and potential restoration. Physical storage cleanup (if ever required) is a separate data-retention workflow that must verify no active child version rows reference the row before deleting the storage object.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `updated_at` | ✅ | Required; trigger-maintained |
| `published_at` | ✅ | Business-critical; marks when content became live for students |
| `created_by` | ❌ | Equivalent to `teacher_id` — redundant. The author is always the uploader |
| `updated_by` | ❌ | Track admin edits via `audit_logs` table |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE content | `RESTRICT` | Tags, approval requests, and teacher upload records reference this row |
| UPDATE content_id | `RESTRICT` | PKs must never change |
| Teacher deleted (soft) | No cascade | `teacher_details` is soft-deleted via `profiles.is_active`; content rows remain and are excluded from student queries via teacher join |
| Chapter deleted | `RESTRICT` | Content is mapped to a chapter; cannot delete a chapter with content |
| Subject deleted | `RESTRICT` | Same reason |
| Institute deleted | `RESTRICT` | Root entity; cannot delete with content rows present |

---

### Supabase RLS Considerations

```
Table: content
RLS: ENABLED

Policies:

SELECT:
  - Students may read content where status = 'approved' within their institute.
    USING: institute_id = get_my_institute_id()
      AND status = 'approved'

  - Students may additionally read is_free_preview = TRUE content
    even without subscription check (subscription enforcement is at the API/Edge Function layer,
    not at RLS level — RLS only enforces institute and approval boundary).

  - Teachers may read all their own content regardless of status.
    USING: teacher_id = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )

  - Teachers may read approved content from other teachers in the same institute.
    USING: institute_id = get_my_institute_id() AND status = 'approved'

  - Admins may read all content within their institute regardless of status.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

INSERT:
  - Teachers may insert content only within their own institute.
    WITH CHECK: institute_id = get_my_institute_id()
      AND teacher_id = (
        SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
      )
  - status must default to 'draft' on insert — enforce via DEFAULT, not RLS.

UPDATE:
  - Teachers may update their own content when status IN ('draft', 'rejected').
    Approved content is immutable — any change requires re-submission.
    USING: teacher_id = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )
    WITH CHECK: status IN ('draft', 'rejected')

  - Admins may update status (approve/reject) for any content in their institute.
    USING: institute_id = get_my_institute_id()
    WITH CHECK: (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

DELETE:
  - Blocked at RLS level. Use status = 'archived' instead.
```

> **Performance note:** Because `institute_id` is denormalized directly onto `content`, all RLS policies resolve in O(1) without a join through `teacher_details → profiles`. This is the correct pattern for a table at this query volume.

---

### Backend Developer Notes

1. **institute_id denormalization is mandatory:** Do not rely on `teacher_id → teacher_details → profiles → institute_id` for RLS. The denormalized `institute_id` on `content` is required for RLS performance, composite index coverage, and query plan stability at scale.

2. **subject_id denormalization:** `subject_id` is populated at insert time by resolving `chapter_id → chapters.subject_id`. It must never be independently set by the client — always derive it from the chapter. Add a trigger or Edge Function validation to enforce this. This denormalization exists exclusively for analytics query performance.

3. **content_type is immutable:** After a row is inserted, `content_type` must not change. If a teacher uploads the wrong file type, they must archive the old row and create a new one. Enforce this via UPDATE RLS or application validation.

4. **Storage path construction:** Always build `storage_path` using the `content_id` UUID so it is globally unique and human-debuggable. Recommended pattern: `institutes/{institute_id}/content/{content_id}/{sanitised_original_filename}`. Never construct paths from user-supplied strings alone — sanitise the filename component (strip special characters, normalise spaces to hyphens) before appending it. The `original_file_name` column stores the raw user-facing name separately and is never used for path construction.

5. **Signed URL generation:** `storage_bucket` and `storage_path` are the durable storage identity. The API layer generates a short-lived signed URL at request time using Supabase Storage's `createSignedUrl(bucket, path, expiresIn)`. Signed URL expiry should match the content type: 60 seconds for streaming video start tokens, 300 seconds for PDF download links. Never cache signed URLs server-side beyond their expiry window.

6. **MIME type allowlist:** Enforce at the API layer (before the storage upload is accepted) that `mime_type` is one of: `application/pdf`, `video/mp4`, `video/webm`, `text/plain`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Reject other MIME types with a 422 response. The DB CHECK only validates structural format, not membership in the allowlist.

7. **Approval state machine:** Valid status transitions are:
   - `draft` → `pending_review` (teacher submits for review)
   - `pending_review` → `approved` (admin approves)
   - `pending_review` → `rejected` (admin rejects)
   - `rejected` → `draft` (teacher revises and pulls back)
   - `approved` → `archived` (admin retires content)
   - `draft` → `archived` (teacher discards draft)
   
   All other transitions are invalid. Enforce via a trigger that validates `OLD.status → NEW.status` transitions. Do not rely solely on application-layer validation.

8. **published_at is system-set:** `published_at` is never sent by the client. It is set by the approval Edge Function when status transitions to `approved`. Include it in the UPDATE triggered by the admin approval action, not on the content insert.

9. **view_count and download_count increment strategy:** At the scale of hundreds of thousands of students, naive `UPDATE content SET view_count = view_count + 1` on every view event will cause lock contention on hot content rows. Use one of the following patterns instead:
   - **Buffered increment (recommended):** Accumulate view events in a separate lightweight `content_events` table or Redis counter, then flush to `content.view_count` in a background job (pg_cron every 5 minutes).
   - **Postgres advisory locks + batch:** Collect events in a queue and batch-update with a single `UPDATE ... SET view_count = view_count + $delta` per content row per flush interval.
   
   Treat `view_count` and `download_count` as eventually-consistent display metrics, not exact real-time counters. Never use them for billing or access control decisions.

10. **Version history with parent_content_id:** The recommended revision workflow is:
    1. Teacher uploads a new file → new `content` row is created with `parent_content_id = {old_content_id}` and `status = 'draft'`.
    2. The old row's `status` is set to `'archived'` atomically in the same transaction.
    3. The new row goes through the normal approval workflow.
    4. Only one row in a version chain should ever have `status = 'approved'` at any time. Enforce this at the application layer — there is no DB constraint that spans the version chain.
    
    To reconstruct a full version chain, traverse `parent_content_id` recursively (PostgreSQL `WITH RECURSIVE` CTE). Cap traversal depth at the application layer to prevent runaway queries on pathologically deep chains.

11. **Storage quota:** `file_size_bytes` can be aggregated per `institute_id` to enforce per-institute storage quotas. A materialized view or background aggregation job is appropriate — do not SUM on every upload request.

12. **Free preview content:** `is_free_preview` is set by the teacher at upload time and can be changed by an admin. Subscription enforcement happens at the API / Edge Function layer, not at the RLS layer. RLS only enforces institute boundary and approval status.

---

## Table 2: `tags`

### Purpose

A flat, institute-scoped vocabulary of labels that can be attached to content for filtering and search. Tags allow students and teachers to find related content across chapters (e.g., all content tagged `"thermodynamics"` regardless of which chapter it lives in).

Tags are not shared across institutes. Each institute maintains its own tag vocabulary.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `tag_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Tags are scoped per institute. An institute cannot see or use another institute's tags |
| `name` | `VARCHAR(100)` | NOT NULL | — | Tag label. Case-insensitive in practice — enforce lowercase at the application layer. Examples: `thermodynamics`, `organic-chemistry`, `jee-advanced` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC creation timestamp |
| `created_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin or teacher who created this tag. Nullable to support seeded/system-created tags |

---

### Primary Key

```
PRIMARY KEY (tag_id)
```

---

### Foreign Keys

```
institute_id → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
created_by   → profiles.profile_id   ON DELETE SET NULL   ON UPDATE RESTRICT
```

> `created_by` uses `SET NULL` on delete because a tag must outlive the user who created it — tag–content relationships must not be disrupted if the creating teacher is deactivated or their profile is eventually purged.

---

### Unique Constraints

```
UNIQUE (institute_id, name)
```

> Tag names are unique per institute (case-insensitive deduplication enforced at the application layer by normalising to lowercase before insert). A tag named `"Thermodynamics"` and one named `"thermodynamics"` must not coexist — normalise before insert.

---

### CHECK Constraints

```
CHECK (char_length(name) >= 1)
CHECK (char_length(name) <= 100)
CHECK (name = lower(name))
```

> The `lower()` check enforces lowercase at the database level as a safety net. The application layer should also normalise before insert, but the DB constraint prevents dirty data from any path (direct insert, migration, seed scripts).

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_tags_institute_name` | `(institute_id, name)` | B-tree (covered by UNIQUE) | Already covered by unique constraint |
| `idx_tags_institute` | `(institute_id)` | B-tree | List all tags for an institute (tag management UI) |

---

### Soft Delete Strategy

`tags` does not support soft delete. Tags that are no longer needed should be deleted only after all `content_tag` rows referencing them are removed. Because the FK on `content_tag.tag_id` uses `ON DELETE CASCADE` (see ContentTag below), deleting a tag automatically removes all its content associations.

However, deleting a widely-used tag is a destructive operation. Consider adding an `is_active BOOLEAN` column in a future iteration if tag deprecation without deletion becomes a product requirement.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `created_at` | ✅ | Required |
| `created_by` | ✅ | Tag creation is a deliberate action by an identifiable user; worth recording |
| `updated_at` | ❌ | Tags are immutable after creation. Name changes require delete + recreate to preserve uniqueness semantics |
| `updated_by` | ❌ | Same reason |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE tag | `CASCADE` to `content_tag` | Removing a tag removes all its content associations |
| DELETE institute | `RESTRICT` | Cannot delete institute with tags |
| UPDATE tag_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: tags
RLS: ENABLED

Policies:

SELECT:
  - Any authenticated user within the same institute may read all tags.
    USING: institute_id = get_my_institute_id()

INSERT:
  - Teachers and admins within the institute may create tags.
    WITH CHECK: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) IN ('admin', 'teacher')

UPDATE:
  - Blocked. Tags are immutable. Rename = delete + create.

DELETE:
  - Admins only.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'
```

---

### Backend Developer Notes

1. **Normalise before insert:** Always `TRIM()` and `LOWER()` the tag name before attempting an insert. Use an `INSERT ... ON CONFLICT (institute_id, name) DO NOTHING RETURNING tag_id` pattern to atomically get-or-create a tag without a race condition.

2. **Tag autocomplete:** The tag management UI will need a fast prefix search (`LIKE 'thermo%'`). The B-tree index on `(institute_id, name)` supports this query efficiently. Alternatively, add a `pg_trgm` GIN index on `name` if full substring search (not just prefix) is required.

3. **Tag limits:** Consider enforcing a maximum number of tags per institute at the application layer (e.g., 500 tags) to prevent unbounded growth. This is a product decision, not enforced at the DB level.

---

## Table 3: `content_tag`

### Purpose

Many-to-many junction table linking `content` to `tags`. One piece of content can have multiple tags; one tag can be applied to many content rows. Carries no attributes beyond the relationship itself.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `content_id` | `UUID` | NOT NULL | — | FK → `content.content_id`. Part of composite primary key |
| `tag_id` | `UUID` | NOT NULL | — | FK → `tags.tag_id`. Part of composite primary key |
| `tagged_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when this tag was applied to this content. Useful for audit and "recently tagged" queries |
| `tagged_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. Who applied the tag. Nullable to support system/bulk tagging operations |

---

### Primary Key

```
PRIMARY KEY (content_id, tag_id)
```

> Composite primary key enforces uniqueness of the relationship. A tag can only be applied to a given content row once.

---

### Foreign Keys

```
content_id → content.content_id   ON DELETE CASCADE   ON UPDATE RESTRICT
tag_id     → tags.tag_id   ON DELETE CASCADE   ON UPDATE RESTRICT
tagged_by  → profiles.profile_id   ON DELETE SET NULL   ON UPDATE RESTRICT
```

> Both `content_id` and `tag_id` use `CASCADE` on delete. If a content row is archived/deleted or a tag is removed, the junction row is automatically cleaned up. This is correct for a pure junction table — stale associations have no standalone value.

---

### Unique Constraints

Enforced by the composite primary key.

---

### CHECK Constraints

None. The composite PK + FK constraints are sufficient.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_content_tag_tag_id` | `(tag_id)` | B-tree | "All content with this tag" query — the reverse direction of the composite PK |
| `idx_content_tag_content_id` | `(content_id)` | B-tree | Covered by the composite PK (leading column); no additional index needed |

> The composite PK creates a B-tree index on `(content_id, tag_id)`. Queries filtering by `tag_id` alone need the reverse index on `(tag_id)` because the PK index cannot be used for a tag-first lookup.

---

### Soft Delete Strategy

None. Rows in this table are either present (tag is applied) or absent (tag is not applied). There is no concept of "soft-removing" a tag from content — simply delete the row.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `tagged_at` | ✅ | Lightweight audit; useful for "when was this tag applied" |
| `tagged_by` | ✅ | Identifies who tagged the content (teacher self-tags vs admin bulk-tagging) |
| `updated_at` | ❌ | Junction rows are not updated; they are inserted and deleted |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE content | `CASCADE` to `content_tag` | Clean up all tags when content is removed |
| DELETE tag | `CASCADE` to `content_tag` | Clean up all content associations when tag is removed |
| UPDATE content_id / tag_id | `RESTRICT` | PKs must not change |

---

### Supabase RLS Considerations

```
Table: content_tag
RLS: ENABLED

Policies:

SELECT:
  - Any authenticated user may read content_tag rows where the content belongs to their institute.
    Join path: content_tag → content.institute_id = get_my_institute_id()
    USING: EXISTS (
      SELECT 1 FROM content c
      WHERE c.content_id = content_tag.content_id
        AND c.institute_id = get_my_institute_id()
    )

  NOTE: If content is frequently accessed with its tags in a single query (JOIN), the
  content RLS policy already filters the parent; Postgres will not independently re-evaluate
  content_tag RLS for rows reached via that join in most query patterns. Validate this
  behaviour in your Supabase version and test with EXPLAIN ANALYZE.

INSERT:
  - Teachers may tag their own content.
    WITH CHECK: EXISTS (
      SELECT 1 FROM content c
      WHERE c.content_id = content_tag.content_id
        AND c.teacher_id = (
          SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
        )
    )

  - Admins may tag any content within their institute.

DELETE:
  - Same policy as INSERT (teachers remove tags from their own content; admins remove any).
```

---

### Backend Developer Notes

1. **Bulk tag operations:** When a teacher submits content with multiple tags (e.g., `["thermodynamics", "jee-advanced", "heat-transfer"]`), first get-or-create all tags in a single batch, then insert all `content_tag` rows in a single `INSERT ... ON CONFLICT DO NOTHING` statement. Never loop with individual inserts.

2. **Tag search across content:** The most common query is "find all approved content in this institute with tag X." This query pattern is: `content_tag JOIN content ON content_id WHERE tag_id = ? AND institute_id = ? AND status = 'approved'`. The `idx_content_tag_tag_id` index combined with the `idx_content_institute_status` index supports this efficiently.

3. **Maximum tags per content:** Enforce a limit (e.g., 10 tags per content row) at the application layer before insert. Unbounded tagging creates noise in search results and complicates analytics.

---

## Table 4: `approval_requests`

### Purpose

Workflow management table for content and mock test approval. When a teacher submits content or a mock test for admin review, an `approval_request` row is created. Admins review the submission and either approve or reject it, recording their decision and remarks in this table.

`approval_requests` is a polymorphic table: its `resource_type` + `resource_id` pair points to either a `content` row or a `mock_test` row. This avoids two separate approval tables with identical structures.

This table is the system of record for the approval audit trail. Every approval decision — including the reviewer, timestamp, and remarks — is persisted here permanently.

---

### Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `approval_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key |
| `institute_id` | `UUID` | NOT NULL | — | FK → `institutes.institute_id`. Denormalized for RLS and multi-tenant query performance |
| `resource_type` | `approval_resource_type` | NOT NULL | — | PostgreSQL enum: `content`, `mock_test`. Identifies the type of the polymorphic reference |
| `resource_id` | `UUID` | NOT NULL | — | The `content_id` or `test_id` of the item being reviewed. No FK constraint possible on a polymorphic reference — integrity enforced via trigger (see notes) |
| `requested_by` | `UUID` | NOT NULL | — | FK → `profiles.profile_id`. The teacher (or admin) who submitted the item for review |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `teacher_details.teacher_id`. Denormalized from `requested_by → profiles → teacher_details`. Used for teacher dashboard and analytics queries without joining through profiles |
| `reviewed_by` | `UUID` | NULL | `NULL` | FK → `profiles.profile_id`. The admin who approved or rejected. NULL until a review decision is made |
| `status` | `approval_status` | NOT NULL | `'pending'` | PostgreSQL enum: `pending`, `approved`, `rejected`. Tracks the current review decision |
| `remarks` | `TEXT` | NULL | `NULL` | Admin's review notes. Required when `status = 'rejected'` (enforced at application layer). Optional for approvals |
| `version` | `INTEGER` | NOT NULL | `1` | Submission version counter. Increments each time the teacher resubmits after a rejection. Allows tracking revision history |
| `requested_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | UTC timestamp when the approval request was created (item submitted for review) |
| `reviewed_at` | `TIMESTAMPTZ` | NULL | `NULL` | UTC timestamp when the admin recorded their decision. NULL until reviewed |

---

### Primary Key

```
PRIMARY KEY (approval_id)
```

---

### Foreign Keys

```
institute_id  → institutes.institute_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
requested_by  → profiles.profile_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
teacher_id    → teacher_details.teacher_id   ON DELETE RESTRICT   ON UPDATE RESTRICT
reviewed_by   → profiles.profile_id   ON DELETE SET NULL   ON UPDATE RESTRICT
```

> `reviewed_by` uses `SET NULL` on delete: if the reviewing admin's profile is ever deactivated or (in a future hard-delete scenario) removed, the approval record must be preserved with the reviewer's identity nulled out. The approval decision itself (status, reviewed_at, remarks) remains intact.

> There is no FK on `resource_id` because PostgreSQL does not support polymorphic foreign keys. Referential integrity for `resource_id` must be enforced via a trigger (see Backend Developer Notes).

---

### Unique Constraints

```
UNIQUE (resource_type, resource_id)
  WHERE status = 'pending'
```

> Partial unique index. Ensures only one open (pending) approval request exists per resource at any time. Multiple historical approval records (approved/rejected) for the same resource are allowed — they form the revision audit trail. A second submission after rejection creates a new `approval_request` row (with `version` incremented), but the partial unique constraint allows this because the prior row is no longer `pending`.

---

### CHECK Constraints

```
CHECK (reviewed_at IS NULL OR reviewed_at >= requested_at)
CHECK (version >= 1)
CHECK (
  (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  OR (status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL)
)
```

> The third CHECK enforces internal consistency of the review state: a pending request has no reviewer or timestamp; a decided request must have both. This prevents half-written review states from persisting.

---

### Recommended Indexes

| Index | Columns | Type | Reason |
|-------|---------|------|--------|
| `idx_approval_institute_status` | `(institute_id, status)` | B-tree | Admin review queue: all pending approvals in this institute |
| `idx_approval_resource` | `(resource_type, resource_id)` | B-tree | Look up approval history for a given content or mock test |
| `idx_approval_teacher_status` | `(teacher_id, status)` | B-tree | Teacher dashboard: status of my submitted items |
| `idx_approval_requested_at` | `(requested_at DESC)` | B-tree | Admin queue sorted by submission time (oldest-first review processing) |
| `idx_approval_pending_resource` | `(resource_type, resource_id)` WHERE `status = 'pending'` | B-tree (partial) | Fast lookup of the current open approval for a resource; also backs the partial unique constraint |

---

### Soft Delete Strategy

`approval_requests` is an immutable audit trail. Rows are never deleted or soft-deleted. A rejected approval record is retained permanently as part of the content review history. The `version` column tracks re-submissions.

---

### Audit Fields

| Field | Present | Reason |
|-------|---------|--------|
| `requested_at` | ✅ | Submission timestamp |
| `reviewed_at` | ✅ | Decision timestamp |
| `requested_by` | ✅ | Submitter identity |
| `reviewed_by` | ✅ | Reviewer identity |
| `version` | ✅ | Revision counter for resubmissions |
| `created_at` | ❌ | `requested_at` serves this role |
| `updated_at` | ❌ | Approval rows are append-only in spirit; updates only occur once (when the decision is recorded). `reviewed_at` captures the update timestamp |

---

### Cascade Rules

| Action | Behaviour | Reason |
|--------|-----------|--------|
| DELETE approval_request | `RESTRICT` | Audit trail must not be deleted |
| DELETE institute | `RESTRICT` | Cannot delete institute with approval records |
| DELETE requesting profile | `RESTRICT` | Teacher's identity must be preserved in audit trail |
| DELETE reviewing profile | `SET NULL` on `reviewed_by` | Decision record preserved; reviewer identity nulled |
| UPDATE approval_id | `RESTRICT` | PK must not change |

---

### Supabase RLS Considerations

```
Table: approval_requests
RLS: ENABLED

Policies:

SELECT:
  - Teachers may read approval_requests for their own submissions.
    USING: teacher_id = (
      SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
    )

  - Admins may read all approval_requests within their institute.
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'

  - Students may NOT read approval_requests. No policy grants them access.

INSERT:
  - Teachers may create approval_requests for their own content or mock tests.
    WITH CHECK: institute_id = get_my_institute_id()
      AND requested_by = auth.uid()
      AND teacher_id = (
        SELECT teacher_id FROM teacher_details WHERE profile_id = auth.uid()
      )
  - status must be 'pending' on insert — enforced via DEFAULT and application validation.

UPDATE:
  - Admins may update status, reviewed_by, reviewed_at, remarks (recording a decision).
    USING: institute_id = get_my_institute_id()
      AND (SELECT role FROM profiles WHERE profile_id = auth.uid()) = 'admin'
    WITH CHECK: status IN ('approved', 'rejected')
      AND reviewed_by = auth.uid()
      AND reviewed_at IS NOT NULL

  - Teachers may NOT update approval_requests. If they need to revise, the workflow
    creates a new approval_request row (new version).

DELETE:
  - Blocked at RLS level. Approval trail is permanent.
```

---

### Backend Developer Notes

1. **Polymorphic integrity via trigger:** Because `resource_id` cannot carry a FK constraint, create a trigger `BEFORE INSERT OR UPDATE ON approval_requests` that validates the `resource_id` exists in the correct target table based on `resource_type`. For `resource_type = 'content'`, check `EXISTS (SELECT 1 FROM content WHERE content_id = NEW.resource_id)`. For `resource_type = 'mock_test'`, check `EXISTS (SELECT 1 FROM mock_tests WHERE test_id = NEW.resource_id)`. Raise an exception if the lookup fails.

2. **Approval workflow and content status are linked:** When an admin sets `approval_requests.status = 'approved'`, an Edge Function (or DB trigger) must also update `content.status = 'approved'` and set `content.published_at = NOW()`. These two updates must happen atomically in a single transaction. Never update one without the other.

3. **Rejection flow:** When an admin rejects (`status = 'rejected'`), the corresponding `content.status` must revert to `'rejected'`. The teacher can then revise and resubmit. On resubmission, a NEW `approval_request` row is inserted with `version = (previous_version + 1)` and `status = 'pending'`. The old rejected row remains untouched.

4. **Admin notification on submission:** When a teacher inserts an `approval_request`, trigger a notification to all admin profiles in the institute. Use the `notifications` domain (Domain 13) for this — do not implement ad-hoc notification logic in the approval trigger.

5. **Remarks are required on rejection:** Enforce at the API validation layer (Zod/Joi) that `remarks` is non-null and non-empty when `status = 'rejected'`. This cannot be enforced as a simple CHECK constraint because the rule is conditional on another column's value in a way that interacts with the update flow. A trigger enforcement is possible but adds complexity; application-layer validation is sufficient given RLS already prevents non-admin updates.

6. **version initialisation:** When an `approval_request` row is first created, `version = 1`. When a new request is created after a rejection, query the maximum `version` for that `(resource_type, resource_id)` pair and increment by 1. This gives a continuous revision counter per resource, even across multiple rejection-revise-resubmit cycles.

7. **reviewed_at should never be set by the client:** The `reviewed_at` timestamp must be set server-side (either via a DB trigger on status change or by the Edge Function that processes the admin's decision). Never accept it as a client-supplied value.

---

## Domain 3 — Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Single `content` table | Yes — `content_type` enum discriminator | Eliminates 3-way joins from v1's `PDFContent` / `VideoContent` / `StudyMaterial` split |
| Storage model | `storage_bucket` + `storage_path` + `mime_type` + `original_file_name` (no stored URL) | Signed URLs are ephemeral; storing them creates stale-URL risk. Bucket/path are the durable identity; URLs generated at request time |
| `subject_id` on `content` | Denormalized | Analytics by subject without joining through chapter; covered by composite index |
| `institute_id` on `content` | Denormalized | RLS performance; composite index coverage; mandatory for multi-tenant isolation at scale |
| `content_type` immutability | Yes | Type change is semantically a new upload; prevents orphaned type-specific metadata |
| `parent_content_id` self-reference | Optional nullable FK on same table | Enables version lineage without a separate `content_versions` table; archive-on-revise pattern keeps exactly one approved row per lineage |
| `view_count` / `download_count` | `BIGINT NOT NULL DEFAULT 0` | Buffered/eventual increment via background job; avoids row-level lock contention on hot content |
| Polymorphic `approval_requests` | `resource_type` + `resource_id` pair | Avoids two identical tables; accepted trade-off of no native FK (mitigated by trigger) |
| Approval audit trail | Append-only; new row per resubmission | Full revision history; `version` counter tracks iterations |
| Partial unique index on approval | `UNIQUE (resource_type, resource_id) WHERE status = 'pending'` | One open review per resource; multiple historical records allowed |
| Tag lowercase enforcement | DB CHECK `name = lower(name)` + app-layer normalisation | Belt-and-suspenders; prevents case variant duplicates from any insert path |
| `content_tag` cascade | `ON DELETE CASCADE` both FKs | Junction rows have no standalone value; clean up automatically |

---

## Domain 3 — Relationships to Other Domains

| This Table | Referenced By | Via Column | Domain |
|------------|--------------|------------|--------|
| `content` | `teacher_upload` | `content_id` | Domain 14 (Teacher Dashboard) |
| `content` | `content_tag` | `content_id` | This domain (junction) |
| `content` | `approval_requests` | `resource_id` WHERE `resource_type = 'content'` | This domain |
| `approval_requests` | `mock_tests` | `resource_id` WHERE `resource_type = 'mock_test'` | Domain 9 (Mock Test Engine) |
| `approval_requests` | `audit_logs` | `resource_id` (action logging) | Domain 15 (Administration) |
| `tags` | `content_tag` | `tag_id` | This domain (junction) |

---

## Domain 3 — Enum Types Used

All enums are defined globally in the pre-domain migration (see Domain 1 Pre-Domain Notes).

| Enum | Values Used in This Domain |
|------|--------------------------|
| `content_type` | `pdf`, `video`, `notes`, `assignment` |
| `lifecycle_status` | `draft`, `pending_review`, `approved`, `rejected`, `archived` |
| `approval_resource_type` | `content`, `mock_test` |
| `approval_status` | `pending`, `approved`, `rejected` |

---

*Domain 3 complete (v1.1 — storage model, engagement counters, version history added). Awaiting approval before proceeding to Domain 4 — Batch Management (Batch · BatchStudent · BatchTeacher).*
