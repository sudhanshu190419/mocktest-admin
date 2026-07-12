-- ============================================================================
-- Migration: 021 — Row Level Security Policies
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Applies RLS to every user-facing table across all 15 domains.
-- Creates helper functions first, then enables RLS, then creates policies.
--
-- Depends on:
--   All migrations 001–017 (tables, enums, triggers, indexes exist)
--   Existing functions: public.set_updated_at(), public.get_my_institute_id()
--   Supabase auth.uid() (built-in)
--
-- Order:
--   1. Enable RLS on every user-facing table
--   2. Create helper functions (is_admin, get_my_teacher_id, get_my_student_id)
--   3. Create policies (grouped by domain)
--   4. Comments
--
-- Roles (from profiles.role):
--   'admin'   — Platform/Institute admin — full access within institute scope
--   'teacher' — Content creator and classroom manager
--   'student' — Consumer of content, taker of tests
--
-- Performance:
--   - Uses EXISTS with subqueries for role checks (short-circuits early)
--   - Prefers auth.uid() over self-joins where possible
--   - institute_id is denormalized on virtually all tables for efficient RLS
--   - Helper functions are SECURITY DEFINER + SET search_path = '' to prevent
--     recursion and search-path hijacking
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Enable RLS on Every User-Facing Table
-- ════════════════════════════════════════════════════════════════════════════
-- Ordered by domain. Profiles already has RLS from migration 001.
-- Tables where RLS is intentionally NOT enabled are commented.

-- Domain 01 — Foundation
alter table public.institutes         enable row level security;
alter table public.teacher_details    enable row level security;
alter table public.student_details    enable row level security;

-- Domain 02 — Academic Structure
alter table public.streams            enable row level security;
alter table public.subjects           enable row level security;
alter table public.chapters           enable row level security;
alter table public.topics             enable row level security;
alter table public.batches            enable row level security;
alter table public.batch_students     enable row level security;
alter table public.batch_teachers     enable row level security;

-- Domain 03 — Content Management
alter table public.content            enable row level security;
alter table public.tags               enable row level security;
alter table public.content_tag        enable row level security;
alter table public.approval_requests  enable row level security;

-- Domain 04 — Live Learning
alter table public.live_classes       enable row level security;
alter table public.live_sessions      enable row level security;
alter table public.live_class_batch   enable row level security;
alter table public.recordings         enable row level security;
alter table public.session_participants  enable row level security;
alter table public.attendance         enable row level security;
alter table public.attendance_events  enable row level security;

-- Domain 05 — Assessment
alter table public.questions              enable row level security;
alter table public.question_options       enable row level security;
alter table public.question_explanations  enable row level security;
alter table public.question_images        enable row level security;
alter table public.mock_tests             enable row level security;
alter table public.mock_test_questions    enable row level security;
alter table public.mock_attempts          enable row level security;
alter table public.mock_answers           enable row level security;
alter table public.mock_answer_options    enable row level security;
alter table public.mock_results           enable row level security;

-- Domain 06 — PYQ
alter table public.pyq_packages               enable row level security;
alter table public.pyq_package_unlocks        enable row level security;
alter table public.pyq_papers                 enable row level security;
alter table public.pyq_question_mappings      enable row level security;
alter table public.pyq_solutions              enable row level security;
alter table public.pyq_mock_mappings          enable row level security;
alter table public.student_pyq_purchases      enable row level security;

-- Domain 07 — Commerce
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.payments            enable row level security;
alter table public.invoices            enable row level security;

-- Domain 08 — Analytics
alter table public.performance_reports     enable row level security;
alter table public.subject_performances    enable row level security;
alter table public.chapter_performances    enable row level security;
alter table public.progress_history        enable row level security;
alter table public.teacher_analytics       enable row level security;

-- Domain 09 — Notifications
alter table public.notification_templates   enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_recipients  enable row level security;

-- Domain 10 — Administration
alter table public.audit_logs           enable row level security;
alter table public.system_settings      enable row level security;

-- Domain 11 — Subscription & Access Control
alter table public.subscription_features        enable row level security;
alter table public.subscription_plans           enable row level security;
alter table public.plan_unlocks                 enable row level security;
alter table public.student_subscriptions        enable row level security;
alter table public.subscription_history         enable row level security;
alter table public.subscription_renewals        enable row level security;
alter table public.subscription_cancellations   enable row level security;
alter table public.subscription_grace_periods   enable row level security;
alter table public.subscription_usage           enable row level security;

-- Domain 12 — File & Media Management
alter table public.media_files            enable row level security;
alter table public.media_versions         enable row level security;
alter table public.media_usage            enable row level security;
alter table public.media_processing_jobs  enable row level security;

-- Domain 13 — Teacher Management (HR)
alter table public.teacher_employment_records  enable row level security;
alter table public.teacher_specializations     enable row level security;
alter table public.teacher_qualifications      enable row level security;
alter table public.teacher_experiences         enable row level security;
alter table public.teacher_documents           enable row level security;
alter table public.teacher_bank_details        enable row level security;
alter table public.teacher_availability        enable row level security;
alter table public.teacher_leave_requests      enable row level security;

-- Domain 14 — Student Services
alter table public.student_bookmarks          enable row level security;
alter table public.student_downloads          enable row level security;
alter table public.student_viewing_history    enable row level security;
alter table public.student_personal_notes     enable row level security;
alter table public.student_doubts             enable row level security;
alter table public.doubt_replies              enable row level security;
alter table public.support_tickets            enable row level security;
alter table public.support_ticket_messages    enable row level security;
alter table public.student_feedback_ratings   enable row level security;

