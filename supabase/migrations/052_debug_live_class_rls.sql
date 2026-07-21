-- ============================================================================
-- Migration: 052 — Temporary Debug: Live Class RLS Diagnostics
--
-- PostgreSQL 16 | Supabase Compatible | DEBUG ONLY
--
-- This is a TEMPORARY debug function. It will be removed once the RLS
-- violation root cause is identified and fixed.
--
-- Purpose
-- -------
-- Call this from the application code immediately before the
-- `live_class_batch` INSERT to verify:
--
--   1. What auth.uid() resolves to at the SQL level
--   2. What get_my_teacher_id() resolves to
--   3. What teacher_id is stored in the live_classes row for this class_id
--   4. Whether get_live_class_teacher_id() returns the expected value
--
-- This allows us to compare the three values and pinpoint why the
-- policy `get_live_class_teacher_id(class_id) = get_my_teacher_id()`
-- evaluates to FALSE.
--
-- Usage (from application code):
--   const { data, error } = await supabase
--     .rpc('debug_live_class_rls', { p_class_id: 'uuid-here' });
--   console.log('[DEBUG] RLS Debug:', data);
--
-- ============================================================================

drop function if exists public.debug_live_class_rls(uuid);

create or replace function public.debug_live_class_rls(p_class_id uuid)
returns table (
  sql_auth_uid       uuid,
  sql_my_teacher_id  uuid,
  stored_teacher_id  uuid,
  function_teacher_id uuid,
  class_id_exists    boolean,
  status             text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auth_uid          uuid;
  v_my_teacher_id     uuid;
  v_stored_teacher_id uuid;
  v_function_tid      uuid;
  v_class_exists      boolean;
  v_status            text;
begin
  -- 1. Get auth.uid() as seen by SQL
  v_auth_uid := auth.uid();

  -- 2. Get the teacher_id for this auth user via the helper function
  v_my_teacher_id := public.get_my_teacher_id();

  -- 3. Get the teacher_id actually stored in live_classes for this class_id
  select lc.teacher_id, lc.status
  into v_stored_teacher_id, v_status
  from public.live_classes lc
  where lc.class_id = p_class_id;

  v_class_exists := found;

  -- 4. Get what get_live_class_teacher_id() returns (the function used in the policy)
  v_function_tid := public.get_live_class_teacher_id(p_class_id);

  -- Return all values as a single-row table
  return query
  select
    v_auth_uid          as sql_auth_uid,
    v_my_teacher_id     as sql_my_teacher_id,
    v_stored_teacher_id as stored_teacher_id,
    v_function_tid      as function_teacher_id,
    v_class_exists      as class_id_exists,
    v_status            as status;
end;
$$;

-- ============================================================================
-- END OF TEMPORARY DEBUG MIGRATION 052
-- ============================================================================
