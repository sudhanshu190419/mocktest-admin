-- ============================================================================
-- Migration: 165 — Allow Institute Members to Read Published PYQ Papers Catalog
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- Allows authenticated members (students) of an institute to browse published,
-- non-deleted PYQ paper catalog metadata (paper title, year, duration,
-- total_questions count) before purchase.
--
-- Replaces the restrictive "Students can read pyq_papers they have purchased access to"
-- policy from Migration 147 which prevented unenrolled students from viewing the
-- paper catalog in the mobile Exam Pack Detail screen.
--
-- Security boundary:
-- - Only published (is_published = true) and active (deleted_at IS NULL) papers.
-- - Strictly scoped to the authenticated member's institute (institute_id = public.get_my_institute_id()).
-- - Question mappings (pyq_question_mappings), mock test attempts (pyq_mock_mappings),
--   and solution PDFs remain protected by purchase gates and separate RLS policies.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Replace pyq_papers SELECT policy for Students / Institute Members ─────

DROP POLICY IF EXISTS "Students can read pyq_papers they have purchased access to"
  ON public.pyq_papers;

DROP POLICY IF EXISTS "Members can read published pyq_papers in institute"
  ON public.pyq_papers;

CREATE POLICY "Members can read published pyq_papers in institute"
  ON public.pyq_papers
  FOR SELECT
  TO authenticated
  USING (
    is_published = true
    AND deleted_at IS NULL
    AND institute_id = public.get_my_institute_id()
  );

COMMENT ON POLICY "Members can read published pyq_papers in institute"
  ON public.pyq_papers IS
  'Allows authenticated institute members to view published, non-deleted PYQ paper catalog metadata prior to purchase.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only
-- if this migration must be reverted):
--
--   DROP POLICY IF EXISTS "Members can read published pyq_papers in institute" ON public.pyq_papers;
--   CREATE POLICY "Students can read pyq_papers they have purchased access to"
--     ON public.pyq_papers
--     FOR SELECT
--     TO authenticated
--     USING (
--       is_published = true
--       AND institute_id = public.get_my_institute_id()
--       AND EXISTS (
--         SELECT 1 FROM public.student_pyq_purchases spp
--         WHERE spp.package_id = pyq_papers.package_id
--         AND spp.student_id = public.get_my_student_id()
--         AND spp.is_active = true
--       )
--     );
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 165
-- ════════════════════════════════════════════════════════════════════════════
