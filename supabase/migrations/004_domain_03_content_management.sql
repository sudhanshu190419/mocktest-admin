-- ============================================================================
-- Migration: Domain 03 — Content Management
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: content · tags · content_tag · approval_requests
--
-- Depends on: Domain 01 (institutes, profiles, teacher_details, student_details)
--             Domain 02 (streams, subjects, chapters, topics, batches)
--             Existing enums (content_type, lifecycle_status,
--               approval_resource_type, approval_status)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- Order:
--   1. Tables (dependency order: parent → child → junction)
--   2. Indexes (after all tables exist)
--   3. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   4. Comments
--
-- Reference: Schema_Domain_03_Content.md v1.1 | ERD v3.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Content management: content → tags (junction via content_tag)
-- Approval workflow:   approval_requests (polymorphic: content / mock_test)

-- 1a. Table: content
-- Central store for all teacher-uploaded learning materials. Discriminated by
-- content_type enum (pdf, video, notes, assignment). Every piece of content is
-- categorised to exactly one chapter and must pass an approval workflow before
-- becoming visible to students. institute_id and subject_id are denormalized
-- for RLS performance and analytics. parent_content_id supports version history.
create table public.content (
  content_id          uuid              not null  default gen_random_uuid(),
  institute_id        uuid              not null,
  teacher_id          uuid              not null,
  chapter_id          uuid              not null,
  subject_id          uuid              not null,
  parent_content_id   uuid              null      default null,
  title               varchar(500)      not null,
  description         text              null      default null,
  content_type        content_type      not null,
  storage_bucket      varchar(100)      not null,
  storage_path        text              not null,
  mime_type           varchar(127)      not null,
  original_file_name  varchar(500)      not null,
  thumbnail_bucket    varchar(100)      null      default null,
  thumbnail_path      text              null      default null,
  duration_seconds    integer           null      default null,
  page_count          integer           null      default null,
  file_size_bytes     bigint            null      default null,
  view_count          bigint            not null  default 0,
  download_count      bigint            not null  default 0,
  status              lifecycle_status  not null  default 'draft',
  is_free_preview     boolean           not null  default false,
  created_at          timestamptz       not null  default now(),
  updated_at          timestamptz       not null  default now(),
  published_at        timestamptz       null      default null,

  -- Primary Key
  constraint pk_content primary key (content_id),

  -- Foreign Keys
  constraint fk_content_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_content_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_content_chapter
    foreign key (chapter_id) references public.chapters (chapter_id)
    on delete restrict
    on update restrict,

  constraint fk_content_subject
    foreign key (subject_id) references public.subjects (subject_id)
    on delete restrict
    on update restrict,

  constraint fk_content_parent
    foreign key (parent_content_id) references public.content (content_id)
    on delete restrict
    on update restrict,

  -- Unique Constraints
  constraint uq_content_storage unique (storage_bucket, storage_path),

  -- CHECK Constraints
  constraint ck_content_title_length check (char_length(title) >= 3),
  constraint ck_content_duration_seconds check
    (duration_seconds is null or duration_seconds > 0),
  constraint ck_content_page_count check
    (page_count is null or page_count > 0),
  constraint ck_content_file_size_bytes check
    (file_size_bytes is null or file_size_bytes > 0),
  constraint ck_content_view_count check (view_count >= 0),
  constraint ck_content_download_count check (download_count >= 0),
  constraint ck_content_storage_bucket_length check (char_length(storage_bucket) >= 1),
  constraint ck_content_storage_path_length check (char_length(storage_path) >= 1),
  constraint ck_content_mime_type_format check
    (mime_type ~ '^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$'),
  constraint ck_content_no_self_parent check
    (parent_content_id is null or parent_content_id != content_id),
  constraint ck_content_type_specific check
    ((content_type = 'pdf' and page_count is not null)
     or (content_type = 'video' and duration_seconds is not null)
     or (content_type = 'assignment' and duration_seconds is null)
     or (content_type = 'notes')),
  constraint ck_content_published_at check
    (published_at is null or published_at >= created_at)
);

