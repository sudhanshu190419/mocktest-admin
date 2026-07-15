-- ============================================================================
-- Migration: 041 — Create Student After Purchase RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Creates two database functions for the student onboarding flow that occurs
-- after a successful course purchase:
--
--   1. generate_enrollment_number(p_institute_id)
--      - Generates a unique enrollment number within the institute
--      - Format: ENR-YYYY-NNNNNN (prefix-year-sequential number)
--      - Uses a PostgreSQL sequence for atomic, race-condition-free generation
--
--   2. create_student_after_purchase(p_profile_id, p_guardian_name, ...)
--      - Converts a registered profile into a fully onboarded student
--      - Validates profile existence, role, and duplicate detection
--      - Creates the student_details row with guardian and academic info
--      - Returns student_id, profile_id, enrollment_no, institute_id
--
-- This RPC is designed to be called by the payment Edge Function after a
-- successful course purchase. It encapsulates all student onboarding logic
-- in a single atomic database transaction. Do NOT call this function from
-- the frontend directly — it should only be invoked server-side.
--
-- The RPC is intentionally scoped: it only creates the student's academic
-- profile (student_details row). It does NOT:
--   - Create course_enrollment records
--   - Create payment records
--   - Trigger any payment gateway operations
--   - Send notifications
--
-- Future phases (Edge Functions) will build on top of this RPC.
--
-- ## Security
--
--   • SECURITY DEFINER — bypasses RLS so the Edge Function (service role) can
--     create student_details without needing to be the student themselves.
--   • Input validation — checks profile exists, role is 'student', and no
--     duplicate student_details row already exists.
--   • No SQL injection risk — all inputs are strongly typed parameters.
--
-- Depends on:
--   Domain 01 — public.profiles table (institute_id, role, profile_id)
--   Domain 01 — public.student_details table (target row)
--   Migration 036 — guardian columns on student_details
--
-- @module migrations/041
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Sequence for Enrollment Number Generation
-- ════════════════════════════════════════════════════════════════════════════
-- A global sequence provides atomic, race-condition-free incrementing.
-- Combined with the partial unique index uq_student_details_institute_enrollment
-- on (institute_id, enrollment_no), this guarantees:
--   • Uniqueness within each institute
--   • No gaps from race conditions
--   • No dependency on client-side logic

create sequence if not exists public.seq_enrollment_number
  start with 1
  increment by 1
  no minvalue
  no maxvalue
  cache 1;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — generate_enrollment_number()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Generates a unique, human-readable enrollment number for a student
--   within an institute. The number is guaranteed to be unique across all
--   students in the same institute by the partial unique index.
--
-- Format:
--   ENR-YYYY-NNNNNN
--   Where:
--     YYYY   = current year (e.g., 2026)
--     NNNNNN = zero-padded sequential number (e.g., 000042)
--   Example: ENR-2026-000042
--
-- Race condition prevention:
--   Uses a PostgreSQL sequence (seq_enrollment_number) for atomic increments.
--   The partial unique index uq_student_details_institute_enrollment on
--   (institute_id, enrollment_no) provides a second line of defence —
--   any duplicate would raise a unique constraint violation.
--
-- Input:
--   p_institute_id UUID — the institute for which to generate the number.
--     Not embedded in the number itself, but used for the unique constraint.
--
-- Returns:
--   VARCHAR(50) — the generated enrollment number string.

create or replace function public.generate_enrollment_number(p_institute_id uuid)
returns varchar(50)
language plpgsql
volatile
as $$
declare
  v_year          text;
  v_seq           bigint;
  v_enrollment_no varchar(50);
begin
  -- Current year for the enrollment number prefix
  v_year := to_char(current_date, 'YYYY');

  -- Atomically fetch the next value from the global sequence.
  -- This is race-condition-free because nextval() is atomic in PostgreSQL.
  v_seq := nextval('public.seq_enrollment_number');

  -- Build the enrollment number: ENR-YYYY-NNNNNN
  v_enrollment_no := 'ENR-'
    || v_year
    || '-'
    || lpad(v_seq::text, 6, '0');

  return v_enrollment_no;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — create_student_after_purchase()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Converts a registered profile into a fully onboarded student by creating
--   a row in student_details. Called by the payment Edge Function after a
--   successful course purchase.
--
--   This RPC is intentionally atomic — if any validation or insert fails,
--   the entire transaction rolls back automatically.
--
-- Input Parameters:
--   p_profile_id     UUID   — The profiles.profile_id to convert to student
--   p_guardian_name  TEXT   — Parent/guardian full name
--   p_guardian_mobile TEXT  — Parent/guardian mobile (international format)
--   p_guardian_email TEXT   — Parent/guardian email address
--   p_target_year    TEXT   — Academic target year (e.g., '2026-27')
--   p_dob            DATE   — Student date of birth (optional, DEFAULT NULL)
--
-- Internally Resolved (caller must NOT provide):
--   institute_id   — Resolved from profiles.institute_id
--   enrollment_no  — Generated by generate_enrollment_number()
--   enrolled_on    — Set to current_date
--
-- Validations:
--   1. Profile must exist — raises 'P0001' with message 'Profile not found'
--   2. Profile role must be 'student' — raises 'P0001' with role details
--   3. No existing student_details row — returns error JSON (idempotent)
--
-- Returns:
--   JSON object with keys:
--     student_id     UUID   — The generated student_details.student_id
--     profile_id     UUID   — The input profiles.profile_id
--     enrollment_no  TEXT   — The generated enrollment number
--     institute_id   UUID   — The resolved institute_id
--
-- On validation failure, returns:
--     JSON object with key 'error' and a descriptive message

