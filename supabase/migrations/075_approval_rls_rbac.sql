-- ============================================================================
-- Migration: 075 — Approval RLS Hardening (RBAC-aware approval tables)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ## Purpose
--
-- Make the approval-related RLS policies recognize the RBAC admin role model
-- introduced in Migration 074. Previously, the "Admins have full access to X"
-- policies on the approval tables used `public.is_admin()`, which only checks
-- `profiles.role = 'admin'` — a predicate satisfied by EVERY admin type,
-- including Finance Admins.
--
-- After this migration, direct database access to the academic approval
-- tables (questions, mock_tests, content, approval_requests) requires an
-- APPROVED super_admin OR academic_admin role. Finance Admins, teachers, and
-- students are denied at the RLS layer even if they bypass the frontend and
-- call the Supabase client directly.
--
-- This complements the service-layer guards (approvalGuard.ts) so the
-- authorization gap is closed at BOTH layers.
--
-- ## Scope (minimal & focused)
--
-- Only the four pure-academic approval tables are modified:
--   - questions
--   - mock_tests
--   - content
--   - approval_requests
--
-- `courses` is intentionally LEFT UNCHANGED: it serves BOTH the academic
-- approval workflow (publish/archive/restore) AND the Commerce module that
-- Finance Admins legitimately read (revenue, orders, enrollments). Restricting
-- its RLS to academic admins would break Finance Admin Commerce access. Course
-- approval actions are protected by the service-layer guard on
-- `courseManagementService.updateStatus()` instead.
--
-- No teacher or student policies are touched. No other RLS policy changes.
-- The helper functions is_super_admin() / is_academic_admin() are SECURITY
-- DEFINER (Migration 074) and safe to reference from policies — they read
-- admin_roles with the function owner's privileges, avoiding RLS recursion.
--
-- ## Idempotency
--
-- Every policy is dropped (if exists) before being recreated, so re-running
-- this migration never fails and never duplicates policies.
--
-- ## Depends on
--
--   Migration 074: public.is_super_admin(), public.is_academic_admin()
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — questions
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher policies (own questions) and student policies (published questions)
-- are untouched. Only the admin policy is narrowed to academic admins.

drop policy if exists "Admins have full access to questions" on public.questions;

create policy "Admins have full access to questions"
  on public.questions
  for all
  to authenticated
  using (public.is_super_admin() or public.is_academic_admin())
  with check (public.is_super_admin() or public.is_academic_admin());

comment on policy "Admins have full access to questions" on public.questions is
  'Full CRUD on questions for approved super/adademic admins only. Finance '
  'admins, teachers, and students cannot approve or mutate questions via RLS.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — mock_tests
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "Admins have full access to mock_tests" on public.mock_tests;

create policy "Admins have full access to mock_tests"
  on public.mock_tests
  for all
  to authenticated
  using (public.is_super_admin() or public.is_academic_admin())
  with check (public.is_super_admin() or public.is_academic_admin());

comment on policy "Admins have full access to mock_tests" on public.mock_tests is
  'Full CRUD on mock tests for approved super/academic admins only. Finance '
  'admins cannot publish or manage mock tests via RLS.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — content
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher policies (own content) and student policies (approved content) are
-- untouched.

drop policy if exists "Admins have full access to content" on public.content;

create policy "Admins have full access to content"
  on public.content
  for all
  to authenticated
  using (public.is_super_admin() or public.is_academic_admin())
  with check (public.is_super_admin() or public.is_academic_admin());

comment on policy "Admins have full access to content" on public.content is
  'Full CRUD on study content for approved super/academic admins only. Finance '
  'admins cannot approve or manage content via RLS.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — approval_requests
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher policies (read own / create) are untouched — teachers may still
-- submit and track their own requests.

drop policy if exists "Admins have full access to approval_requests" on public.approval_requests;

create policy "Admins have full access to approval_requests"
  on public.approval_requests
  for all
  to authenticated
  using (public.is_super_admin() or public.is_academic_admin())
  with check (public.is_super_admin() or public.is_academic_admin());

comment on policy "Admins have full access to approval_requests" on public.approval_requests is
  'Full access to approval requests for approved super/academic admins only. '
  'Finance admins cannot approve or reject requests via RLS.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after applying)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Policies use the RBAC helpers:
--    select tablename, policyname, qual, with_check
--    from pg_policies
--    where policyname like 'Admins have full access to %'
--      and tablename in ('questions', 'mock_tests', 'content', 'approval_requests');
--    → Expect qual/with_check to reference is_super_admin() / is_academic_admin().
--
-- 2. Super Admin still has full access (run as an existing backfilled admin):
--    select public.is_super_admin() as is_super, public.is_academic_admin() as is_academic;
--    → Expect true / false for current admins (backfilled as super_admin).
--
-- 3. Finance Admin is denied (run as a finance admin session):
--    update public.questions set status = 'published' where false;
--    → Expect an RLS violation / no rows affected.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 075 must be reverted):
--
--   drop policy if exists "Admins have full access to questions" on public.questions;
--   create policy "Admins have full access to questions"
--     on public.questions for all to authenticated
--     using (public.is_admin()) with check (public.is_admin());
--
--   drop policy if exists "Admins have full access to mock_tests" on public.mock_tests;
--   create policy "Admins have full access to mock_tests"
--     on public.mock_tests for all to authenticated
--     using (public.is_admin()) with check (public.is_admin());
--
--   drop policy if exists "Admins have full access to content" on public.content;
--   create policy "Admins have full access to content"
--     on public.content for all to authenticated
--     using (public.is_admin()) with check (public.is_admin());
--
--   drop policy if exists "Admins have full access to approval_requests" on public.approval_requests;
--   create policy "Admins have full access to approval_requests"
--     on public.approval_requests for all to authenticated
--     using (public.is_admin()) with check (public.is_admin());
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 075 Approval RLS Hardening
-- ════════════════════════════════════════════════════════════════════════════
