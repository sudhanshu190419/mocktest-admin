-- ============================================================================
-- Migration: 242_separate_live_class_discovery_from_installment_authorization.sql
--
-- Domain: Live Class Discovery & Access Control Decoupling
--
-- Purpose:
--   Separates the student's catalog/schedule discovery permissions for live classes
--   from the authoritative LiveKit token join-gate authorization.
--
-- Problem Addressed:
--   Previously, the SELECT policy on public.live_classes ("Students can read live_classes
--   for accessible batch subjects") and public.batch_subject_live_classes delegated
--   to can_student_access_live_course(). In Migration 240, can_student_access_live_course()
--   was updated to enforce zero installment arrears.
--   When a student's installment became overdue, the database suppressed the active
--   live_classes record from SELECT queries. The student app, finding no active record,
--   fell back to synthetic timetable IDs (projected_<slot_id>_<date>), which caused
--   UUID parsing crashes and generic 500 errors instead of cleanly presenting the
--   Installment Payment Overdue lockout screen.
--
-- Solution:
--   1. Introduce dedicated SECURITY DEFINER discovery helper:
--      public.can_student_read_live_class(p_class_id uuid)
--      which permits students to discover scheduled/live classes for batches
--      they are actively enrolled in, without checking installment arrears.
--      Hardened with strict cross-institute boundary validation across
--      live_classes, batch_subject_live_classes, batch_subjects, batches,
--      and batch_students.
--   2. Introduce dedicated SECURITY DEFINER discovery helper:
--      public.can_student_read_batch_subject_live_class(p_batch_subject_id uuid)
--      which permits students to discover batch-subject live class assignments
--      for batches they are actively enrolled in, without checking installment arrears.
--      Hardened with strict cross-institute validation across batch_subjects,
--      batches, and batch_students.
--   3. Re-point the student SELECT policy on public.live_classes to
--      can_student_read_live_class().
--   4. Re-point the student SELECT policy on public.batch_subject_live_classes
--      with row-level institute validation combined with
--      can_student_read_batch_subject_live_class() and correlated verification
--      of the referenced live_classes record.
--   5. The join-gate function public.authorize_live_class_access() remains the
--      STRICT, AUTHORITATIVE financial enforcement point. When an overdue student
--      discovers the real class UUID and attempts to join, authorize_live_class_access()
--      rejects the request with INSTALLMENT_ARREARS_BLOCKED (HTTP 403).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Helper - can_student_read_live_class
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.can_student_read_live_class(
  p_class_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id    uuid;
  v_institute_id  uuid;
  v_class_inst_id uuid;
begin
  if p_class_id is null then
    return false;
  end if;

  -- 1. Caller must be an authenticated student
  if not public.is_student() then
    return false;
  end if;

  -- 2. Resolve authenticated student and institute identity
  v_institute_id := public.get_my_institute_id();

  -- Explicitly anchor student to the authenticated profile's institute
  select sd.student_id into v_student_id
  from public.student_details sd
  where sd.profile_id = auth.uid()
    and sd.institute_id = v_institute_id;

  if v_student_id is null or v_institute_id is null then
    return false;
  end if;

  -- 3. Verify target class exists and belongs to the caller's institute
  select lc.institute_id into v_class_inst_id
  from public.live_classes lc
  where lc.class_id = p_class_id;

  if v_class_inst_id is null or v_class_inst_id is distinct from v_institute_id then
    return false;
  end if;

  -- 4. Verify caller has an active membership in at least one batch linked to this class
  -- Anchored strictly to the caller's authenticated institute at every join stage.
  return exists (
    -- Path A: Modern subject-scoped assignment via batch_subject_live_classes -> batch_subjects -> batches
    select 1
    from public.batch_subject_live_classes bslc
    join public.batch_subjects bs
      on bs.batch_subject_id = bslc.batch_subject_id
    join public.batches b
      on b.batch_id = bs.batch_id
    join public.batch_students bst
      on bst.batch_id = b.batch_id
    where bslc.class_id = p_class_id
      and bslc.institute_id = v_institute_id
      and bs.institute_id = v_institute_id
      and b.institute_id = v_institute_id
      and bs.is_active = true
      and bst.student_id = v_student_id
      and bst.status = 'active'

    union all

    -- Path B: Legacy batch assignment via live_class_batch -> batches
    select 1
    from public.live_class_batch lcb
    join public.batches b
      on b.batch_id = lcb.batch_id
    join public.batch_students bst
      on bst.batch_id = b.batch_id
    where lcb.class_id = p_class_id
      and b.institute_id = v_institute_id
      and bst.student_id = v_student_id
      and bst.status = 'active'
  );
end;
$$;

comment on function public.can_student_read_live_class(uuid) is
  'Phase 11J.4 / Migration 242: Discovery permission for live classes. Returns TRUE '
  'when the authenticated student belongs to an active batch assigned to this live class. '
  'Hardened with multi-level institute boundary checks. Decoupled from financial arrears to '
  'allow schedule discovery while preserving join-time enforcement in authorize_live_class_access(). '
  'SECURITY DEFINER with search_path = ''''.';

revoke all on function public.can_student_read_live_class(uuid) from public;
revoke all on function public.can_student_read_live_class(uuid) from anon;
grant execute on function public.can_student_read_live_class(uuid) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Helper - can_student_read_batch_subject_live_class
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.can_student_read_batch_subject_live_class(
  p_batch_subject_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_id    uuid;
  v_institute_id  uuid;
begin
  if p_batch_subject_id is null then
    return false;
  end if;

  -- 1. Caller must be an authenticated student
  if not public.is_student() then
    return false;
  end if;

  -- 2. Resolve authenticated student and institute identity
  v_institute_id := public.get_my_institute_id();

  -- Explicitly anchor student to the authenticated profile's institute
  select sd.student_id into v_student_id
  from public.student_details sd
  where sd.profile_id = auth.uid()
    and sd.institute_id = v_institute_id;

  if v_student_id is null or v_institute_id is null then
    return false;
  end if;

  -- 3. Verify batch subject belongs to caller's institute, the referenced batch
  -- belongs to caller's institute, and caller is an active member
  return exists (
    select 1
    from public.batch_subjects bs
    join public.batches b
      on b.batch_id = bs.batch_id
    join public.batch_students bst
      on bst.batch_id = b.batch_id
    where bs.batch_subject_id = p_batch_subject_id
      and bs.institute_id = v_institute_id
      and b.institute_id = v_institute_id
      and bs.is_active = true
      and bst.student_id = v_student_id
      and bst.status = 'active'
  );
end;
$$;

comment on function public.can_student_read_batch_subject_live_class(uuid) is
  'Phase 11J.4 / Migration 242: Discovery permission for batch_subject_live_classes junction rows. '
  'Returns TRUE when the authenticated student belongs to the active batch for the given batch_subject. '
  'Hardened with multi-level institute boundary checks. Decoupled from financial arrears to '
  'allow schedule discovery while preserving join-time enforcement in authorize_live_class_access(). '
  'SECURITY DEFINER with search_path = ''''.';

revoke all on function public.can_student_read_batch_subject_live_class(uuid) from public;
revoke all on function public.can_student_read_batch_subject_live_class(uuid) from anon;
grant execute on function public.can_student_read_batch_subject_live_class(uuid) to authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Update Student SELECT Policy on public.live_classes
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Students can read live_classes for accessible batch subjects"
  on public.live_classes;

create policy "Students can read live_classes for accessible batch subjects"
  on public.live_classes
  for select
  to authenticated
  using (
    public.can_student_read_live_class(live_classes.class_id)
  );

comment on policy "Students can read live_classes for accessible batch subjects"
  on public.live_classes is
  'Phase 11J.4 / Migration 242: Enables students in assigned batches to read live class metadata '
  'for schedule/timetable discovery, regardless of installment arrears. Actual join access '
  'remains guarded by authorize_live_class_access().';


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Update Student SELECT Policy on public.batch_subject_live_classes
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Students can read batch_subject_live_classes for their batches"
  on public.batch_subject_live_classes;

create policy "Students can read batch_subject_live_classes for their batches"
  on public.batch_subject_live_classes
  for select
  to authenticated
  using (
    batch_subject_live_classes.institute_id = public.get_my_institute_id()
    and public.can_student_read_batch_subject_live_class(batch_subject_live_classes.batch_subject_id)
    and exists (
      select 1
      from public.live_classes lc
      where lc.class_id = batch_subject_live_classes.class_id
        and lc.institute_id = public.get_my_institute_id()
    )
  );

comment on policy "Students can read batch_subject_live_classes for their batches"
  on public.batch_subject_live_classes is
  'Phase 11J.4 / Migration 242: Enables students in assigned batches to read batch_subject_live_classes '
  'junction metadata for schedule/timetable discovery, regardless of installment arrears. '
  'Anchored with strict multi-level institute checks across the junction row, referenced batch subject, '
  'and referenced live class.';
