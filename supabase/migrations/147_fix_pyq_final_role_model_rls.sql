-- ============================================================================
-- Migration: 147 - Final PYQ Role Authorization Model (Super Admin + Academic Admin)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Objective:
--   Align database RLS authorization on all PYQ domain tables with the final
--   target role permission model:
--
--   1. Super Admin + Academic Admin:
--      - Full read/write access to PYQ Packages, PYQ Papers, Question Mappings,
--        Solutions, and Mock Mappings within their own institute.
--
--   2. Finance Admin:
--      - Retains read/write on commerce (student_pyq_purchases, orders, payments).
--      - Strictly DENIED write access to PYQ Packages, Papers, and Mappings.
--
--   3. Teacher:
--      - Strictly DENIED write and management access across all PYQ tables
--        (Packages, Papers, Question Mappings, Mock Mappings).
--
--   4. Student:
--      - Read-only access to published papers/mappings for packages they have
--        actively purchased.
--
--   5. Institute Isolation:
--      - `institute_id = public.get_my_institute_id()` is strictly maintained on
--        every policy.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Table: public.pyq_packages
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins have full access to pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins have full access to pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins can insert pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins can update pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super admins can delete pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Admins can read all pyq_packages in their institute" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super and academic admins can insert pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super and academic admins can update pyq_packages" ON public.pyq_packages;
DROP POLICY IF EXISTS "Super and academic admins can delete pyq_packages" ON public.pyq_packages;

-- Read: Admins (all institute packages including drafts)
CREATE POLICY "Admins can read all pyq_packages in their institute"
  ON public.pyq_packages
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    AND institute_id = public.get_my_institute_id()
  );

-- Write: Super Admin + Academic Admin only
CREATE POLICY "Super and academic admins can insert pyq_packages"
  ON public.pyq_packages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super and academic admins can update pyq_packages"
  ON public.pyq_packages
  FOR UPDATE
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super and academic admins can delete pyq_packages"
  ON public.pyq_packages
  FOR DELETE
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Table: public.pyq_package_unlocks
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins have full access to pyq_package_unlocks" ON public.pyq_package_unlocks;
DROP POLICY IF EXISTS "Super and academic admins can manage pyq_package_unlocks" ON public.pyq_package_unlocks;
DROP POLICY IF EXISTS "Admins can read pyq_package_unlocks in institute" ON public.pyq_package_unlocks;

CREATE POLICY "Admins can read pyq_package_unlocks in institute"
  ON public.pyq_package_unlocks
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super and academic admins can manage pyq_package_unlocks"
  ON public.pyq_package_unlocks
  FOR ALL
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Table: public.pyq_papers
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins have full access to pyq_papers" ON public.pyq_papers;
DROP POLICY IF EXISTS "Students can read pyq_papers they have purchased access to" ON public.pyq_papers;
DROP POLICY IF EXISTS "Super and academic admins can read pyq_papers in institute" ON public.pyq_papers;
DROP POLICY IF EXISTS "Super and academic admins can insert pyq_papers" ON public.pyq_papers;
DROP POLICY IF EXISTS "Super and academic admins can update pyq_papers" ON public.pyq_papers;
DROP POLICY IF EXISTS "Super and academic admins can delete pyq_papers" ON public.pyq_papers;

-- Read: Students with active purchases
CREATE POLICY "Students can read pyq_papers they have purchased access to"
  ON public.pyq_papers
  FOR SELECT
  TO authenticated
  USING (
    is_published = true
    AND institute_id = public.get_my_institute_id()
    AND EXISTS (
      SELECT 1 FROM public.student_pyq_purchases spp
      WHERE spp.package_id = pyq_papers.package_id
      AND spp.student_id = public.get_my_student_id()
      AND spp.is_active = true
    )
  );

-- Read: Super Admin + Academic Admin
CREATE POLICY "Super and academic admins can read pyq_papers in institute"
  ON public.pyq_papers
  FOR SELECT
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

