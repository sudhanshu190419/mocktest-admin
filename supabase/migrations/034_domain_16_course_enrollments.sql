-- ============================================================================
-- Migration: 034 — Domain 16 Course Management — Enrollments
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: course_enrollments
--
-- Depends on: Migration 032 (courses table)
--             Migration 033 (course_teachers, course_batches, course_content)
--             Domain 01 (institutes, profiles, student_details)
--             Domain 07 (orders, order_items — for order_item_id FK)
--             Existing functions (set_updated_at, get_my_institute_id, etc.)
--
-- New Enums: None
--
-- Order:
--   1. Tables (dependency order: parent → child)
--   2. Indexes (after all tables exist)
--   3. Triggers (after all tables exist; set_updated_at already exists from Domain 1)
--   4. Comments
--   5. Row Level Security (RLS)
--
-- Reference: Domain 16 — Course Management Architecture
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Course commerce: course_enrollments (one row per student per course)

-- 1a. Table: course_enrollments
-- Records a student's enrollment in a course. One row per student per course.
-- An enrollment represents the student's right to access the course content,
-- live classes, and mock tests associated with the course. Enrollments may
-- be created via purchase (linked to an order item), admin grant, subscription
-- benefit, or free enrollment. Soft-delete via is_active + revoked_at.
create table public.course_enrollments (
  enrollment_id     uuid            not null  default gen_random_uuid(),
  course_id         uuid            not null,
  student_id        uuid            not null,
  institute_id      uuid            not null,
  order_item_id     uuid            null      default null,
  enrollment_type   varchar(20)     not null  default 'purchase',
  enrolled_at       timestamptz     not null  default now(),
  expires_at        timestamptz     null      default null,
  is_active         boolean         not null  default true,
  completed_at      timestamptz     null      default null,
  last_accessed_at  timestamptz     null      default null,
  progress_percent  numeric(5,2)    not null  default 0.00,
  revoked_at        timestamptz     null      default null,
  revoked_by        uuid            null      default null,
  revoked_reason    text            null      default null,
  created_at        timestamptz     not null  default now(),
  updated_at        timestamptz     not null  default now(),

  -- Primary Key
  constraint pk_course_enrollments primary key (enrollment_id),

  -- Foreign Keys
  constraint fk_course_enrollments_course
    foreign key (course_id) references public.courses (course_id)
    on delete restrict
    on update restrict,

  constraint fk_course_enrollments_student
    foreign key (student_id) references public.student_details (student_id)
    on delete restrict
    on update restrict,

  constraint fk_course_enrollments_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_course_enrollments_order_item
    foreign key (order_item_id) references public.order_items (item_id)
    on delete set null
    on update restrict,

  constraint fk_course_enrollments_revoked_by
    foreign key (revoked_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- Unique Constraints
  constraint uq_course_enrollments_course_student unique (course_id, student_id),

  -- CHECK Constraints
  constraint ck_course_enrollments_enrollment_type check (
    enrollment_type in ('purchase', 'admin_grant', 'subscription', 'free')
  ),
  constraint ck_course_enrollments_expires_at check
    (expires_at is null or expires_at > enrolled_at),
  constraint ck_course_enrollments_progress_percent check
    (progress_percent >= 0.00 and progress_percent <= 100.00),
  constraint ck_course_enrollments_completed_at check
    (completed_at is null or completed_at >= enrolled_at),
  constraint ck_course_enrollments_revocation check
    ((is_active = false and revoked_at is not null and revoked_reason is not null)
     or (is_active = true and revoked_at is null and revoked_reason is null and revoked_by is null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after their respective tables exist.
-- No duplicate indexes on columns already covered by UNIQUE constraints.
-- Partial indexes are used where specified in the schema.

-- 2a. course_enrollments indexes
-- Primary query: student dashboard — "My Courses"
create index if not exists idx_course_enrollments_student_active
  on public.course_enrollments (student_id, is_active);

-- Reverse query: admin dashboard — enrollment count and list per course
create index if not exists idx_course_enrollments_course_active
  on public.course_enrollments (course_id, is_active);

-- Continue learning / last accessed ordering (student dashboard)
create index if not exists idx_course_enrollments_student_last_accessed
  on public.course_enrollments (student_id, last_accessed_at desc nulls last)
  where is_active = true;

-- Background job: find time-limited enrollments nearing expiry
create index if not exists idx_course_enrollments_expires
  on public.course_enrollments (expires_at)
  where expires_at is not null and is_active = true;

-- Institute-wide enrollment analytics
create index if not exists idx_course_enrollments_institute_enrolled
  on public.course_enrollments (institute_id, enrolled_at desc);

-- Note: uq_course_enrollments_course_student covers (course_id, student_id) lookups.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CREATE TRIGGER Statements
-- ════════════════════════════════════════════════════════════════════════════
-- Only tables with an updated_at column receive the set_updated_at trigger.
-- set_updated_at() already exists from Domain 01 — do not recreate.

-- 3a. course_enrollments triggers
create trigger trg_course_enrollments_set_updated_at
  before update on public.course_enrollments
  for each row
  execute function public.set_updated_at();

-- 3b. last_accessed_at auto-updater
-- Automatically updates last_accessed_at whenever the enrollment record is
-- updated (e.g., when progress_percent changes during a study session).
-- This ensures the "Continue Learning" sort order stays current without
-- requiring explicit updates from the application layer.
create or replace function public.trgfn_course_enrollments_set_last_accessed()
returns trigger
language plpgsql
as $$
begin
  new.last_accessed_at = now();
  return new;
end;
$$;

create trigger trg_course_enrollments_set_last_accessed
  before update on public.course_enrollments
  for each row
  when (old.progress_percent is distinct from new.progress_percent)
  execute function public.trgfn_course_enrollments_set_last_accessed();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Table comments
comment on table public.course_enrollments is
  'Records a student''s enrollment in a course. One row per student per '
  'course. An enrollment represents the student''s right to access the '
  'course content, live classes, and mock tests associated with the course. '
  'Supports purchase, admin_grant, subscription, and free enrollment types. '
  'Revocation is explicit (is_active = false) rather than hard-delete — '
  'enrollment history is retained for audit and refund processing.' ;

-- 4b. Column comments
comment on column public.course_enrollments.enrollment_id is
  'Primary key. Generated via gen_random_uuid().';

comment on column public.course_enrollments.course_id is
  'FK to courses.course_id. The course the student is enrolled in. RESTRICT '
  'on delete — courses with active enrollments cannot be deleted.';

comment on column public.course_enrollments.student_id is
  'FK to student_details.student_id. The enrolled student. RESTRICT on '
  'delete — enrollment records are permanent audit records.';

comment on column public.course_enrollments.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation.';

comment on column public.course_enrollments.order_item_id is
  'FK to order_items.item_id. The specific order line item that created this '
  'enrollment. NULL for admin-granted, subscription-derived, or free '
  'enrollments. SET NULL on order item deletion preserves the enrollment.';

comment on column public.course_enrollments.enrollment_type is
  'How the enrollment was obtained. Values: purchase (paid via order), '
  'admin_grant (manual by admin), subscription (plan benefit), free (no '
  'payment required). VARCHAR intentionally — future enrollment models '
  'must not require a migration.';

comment on column public.course_enrollments.enrolled_at is
  'UTC timestamp when the enrollment was created. For paid enrollments, '
  'this is set when the payment is confirmed, not when the order was placed.';

comment on column public.course_enrollments.expires_at is
  'UTC timestamp when the enrollment access expires. NULL means perpetual '
  'access (typical for one-time course purchases). Set for time-limited '
  'subscription-derived or seasonal enrollments.';

comment on column public.course_enrollments.is_active is
  'When TRUE, the student has active access to the course. When FALSE, '
  'access is revoked. Enables temporary holds, suspensions, and permanent '
  'revocation while preserving the enrollment record.';

comment on column public.course_enrollments.completed_at is
  'UTC timestamp when the student completed all required course content. '
  'NULL until the course is fully completed. Must be >= enrolled_at.';

comment on column public.course_enrollments.last_accessed_at is
  'UTC timestamp of the student''s most recent access to any course resource. '
  'Auto-updated by trigger when progress_percent changes. Used for the '
  '"Continue Learning" sort order on the student dashboard.';

comment on column public.course_enrollments.progress_percent is
  'Denormalized completion percentage (0.00–100.00). Updated by a nightly '
  'batch job (not a real-time trigger) to avoid write contention during '
  'high-frequency study sessions. For near-real-time display, the frontend '
  'can compute progress directly from the course_progress table in a '
  'future phase.';

comment on column public.course_enrollments.revoked_at is
  'UTC timestamp when the enrollment was revoked. NULL unless is_active = '
  'FALSE. Must be set together with revoked_reason.';

comment on column public.course_enrollments.revoked_by is
  'FK to profiles. The admin or system that revoked the enrollment. '
  'SET NULL on profile soft-delete preserves the enrollment record.';

comment on column public.course_enrollments.revoked_reason is
  'Reason for revocation (e.g. refund_processed, subscription_lapsed, '
  'admin_revoke, payment_failure). NULL unless is_active = FALSE.';

comment on column public.course_enrollments.created_at is
  'UTC timestamp of row creation.';

comment on column public.course_enrollments.updated_at is
  'UTC timestamp of last modification. Trigger-maintained.';

-- 4c. Constraint comments
comment on constraint uq_course_enrollments_course_student on public.course_enrollments is
  'One enrollment per student per course. Prevents duplicate enrollment '
  'records. Re-enrollment updates the existing row rather than inserting '
  'a new one (e.g. re-activate after revocation).';

comment on constraint ck_course_enrollments_enrollment_type on public.course_enrollments is
  'Validates the enrollment source. Must be purchase, admin_grant, '
  'subscription, or free. VARCHAR allows future values without migration.';

comment on constraint ck_course_enrollments_expires_at on public.course_enrollments is
  'Expiry timestamp must always be after the enrollment timestamp. Prevents '
  'data entry errors where access expires before it was granted.';

comment on constraint ck_course_enrollments_revocation on public.course_enrollments is
  'revoked_at, revoked_by, and revoked_reason must be set together when '
  'and only when is_active = FALSE. Prevents half-written revocation states.';


-- ============================================================================
-- Helper: Prevent RLS recursion between course_teachers and course_enrollments
-- ============================================================================

create or replace function public.is_student_enrolled_in_course(
    p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.course_enrollments ce
        where ce.course_id = p_course_id
          and ce.student_id = public.get_my_student_id()
          and ce.is_active = true
    );
$$;

comment on function public.is_student_enrolled_in_course(uuid) is
'Returns TRUE when the current authenticated student is actively enrolled in the given course. SECURITY DEFINER avoids recursive RLS evaluation.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════
-- RLS policies for course_enrollments follow the same role-based pattern as
-- existing enrollment tables (student_pyq_purchases, batch_students).

-- 5a. Enable RLS
alter table public.course_enrollments enable row level security;

-- 5b. Policies
-- Admins: full CRUD within their institute
create policy "Admins have full access to course_enrollments"
  on public.course_enrollments
  for all
  to authenticated
  using (institute_id = public.get_my_institute_id() and public.is_admin())
  with check (institute_id = public.get_my_institute_id() and public.is_admin());

-- Students: read their own enrollments
create policy "Students can read their own course_enrollments"
  on public.course_enrollments
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

-- Teachers: read enrollments for courses they teach
-- Enables teacher dashboards showing enrolled student counts and progress
create policy "Teachers can read course_enrollments for their courses"
  on public.course_enrollments
  for select
  to authenticated
  using (exists (
    select 1 from public.course_teachers ct
    where ct.course_id = course_enrollments.course_id
    and ct.teacher_id = public.get_my_teacher_id()
  ));

-- 5c. Cross-table student read policies (moved from Migration 033)
-- These policies on junction tables reference course_enrollments, so they are
-- defined here after the course_enrollments table exists.

-- Students: read teachers for courses they are enrolled in
create policy "Students can read course_teachers for enrolled courses"
  on public.course_teachers
  for select
  to authenticated
  using (
      public.is_student_enrolled_in_course(course_id)
  );

-- Students: read batches for courses they are enrolled in
create policy "Students can read course_batches for enrolled courses"
  on public.course_batches
  for select
  to authenticated
  using (exists (
    select 1 from public.course_enrollments ce
    where ce.course_id = course_batches.course_id
    and ce.student_id = public.get_my_student_id()
  ));

-- Students: read content for courses they are enrolled in
create policy "Students can read course_content for enrolled courses"
  on public.course_content
  for select
  to authenticated
  using (exists (
    select 1 from public.course_enrollments ce
    where ce.course_id = course_content.course_id
    and ce.student_id = public.get_my_student_id()
  ));

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 034 Domain 16 Course Management Enrollments
-- ════════════════════════════════════════════════════════════════════════════
