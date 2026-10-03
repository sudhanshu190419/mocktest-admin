-- ============================================================================
-- Migration: 201 - Consolidate Course Management Dashboard Counts RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Consolidates the 5 separate HTTP count requests (draft, pending_approval,
--   approved, published, archived) executed by the Admin Course Management
--   dashboard into a single, highly-optimized SECURITY DEFINER RPC function.
--
-- Security:
--   - SECURITY DEFINER with SET search_path = '' (prevents search-path hijacking)
--   - Caller identity derived strictly from auth.uid()
--   - Requires caller to have role = 'admin' (via public.is_admin())
--   - Preserves institute / tenant isolation:
--       * Super Admin: can query platform-wide (p_institute_id IS NULL)
--         or filter by a specific institute UUID.
--       * Institute Admin: strictly scoped to caller's profiles.institute_id.
--         Cannot view platform-wide counts; passing NULL or a foreign institute
--         is rejected.
--   - Returns predictable typed JSONB matching CourseManagementCounts:
--     { total, draft, pending_approval, pendingApproval, approved, published, archived }
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_course_counts(
  p_institute_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id             uuid;
  v_is_super_admin      boolean;
  v_caller_institute_id uuid;
  v_target_institute_id uuid;
  v_total               bigint;
  v_draft               bigint;
  v_pending_approval    bigint;
  v_approved            bigint;
  v_published           bigint;
  v_archived            bigint;
BEGIN
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify admin authorization
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only administrators can access course counts.' USING ERRCODE = '42501';
  END IF;

  -- 3. Determine super admin status & institute scope
  v_is_super_admin := public.is_super_admin();

  -- Fetch caller's institute
  SELECT institute_id INTO v_caller_institute_id
  FROM public.profiles
  WHERE profile_id = v_user_id;

  IF v_is_super_admin THEN
    -- Super Admin: can view platform-wide (p_institute_id IS NULL) or filter by a specific institute
    v_target_institute_id := p_institute_id;
  ELSE
    -- Institute-scoped Admin:
    -- If p_institute_id was explicitly supplied, ensure it matches caller's institute
    IF p_institute_id IS NOT NULL AND p_institute_id IS DISTINCT FROM v_caller_institute_id THEN
      RAISE EXCEPTION 'Forbidden: cannot access course counts for another institute.' USING ERRCODE = '42501';
    END IF;
    -- Always force institute scope to the caller's institute (never allow NULL for non-super-admin)
    v_target_institute_id := v_caller_institute_id;
    IF v_target_institute_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: institute-scoped admin is missing an institute association.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Calculate course counts in a single aggregation scan
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE status = 'draft') AS draft,
    count(*) FILTER (WHERE status = 'pending_approval') AS pending_approval,
    count(*) FILTER (WHERE status = 'approved') AS approved,
    count(*) FILTER (WHERE status = 'published') AS published,
    count(*) FILTER (WHERE status = 'archived') AS archived
  INTO
    v_total,
    v_draft,
    v_pending_approval,
    v_approved,
    v_published,
    v_archived
  FROM public.courses
  WHERE deleted_at IS NULL
    AND (v_target_institute_id IS NULL OR institute_id = v_target_institute_id);

  RETURN jsonb_build_object(
    'total', COALESCE(v_total, 0),
    'draft', COALESCE(v_draft, 0),
    'pending_approval', COALESCE(v_pending_approval, 0),
    'pendingApproval', COALESCE(v_pending_approval, 0),
    'approved', COALESCE(v_approved, 0),
    'published', COALESCE(v_published, 0),
    'archived', COALESCE(v_archived, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_course_counts(uuid) IS
  'Returns consolidated course management counts (total, draft, pending_approval, approved, published, archived) in a single aggregation scan with strict multi-tenant authorization.';

REVOKE ALL ON FUNCTION public.get_admin_course_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_course_counts(uuid) TO authenticated;

-- Performance index for filtered status counts
CREATE INDEX IF NOT EXISTS idx_courses_institute_status_deleted
  ON public.courses (institute_id, status)
  WHERE deleted_at IS NULL;
