-- ============================================================================
-- Migration: 192 - Teacher Management Performance Indexes
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Adds targeted composite and single-column indexes on tables queried by
--   the Admin Teacher Management feature (/admin/teachers) and the
--   get_teacher_lifecycle_counts RPC:
--
--   1. profiles: Composite (role, account_status) for fast lifecycle count
--      aggregation and status filtering platform-wide.
--   2. profiles: Composite (institute_id, role, account_status) for
--      fast institute-scoped lifecycle count aggregation.
--   3. profiles: Composite (role, created_at DESC) for fast paginated
--      teacher listing without requiring in-memory sort.
--   4. teacher_details: Standalone index on department for fast filtering
--      by department in teacher list and aggregation in stats.
--
-- Safe & Idempotent: Uses IF NOT EXISTS on all statements.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles Indexes
-- ----------------------------------------------------------------------------

-- Composite index for platform-wide lifecycle status counts and list filtering (Super Admin)
CREATE INDEX IF NOT EXISTS idx_profiles_role_account_status
  ON public.profiles (role, account_status);

-- Composite index for institute-scoped lifecycle status counts and list filtering (Institute Admin)
CREATE INDEX IF NOT EXISTS idx_profiles_institute_role_account_status
  ON public.profiles (institute_id, role, account_status);

-- Composite index for default reverse chronological teacher list pagination
CREATE INDEX IF NOT EXISTS idx_profiles_role_created_at_desc
  ON public.profiles (role, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. teacher_details Indexes
-- ----------------------------------------------------------------------------

-- Standalone index on department for fast department filtering and department stats grouping
CREATE INDEX IF NOT EXISTS idx_teacher_details_department
  ON public.teacher_details (department);