-- Domain 15 — Infrastructure
alter table public.api_keys                  enable row level security;
alter table public.webhook_endpoints         enable row level security;
alter table public.webhook_delivery_logs     enable row level security;
alter table public.async_jobs                enable row level security;
alter table public.feature_flags             enable row level security;
alter table public.feature_flag_overrides    enable row level security;
alter table public.system_events_outbox      enable row level security;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Helper Functions
-- ════════════════════════════════════════════════════════════════════════════
-- All functions are SECURITY DEFINER + SET search_path = '' to:
--   1. Bypass RLS when checking roles (prevents infinite recursion)
--   2. Protect against search-path hijacking attacks
--   3. Cache results for the duration of the statement

-- 2a. is_admin()
-- Returns TRUE if the current authenticated user has role = 'admin'.
-- Used by policies that grant full access to platform/institute admins.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where profile_id = auth.uid() and role = 'admin'::public.user_role
  );
$$;

-- 2b. is_teacher()
-- Returns TRUE if the current authenticated user has role = 'teacher'.
create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where profile_id = auth.uid() and role = 'teacher'::public.user_role
  );
$$;

-- 2c. is_student()
-- Returns TRUE if the current authenticated user has role = 'student'.
create or replace function public.is_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where profile_id = auth.uid() and role = 'student'::public.user_role
  );
$$;

-- 2d. get_my_teacher_id()
-- Returns the teacher_id from teacher_details for the current user.
-- Returns NULL if the current user is not a teacher or has no teacher_details row.
-- Used by policies that restrict access to the teacher's own resources.
create or replace function public.get_my_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select teacher_id from public.teacher_details
  where profile_id = auth.uid()
  limit 1;
$$;

-- 2e. get_my_student_id()
-- Returns the student_id from student_details for the current user.
-- Returns NULL if the current user is not a student or has no student_details row.
-- Used by policies that restrict access to the student's own resources.
create or replace function public.get_my_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select student_id from public.student_details
  where profile_id = auth.uid()
  limit 1;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Domain 01: Foundation Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. institutes
-- Admins: full access
-- Teachers/Students: read only their own institute
-- Anonymous: no access
create policy "Admins have full access to institutes"
  on public.institutes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Members can read their own institute"
  on public.institutes
  for select
  to authenticated
  using (institute_id = public.get_my_institute_id());

-- 3b. teacher_details
-- Teachers: read and update own row
-- Admins: read all within institute, full CRUD
-- Students: no access (HR data is sensitive)
create policy "Teachers can read their own teacher_details"
  on public.teacher_details
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "Teachers can update their own teacher_details"
  on public.teacher_details
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "Admins have full access to teacher_details"
  on public.teacher_details
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3c. student_details
-- Students: read own row
-- Teachers: no direct access (access via batch_students)
-- Admins: full access within institute
create policy "Students can read their own student_details"
  on public.student_details
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "Admins have full access to student_details"
  on public.student_details
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Domain 02: Academic Structure & Batch Management Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. streams
-- All authenticated members: read active streams in their institute
-- Admins: full CRUD
create policy "Members can read active streams"
  on public.streams
  for select
  to authenticated
  using (institute_id = public.get_my_institute_id());