-- 1b. Table: tags
-- Flat, institute-scoped vocabulary of labels attachable to content for
-- filtering and search. Case-insensitive — lowercase enforced at DB level.
-- Tags are immutable after creation (name changes require delete + recreate).
create table public.tags (
  tag_id        uuid          not null  default gen_random_uuid(),
  institute_id  uuid          not null,
  name          varchar(100)  not null,
  created_at    timestamptz   not null  default now(),
  created_by    uuid          null      default null,

  -- Primary Key
  constraint pk_tags primary key (tag_id),

  -- Foreign Keys
  constraint fk_tags_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_tags_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_tags_institute_name unique (institute_id, name),

  -- CHECK Constraints
  constraint ck_tags_name_length check (char_length(name) >= 1),
  constraint ck_tags_name_max_length check (char_length(name) <= 100),
  constraint ck_tags_name_lowercase check (name = lower(name))
);

-- 1c. Table: content_tag
-- Many-to-many junction table linking content to tags. Composite PK enforces
-- uniqueness — a tag can only be applied to a given content row once.
-- Both FKs use CASCADE on delete for automatic cleanup.
create table public.content_tag (
  content_id  uuid          not null,
  tag_id      uuid          not null,
  tagged_at   timestamptz   not null  default now(),
  tagged_by   uuid          null      default null,

  -- Primary Key (composite)
  constraint pk_content_tag primary key (content_id, tag_id),

  -- Foreign Keys
  constraint fk_content_tag_content
    foreign key (content_id) references public.content (content_id)
    on delete cascade
    on update restrict,

  constraint fk_content_tag_tag
    foreign key (tag_id) references public.tags (tag_id)
    on delete cascade
    on update restrict,

  constraint fk_content_tag_tagged_by
    foreign key (tagged_by) references public.profiles (profile_id)
    on delete set null
    on update restrict
);

