-- ============================================================================
-- Migration: 193 - Consolidate Student Lifecycle Status Counts RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Consolidates the 5 separate HTTP count requests on public.profiles
--   (pending, approved, rejected, suspended, inactive) executed by the
--   Admin Student Management feature into a single, highly-optimized
--   SECURITY DEFINER RPC function.
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
--   - Returns predictable typed JSONB matching StudentLifecycleCounts
--     (including both 'totalStudents' and 'total').
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_student_lifecycle_counts(
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
  v_pending             bigint;
  v_approved            bigint;
  v_rejected            bigint;
  v_suspended           bigint;
  v_inactive            bigint;
  v_total               bigint;
BEGIN
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify admin authorization
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only administrators can access student lifecycle counts.' USING ERRCODE = '42501';
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
      RAISE EXCEPTION 'Forbidden: cannot access student counts for another institute.' USING ERRCODE = '42501';
    END IF;
    -- Always force institute scope to the caller's institute (never allow NULL for non-super-admin)
    v_target_institute_id := v_caller_institute_id;
    IF v_target_institute_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: institute-scoped admin is missing an institute association.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Calculate counts in a single aggregation scan
  SELECT
    count(*) FILTER (WHERE account_status = 'pending')   AS pending,
    count(*) FILTER (WHERE account_status = 'approved')  AS approved,
    count(*) FILTER (WHERE account_status = 'rejected')  AS rejected,
    count(*) FILTER (WHERE account_status = 'suspended') AS suspended,
    count(*) FILTER (WHERE account_status = 'inactive')  AS inactive
  INTO
    v_pending,
    v_approved,
    v_rejected,
    v_suspended,
    v_inactive
  FROM public.profiles
  WHERE role = 'student'
    AND (v_target_institute_id IS NULL OR institute_id = v_target_institute_id);

  v_total := COALESCE(v_pending, 0) + COALESCE(v_approved, 0) + COALESCE(v_rejected, 0) + COALESCE(v_suspended, 0) + COALESCE(v_inactive, 0);

  RETURN jsonb_build_object(
    'total', v_total,
    'totalStudents', v_total,
    'pending', COALESCE(v_pending, 0),
    'approved', COALESCE(v_approved, 0),
    'rejected', COALESCE(v_rejected, 0),
    'suspended', COALESCE(v_suspended, 0),
    'inactive', COALESCE(v_inactive, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.get_student_lifecycle_counts(uuid) IS
  'Returns consolidated student lifecycle counts (pending, approved, rejected, suspended, inactive, total, totalStudents) in a single aggregation scan with strict multi-tenant authorization.';

REVOKE ALL ON FUNCTION public.get_student_lifecycle_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_lifecycle_counts(uuid) TO authenticated;
