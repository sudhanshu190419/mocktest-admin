-- ============================================================================
-- Migration: 045 — Add 'user' Role to user_role Enum
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds the new 'user' role value to the existing `user_role` enum type.
-- This is the first step in supporting pre-onboarding user accounts that
-- can browse and purchase courses before being upgraded to 'student'.
--
-- The migration is idempotent: it checks whether 'user' already exists in
-- the enum before attempting to add it, so it is safe to run multiple times.
--
-- IMPORTANT: This migration does NOT change any triggers, RLS policies,
--            RPCs, or existing data. It only adds the new enum value.
--            The handle_new_user() trigger still defaults to 'student'.
--            The check_student_role() trigger still validates against 'student'.
--            The create_student_after_purchase() RPC still expects 'student'.
--            Those changes will be made in separate migrations as needed.
--
-- Reference: Phase 1B — Role Migration Impact Analysis
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Add 'user' to user_role enum (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- ALTER TYPE ... ADD VALUE cannot be wrapped in a DO block directly because
-- PostgreSQL does not allow ADD VALUE in transactional blocks when running
-- in a multi-tenant Supabase environment. However, we can protect against
-- duplicate value errors with a conditional check.
--
-- Note: IF NOT EXISTS is available from PostgreSQL 16+. Since we target
--       PostgreSQL 16 (defined in supabase/config.toml), we can use:
--         ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'user';
--
--       For maximum backward compatibility, we wrap it in a safe check.
do $$
begin
  if not exists (
    select 1 from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    where pg_type.typname = 'user_role'
      and pg_enum.enumlabel = 'user'
  ) then
    alter type user_role add value 'user';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Verification Query (for reference — run manually if needed)
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT enumlabel, enumsortorder
-- FROM pg_enum
-- JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
-- WHERE pg_type.typname = 'user_role'
-- ORDER BY enumsortorder;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 045
-- ════════════════════════════════════════════════════════════════════════════
