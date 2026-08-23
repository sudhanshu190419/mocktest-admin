-- ============================================================================
-- Migration: 148 - Atomic PYQ Counter Synchronization Triggers & Backfill
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Objective:
--   1. Automatically maintain `public.pyq_packages.total_papers` accurately
--      across paper creation, soft-delete, restore, and hard-delete.
--   2. Automatically maintain `public.pyq_papers.total_questions` accurately
--      across question mapping insert, delete, and paper reassignment.
--   3. Backfill existing `pyq_packages.total_papers` and `pyq_papers.total_questions`.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger on public.pyq_papers -> public.pyq_packages.total_papers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_pyq_package_total_papers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pkg_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_pkg_id := OLD.package_id;
  ELSE
    v_pkg_id := NEW.package_id;
  END IF;

  IF v_pkg_id IS NOT NULL THEN
    UPDATE public.pyq_packages
    SET total_papers = (
      SELECT count(*)::int
      FROM public.pyq_papers
      WHERE package_id = v_pkg_id
        AND deleted_at IS NULL
    ),
    updated_at = now()
    WHERE package_id = v_pkg_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.package_id IS DISTINCT FROM NEW.package_id AND OLD.package_id IS NOT NULL THEN
    UPDATE public.pyq_packages
    SET total_papers = (
      SELECT count(*)::int
      FROM public.pyq_papers
      WHERE package_id = OLD.package_id
        AND deleted_at IS NULL
    ),
    updated_at = now()
    WHERE package_id = OLD.package_id;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sync_pyq_package_total_papers() IS
  'Maintains pyq_packages.total_papers denormalized count automatically based on active papers (deleted_at IS NULL).';

DROP TRIGGER IF EXISTS trg_sync_pyq_package_total_papers ON public.pyq_papers;

CREATE TRIGGER trg_sync_pyq_package_total_papers
  AFTER INSERT OR UPDATE OF package_id, deleted_at OR DELETE
  ON public.pyq_papers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pyq_package_total_papers();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger on public.pyq_question_mappings -> public.pyq_papers.total_questions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_pyq_paper_total_questions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_paper_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_paper_id := OLD.paper_id;
  ELSE
    v_paper_id := NEW.paper_id;
  END IF;

  IF v_paper_id IS NOT NULL THEN
    UPDATE public.pyq_papers
    SET total_questions = (
      SELECT count(*)::int
      FROM public.pyq_question_mappings
      WHERE paper_id = v_paper_id
    ),
    updated_at = now()
    WHERE paper_id = v_paper_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.paper_id IS DISTINCT FROM NEW.paper_id AND OLD.paper_id IS NOT NULL THEN
    UPDATE public.pyq_papers
    SET total_questions = (
      SELECT count(*)::int
      FROM public.pyq_question_mappings
      WHERE paper_id = OLD.paper_id
    ),
    updated_at = now()
    WHERE paper_id = OLD.paper_id;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sync_pyq_paper_total_questions() IS
  'Maintains pyq_papers.total_questions denormalized count automatically based on mapped questions.';

DROP TRIGGER IF EXISTS trg_sync_pyq_paper_total_questions ON public.pyq_question_mappings;

CREATE TRIGGER trg_sync_pyq_paper_total_questions
  AFTER INSERT OR UPDATE OF paper_id OR DELETE
  ON public.pyq_question_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pyq_paper_total_questions();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill existing counters to guarantee 100% data integrity
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.pyq_packages pkg
SET total_papers = coalesce((
  SELECT count(*)::int
  FROM public.pyq_papers p
  WHERE p.package_id = pkg.package_id
    AND p.deleted_at IS NULL
), 0);

UPDATE public.pyq_papers paper
SET total_questions = coalesce((
  SELECT count(*)::int
  FROM public.pyq_question_mappings m
  WHERE m.paper_id = paper.paper_id
), 0);