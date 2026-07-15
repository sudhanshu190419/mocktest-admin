-- ============================================================================
-- Migration: 044 — Make orders.student_id Nullable
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Fixes a schema gap introduced by migration 043. Migration 043 added
-- profile_id (nullable) and a CHECK constraint requiring at least one of
-- profile_id or student_id, but failed to relax the original NOT NULL
-- constraint on student_id from migration 008.
--
-- The result was a contradictory schema:
--   • student_id  → NOT NULL (from migration 008) ❌
--   • profile_id  → NULLABLE (from migration 043)
--   • ck_orders_identifier_present → profile_id IS NOT NULL OR student_id IS NOT NULL
--
-- When create-payment-order attempted to insert student_id = NULL (the
-- pre-onboarding flow), PostgreSQL rejected it at the NOT NULL constraint
-- before the CHECK constraint was ever evaluated.
--
-- Changes:
--   1. ALTER COLUMN student_id DROP NOT NULL
--   2. Update column comment to document the nullable state
--
-- Dependency Analysis (all safe):
--   • FK fk_orders_student → student_details(student_id) — PostgreSQL skips
--     FK validation for NULL values. Existing non-null references preserved.
--   • Index idx_orders_institute_student — B-tree handles NULLs fine.
--   • Index idx_orders_student_placed_at — B-tree handles NULLs fine.
--   • RLS policies — "Students can read their own orders" uses
--     student_id = get_my_student_id(). NULL ≠ NULL, so pre-onboarding
--     orders won't be visible via RLS. This is acceptable because:
--       - Edge Functions use service_role (bypass RLS)
--       - The client receives order data from the API response
--       - After webhook processing, student_id is linked
--   • Trigger trg_orders_set_updated_at — Unrelated to student_id
--   • Application code — No TypeScript code queries orders.student_id directly
--   • Edge Functions — All three (create-payment-order, razorpay-webhook,
--     complete-course-purchase) handle NULL student_id correctly
--
-- Depends on:
--   Migration 008 — Domain 07 Commerce (original orders table)
--   Migration 043 — Course Purchase Commerce Schema (added profile_id)
--
-- @module migrations/044
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Make student_id Nullable
-- ════════════════════════════════════════════════════════════════════════════
-- This is idempotent — PostgreSQL silently succeeds (no error) if the
-- column is already nullable. The CHECK constraint
-- ck_orders_identifier_present (from migration 043) already ensures at
-- least one of profile_id or student_id is set, so this change does NOT
-- allow fully orphaned orders.

alter table public.orders
  alter column student_id drop not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Update Column Comment
-- ════════════════════════════════════════════════════════════════════════════
-- The previous comment from migration 008 stated "student_id" without
-- documenting its nullability. Update it to reflect the new semantics.

comment on column public.orders.student_id is
  'FK to student_details.student_id. NULL for pre-onboarding orders where '
  'the student_details row has not yet been created. Populated once the '
  'payment webhook (razorpay-webhook → complete-course-purchase) creates '
  'the student record. At least one of student_id or profile_id must be '
  'set (enforced by ck_orders_identifier_present). Existing subscription '
  'and PYQ orders continue to have student_id populated as before.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Verification Query
-- ════════════════════════════════════════════════════════════════════════════
-- After applying, verify the constraint is gone:
--
--   select column_name, is_nullable
--   from   information_schema.columns
--   where  table_schema = 'public'
--     and  table_name   = 'orders'
--     and  column_name  = 'student_id';
--
-- Expected output: is_nullable = 'YES'
--
-- ============================================================================
-- END OF MIGRATION — 044 Make orders.student_id Nullable
-- ============================================================================
