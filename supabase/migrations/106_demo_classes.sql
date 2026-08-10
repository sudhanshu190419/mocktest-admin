-- ============================================================================
-- Migration: 106 — Demo Classes
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: demo_classes
-- Enum:   demo_class_status (draft | published | archived)
--
-- Depends on: Domain 01 (institutes, profiles)
--             Domain 02 (streams)
--             Existing functions (set_updated_at, get_my_institute_id,
--               is_super_admin, is_academic_admin — from migrations
--               002 and 074)
--
-- ## Purpose
--
-- Stream-scoped marketing/demo videos shown at the very top of the student
-- Home screen. Multiple demo classes per stream are intentionally supported
-- (approved architecture Option B). Students read the latest published demo:
--
--     WHERE institute_id = ? AND stream_id = ? AND status = 'published'
--     ORDER BY created_at DESC
--     LIMIT 1
--
-- Video files live in the EXISTING `content-videos` storage bucket (migration
-- 022). This table stores only storage_bucket + storage_path; playback uses
-- the existing client-side signed-URL flow (VideoViewer → generateSignedUrl).
-- No new bucket, no storage policy changes.
--
-- This table is intentionally independent of courses, chapters, subjects,
-- batches, recordings, and all payment/subscription/entitlement tables.
--
-- ## RLS model
--
--   Students:  SELECT only where institute_id = get_my_institute_id()
--              AND status = 'published'. Drafts/archived demos are invisible.
--   Admins:    Full CRUD for approved super_admin OR academic_admin, scoped
--              to their own institute (RBAC-hardened per migration 075 —
--              Finance Admins, teachers, and students are denied at RLS).
--
-- ## Idempotency
--
-- Enum creation is wrapped in a do-block (duplicate_object → no-op). Indexes
-- use `if not exists`. Policies are dropped (if exists) before recreation,
-- matching migration 075's convention.
--
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create Enum: demo_class_status
-- ════════════════════════════════════════════════════════════════════════════
-- A purpose-built lifecycle for demos. Deliberately NOT reusing
-- lifecycle_status ('draft'|'pending_review'|'approved'|'rejected'|'archived')
-- because demos have no approval workflow — they are managed directly by
-- admins, so the state set is smaller and uses 'published' instead of
-- 'approved'.

do $$ begin
  create type public.demo_class_status as enum (
    'draft',      -- Visible to admins only; not yet live for students
    'published',  -- Live: students can read it for their stream
    'archived'    -- Retired: hidden from students, retained for admins
  );