-- Write: Super Admin + Academic Admin only (Teachers strictly denied)
CREATE POLICY "Super and academic admins can insert pyq_papers"
  ON public.pyq_papers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super and academic admins can update pyq_papers"
  ON public.pyq_papers
  FOR UPDATE
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super and academic admins can delete pyq_papers"
  ON public.pyq_papers
  FOR DELETE
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Table: public.pyq_question_mappings
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins have full access to pyq_question_mappings" ON public.pyq_question_mappings;
DROP POLICY IF EXISTS "Students can read pyq_question_mappings for accessible papers" ON public.pyq_question_mappings;
DROP POLICY IF EXISTS "Super and academic admins can read pyq_question_mappings" ON public.pyq_question_mappings;
DROP POLICY IF EXISTS "Super and academic admins can manage pyq_question_mappings" ON public.pyq_question_mappings;

-- Read: Students with active purchases
CREATE POLICY "Students can read pyq_question_mappings for accessible papers"
  ON public.pyq_question_mappings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pyq_papers pp
      JOIN public.student_pyq_purchases spp ON spp.package_id = pp.package_id
      WHERE pp.paper_id = pyq_question_mappings.paper_id
      AND spp.student_id = public.get_my_student_id()
      AND spp.is_active = true
    )
  );

-- Read: Super Admin + Academic Admin
CREATE POLICY "Super and academic admins can read pyq_question_mappings"
  ON public.pyq_question_mappings
  FOR SELECT
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

-- Write: Super Admin + Academic Admin only
CREATE POLICY "Super and academic admins can manage pyq_question_mappings"
  ON public.pyq_question_mappings
  FOR ALL
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Table: public.pyq_solutions
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins have full access to pyq_solutions" ON public.pyq_solutions;
DROP POLICY IF EXISTS "Students can read pyq_solutions for accessible papers" ON public.pyq_solutions;
DROP POLICY IF EXISTS "Super and academic admins can read pyq_solutions" ON public.pyq_solutions;
DROP POLICY IF EXISTS "Super and academic admins can manage pyq_solutions" ON public.pyq_solutions;

CREATE POLICY "Students can read pyq_solutions for accessible papers"
  ON public.pyq_solutions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pyq_papers pp
      JOIN public.student_pyq_purchases spp ON spp.package_id = pp.package_id
      WHERE pp.paper_id = pyq_solutions.paper_id
      AND spp.student_id = public.get_my_student_id()
      AND spp.is_active = true
    )
  );

CREATE POLICY "Super and academic admins can read pyq_solutions"
  ON public.pyq_solutions
  FOR SELECT
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super and academic admins can manage pyq_solutions"
  ON public.pyq_solutions
  FOR ALL
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Table: public.pyq_mock_mappings
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins have full access to pyq_mock_mappings" ON public.pyq_mock_mappings;
DROP POLICY IF EXISTS "Students can read pyq_mock_mappings for accessible papers" ON public.pyq_mock_mappings;
DROP POLICY IF EXISTS "Super and academic admins can read pyq_mock_mappings" ON public.pyq_mock_mappings;
DROP POLICY IF EXISTS "Super and academic admins can manage pyq_mock_mappings" ON public.pyq_mock_mappings;

CREATE POLICY "Students can read pyq_mock_mappings for accessible papers"
  ON public.pyq_mock_mappings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pyq_papers pp
      JOIN public.student_pyq_purchases spp ON spp.package_id = pp.package_id
      WHERE pp.paper_id = pyq_mock_mappings.paper_id
      AND spp.student_id = public.get_my_student_id()
      AND spp.is_active = true
    )
  );

CREATE POLICY "Super and academic admins can read pyq_mock_mappings"
  ON public.pyq_mock_mappings
  FOR SELECT
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );

CREATE POLICY "Super and academic admins can manage pyq_mock_mappings"
  ON public.pyq_mock_mappings
  FOR ALL
  TO authenticated
  USING (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_academic_admin())
    AND institute_id = public.get_my_institute_id()
  );
