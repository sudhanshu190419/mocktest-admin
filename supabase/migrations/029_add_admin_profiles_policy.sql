-- ============================================================================
-- Migration: 029 — Admin Access Policy for Profiles
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Add an admin-override RLS policy to the `profiles` table so that
--          administrators can view and manage all profile rows — required by
--          the Teacher Lifecycle Management module (summary counts, teacher
--          list, teacher detail) and future admin features.
--
-- Problem:
--   The only existing SELECT policy on `profiles` is a self-access policy
--   from migration 001:
--
--     "Users can view their own profile"
--       using ((select auth.uid()) = id)
--
--   This means every query against `profiles` appends `AND profile_id =
--   auth.uid()`. When an admin queries `WHERE role = 'teacher'`, the filter
--   becomes `WHERE role = 'teacher' AND profile_id = auth.uid()` — which
--   returns 0 rows because the admin's own profile has `role = 'admin'`.
--
--   Every other table (institutes, teacher_details, questions, mock_tests,
--   etc.) already has an admin-override policy.  Profiles was the only table
--   that relied solely on the self-access policy from the initial schema.
--
-- Solution:
--   Add a single FOR ALL policy that grants full CRUD access to any user
--   whose `profiles.role = 'admin'`.  PostgreSQL combines multiple policies
--   of the same command type with OR, so:
--
--     Teachers/students → `(auth.uid() = profile_id)`  (self only)
--     Admins           → `(auth.uid() = profile_id) OR (is_admin())`  (all rows)
--
-- Depends on:
--   Migration 021 — is_admin() helper function (SECURITY DEFINER)
--   Migration 001 — existing self-access policy on profiles
--
-- Safe to re-run: Idempotent via `CREATE POLICY ... ON ...` (no IF NOT EXISTS
-- for policies in PostgreSQL; use DROP + CREATE or check before running).
-- This migration uses a DO block to check for existence before creating.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create the admin-override policy (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Pattern: Use a DO block to check if the policy already exists before
-- creating it.  This is the standard idempotent approach for RLS policies
-- in PostgreSQL (there is no `CREATE POLICY IF NOT EXISTS` syntax).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles'
      and policyname = 'Admins have full access to profiles'
  ) then
    create policy "Admins have full access to profiles"
      on public.profiles
      for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on policy "Admins have full access to profiles" on public.profiles is
  'Grants administrators full CRUD access to all profile rows. '
  'Complemented by the self-access policy from migration 001. '
  'PostgreSQL ORs same-type policies, so teachers/students only see '
  'their own row while admins see every row.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Verification (run after applying)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 3a. Confirm the policy exists:
--     select * from pg_policies
--     where tablename = 'profiles'
--     order by policyname;
--
--     Expected output (two policies):
--
--       policyname                             | cmd   |
--       ───────────────────────────────────────┼───────┤
--       Admins have full access to profiles    | ALL   |
--       Users can view their own profile       | SELECT|
--
--     The self-access policy covers INSERT, UPDATE, DELETE from migration
--     001. Since "Admins have full access" covers ALL, admin operations
--     are unrestricted while non-admins remain limited to their own row.
--
-- 3b. Confirm admins can read all profiles:
--     (execute as an admin user — the is_admin() check in the policy clause
--      is evaluated against the current user's session)
--
--     set local role authenticated;
--     -- (requires an admin session token to be attached)
--     select count(*) from public.profiles;
--     -- Expected: total count of all profiles in the database.
--
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 029 Admin Access Policy for Profiles
-- ════════════════════════════════════════════════════════════════════════════
