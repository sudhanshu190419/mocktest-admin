-- ============================================================================
-- Migration: 036 — Add Guardian Fields to student_details
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds contact information for the student's parent or guardian as nullable
-- columns on the existing student_details table. This supports the student
-- onboarding flow that occurs after a successful course purchase.
--
-- All three columns are NULLABLE so existing records continue to work without
-- modification or backfilling.
--
-- References:
--   Domain 01 — public.student_details (002_domain_01_foundation.sql)
--   RLS Policies for student_details  (021_rls_policies.sql)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Add Guardian Columns
-- ════════════════════════════════════════════════════════════════════════════
-- Each column uses IF NOT EXISTS so the migration is idempotent and safe to
-- re-run. All three columns are NULLABLE — no backfill is required.
--
-- Columns are placed after enrolled_on (last student-specific data column)
-- and before created_at (system audit column) to group related fields.

alter table public.student_details
  add column if not exists guardian_name    varchar(150)  null  default null,
  add column if not exists guardian_mobile  varchar(20)   null  default null,
  add column if not exists guardian_email   varchar(255)  null  default null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CHECK Constraints
-- ════════════════════════════════════════════════════════════════════════════
-- Validation follows the same patterns used by the profiles table:
--
--   profiles.phone         → varchar(20), CHECK (phone ~ '^\+[1-9]\d{6,14}$')
--   profiles.email         → varchar(255), CHECK (email ~* '...')
--
-- guardian_mobile uses the same phone format as profiles.phone (international
-- format starting with +, allowing country codes from any region).
--
-- guardian_email uses the same email format as profiles.email. The constraint
-- is defined only if it does not already exist, making this migration safe
-- for re-runs or partial application.

do $$
begin
  -- guardian_mobile CHECK constraint (same pattern as ck_profiles_phone_format)
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.student_details'::regclass
      and conname = 'ck_student_details_guardian_mobile_format'
  ) then
    alter table public.student_details
      add constraint ck_student_details_guardian_mobile_format
        check (
          guardian_mobile is null
          or guardian_mobile ~ '^\+[1-9]\d{6,14}$'
        );
  end if;

  -- guardian_email CHECK constraint (same pattern as ck_profiles_email_format)
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.student_details'::regclass
      and conname = 'ck_student_details_guardian_email_format'
  ) then
    alter table public.student_details
      add constraint ck_student_details_guardian_email_format
        check (
          guardian_email is null
          or guardian_email ~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$'
        );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Column Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on column public.student_details.guardian_name is
  'Name of the student''s parent or guardian. Captured during post-purchase '
  'onboarding. Optional — existing records are unaffected.';

comment on column public.student_details.guardian_mobile is
  'Primary guardian contact number in international format (e.g. +919876543210). '
  'Validated by a CHECK constraint matching the profiles.phone format. '
  'Maximum 20 characters with country code.';

comment on column public.student_details.guardian_email is
  'Primary guardian email address. Validated by a CHECK constraint matching '
  'the profiles.email format. NULL if the guardian does not use email.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Index Decision
-- ════════════════════════════════════════════════════════════════════════════
-- No index is created for guardian_name, guardian_mobile, or guardian_email.
--
-- Rationale:
--   These fields are contact information, not lookup keys. The student_details
--   table is always queried by:
--     • student_id (primary key — auto-indexed)
--     • profile_id (unique index — uq_student_details_profile_id)
--     • (institute_id, enrollment_no) (partial unique index)
--
--   There is no current or planned query pattern that filters or joins on
--   guardian columns. An index would add write overhead without a read benefit.
--   If a future feature (e.g. SMS/email broadcasts to guardians) requires
--   filtering, an index can be added at that point.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Trigger Verification
-- ════════════════════════════════════════════════════════════════════════════
-- No trigger modifications are necessary:
--
--   1. trg_student_details_set_updated_at (BEFORE UPDATE)
--      — Only touches updated_at. New columns are unchanged by this trigger.
--
--   2. trg_student_details_check_role (BEFORE INSERT OR UPDATE)
--      — Checks profiles.role == 'student'. Adding nullable columns does not
--        affect this check in any way. No changes required.
--
--   3. trg_student_details_set_updated_at
--      — Auto-sets updated_at = NOW() on UPDATE. Works identically regardless
--        of which columns are modified.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 036 Add Guardian Fields to student_details
-- ════════════════════════════════════════════════════════════════════════════
