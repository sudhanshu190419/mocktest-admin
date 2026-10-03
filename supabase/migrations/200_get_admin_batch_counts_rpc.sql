-- ============================================================================
-- Migration: 200 - Consolidate Batch Management Dashboard Counts RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Consolidates the 4 separate HTTP count requests (active, upcoming,
--   completed, archived) and the unbounded full-table scan for seat capacity
--   executed by the Admin Batch Management dashboard into a single,
--   highly-optimized SECURITY DEFINER RPC function.
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
--   - Returns predictable typed JSONB matching BatchManagementCounts:
--     { total, active, inactive, upcoming, completed, archived, full, availableSeats }
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_batch_counts(
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
  v_active              bigint;
  v_upcoming            bigint;
  v_completed           bigint;
  v_archived            bigint;
  v_inactive            bigint;
  v_full                bigint;
  v_available_seats     bigint;
BEGIN
  -- 1. Validate caller identity (derive strictly from auth.uid())
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify admin authorization
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only administrators can access batch counts.' USING ERRCODE = '42501';
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
      RAISE EXCEPTION 'Forbidden: cannot access batch counts for another institute.' USING ERRCODE = '42501';
    END IF;
    -- Always force institute scope to the caller's institute (never allow NULL for non-super-admin)
    v_target_institute_id := v_caller_institute_id;
    IF v_target_institute_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: institute-scoped admin is missing an institute association.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Calculate batch counts and capacity metrics in a single aggregation scan
  WITH batch_metrics AS (
    SELECT
      b.batch_id,
      b.status,
      b.max_seats,
      COALESCE(count(bs.student_id) FILTER (WHERE bs.status IS NULL OR bs.status = 'active'), 0) AS active_students
    FROM public.batches b
    LEFT JOIN public.batch_students bs ON bs.batch_id = b.batch_id
    WHERE b.deleted_at IS NULL
      AND (v_target_institute_id IS NULL OR b.institute_id = v_target_institute_id)
    GROUP BY b.batch_id, b.status, b.max_seats
  )
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE status = 'active') AS active,
    count(*) FILTER (WHERE status = 'upcoming') AS upcoming,
    count(*) FILTER (WHERE status = 'completed') AS completed,
    count(*) FILTER (WHERE status = 'archived') AS archived,
    count(*) FILTER (WHERE status IN ('upcoming', 'completed')) AS inactive,
    count(*) FILTER (WHERE max_seats IS NOT NULL AND max_seats > 0 AND active_students >= max_seats) AS full,
    COALESCE(sum(CASE WHEN max_seats IS NOT NULL AND max_seats > 0 THEN GREATEST(0, max_seats - active_students) ELSE 0 END), 0) AS available_seats
  INTO
    v_total,
    v_active,
    v_upcoming,
    v_completed,
    v_archived,
    v_inactive,
    v_full,
    v_available_seats
  FROM batch_metrics;

  RETURN jsonb_build_object(
    'total', COALESCE(v_total, 0),
    'active', COALESCE(v_active, 0),
    'inactive', COALESCE(v_inactive, 0),
    'upcoming', COALESCE(v_upcoming, 0),
    'completed', COALESCE(v_completed, 0),
    'archived', COALESCE(v_archived, 0),
    'full', COALESCE(v_full, 0),
    'availableSeats', COALESCE(v_available_seats, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_batch_counts(uuid) IS
  'Returns consolidated batch management counts (total, active, inactive, upcoming, completed, archived, full, availableSeats) in a single aggregation scan with strict multi-tenant authorization.';

REVOKE ALL ON FUNCTION public.get_admin_batch_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_batch_counts(uuid) TO authenticated;
