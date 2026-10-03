-- ============================================================================
-- Migration: 190 - Admin Dashboard Query Performance Indexes
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Adds missing leading and composite indexes on tables queried by the
--   Admin Dashboard (/admin) home page widgets and counts:
--   1. questions: Leading status index and partial pending approval index
--      (resolves the ~2.37s bottleneck on question approval count).
--   2. profiles: Standalone role index and created_at sorting indexes
--      (resolves sequential scans on student/teacher counts & recent registrations).
--   3. mock_tests: Standalone status index for platform-level counts.
--   4. batches: Standalone status index for platform-level active batch counts.
--   5. orders: Composite status + created_at indexes for month-to-date revenue queries.
--
-- Safe & Idempotent: Uses IF NOT EXISTS on all statements.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. questions Indexes
-- ----------------------------------------------------------------------------

-- Standalone status index for platform-wide pending question count (Super Admin)
CREATE INDEX IF NOT EXISTS idx_questions_status
  ON public.questions (status);

-- Composite status + institute index for fast filtering by status within institute
CREATE INDEX IF NOT EXISTS idx_questions_status_institute
  ON public.questions (status, institute_id);

-- Partial index dedicated to pending approvals for minimal index size & maximum speed
CREATE INDEX IF NOT EXISTS idx_questions_pending_approval
  ON public.questions (institute_id, question_id)
  WHERE status = 'pending_approval';

-- ----------------------------------------------------------------------------
-- 2. profiles Indexes
-- ----------------------------------------------------------------------------

-- Standalone role index for platform-wide student and teacher counts (Super Admin)
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles (role);

-- Reverse chronological index for recent registrations platform-wide (Super Admin)
CREATE INDEX IF NOT EXISTS idx_profiles_created_at_desc
  ON public.profiles (created_at DESC);

-- Institute-scoped reverse chronological index for recent registrations (Institute Admin)
CREATE INDEX IF NOT EXISTS idx_profiles_institute_created_at
  ON public.profiles (institute_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. mock_tests Indexes
-- ----------------------------------------------------------------------------

-- Standalone status index for platform-wide published test counts (Super Admin)
CREATE INDEX IF NOT EXISTS idx_mock_tests_status
  ON public.mock_tests (status);

-- ----------------------------------------------------------------------------
-- 4. batches Indexes
-- ----------------------------------------------------------------------------

-- Standalone status index for platform-wide active batch counts (Super Admin)
CREATE INDEX IF NOT EXISTS idx_batches_status
  ON public.batches (status);

-- ----------------------------------------------------------------------------
-- 5. orders Indexes
-- ----------------------------------------------------------------------------

-- Standalone status + created_at index for MTD revenue queries (Super Admin)
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON public.orders (status, created_at DESC);

-- Institute-scoped status + created_at index for MTD revenue queries (Institute Admin)
CREATE INDEX IF NOT EXISTS idx_orders_institute_status_created_at
  ON public.orders (institute_id, status, created_at DESC);
