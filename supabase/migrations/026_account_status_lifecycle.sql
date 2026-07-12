-- ============================================================================
-- Migration: 026 — Account Status Lifecycle
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Introduce an account lifecycle system for the profiles table.
--
--   Instead of introducing new roles (e.g. teacher_pending), we separate
--   the concept of "who the user is" (role) from "what state their account
--   is in" (account_status). This gives us a clean, flexible lifecycle
--   that applies equally to all roles — admin, teacher, and student.
--
--   account_status values (in order):
--     pending   – User registered but not yet approved (e.g. new teacher
--                 awaiting admin verification)
--     approved  – Account is active and fully functional
--     rejected  – Registration was denied (e.g. invalid credentials)
--     suspended – Temporarily disabled (e.g. policy violation)
--     inactive  – Long-term disabled / deactivated by user choice
--
-- Changes:
--   1. Create account_status enum
--   2. Add account_status column to profiles (NOT NULL, DEFAULT 'approved')
--   3. Backfill existing rows — all existing users get 'approved'
--   4. Verification queries
--
-- Design decisions:
--   • DEFAULT 'approved' ensures backward compatibility — existing code
--     that inserts into profiles without specifying account_status gets
--     the correct value automatically. No existing user becomes pending.
--
--   • Enum values are ordered from "most restrictive" to "least
--     restrictive" state transitions: pending → approved ↔ rejected /
--     suspended / inactive. PostgreSQL does not enforce transition
--     ordering; this is handled by application logic.
--
--   • No triggers, RLS policies, or foreign keys are modified in this
--     migration. Those will be updated in subsequent phases.
--
-- Dependencies:
--   - Migration 002 (Domain 01 — Foundation) must be applied first
--   - Migration 024 (Phone-First Auth) must be applied first
--   - The profiles table must exist
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create account_status enum (idempotent)
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type account_status as enum ('pending', 'approved', 'rejected', 'suspended', 'inactive');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Add column to profiles (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- The column is added in a single ALTER TABLE with both NOT NULL and DEFAULT.
-- PostgreSQL 11+ optimises ADD COLUMN ... NOT NULL DEFAULT <constant> to a
-- metadata-only operation — no table rewrite occurs, and existing rows are
-- backfilled instantly through the system catalogs.
--
-- DEFAULT 'approved' ensures:
--   • All new rows inserted by application code (including handle_new_user()
--     trigger) automatically get 'approved' without code changes.
--   • All existing rows are backfilled correctly — the DEFAULT is applied
--     to all existing rows without a separate UPDATE pass.

alter table only public.profiles
  add column if not exists account_status account_status
  not null
  default 'approved';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Backfill (safety net)
-- ════════════════════════════════════════════════════════════════════════════
-- The DEFAULT clause on the column addition already backfills all existing
-- rows to 'approved'. This explicit UPDATE is a safety net in case the
-- column was already added (e.g. rolled back partial migration) with a
-- different DEFAULT or without NOT NULL.
--
-- Only touches rows where account_status IS NULL to avoid overwriting any
-- manually set values.

update public.profiles
set account_status = 'approved'
where account_status is null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Verification Queries
-- ════════════════════════════════════════════════════════════════════════════
-- Run these after applying the migration to confirm everything is correct.

-- 4a. Confirm the enum was created with the expected values:
--     select enum_range(null::account_status);
--     Expected: {pending,approved,rejected,suspended,inactive}

-- 4b. Verify all rows have account_status set (expected: 0):
--     select count(*) from public.profiles where account_status is null;

-- 4c. See the distribution of account_status across all rows:
--     select account_status, count(*)
--     from public.profiles
--     group by account_status
--     order by account_status;

-- 4d. See the full profiles table with role + account_status side by side:
--     select profile_id, name, role, account_status, created_at
--     from public.profiles
--     order by created_at;
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 026 Account Status Lifecycle
-- ════════════════════════════════════════════════════════════════════════════