exception
  when duplicate_object then null;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Create Table: demo_classes
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.demo_classes (
  -- Primary Key
  demo_class_id     uuid             not null  default gen_random_uuid(),

  -- Ownership & Scoping
  institute_id      uuid             not null,
  stream_id         uuid             not null,

  -- Display Metadata
  title             varchar(500)     not null,
  description       text             null      default null,

  -- Video Storage (existing `content-videos` bucket; signed URLs at runtime)
  storage_bucket    varchar(100)     not null  default 'content-videos',
  storage_path      text             not null,
  thumbnail_bucket  varchar(100)     null      default null,
  thumbnail_path    text             null      default null,
  duration_seconds  integer          null      default null,

  -- Lifecycle
  status            public.demo_class_status  not null  default 'draft',
  display_order     smallint         not null  default 0,

  -- Audit
  created_by        uuid             null      default null,
  created_at        timestamptz      not null  default now(),
  updated_at        timestamptz      not null  default now(),
  published_at      timestamptz      null      default null,

  -- Primary Key
  constraint pk_demo_classes primary key (demo_class_id),

  -- Foreign Keys
  constraint fk_demo_classes_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_demo_classes_stream
    foreign key (stream_id) references public.streams (stream_id)
    on delete restrict
    on update restrict,

  constraint fk_demo_classes_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- CHECK Constraints
  constraint ck_demo_classes_title_length check (char_length(title) >= 3),
  constraint ck_demo_classes_display_order check (display_order >= 0),
  constraint ck_demo_classes_storage_bucket_length check (char_length(storage_bucket) >= 1),
  constraint ck_demo_classes_storage_path_length check (char_length(storage_path) >= 1),
  constraint ck_demo_classes_duration_seconds check
    (duration_seconds is null or duration_seconds > 0),
  constraint ck_demo_classes_thumbnail_pair check
    ((thumbnail_bucket is null) = (thumbnail_path is null)),
  constraint ck_demo_classes_published_at check
    (
      (status in ('published', 'archived')
        and published_at is not null
        and published_at >= created_at)
      or
      (status = 'draft' and published_at is null)
    )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════

-- Student query: LATEST published demo for (institute, stream).
--   WHERE institute_id = ? AND stream_id = ? AND status = 'published'
--   ORDER BY created_at DESC LIMIT 1
-- Recency wins; display_order is retained only as an admin ordering hint
-- and does NOT participate in the student selection.
-- The index is built with created_at DESC so the ORDER BY is a forward scan.
create index if not exists idx_demo_classes_stream_latest
  on public.demo_classes (institute_id, stream_id, status, created_at desc);

-- Admin listing: all demos for an institute, filtered by status, newest first.
create index if not exists idx_demo_classes_institute_status
  on public.demo_classes (institute_id, status, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Updated_at Trigger
-- ════════════════════════════════════════════════════════════════════════════
-- set_updated_at() already exists from Domain 01 (migration 002) — do not
-- recreate. Same pattern used by the content table (migration 004).

create trigger trg_demo_classes_set_updated_at
  before update on public.demo_classes
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

alter table public.demo_classes enable row level security;

-- Students: read only published demos within their own institute.
-- Drafts and archived demos are invisible. No INSERT/UPDATE/DELETE for
-- students (no policy = no access).
drop policy if exists "Students can read published demo classes" on public.demo_classes;

create policy "Students can read published demo classes"
  on public.demo_classes
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and status = 'published'::public.demo_class_status
  );

comment on policy "Students can read published demo classes" on public.demo_classes is
  'Students can only read published demo classes for their own institute. '
  'Drafts and archived demos are never exposed.';

-- Admins: full CRUD for approved super_admin OR academic_admin only,
-- scoped to their own institute. Finance Admins, teachers, and students are
-- denied at the RLS layer (RBAC hardening per migration 075).
drop policy if exists "Admins have full access to demo classes" on public.demo_classes;

create policy "Admins have full access to demo classes"
  on public.demo_classes
  for all
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and (public.is_super_admin() or public.is_academic_admin())
  )
  with check (
    institute_id = public.get_my_institute_id()
    and (public.is_super_admin() or public.is_academic_admin())
  );

comment on policy "Admins have full access to demo classes" on public.demo_classes is
  'Full CRUD on demo classes for approved super/academic admins within their '
  'own institute. Finance admins cannot manage demo classes via RLS.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on table public.demo_classes is
  'Stream-scoped demo classes shown at the top of the student Home screen. '
  'Multiple demos per stream are supported; students read the latest '
  'published demo (created_at DESC, LIMIT 1 — recency wins). Video files '
  'live in the content-videos storage bucket; signed URLs are generated at '
  'request time. Independent of courses, chapters, subjects, batches, '
  'recordings, and payment/subscription tables.';

comment on column public.demo_classes.institute_id is
  'Owning institute. Denormalized for RLS and fast scoped queries.';

comment on column public.demo_classes.stream_id is
  'Exam stream this demo targets (FK → streams). JEE, NEET, CUET, etc.';

comment on column public.demo_classes.storage_bucket is
  'Supabase Storage bucket. Defaults to the existing content-videos bucket.';

comment on column public.demo_classes.storage_path is
  'Object key within storage_bucket. Signed URLs are generated dynamically '
  'from this path — never stored in the table.';

comment on column public.demo_classes.status is
  'Lifecycle: draft (admin-only) → published (visible to students) → '
  'archived (hidden from students, retained for admins).';

comment on column public.demo_classes.display_order is
  'Admin-defined ordering hint; lower values appear first. Does NOT affect '
  'the student latest-demo selection, which is ordered by created_at DESC.';

comment on column public.demo_classes.published_at is
  'UTC timestamp when the demo was published. Enforced by '
  'ck_demo_classes_published_at: published/archived rows must carry it, '
  'draft rows must not. Preserved through archive for the audit trail '
  '(migration 031 convention).';

comment on constraint ck_demo_classes_published_at on public.demo_classes is
  'published_at must be set when status is published or archived, and must '
  'be NULL for drafts. Preserves the publish audit trail through the '
  'published → archived transition (migration 031 convention).';
