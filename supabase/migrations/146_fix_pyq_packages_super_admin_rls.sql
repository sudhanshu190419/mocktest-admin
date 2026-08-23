-- ============================================================================
-- Migration: 146 - Fix PYQ Packages Super Admin RLS Authorization
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Objective:
--   Align database RLS write authorization on `public.pyq_packages` with the
--   application-layer Super Admin requirement (`pyqPackageService`).
--
-- Changes:
--   1. Drops the overly broad `Admins have full access to pyq_packages` policy
--      (which previously permitted any admin role to write).
--   2. Grants SELECT to admins for all packages in their institute (drafts + published).
--   3. Restricts INSERT, UPDATE, DELETE strictly to Super Admins within their own institute
--      via `public.is_super_admin()` and `institute_id = public.get_my_institute_id()`.
--
-- Security Guarantees:
--   - Non-Super-Admin roles (Academic Admin, Finance Admin, Teacher, Student)
--     are strictly denied write access at the PostgreSQL engine level.
--   - Institute / tenant isolation is strictly preserved.
--   - Existing SELECT behavior for students and teachers is completely preserved.
-- ============================================================================

-- ── 1. Drop Generic Admin Policy ────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins have full access to pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins have full access to pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins can insert pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins can update pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins can delete pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Admins can read all pyq_packages in their institute" ON public.pyq_packages;

-- ── 2. Admin Read Policy (All institute packages including drafts) ──────────

CREATE POLICY "Admins can read all pyq_packages in their institute"
  ON public.pyq_packages
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    AND institute_id = public.get_my_institute_id()
  );

-- ── 3. Super Admin Write Policies (INSERT, UPDATE, DELETE) ──────────────────

CREATE POLICY "Super admins can insert pyq_packages"
  ON public.pyq_packages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super admins can update pyq_packages"
  ON public.pyq_packages
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    AND institute_id = public.get_my_institute_id()
  )
  WITH CHECK (
    public.is_super_admin()
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super admins can delete pyq_packages"
  ON public.pyq_packages
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    AND institute_id = public.get_my_institute_id()
  );

COMMENT ON TABLE public.pyq_packages IS
  'Sellable PYQ package units. Read-accessible by members (when active) and institute admins. '
  'Mutations (INSERT, UPDATE, DELETE) are strictly restricted to Super Admins within their own institute.';