-- 1d. Table: approval_requests
-- Polymorphic workflow table for content and mock test approval.
-- resource_type + resource_id pairs point to either a content row or a
-- mock_test row (no FK possible on polymorphic reference — integrity
-- enforced via application-layer validation). One open (pending) request
-- allowed per resource; historical records form the revision audit trail.
create table public.approval_requests (
  approval_id   uuid                    not null  default gen_random_uuid(),
  institute_id  uuid                    not null,
  resource_type approval_resource_type  not null,
  resource_id   uuid                    not null,
  requested_by  uuid                    not null,
  teacher_id    uuid                    not null,
  reviewed_by   uuid                    null      default null,
  status        approval_status         not null  default 'pending',
  remarks       text                    null      default null,
  version       integer                 not null  default 1,
  requested_at  timestamptz             not null  default now(),
  reviewed_at   timestamptz             null      default null,

  -- Primary Key
  constraint pk_approval_requests primary key (approval_id),

  -- Foreign Keys
  constraint fk_approval_requests_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_approval_requests_requested_by
    foreign key (requested_by) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  constraint fk_approval_requests_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_approval_requests_reviewed_by
    foreign key (reviewed_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_approval_reviewed_at check
    (reviewed_at is null or reviewed_at >= requested_at),
  constraint ck_approval_version check (version >= 1),
  constraint ck_approval_state_consistency check
    ((status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
     or (status = 'pending' and reviewed_at is null and reviewed_by is null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- 2a. content indexes
create index if not exists idx_content_institute_status
  on public.content (institute_id, status);

create index if not exists idx_content_chapter_status
  on public.content (chapter_id, status);

create index if not exists idx_content_teacher
  on public.content (teacher_id);

create index if not exists idx_content_institute_type_status
  on public.content (institute_id, content_type, status);

create index if not exists idx_content_subject_status
  on public.content (subject_id, status);

create index if not exists idx_content_published_at
  on public.content (published_at desc nulls last);

-- Partial index: only rows with a parent reference (reduces index size)
create index if not exists idx_content_parent_content_id
  on public.content (parent_content_id)
  where parent_content_id is not null;

create index if not exists idx_content_institute_view_count
  on public.content (institute_id, view_count desc);

-- Note: idx_content_storage is covered by uq_content_storage (unique constraint).

-- 2b. tags indexes
-- Only the institute-wide listing index — lookup-by-name is covered by
-- the uq_tags_institute_name unique constraint.
create index if not exists idx_tags_institute
  on public.tags (institute_id);

-- Note: idx_tags_institute_name is covered by uq_tags_institute_name.

-- 2c. content_tag indexes
-- Reverse index: query all content for a given tag (composite PK covers
-- content-first lookups).
create index if not exists idx_content_tag_tag_id
  on public.content_tag (tag_id);

-- Note: idx_content_tag_content_id is covered by the composite PK leading column.

-- 2d. approval_requests indexes
create index if not exists idx_approval_institute_status
  on public.approval_requests (institute_id, status);

create index if not exists idx_approval_resource
  on public.approval_requests (resource_type, resource_id);

create index if not exists idx_approval_teacher_status
  on public.approval_requests (teacher_id, status);

create index if not exists idx_approval_requested_at
  on public.approval_requests (requested_at desc);

-- Partial unique index: only one open (pending) request per resource.
-- Implemented as a partial unique INDEX because PostgreSQL does not
-- support WHERE clauses on UNIQUE constraints. Also serves as the
-- fast lookup for pending approvals.
create unique index if not exists uq_approval_pending_resource
  on public.approval_requests (resource_type, resource_id)
  where status = 'pending';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.
-- tags and content_tag have no updated_at column (tags are immutable;
--   content_tag rows are inserted and deleted, not updated).
-- approval_requests uses requested_at / reviewed_at instead of updated_at.

-- 3a. content triggers
create trigger trg_content_set_updated_at
  before update on public.content
  for each row
  execute function public.set_updated_at();

-- 3b. approval_requests polymorphic validation trigger
-- Validates resource_id exists in the correct target table based on resource_type.
--   resource_type = 'content'   → content.content_id must exist
--   resource_type = 'mock_test' → TODO: validate when mock_tests table is created (Domain 09)
create or replace function public.trgfn_approval_validate_resource()
returns trigger
language plpgsql
as $$
begin
  if new.resource_type = 'content' then
    if not exists (select 1 from public.content where content_id = new.resource_id) then
      raise exception 'resource_id % does not exist in content table', new.resource_id;
    end if;
  elsif new.resource_type = 'mock_test' then
    -- TODO: Add mock_tests validation once Domain 09 (Mock Test Engine) is migrated.
    --   if not exists (select 1 from public.mock_tests where test_id = new.resource_id) then
    --     raise exception 'resource_id % does not exist in mock_tests table', new.resource_id;
    --   end if;
    null;
  end if;
  return new;
end;
$$;

create trigger trg_approval_validate_resource
  before insert or update on public.approval_requests
  for each row
  execute function public.trgfn_approval_validate_resource();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.content is
  'Central store for all teacher-uploaded learning materials. Discriminated by '
  'content_type (pdf, video, notes, assignment). institute_id and subject_id are '
  'denormalized for RLS performance and analytics. parent_content_id supports '
  'version history. Only approved content is visible to students.';

comment on table public.tags is
  'Flat, institute-scoped vocabulary of labels attachable to content for filtering '
  'and search. Lowercase enforced at DB level. Tags are immutable after creation.';

comment on table public.content_tag is
  'Many-to-many junction table linking content to tags. Composite PK enforces '
  'uniqueness. Both FKs use CASCADE on delete for automatic cleanup.';

comment on table public.approval_requests is
  'Polymorphic workflow table for content and mock test approval. resource_type + '
  'resource_id pairs point to either a content or mock_test row. One open (pending) '
  'request allowed per resource. Historical records form the revision audit trail.';

-- 4b. Column comments
comment on column public.content.content_type is
  'Discriminator: pdf, video, notes, or assignment. Immutable after creation.';

comment on column public.content.storage_bucket is
  'Supabase Storage bucket name. Part of durable storage identity — signed URLs '
  'are generated dynamically at request time.';

comment on column public.content.storage_path is
  'Object path within the storage bucket. Together with storage_bucket, uniquely '
  'identifies the file. Signed URLs generated dynamically from this path.';

comment on column public.content.mime_type is
  'IANA media type (e.g. application/pdf, video/mp4). Validated at upload time '
  'against an allowlist at the API layer.';

comment on column public.content.original_file_name is
  'File name as submitted by the teacher. Never used for storage path construction '
  '(paths use UUIDs). Displayed in download dialogs and dashboards.';

comment on column public.content.parent_content_id is
  'Self-referencing FK to the immediately preceding version. NULL for the original '
  'upload. Enables full revision lineage traversal via recursive CTE.';

comment on column public.content.duration_seconds is
  'Applicable to video content only. Total video duration in seconds.';

comment on column public.content.page_count is
  'Applicable to PDF and notes content only. NULL for video and assignments.';

comment on column public.content.file_size_bytes is
  'Raw file size in bytes. Used for storage quota enforcement and display.';

comment on column public.content.view_count is
  'Running total of student view events. Eventually-consistent — buffered and '
  'flushed by background job to avoid lock contention on hot rows.';

comment on column public.content.download_count is
  'Running total of download events. Eventually-consistent display metric.';

comment on column public.content.status is
  'Lifecycle: draft → pending_review → approved → archived. Rejected content '
  'can return to draft for revision. Only approved content visible to students.';

comment on column public.content.is_free_preview is
  'When TRUE, students without an active subscription can access this content. '
  'Used for trial and demo material.';

comment on column public.content.published_at is
  'UTC timestamp when status transitioned to approved. Set by the approval '
  'workflow, never by the client.';

comment on column public.tags.name is
  'Tag label. Lowercase enforced at DB level via CHECK constraint. Normalise '
  'to lowercase at the application layer before insert.';

comment on column public.tags.created_by is
  'Admin or teacher who created this tag. Nullable to support seeded/system-created tags.';

comment on column public.content_tag.tagged_at is
  'UTC timestamp when this tag was applied to this content.';

comment on column public.content_tag.tagged_by is
  'Profile who applied the tag. Nullable to support system/bulk tagging operations.';

comment on column public.approval_requests.resource_type is
  'Polymorphic discriminator: content or mock_test. Identifies the type of '
  'the referenced resource.';

comment on column public.approval_requests.resource_id is
  'The content_id or test_id of the item being reviewed. No FK constraint '
  'possible on polymorphic reference — integrity enforced via trigger.';

comment on column public.approval_requests.requested_by is
  'Teacher or admin who submitted the item for review.';

comment on column public.approval_requests.teacher_id is
  'Denormalized from requested_by → profiles → teacher_details. Enables '
  'teacher dashboard queries without joining through profiles.';

comment on column public.approval_requests.reviewed_by is
  'Admin who approved or rejected. NULL until a review decision is made.';

comment on column public.approval_requests.status is
  'Current review decision: pending, approved, or rejected.';

comment on column public.approval_requests.remarks is
  'Admin review notes. Required when status = rejected (enforced at '
  'application layer). Optional for approvals.';

comment on column public.approval_requests.version is
  'Submission version counter. Increments on each resubmission after a '
  'rejection. Tracks revision history.';

comment on column public.approval_requests.requested_at is
  'UTC timestamp when the approval request was created.';

comment on column public.approval_requests.reviewed_at is
  'UTC timestamp when the admin recorded their decision. NULL until reviewed.';

-- 4c. Constraint comments
comment on constraint uq_content_storage on public.content is
  'Every storage file must be referenced by exactly one content row. Prevents '
  'two content rows from pointing at the same physical file.';

comment on constraint ck_content_mime_type_format on public.content is
  'Enforces basic IANA type/subtype structural format. The allowed-MIME-type '
  'allowlist is enforced at the API layer (Zod/Joi).';

comment on constraint ck_content_no_self_parent on public.content is
  'Prevents a row from being its own parent. Longer cycles (A→B→A) must be '
  'detected at the application layer.';

comment on constraint ck_content_type_specific on public.content is
  'Content-type-specific column requirements: PDF requires page_count; video '
  'requires duration_seconds; assignment must not have duration_seconds; '
  'notes have no additional requirements. Enforced at the DB level for safety '
  'across all insert paths (Edge Functions, admin tools).';

comment on constraint ck_content_published_at on public.content is
  'published_at must never precede created_at. Prevents temporal anomalies '
  'from clock skew or incorrect workflow logic.';

comment on constraint ck_tags_name_lowercase on public.tags is
  'Enforces lowercase tag names at the database level as a safety net. '
  'Application layer should normalise before insert.';

comment on constraint ck_approval_state_consistency on public.approval_requests is
  'A pending request has no reviewer or timestamp. A decided request '
  '(approved/rejected) must have both. Prevents half-written review states.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Domain 03 Content Management
-- ════════════════════════════════════════════════════════════════════════════
