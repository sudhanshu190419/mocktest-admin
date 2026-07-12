-- ============================================================================
-- Migration: 030 — Update question approval consistency constraint
--
-- PostgreSQL 16 | Supabase Compatible | Idempotent
--
-- Problem
-- -------
-- The previous CHECK constraint ck_questions_approval_consistency (created in
-- migration 006_domain_05_assessment.sql) only allowed approval metadata
-- (approved_by, approved_at) when status = 'published'.  Any other status,
-- including 'archived', required both columns to be NULL.  This meant that
-- archiving a published question forced the system to forget who approved it
-- and when — destroying the audit trail.
--
-- New business rules (applied to new and modified rows only)
-- ------------------
--   1. status IN ('published', 'archived')
--        → approved_by IS NOT NULL AND approved_at IS NOT NULL
--   2. status IN ('draft', 'pending_approval')
--        → approved_by IS NULL AND approved_at IS NULL
--
-- This preserves the approval audit trail through the archive lifecycle
-- transition, while still preventing draft and pending-approval questions
-- from carrying stale approval metadata.
--
-- Existing rows approach
-- ----------------------
-- The constraint is added WITH NOT VALID, meaning existing rows are not
-- checked.  This is necessary because existing archived rows have NULL
-- approved_by and NULL approved_at (forced by the old constraint), and there
-- is no reliable way to backfill them (we do not know who approved the
-- question).  A future data-audit job can identify and flag these rows for
-- manual correction, or a future migration can VALIDATE the constraint after
-- all archived rows have been remediated.
--
-- Any new INSERT or UPDATE must still satisfy the constraint.  This means:
--   - New archived rows (from published → archive) will pass because
--     published rows carry NOT NULL metadata.
--   - No future row can be archived with NULL/NULL approval metadata.
--   - Draft and pending_approval rows remain strictly NULL/NULL.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Drop old constraint (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.questions
  drop constraint if exists ck_questions_approval_consistency;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Create new constraint
--
-- NOT VALID means existing rows are grandfathered.  The constraint still
-- applies to all future INSERT and UPDATE operations.
--
-- Two-branch design:
--
--   Branch A — status IN ('published', 'archived')
--     Both columns must be NOT NULL.  Archived questions keep their approval
--     metadata so the audit trail is preserved through lifecycle transitions.
--
--   Branch B — status IN ('draft', 'pending_approval')
--     Neither column may be set.  Draft and pending-approval questions have
--     never gone through the approval workflow, so they must not carry stale
--     or accidentally-set metadata.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.questions
  add constraint ck_questions_approval_consistency check
    ((status in ('published', 'archived') and approved_by is not null and approved_at is not null)
     or (status in ('draft', 'pending_approval') and approved_by is null and approved_at is null))
  not valid;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Update constraint comment
-- ════════════════════════════════════════════════════════════════════════════
comment on constraint ck_questions_approval_consistency on public.questions is
  'approved_by and approved_at must be set together when and only when '
  'status is published or archived.  Draft and pending_approval questions '
  'must have NULL approval metadata.  Added NOT VALID — existing archived '
  'rows with NULL metadata are grandfathered.  Future rows are fully enforced.';
