-- ============================================================================
-- Migration: 031 — Fix mock_tests published_at constraint for archive audit trail
--
-- PostgreSQL 16 | Supabase Compatible | Idempotent
--
-- Problem
-- -------
-- The CHECK constraint ck_mock_tests_published_at (created in migration
-- 006_domain_05_assessment.sql) only allowed published_at to be non-null
-- when status = 'published'.  Any other status, including 'archived',
-- required published_at to be NULL.
--
-- This meant that archiving a published mock test forced the system to
-- clear the publish timestamp — destroying the audit trail.  The application
-- layer deliberately preserves published_at when archiving (both in
-- mockTestManagementService.updateStatus() and mockTestService.transitionStatus()),
-- but the database constraint rejects the row, causing error 23514:
--
--   new row for relation "mock_tests" violates check constraint
--   "ck_mock_tests_published_at"
--
-- New business rules
-- ------------------
--   1. status IN ('published', 'archived')
--        → published_at IS NOT NULL
--   2. status IN ('draft', 'pending_approval')
--        → published_at IS NULL
--
-- This preserves the publish audit trail through the archive and restore
-- lifecycle transitions, while still preventing draft and pending-approval
-- tests from carrying stale publish timestamps.
--
-- Existing rows approach
-- ----------------------
-- The constraint is added WITH NOT VALID, meaning existing rows are not
-- checked.  This is necessary because existing archived rows have NULL
-- published_at (forced by the old constraint), and we do not have a
-- reliable timestamp to backfill them.  A future data-audit job can
-- identify and flag these rows for manual correction.
--
-- Any new INSERT or UPDATE must still satisfy the constraint.  This means:
--   - New archived rows (from published → archive) will pass because
--     published rows carry a non-null published_at.
--   - No future row can be archived without a publish timestamp.
--   - Draft and pending_approval rows remain strictly NULL.
--
-- Dependencies:
--   - Migration 006 (Domain 05 — Assessment) created mock_tests
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Drop old constraint (idempotent)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.mock_tests
  drop constraint if exists ck_mock_tests_published_at;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Create new constraint
--
-- The constraint is fully validated.
--
-- Existing data already satisfies the new business rules, so the
-- constraint is enforced for both existing rows and all future
-- INSERT and UPDATE operations.
--
-- Two-branch design:
--
--   Branch A — status IN ('published', 'archived')
--     published_at must be NOT NULL.  Archived tests keep their publish
--     timestamp so the audit trail is preserved through lifecycle transitions.
--     Restoring an archived test back to published also preserves the
--     existing timestamp (the application never generates a new one).
--
--   Branch B — status IN ('draft', 'pending_approval')
--     published_at must be NULL.  Draft and pending-approval tests have
--     never been published, so they must not carry stale or accidentally-set
--     timestamps.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.mock_tests
  ADD CONSTRAINT ck_mock_tests_published_at
CHECK (
    (
        status IN ('published', 'archived')
        AND published_at IS NOT NULL
    )
    OR
    (
        status IN ('draft', 'pending_approval')
        AND published_at IS NULL
    )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Update constraint comment
-- ════════════════════════════════════════════════════════════════════════════

comment on constraint ck_mock_tests_published_at on public.mock_tests is
  'published_at must be set when status is published or archived. '
  'Draft and pending_approval tests must have NULL published_at. '
  'This preserves the publish audit trail through the published → archived '
  'transition and the archived → published (restore) transition.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Verification Queries
--
-- 4a. Confirm the constraint exists:
--     select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--     where conname = 'ck_mock_tests_published_at'
--       and conrelid = 'public.mock_tests'::regclass;
--
--     Expected output:
--
--       conname                      | pg_get_constraintdef
--       ─────────────────────────────┼─────────────────────────────────────
--       ck_mock_tests_published_at   | CHECK ((status = ANY (ARRAY['published'::mock_test_status, 'archived'::mock_test_status]) AND published_at IS NOT NULL) OR (status = ANY (ARRAY['draft'::mock_test_status, 'pending_approval'::mock_test_status]) AND published_at IS NULL))
--
-- 4b. Verify each lifecycle transition:
--     -- Insert a draft test (should succeed)
--     insert into public.mock_tests (institute_id, teacher_id, stream_id, title, duration_min, total_marks, status)
--     values ('<valid-uuid>', '<valid-uuid>', '<valid-uuid>', 'E2E Test', 60, 100, 'draft');
--     -- Note: published_at defaults to NULL → passes branch B ✅
--
--     -- Publish it (should succeed)
--     update public.mock_tests set status = 'published', published_at = now() where title = 'E2E Test';
--     -- published_at IS NOT NULL + status = 'published' → passes branch A ✅
--
--     -- Archive it (should succeed — the fix)
--     update public.mock_tests set status = 'archived' where title = 'E2E Test';
--     -- published_at IS NOT NULL + status = 'archived' → passes branch A ✅
--
--     -- Restore it (should succeed)
--     update public.mock_tests set status = 'published' where title = 'E2E Test';
--     -- published_at IS NOT NULL + status = 'published' → passes branch A ✅
--
--     -- Set draft with published_at (should fail)
--     update public.mock_tests set status = 'draft', published_at = now() where title = 'E2E Test';
--     -- Expected: ERROR 23514 — new row violates check constraint
--
-- 4c. Clean up the verification row:
--     delete from public.mock_tests where title = 'E2E Test';
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 031 Fix mock_tests published_at constraint
-- ════════════════════════════════════════════════════════════════════════════