create or replace function public.create_student_after_purchase(
  p_profile_id      uuid,
  p_guardian_name   text,
  p_guardian_mobile text,
  p_guardian_email  text,
  p_target_year     text,
  p_dob             date default null
)
returns json
language plpgsql
volatile
security definer
set search_path = 'public'
as $$
declare
  v_institute_id  uuid;
  v_role          public.user_role;
  v_enrollment_no varchar(50);
  v_student_id    uuid;
begin
  -- ══════════════════════════════════════════════════════════════════════
  -- Step 1: Verify the profile exists and extract role + institute_id
  -- ══════════════════════════════════════════════════════════════════════
  select p.institute_id, p.role
  into strict v_institute_id, v_role
  from public.profiles p
  where p.profile_id = p_profile_id;

  -- ══════════════════════════════════════════════════════════════════════
  -- Step 2: Verify the profile role is 'student'
  -- ══════════════════════════════════════════════════════════════════════
  if v_role is distinct from 'student' then
    raise exception 'Profile % has role % — create_student_after_purchase requires role = student',
      p_profile_id, v_role
      using hint = 'Only profiles with role = student can be converted to students.';
  end if;

  -- ══════════════════════════════════════════════════════════════════════
  -- Step 3: Verify no existing student_details row for this profile
  --         (idempotency check — prevents duplicate student creation)
  -- ══════════════════════════════════════════════════════════════════════
  if exists (
    select 1
    from public.student_details sd
    where sd.profile_id = p_profile_id
  ) then
    return json_build_object(
      'error', format(
        'A student_details row already exists for profile %s. Each profile can have only one student record.',
        p_profile_id
      )
    );
  end if;

  -- ══════════════════════════════════════════════════════════════════════
  -- Step 4: Generate the enrollment number
  -- ══════════════════════════════════════════════════════════════════════
  v_enrollment_no := public.generate_enrollment_number(v_institute_id);

  -- ══════════════════════════════════════════════════════════════════════
  -- Step 5: Insert into student_details
  -- ══════════════════════════════════════════════════════════════════════
  insert into public.student_details (
    profile_id,
    institute_id,
    enrollment_no,
    guardian_name,
    guardian_mobile,
    guardian_email,
    target_year,
    dob,
    enrolled_on,
    created_at,
    updated_at
  ) values (
    p_profile_id,
    v_institute_id,
    v_enrollment_no,
    p_guardian_name,
    p_guardian_mobile,
    p_guardian_email,
    p_target_year,
    p_dob,
    current_date,           -- enrolled_on is a date, not timestamptz
    now(),
    now()
  )
  returning student_id into v_student_id;

  -- ══════════════════════════════════════════════════════════════════════
  -- Step 6: Return the structured response
  -- ══════════════════════════════════════════════════════════════════════
  return json_build_object(
    'student_id',     v_student_id,
    'profile_id',     p_profile_id,
    'enrollment_no',  v_enrollment_no,
    'institute_id',   v_institute_id
  );

exception
  when no_data_found then
    raise exception 'Profile % not found — create_student_after_purchase requires an existing profile.',
      p_profile_id
      using hint = 'Verify that the profile_id exists in public.profiles before calling this function.';
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Permissions
-- ════════════════════════════════════════════════════════════════════════════
-- Grant execute to authenticated users so the Edge Function (which runs with
-- the service role key) can call this RPC. The service role is mapped to the
-- 'authenticated' role in Supabase's JWT configuration.
--
-- The sequence must also be accessible to the function caller.
--
-- Unlike the read-only analytics RPCs, these functions perform INSERT
-- operations, so we explicitly revoke PUBLIC access and grant only to
-- authenticated users for defense-in-depth.

-- Write function grants
grant usage on sequence public.seq_enrollment_number to authenticated;

revoke execute on function public.create_student_after_purchase from public;
grant execute on function public.create_student_after_purchase to authenticated;

revoke execute on function public.generate_enrollment_number from public;
grant execute on function public.generate_enrollment_number to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on sequence public.seq_enrollment_number is
  'Global sequence for generating unique enrollment numbers. Used by '
  'generate_enrollment_number() to guarantee atomic, race-condition-free '
  'incrementing. Combined with the partial unique index '
  'uq_student_details_institute_enrollment (institute_id, enrollment_no), '
  'this ensures uniqueness within each institute.';

comment on function public.generate_enrollment_number(uuid) is
  'Generates a unique enrollment number in the format ENR-YYYY-NNNNNN for '
  'the given institute. Uses a PostgreSQL sequence for atomic, race-condition-'
  'free generation. The enrollment_no is unique per institute (enforced by '
  'the partial unique index uq_student_details_institute_enrollment). '
  'Input: p_institute_id UUID. Returns: VARCHAR(50). Called automatically by '
  'create_student_after_purchase() — do not call directly from application code.';

comment on function public.create_student_after_purchase(uuid, text, text, text, text, date) is
  'Creates a student_details row for a registered profile after a successful '
  'course purchase. Validates that the profile exists, has role = student, '
  'and does not already have a student_details row. Internally resolves '
  'institute_id from the profile and generates a unique enrollment number. '
  'Returns a JSON object with student_id, profile_id, enrollment_no, and '
  'institute_id. Designed to be called by the payment Edge Function. '
  'SECURITY DEFINER bypasses RLS so the service role can create the record. '
  'This function does NOT create course_enrollments, payments, or notifications '
  '— it only creates the student''s academic profile.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 041 Create Student After Purchase RPC
-- ════════════════════════════════════════════════════════════════════════════
