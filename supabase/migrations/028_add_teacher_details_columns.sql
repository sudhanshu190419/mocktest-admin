-- ============================================================================
-- Migration: 028 — Add faculty_id, department, designation to teacher_details
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Add the three missing columns that the application layer already
--          assumes exist on teacher_details.
--
--   Registration collects:
--     faculty_id  → stored in auth.users.raw_user_meta_data (lost)
--     department  → incorrectly mapped to specialization
--     designation → never stored (hardcoded in frontend only)
--
--   This migration adds the correct columns so that registration stores
--   values in the right place, and every service query that reads
--   teacher_details.department / teacher_details.designation gets real
--   data instead of NULL.
--
-- Changes:
--   1. Add faculty_id   varchar(100)  — Teacher's employee/faculty code
--   2. Add department   varchar(255)  — Academic department
--   3. Add designation  varchar(255)  — Job title / role
--
--   All three are nullable so existing rows are not affected.
--
-- Dependencies:
--   - Migration 002 (Domain 01) created teacher_details
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Add columns (idempotent)
-- ════════════════════════════════════════════════════════════════════════════

alter table only public.teacher_details
  add column if not exists faculty_id   varchar(100)  null,
  add column if not exists department   varchar(255)  null,
  add column if not exists designation  varchar(255)  null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Verification Queries
-- ════════════════════════════════════════════════════════════════════════════

-- 2a. Confirm the columns exist:
--     select column_name, data_type, is_nullable
--     from information_schema.columns
--     where table_name = 'teacher_details'
--     order by ordinal_position;

-- 2b. See current data with the new columns (all null for existing rows):
--     select teacher_id, faculty_id, department, designation, specialization
--     from public.teacher_details;
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 028 Add missing teacher_details columns
-- ════════════════════════════════════════════════════════════════════════════