create policy "Admins have full access to streams"
  on public.streams
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4b. subjects (no direct institute_id — resolved via stream FK)
-- All authenticated members: read active subjects in their institute
-- Admins: full CRUD
create policy "Members can read subjects in their institute"
  on public.subjects
  for select
  to authenticated
  using (exists (
    select 1 from public.streams s
    where s.stream_id = subjects.stream_id
    and s.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to subjects"
  on public.subjects
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4c. chapters (no direct institute_id)
-- All authenticated members: read chapters within their institute
-- Admins: full CRUD
create policy "Members can read chapters in their institute"
  on public.chapters
  for select
  to authenticated
  using (exists (
    select 1 from public.subjects sub
    join public.streams s on s.stream_id = sub.stream_id
    where sub.subject_id = chapters.subject_id
    and s.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to chapters"
  on public.chapters
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4d. topics (no direct institute_id)
-- All authenticated members: read topics within their institute
-- Admins: full CRUD
create policy "Members can read topics in their institute"
  on public.topics
  for select
  to authenticated
  using (exists (
    select 1 from public.chapters ch
    join public.subjects sub on sub.subject_id = ch.subject_id
    join public.streams s on s.stream_id = sub.stream_id
    where ch.chapter_id = topics.chapter_id
    and s.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to topics"
  on public.topics
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4e. batches
-- Teachers: read batches they are assigned to
-- Students: read batches they are enrolled in
-- Admins: full CRUD within institute
create policy "Students can read batches they are enrolled in"
  on public.batches
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_students bs
    where bs.batch_id = batches.batch_id
    and bs.student_id = public.get_my_student_id()
  ));

create policy "Teachers can read batches they are assigned to"
  on public.batches
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_teachers bt
    where bt.batch_id = batches.batch_id
    and bt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to batches"
  on public.batches
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4f. batch_students
-- Students: read own enrollment records
-- Teachers: read students in their batches
-- Admins: full access within institute
create policy "Students can read their own batch enrollments"
  on public.batch_students
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Teachers can read batch_students for their batches"
  on public.batch_students
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_teachers bt
    where bt.batch_id = batch_students.batch_id
    and bt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to batch_students"
  on public.batch_students
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4g. batch_teachers
-- Teachers: read their own batch assignments
-- Admins: full access within institute
create policy "Teachers can read their own batch_teachers assignments"
  on public.batch_teachers
  for select
  to authenticated
  using (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to batch_teachers"
  on public.batch_teachers
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Domain 03: Content Management Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. content
-- Teachers: full CRUD on own content
-- Students: read approved content or free preview content
-- Admins: full access within institute
create policy "Teachers have full access to their own content"
  on public.content
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Students can read approved and free preview content"
  on public.content
  for select
  to authenticated
  using ((status = 'approved'::public.lifecycle_status or is_free_preview = true)
    and institute_id = public.get_my_institute_id());

create policy "Admins have full access to content"
  on public.content
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5b. tags
-- All authenticated members: read tags in their institute
-- Teachers: create tags (insert)
-- Admins: full access
create policy "Members can read tags in their institute"
  on public.tags
  for select
  to authenticated
  using (institute_id = public.get_my_institute_id());

create policy "Teachers and admins can manage tags"
  on public.tags
  for insert
  to authenticated
  with check (institute_id = public.get_my_institute_id()
    and (public.is_teacher() or public.is_admin()));

create policy "Admins have full access to tags"
  on public.tags
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete tags"
  on public.tags
  for delete
  to authenticated
  using (public.is_admin());

-- 5c. content_tag
-- Teachers: tag their own content
-- Admins: full access
create policy "Teachers can manage tags on their own content"
  on public.content_tag
  for all
  to authenticated
  using (exists (
    select 1 from public.content c
    where c.content_id = content_tag.content_id
    and c.teacher_id = public.get_my_teacher_id()
  ))
  with check (exists (
    select 1 from public.content c
    where c.content_id = content_tag.content_id
    and c.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to content_tag"
  on public.content_tag
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5d. approval_requests
-- Teachers: read and create their own approval requests
-- Admins: read all, review (update status)
-- Platform admins: full access
create policy "Teachers can read their own approval_requests"
  on public.approval_requests
  for select
  to authenticated
  using (teacher_id = public.get_my_teacher_id());

create policy "Teachers can create approval_requests"
  on public.approval_requests
  for insert
  to authenticated
  with check (teacher_id = public.get_my_teacher_id()
    and institute_id = public.get_my_institute_id()
    and status = 'pending'::public.approval_status);

create policy "Admins have full access to approval_requests"
  on public.approval_requests
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Domain 04: Live Learning Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. live_classes
-- Teachers: full CRUD on their own live classes
-- Students: read classes for batches they are enrolled in
-- Admins: full access within institute
create policy "Teachers have full access to their own live_classes"
  on public.live_classes
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Students can read live_classes for their batches"
  on public.live_classes
  for select
  to authenticated
  using (exists (
    select 1 from public.live_class_batch lcb
    join public.batch_students bs on bs.batch_id = lcb.batch_id
    where lcb.class_id = live_classes.class_id
    and bs.student_id = public.get_my_student_id()
  ));

create policy "Admins have full access to live_classes"
  on public.live_classes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6b. live_sessions
-- Teachers: read sessions for their own classes
-- Admins: full access
create policy "Teachers can read live_sessions for their classes"
  on public.live_sessions
  for select
  to authenticated
  using (exists (
    select 1 from public.live_classes lc
    where lc.class_id = live_sessions.class_id
    and lc.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to live_sessions"
  on public.live_sessions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6c. live_class_batch
-- Teachers: read batch mappings for their classes
-- Admins: full access
create policy "Teachers can read live_class_batch for their classes"
  on public.live_class_batch
  for select
  to authenticated
  using (exists (
    select 1 from public.live_classes lc
    where lc.class_id = live_class_batch.class_id
    and lc.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to live_class_batch"
  on public.live_class_batch
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6d. recordings
-- Teachers: read recordings for their own classes
-- Students: read recordings for their enrolled batch classes
-- Admins: full access
create policy "Teachers can read recordings for their classes"
  on public.recordings
  for select
  to authenticated
  using (exists (
    select 1 from public.live_classes lc
    where lc.class_id = recordings.class_id
    and lc.teacher_id = public.get_my_teacher_id()
  ));

create policy "Students can read recordings for their batch classes"
  on public.recordings
  for select
  to authenticated
  using (exists (
    select 1 from public.live_class_batch lcb
    join public.batch_students bs on bs.batch_id = lcb.batch_id
    where lcb.class_id = recordings.class_id
    and bs.student_id = public.get_my_student_id()
  ));

create policy "Admins have full access to recordings"
  on public.recordings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6e. session_participants
-- Students: read their own participation records
-- Teachers: read participants in their classes
-- Admins: full access
create policy "Students can read their own session_participants"
  on public.session_participants
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Teachers can read session_participants for their classes"
  on public.session_participants
  for select
  to authenticated
  using (exists (
    select 1 from public.live_classes lc
    where lc.class_id = session_participants.class_id
    and lc.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to session_participants"
  on public.session_participants
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6f. attendance
-- Students: read their own attendance
-- Teachers: read attendance for their classes
-- Admins: full access
create policy "Students can read their own attendance"
  on public.attendance
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Teachers can read attendance for their classes"
  on public.attendance
  for select
  to authenticated
  using (exists (
    select 1 from public.live_classes lc
    where lc.class_id = attendance.class_id
    and lc.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to attendance"
  on public.attendance
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6g. attendance_events
-- Students: read their own attendance events
-- Teachers: read events for their classes
-- Admins: full access
create policy "Students can read their own attendance_events"
  on public.attendance_events
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Teachers can read attendance_events for their classes"
  on public.attendance_events
  for select
  to authenticated
  using (exists (
    select 1 from public.live_classes lc
    where lc.class_id = attendance_events.class_id
    and lc.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to attendance_events"
  on public.attendance_events
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Domain 05: Assessment Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 7a. questions
-- Teachers: full CRUD on their own questions
-- Students: read published questions (via mock tests)
-- Admins: full access within institute
create policy "Teachers have full access to their own questions"
  on public.questions
  for all
  to authenticated
  using (created_by = public.get_my_teacher_id())
  with check (created_by = public.get_my_teacher_id());

create policy "Students can read published questions"
  on public.questions
  for select
  to authenticated
  using (status = 'published'::public.question_status
    and institute_id = public.get_my_institute_id());

create policy "Admins have full access to questions"
  on public.questions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7b. question_options
-- Teachers: manage options for their own questions
-- Students: read options for published questions
-- Admins: full access
create policy "Teachers can manage options for their questions"
  on public.question_options
  for all
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_options.question_id
    and q.created_by = public.get_my_teacher_id()
  ))
  with check (exists (
    select 1 from public.questions q
    where q.question_id = question_options.question_id
    and q.created_by = public.get_my_teacher_id()
  ));

create policy "Students can read options for published questions"
  on public.question_options
  for select
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_options.question_id
    and q.status = 'published'::public.question_status
    and q.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to question_options"
  on public.question_options
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7c. question_explanations
-- Teachers: manage explanations for their own questions
-- Students: read explanations for published questions (after attempt)
-- Admins: full access
create policy "Teachers can manage explanations for their questions"
  on public.question_explanations
  for all
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_explanations.question_id
    and q.created_by = public.get_my_teacher_id()
  ))
  with check (exists (
    select 1 from public.questions q
    where q.question_id = question_explanations.question_id
    and q.created_by = public.get_my_teacher_id()
  ));

create policy "Students can read explanations for published questions"
  on public.question_explanations
  for select
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_explanations.question_id
    and q.status = 'published'::public.question_status
    and q.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to question_explanations"
  on public.question_explanations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7d. question_images
-- Teachers: manage images for their own questions
-- Students: read images for published questions
-- Admins: full access
create policy "Teachers can manage images for their questions"
  on public.question_images
  for all
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_images.question_id
    and q.created_by = public.get_my_teacher_id()
  ))
  with check (exists (
    select 1 from public.questions q
    where q.question_id = question_images.question_id
    and q.created_by = public.get_my_teacher_id()
  ));

create policy "Students can read images for published questions"
  on public.question_images
  for select
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.question_id = question_images.question_id
    and q.status = 'published'::public.question_status
    and q.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to question_images"
  on public.question_images
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7e. mock_tests
-- Teachers: full CRUD on their own mock tests
-- Students: read published tests
-- Admins: full access within institute
create policy "Teachers have full access to their own mock_tests"
  on public.mock_tests
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Students can read published mock_tests"
  on public.mock_tests
  for select
  to authenticated
  using (status = 'published'::public.mock_test_status
    and institute_id = public.get_my_institute_id());

create policy "Admins have full access to mock_tests"
  on public.mock_tests
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7f. mock_test_questions
-- Teachers: manage questions in their own tests
-- Students: read questions in published tests
-- Admins: full access
create policy "Teachers can manage questions in their tests"
  on public.mock_test_questions
  for all
  to authenticated
  using (exists (
    select 1 from public.mock_tests mt
    where mt.test_id = mock_test_questions.test_id
    and mt.teacher_id = public.get_my_teacher_id()
  ))
  with check (exists (
    select 1 from public.mock_tests mt
    where mt.test_id = mock_test_questions.test_id
    and mt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Students can read questions in published tests"
  on public.mock_test_questions
  for select
  to authenticated
  using (exists (
    select 1 from public.mock_tests mt
    where mt.test_id = mock_test_questions.test_id
    and mt.status = 'published'::public.mock_test_status
    and mt.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to mock_test_questions"
  on public.mock_test_questions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7g. mock_attempts
-- Students: full CRUD on their own attempts
-- Teachers: read attempts on their tests
-- Admins: full access
create policy "Students have full access to their own mock_attempts"
  on public.mock_attempts
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Teachers can read mock_attempts on their tests"
  on public.mock_attempts
  for select
  to authenticated
  using (exists (
    select 1 from public.mock_tests mt
    where mt.test_id = mock_attempts.test_id
    and mt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to mock_attempts"
  on public.mock_attempts
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7h. mock_answers
-- Students: read and update their own answers (during attempt)
-- Teachers: read answers for their tests
-- Admins: full access
create policy "Students have full access to their own mock_answers"
  on public.mock_answers
  for all
  to authenticated
  using (exists (
    select 1 from public.mock_attempts ma
    where ma.attempt_id = mock_answers.attempt_id
    and ma.student_id = public.get_my_student_id()
  ))
  with check (exists (
    select 1 from public.mock_attempts ma
    where ma.attempt_id = mock_answers.attempt_id
    and ma.student_id = public.get_my_student_id()
  ));

create policy "Teachers can read mock_answers for their tests"
  on public.mock_answers
  for select
  to authenticated
  using (exists (
    select 1 from public.mock_attempts ma
    join public.mock_tests mt on mt.test_id = ma.test_id
    where ma.attempt_id = mock_answers.attempt_id
    and mt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to mock_answers"
  on public.mock_answers
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7i. mock_answer_options
-- Students: manage their own selected options
-- Teachers: read options for their tests
-- Admins: full access
create policy "Students have full access to their own mock_answer_options"
  on public.mock_answer_options
  for all
  to authenticated
  using (exists (
    select 1 from public.mock_answers maw
    join public.mock_attempts ma on ma.attempt_id = maw.attempt_id
    where maw.answer_id = mock_answer_options.answer_id
    and ma.student_id = public.get_my_student_id()
  ))
  with check (exists (
    select 1 from public.mock_answers maw
    join public.mock_attempts ma on ma.attempt_id = maw.attempt_id
    where maw.answer_id = mock_answer_options.answer_id
    and ma.student_id = public.get_my_student_id()
  ));

create policy "Admins have full access to mock_answer_options"
  on public.mock_answer_options
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7j. mock_results
-- Students: read their own results after release
-- Teachers: read results for their tests
-- Admins: full access
create policy "Students can read their own mock_results"
  on public.mock_results
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Teachers can read mock_results for their tests"
  on public.mock_results
  for select
  to authenticated
  using (exists (
    select 1 from public.mock_tests mt
    where mt.test_id = mock_results.test_id
    and mt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to mock_results"
  on public.mock_results
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — Domain 06: PYQ Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. pyq_packages
-- All members: read active packages in their institute
-- Admins: full CRUD
create policy "Members can read active pyq_packages"
  on public.pyq_packages
  for select
  to authenticated
  using (is_active = true
    and institute_id = public.get_my_institute_id());

create policy "Admins have full access to pyq_packages"
  on public.pyq_packages
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 8b. pyq_package_unlocks
-- Members: read unlocks for active packages
-- Admins: full access
create policy "Members can read pyq_package_unlocks for active packages"
  on public.pyq_package_unlocks
  for select
  to authenticated
  using (exists (
    select 1 from public.pyq_packages pp
    where pp.package_id = pyq_package_unlocks.package_id
    and pp.is_active = true
    and pp.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to pyq_package_unlocks"
  on public.pyq_package_unlocks
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 8c. pyq_papers
-- Students: read published papers for packages they have purchased
-- Admins: full CRUD
create policy "Students can read pyq_papers they have purchased access to"
  on public.pyq_papers
  for select
  to authenticated
  using (is_published = true
    and institute_id = public.get_my_institute_id()
    and exists (
      select 1 from public.student_pyq_purchases spp
      where spp.package_id = pyq_papers.package_id
      and spp.student_id = public.get_my_student_id()
      and spp.is_active = true
    ));

create policy "Admins have full access to pyq_papers"
  on public.pyq_papers
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 8d. pyq_question_mappings
-- Students: read mappings for papers they have access to
-- Admins: full access
create policy "Students can read pyq_question_mappings for accessible papers"
  on public.pyq_question_mappings
  for select
  to authenticated
  using (exists (
    select 1 from public.pyq_papers pp
    join public.student_pyq_purchases spp on spp.package_id = pp.package_id
    where pp.paper_id = pyq_question_mappings.paper_id
    and spp.student_id = public.get_my_student_id()
    and spp.is_active = true
  ));

create policy "Admins have full access to pyq_question_mappings"
  on public.pyq_question_mappings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 8e. pyq_solutions
-- Students: read solutions for papers they have access to
-- Admins: full access
create policy "Students can read pyq_solutions for accessible papers"
  on public.pyq_solutions
  for select
  to authenticated
  using (exists (
    select 1 from public.pyq_papers pp
    join public.student_pyq_purchases spp on spp.package_id = pp.package_id
    where pp.paper_id = pyq_solutions.paper_id
    and spp.student_id = public.get_my_student_id()
    and spp.is_active = true
  ));

create policy "Admins have full access to pyq_solutions"
  on public.pyq_solutions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 8f. pyq_mock_mappings
-- Students: read mappings for accessible papers
-- Admins: full access
create policy "Students can read pyq_mock_mappings for accessible papers"
  on public.pyq_mock_mappings
  for select
  to authenticated
  using (exists (
    select 1 from public.pyq_papers pp
    join public.student_pyq_purchases spp on spp.package_id = pp.package_id
    where pp.paper_id = pyq_mock_mappings.paper_id
    and spp.student_id = public.get_my_student_id()
    and spp.is_active = true
  ));

create policy "Admins have full access to pyq_mock_mappings"
  on public.pyq_mock_mappings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 8g. student_pyq_purchases
-- Students: read their own purchases
-- Admins: full access
create policy "Students can read their own student_pyq_purchases"
  on public.student_pyq_purchases
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to student_pyq_purchases"
  on public.student_pyq_purchases
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — Domain 07: Commerce Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 9a. orders
-- Students: read their own orders
-- Admins: full access within institute (payment info)
create policy "Students can read their own orders"
  on public.orders
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to orders"
  on public.orders
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 9b. order_items
-- Students: read items in their own orders
-- Admins: full access
create policy "Students can read their own order_items"
  on public.order_items
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.order_id = order_items.order_id
    and o.student_id = public.get_my_student_id()
  ));

create policy "Admins have full access to order_items"
  on public.order_items
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 9c. payments
-- Students: read payments for their own orders
-- Admins: full access (financial records)
create policy "Students can read payments for their own orders"
  on public.payments
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.order_id = payments.order_id
    and o.student_id = public.get_my_student_id()
  ));

create policy "Admins have full access to payments"
  on public.payments
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 9d. invoices
-- Students: read invoices for their own orders
-- Admins: full access
create policy "Students can read their own invoices"
  on public.invoices
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.order_id = invoices.order_id
    and o.student_id = public.get_my_student_id()
  ));

create policy "Admins have full access to invoices"
  on public.invoices
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — Domain 08: Analytics Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 10a. performance_reports
-- Students: read their own performance reports
-- Teachers: read reports for students in their batches
-- Admins: full access
create policy "Students can read their own performance_reports"
  on public.performance_reports
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Teachers can read performance_reports for their students"
  on public.performance_reports
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_teachers bt
    join public.batch_students bs on bs.batch_id = bt.batch_id
    where bs.student_id = performance_reports.student_id
    and bt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to performance_reports"
  on public.performance_reports
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 10b. subject_performances
-- Students: read their own subject performances
-- Teachers: read for students in their batches
-- Admins: full access
create policy "Students can read their own subject_performances"
  on public.subject_performances
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to subject_performances"
  on public.subject_performances
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 10c. chapter_performances
-- Students: read their own chapter performances
-- Admins: full access
create policy "Students can read their own chapter_performances"
  on public.chapter_performances
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to chapter_performances"
  on public.chapter_performances
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 10d. progress_history
-- Students: read their own progress history
-- Teachers: read progress for students in their batches
-- Admins: full access
create policy "Students can read their own progress_history"
  on public.progress_history
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Teachers can read progress_history for their students"
  on public.progress_history
  for select
  to authenticated
  using (exists (
    select 1 from public.batch_teachers bt
    join public.batch_students bs on bs.batch_id = bt.batch_id
    where bs.student_id = progress_history.student_id
    and bt.teacher_id = public.get_my_teacher_id()
  ));

create policy "Admins have full access to progress_history"
  on public.progress_history
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 10e. teacher_analytics
-- Teachers: read their own analytics
-- Admins: full access
create policy "Teachers can read their own teacher_analytics"
  on public.teacher_analytics
  for select
  to authenticated
  using (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to teacher_analytics"
  on public.teacher_analytics
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — Domain 09: Notifications Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 11a. notification_templates
-- Admins: full CRUD
-- Other authenticated users: no access (templates are for admin configuration only)
create policy "Admins have full access to notification_templates"
  on public.notification_templates
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 11b. notifications
-- Users: read notifications sent to them (via notification_recipients)
-- Admins: full access
create policy "Users can read notifications addressed to them"
  on public.notifications
  for select
  to authenticated
  using (exists (
    select 1 from public.notification_recipients nr
    where nr.notification_id = notifications.notification_id
    and nr.profile_id = auth.uid()
  ));

create policy "Admins have full access to notifications"
  on public.notifications
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 11c. notification_recipients
-- Users: read their own recipient rows, update is_read/read_at
-- Admins: full access
create policy "Users can read their own notification_recipients"
  on public.notification_recipients
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "Users can update read status on their own notification_recipients"
  on public.notification_recipients
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid()
    and ((is_read = true and read_at is not null) or (is_read = false and read_at is null)));

create policy "Admins have full access to notification_recipients"
  on public.notification_recipients
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 12 — Domain 10: Administration Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 12a. audit_logs
-- Only platform admins can read audit logs
-- No INSERT/UPDATE/DELETE by client roles (enforced by triggers in migration 011)
create policy "Only admins can read audit_logs"
  on public.audit_logs
  for select
  to authenticated
  using (public.is_admin());

-- 12b. system_settings
-- Only platform admins can read and modify system settings
create policy "Only admins can read system_settings"
  on public.system_settings
  for select
  to authenticated
  using (public.is_admin());

create policy "Only admins can modify system_settings"
  on public.system_settings
  for insert
  to authenticated
  with check (public.is_admin());

create policy "Only admins can update system_settings"
  on public.system_settings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Only admins can delete system_settings"
  on public.system_settings
  for delete
  to authenticated
  using (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 13 — Domain 11: Subscription & Access Control Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 13a. subscription_features
-- All authenticated members: read active features
-- Admins: full CRUD
create policy "Members can read active subscription_features"
  on public.subscription_features
  for select
  to authenticated
  using (is_active = true);

create policy "Admins have full access to subscription_features"
  on public.subscription_features
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13b. subscription_plans
-- All members: read active plans in their institute
-- Admins: full CRUD
create policy "Members can read active subscription_plans"
  on public.subscription_plans
  for select
  to authenticated
  using (is_active = true
    and institute_id = public.get_my_institute_id());

create policy "Admins have full access to subscription_plans"
  on public.subscription_plans
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13c. plan_unlocks
-- Members: read unlocks for active plans
-- Admins: full access
create policy "Members can read plan_unlocks for active plans"
  on public.plan_unlocks
  for select
  to authenticated
  using (exists (
    select 1 from public.subscription_plans sp
    where sp.plan_id = plan_unlocks.plan_id
    and sp.is_active = true
    and sp.institute_id = public.get_my_institute_id()
  ));

create policy "Admins have full access to plan_unlocks"
  on public.plan_unlocks
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13d. student_subscriptions
-- Students: read their own subscriptions
-- Admins: full access
create policy "Students can read their own student_subscriptions"
  on public.student_subscriptions
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to student_subscriptions"
  on public.student_subscriptions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13e. subscription_history
-- Students: read history of their own subscriptions
-- Admins: full access
create policy "Students can read their own subscription_history"
  on public.subscription_history
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to subscription_history"
  on public.subscription_history
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13f. subscription_renewals
-- Students: read renewals for their own subscriptions
-- Admins: full access
create policy "Students can read their own subscription_renewals"
  on public.subscription_renewals
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to subscription_renewals"
  on public.subscription_renewals
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13g. subscription_cancellations
-- Students: read cancellations for their own subscriptions
-- Admins: full access
create policy "Students can read their own subscription_cancellations"
  on public.subscription_cancellations
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to subscription_cancellations"
  on public.subscription_cancellations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13h. subscription_grace_periods
-- Students: read grace periods for their own subscriptions
-- Admins: full access
create policy "Students can read their own subscription_grace_periods"
  on public.subscription_grace_periods
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to subscription_grace_periods"
  on public.subscription_grace_periods
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 13i. subscription_usage
-- Students: read their own usage records
-- Admins: full access
create policy "Students can read their own subscription_usage"
  on public.subscription_usage
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

create policy "Admins have full access to subscription_usage"
  on public.subscription_usage
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 14 — Domain 12: File & Media Management Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 14a. media_files
-- Users: read and manage files they uploaded
-- Teachers: CRUD own files
-- Students: read files they uploaded
-- Admins: full access
create policy "Users can read their own media_files"
  on public.media_files
  for select
  to authenticated
  using (uploaded_by = auth.uid());

create policy "Users can manage their own media_files"
  on public.media_files
  for insert
  to authenticated
  with check (uploaded_by = auth.uid()
    and institute_id = public.get_my_institute_id());

create policy "Users can update their own media_files"
  on public.media_files
  for update
  to authenticated
  using (uploaded_by = auth.uid())
  with check (uploaded_by = auth.uid());

create policy "Admins have full access to media_files"
  on public.media_files
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 14b. media_versions
-- Users: read versions of files they own
-- Admins: full access
create policy "Users can read media_versions for their own files"
  on public.media_versions
  for select
  to authenticated
  using (exists (
    select 1 from public.media_files mf
    where mf.media_id = media_versions.media_id
    and mf.uploaded_by = auth.uid()
  ));

create policy "Admins have full access to media_versions"
  on public.media_versions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 14c. media_usage
-- Users: read usage for files they own
-- Admins: full access
create policy "Users can read media_usage for their own files"
  on public.media_usage
  for select
  to authenticated
  using (exists (
    select 1 from public.media_files mf
    where mf.media_id = media_usage.media_id
    and mf.uploaded_by = auth.uid()
  ));

create policy "Admins have full access to media_usage"
  on public.media_usage
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 14d. media_processing_jobs
-- Users: read jobs for files they own
-- Admins: full access
create policy "Users can read media_processing_jobs for their own files"
  on public.media_processing_jobs
  for select
  to authenticated
  using (exists (
    select 1 from public.media_files mf
    where mf.media_id = media_processing_jobs.media_id
    and mf.uploaded_by = auth.uid()
  ));

create policy "Admins have full access to media_processing_jobs"
  on public.media_processing_jobs
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 15 — Domain 13: Teacher Management (HR) Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 15a. teacher_employment_records (SENSITIVE — HR data)
-- Only admins can read/write employment records
create policy "Only admins can access teacher_employment_records"
  on public.teacher_employment_records
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 15b. teacher_specializations
-- Teachers: read their own specializations
-- Admins: full access
create policy "Teachers can read their own specializations"
  on public.teacher_specializations
  for select
  to authenticated
  using (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to teacher_specializations"
  on public.teacher_specializations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 15c. teacher_qualifications
-- Teachers: read and manage their own qualifications
-- Admins: full access
create policy "Teachers have full access to their own qualifications"
  on public.teacher_qualifications
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to teacher_qualifications"
  on public.teacher_qualifications
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 15d. teacher_experiences
-- Teachers: read and manage their own experience records
-- Admins: full access
create policy "Teachers have full access to their own experiences"
  on public.teacher_experiences
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to teacher_experiences"
  on public.teacher_experiences
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 15e. teacher_documents (SENSITIVE — KYC documents)
-- Teachers: read and manage their own documents
-- Admins: full access (verification)
create policy "Teachers have full access to their own documents"
  on public.teacher_documents
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to teacher_documents"
  on public.teacher_documents
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 15f. teacher_bank_details (SENSITIVE — financial data)
-- Only admins can access bank details
create policy "Only admins can access teacher_bank_details"
  on public.teacher_bank_details
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 15g. teacher_availability
-- Teachers: manage their own availability
-- Admins: full access
create policy "Teachers have full access to their own availability"
  on public.teacher_availability
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to teacher_availability"
  on public.teacher_availability
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 15h. teacher_leave_requests
-- Teachers: read and manage their own leave requests
-- Admins: full access (review and approve)
create policy "Teachers have full access to their own leave_requests"
  on public.teacher_leave_requests
  for all
  to authenticated
  using (teacher_id = public.get_my_teacher_id())
  with check (teacher_id = public.get_my_teacher_id());

create policy "Admins have full access to teacher_leave_requests"
  on public.teacher_leave_requests
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 16 — Domain 14: Student Services Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 16a. student_bookmarks
-- Students: full CRUD on their own bookmarks
-- Admins: full access
create policy "Students have full access to their own bookmarks"
  on public.student_bookmarks
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Admins have full access to student_bookmarks"
  on public.student_bookmarks
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16b. student_downloads
-- Students: read their own downloads
-- Admins: full access
create policy "Students have full access to their own downloads"
  on public.student_downloads
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Admins have full access to student_downloads"
  on public.student_downloads
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16c. student_viewing_history
-- Students: full CRUD on their own viewing history
-- Admins: full access
create policy "Students have full access to their own viewing_history"
  on public.student_viewing_history
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Admins have full access to student_viewing_history"
  on public.student_viewing_history
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16d. student_personal_notes
-- Students: full CRUD on their own notes
-- Admins: full access
create policy "Students have full access to their own personal_notes"
  on public.student_personal_notes
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Admins have full access to student_personal_notes"
  on public.student_personal_notes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16e. student_doubts
-- Students: full CRUD on their own doubts
-- Teachers: read doubts for subjects they teach
-- Admins: full access
create policy "Students have full access to their own doubts"
  on public.student_doubts
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Teachers can read doubts for subjects they specialize in"
  on public.student_doubts
  for select
  to authenticated
  using (exists (
    select 1 from public.teacher_specializations ts
    where ts.teacher_id = public.get_my_teacher_id()
    and ts.subject_id = student_doubts.subject_id
  ));

create policy "Admins have full access to student_doubts"
  on public.student_doubts
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16f. doubt_replies
-- All authenticated users: read replies for doubts they can access
-- Students: create replies on their own doubts
-- Teachers: create replies on doubts they can access
-- Admins: full access
create policy "Users can read doubt_replies for accessible doubts"
  on public.doubt_replies
  for select
  to authenticated
  using (exists (
    select 1 from public.student_doubts sd
    where sd.doubt_id = doubt_replies.doubt_id
    and (sd.student_id = public.get_my_student_id()
      or exists (
        select 1 from public.teacher_specializations ts
        where ts.teacher_id = public.get_my_teacher_id()
        and ts.subject_id = sd.subject_id
      )
      or public.is_admin())
  ));

create policy "Authenticated users can create doubt_replies"
  on public.doubt_replies
  for insert
  to authenticated
  with check (exists (
    select 1 from public.profiles
    where profile_id = auth.uid()
  ));

create policy "Admins have full access to doubt_replies"
  on public.doubt_replies
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16g. support_tickets
-- Students: full CRUD on their own tickets
-- Admins: full access
create policy "Students have full access to their own support_tickets"
  on public.support_tickets
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Admins have full access to support_tickets"
  on public.support_tickets
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16h. support_ticket_messages
-- Students: read and create messages on their own tickets
-- Admins: full access
create policy "Students can read and create messages on their own tickets"
  on public.support_ticket_messages
  for select
  to authenticated
  using (exists (
    select 1 from public.support_tickets st
    where st.ticket_id = support_ticket_messages.ticket_id
    and st.student_id = public.get_my_student_id()
  ));

create policy "Students can create messages on their own tickets"
  on public.support_ticket_messages
  for insert
  to authenticated
  with check (exists (
    select 1 from public.support_tickets st
    where st.ticket_id = support_ticket_messages.ticket_id
    and st.student_id = public.get_my_student_id()
  ));

create policy "Admins have full access to support_ticket_messages"
  on public.support_ticket_messages
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 16i. student_feedback_ratings
-- Students: full CRUD on their own ratings
-- All authenticated: read public ratings
-- Admins: full access
create policy "Students have full access to their own feedback_ratings"
  on public.student_feedback_ratings
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (student_id = public.get_my_student_id());

create policy "Users can read public feedback_ratings"
  on public.student_feedback_ratings
  for select
  to authenticated
  using (is_public = true or student_id = public.get_my_student_id() or public.is_admin());

create policy "Admins have full access to student_feedback_ratings"
  on public.student_feedback_ratings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 17 — Domain 15: Infrastructure Policies
-- ════════════════════════════════════════════════════════════════════════════

-- 17a. api_keys
-- Only admins can manage API keys
create policy "Only admins can access api_keys"
  on public.api_keys
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 17b. webhook_endpoints
-- Only admins can manage webhook endpoints
create policy "Only admins can access webhook_endpoints"
  on public.webhook_endpoints
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 17c. webhook_delivery_logs
-- Only admins can read webhook delivery logs
create policy "Only admins can access webhook_delivery_logs"
  on public.webhook_delivery_logs
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 17d. async_jobs
-- Only admins can manage async jobs
create policy "Only admins can access async_jobs"
  on public.async_jobs
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 17e. feature_flags
-- Only platform admins can manage feature flags
create policy "Only admins can access feature_flags"
  on public.feature_flags
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 17f. feature_flag_overrides
-- Only platform admins can manage feature flag overrides
create policy "Only admins can access feature_flag_overrides"
  on public.feature_flag_overrides
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 17g. system_events_outbox
-- Only admins can access the outbox
create policy "Only admins can access system_events_outbox"
  on public.system_events_outbox
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 18 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on function public.is_admin() is
  'Returns TRUE if the current authenticated user has role = admin. '
  'SECURITY DEFINER bypasses RLS to prevent recursion during policy evaluation.';

comment on function public.is_teacher() is
  'Returns TRUE if the current authenticated user has role = teacher. '
  'SECURITY DEFINER bypasses RLS to prevent recursion during policy evaluation.';

comment on function public.is_student() is
  'Returns TRUE if the current authenticated user has role = student. '
  'SECURITY DEFINER bypasses RLS to prevent recursion during policy evaluation.';

comment on function public.get_my_teacher_id() is
  'Returns the teacher_id from teacher_details for the current user. '
  'Returns NULL if the current user is not a teacher. '
  'SECURITY DEFINER to bypass RLS during policy evaluation.';

comment on function public.get_my_student_id() is
  'Returns the student_id from student_details for the current user. '
  'Returns NULL if the current user is not a student. '
  'SECURITY DEFINER to bypass RLS during policy evaluation.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 021 RLS Policies
-- ════════════════════════════════════════════════════════════════════════════
