-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 116 — Timetable stale live_class reconciliation (Option D)
--
-- GOAL
--   When a timetable_slots row is changed, future live_classes that no longer
--   correspond to the slot rule must be reconciled automatically, while
--   legitimate leave/resolution outcomes stay protected. This is the
--   database-authoritative fix for stale materialized classes (e.g. the known
--   Aug-15 2026 class on a slot later reconfigured to a Thursday 11:00 rule
--   valid only through Aug-14).
--
-- APPROVED DESIGN (Option D)
--   1. reconcile_timetable_slot_internal(uuid) — the exact migration-115
--      reconciliation body (restore / cancel / junction re-point / fill,
--      holiday + teacher-leave guards, RESOLVED-resolution protection),
--      WITHOUT the caller/scope checks so the AFTER UPDATE trigger and the
--      cron sweep can invoke it. Row-locks the slot (FOR NO KEY UPDATE).
--   2. reconcile_timetable_slot(uuid) — public compatibility wrapper with the
--      original authorization + institute-scope checks, delegating to (1).
--   3. reconcile_institute_timetable(uuid) — reconcile every slot of an
--      institute (any status) for cron convergence.
--   4. AFTER UPDATE trigger on timetable_slots — fires ONLY for
--      schedule-affecting changes (day_of_week/start/end/teacher/batch_subject/
--      status/valid_from-shortened/valid_until-shortened). Extension and
--      metadata-only updates are no-ops.
--   5. Row locking — materialize_timetable_classes + update_timetable_slot
--      now lock the slot row so editing/materialization/reconciliation/cron
--      serialize instead of racing.
--   6. Grants/revokes — internal helpers are not executable by clients.
--   7. One-time backfill — reconcile every existing slot, soft-cancelling
--      stale future classes (never hard-deletes), then re-label the known
--      stale class with a clear reason (guarded by the resolution guard).
--
-- SAFETY
--   * Migration 114 and 115 are NOT modified.
--   * The migration-115 RESOLVED-resolution guard is preserved EXACTLY.
--   * Stale classes are soft-cancelled (status='cancelled'); no DELETE.
--   * No RLS changes; no service-role keys added to frontend code.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — reconcile_timetable_slot_internal(uuid)
--   Migration-115 body minus caller/scope checks, plus a row lock on the slot.
--   Callers enforce authorization and institute scope:
--     * reconcile_timetable_slot        (admin/service_role + scope)
--     * reconcile_institute_timetable   (admin/service_role + scope)
--     * AFTER UPDATE trigger            (fires only for legitimate slot writes)
--     * migration backfill              (trusted migration context)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.reconcile_timetable_slot_internal(p_slot_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot          record;
  v_timezone      text;
  v_duration_min  integer;
  v_title         varchar(500);
  v_restored      integer := 0;
  v_cancelled     integer := 0;
  v_created       integer := 0;
begin
  if p_slot_id is null then
    raise exception 'A timetable slot id is required.';
  end if;

  -- Load slot + joined batch/subject names (same shape as 109/115) and lock
  -- the slot row so concurrent edits / materialization / cron serialize.
  select ts.timetable_slot_id,
         ts.institute_id,
         ts.teacher_id,
         ts.batch_subject_id,
         ts.day_of_week,
         ts.start_time,
         ts.end_time,
         ts.valid_from,
         ts.valid_until,
         ts.status,
         coalesce(bs.name, s.name) as subject_display_name,
         b.name                    as batch_name
  into v_slot
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  join public.subjects s          on s.subject_id       = bs.subject_id
  join public.batches b           on b.batch_id         = bs.batch_id
  where ts.timetable_slot_id = p_slot_id
  for no key update of ts;

  if v_slot.timetable_slot_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  -- Institute timezone (default Asia/Kolkata — matches 108/109/115)
  select timezone into v_timezone
  from public.institutes
  where institute_id = v_slot.institute_id;
  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  v_duration_min := (extract(epoch from (v_slot.end_time - v_slot.start_time)) / 60)::integer;
  v_title := left(v_slot.subject_display_name || ' — ' || v_slot.batch_name, 500);

  -- ═══════════════════════════════════════════════════════════════════════
  -- ACTIVE SLOT — restore matching rows, cancel stale rows, fill gaps
  -- ═══════════════════════════════════════════════════════════════════════
  if v_slot.status = 'active'::public.timetable_slot_status then

    -- 1) RESTORE/REFRESH future rows that still match the current rule.
    --    (unchanged from 110/115) + resolved-resolution guard.
    update public.live_classes lc
    set status           = 'scheduled'::public.live_class_status,
        cancelled_at     = null,
        cancelled_reason = null,
        teacher_id       = v_slot.teacher_id,
        title            = v_title,
        duration_min     = v_duration_min,
        updated_at       = now()
    where lc.timetable_slot_id = p_slot_id
      and lc.status in (
            'scheduled'::public.live_class_status,
            'cancelled'::public.live_class_status
          )
      and lc.scheduled_at > now()
      and (lc.status = 'scheduled'::public.live_class_status
           or lc.cancelled_reason like 'Superseded by a timetable update%'
           or lc.cancelled_reason like 'This recurring timetable slot is no longer active%')
      and extract(isodow from (lc.scheduled_at at time zone v_timezone)::date) = v_slot.day_of_week
      and lc.scheduled_at = (
            ((lc.scheduled_at at time zone v_timezone)::date + v_slot.start_time)
            at time zone v_timezone
          )
      and (lc.scheduled_at at time zone v_timezone)::date
            between v_slot.valid_from and v_slot.valid_until
      and not exists (
        select 1 from public.institute_holidays h
        where h.institute_id = v_slot.institute_id
          and h.holiday_date = (lc.scheduled_at at time zone v_timezone)::date
      )
      and not exists (
        select 1 from public.teacher_leaves l
        where l.institute_id = v_slot.institute_id
          and l.teacher_id = v_slot.teacher_id
          and l.status = 'active'::public.teacher_leave_status
          and l.start_date <= (lc.scheduled_at at time zone v_timezone)::date
          and l.end_date   >= (lc.scheduled_at at time zone v_timezone)::date
      )
      -- Phase 1 guard: resolved resolutions are never reverted.
      and not exists (
        select 1 from public.class_resolution_events cre
        where cre.timetable_slot_id = p_slot_id
          and cre.status = 'resolved'::public.resolution_status
          and (
            cre.occurrence_date = (lc.scheduled_at at time zone v_timezone)::date
            or cre.class_id = lc.class_id
          )
      );

    get diagnostics v_restored = row_count;

    -- 2) CANCEL future scheduled rows that no longer match the current rule
    --    (unchanged from 110/115) + resolved-resolution guard.
    update public.live_classes lc
    set status           = 'cancelled'::public.live_class_status,
        cancelled_at     = now(),
        cancelled_reason = 'Superseded by a timetable update — this recurring slot''s schedule changed.',
        updated_at       = now()
    where lc.timetable_slot_id = p_slot_id
      and lc.status = 'scheduled'::public.live_class_status
      and lc.scheduled_at > now()
      and not (
        extract(isodow from (lc.scheduled_at at time zone v_timezone)::date) = v_slot.day_of_week
        and lc.scheduled_at = (
              ((lc.scheduled_at at time zone v_timezone)::date + v_slot.start_time)
              at time zone v_timezone
            )
        and (lc.scheduled_at at time zone v_timezone)::date
              between v_slot.valid_from and v_slot.valid_until
        and not exists (
          select 1 from public.institute_holidays h
          where h.institute_id = v_slot.institute_id
            and h.holiday_date = (lc.scheduled_at at time zone v_timezone)::date
        )
        and not exists (
          select 1 from public.teacher_leaves l
          where l.institute_id = v_slot.institute_id
            and l.teacher_id = v_slot.teacher_id
            and l.status = 'active'::public.teacher_leave_status
            and l.start_date <= (lc.scheduled_at at time zone v_timezone)::date
            and l.end_date   >= (lc.scheduled_at at time zone v_timezone)::date
        )
        -- Phase 1 guard: resolved resolutions are never cancelled.
        and not exists (
          select 1 from public.class_resolution_events cre
          where cre.timetable_slot_id = p_slot_id
            and cre.status = 'resolved'::public.resolution_status
            and (
              cre.occurrence_date = (lc.scheduled_at at time zone v_timezone)::date
              or cre.class_id = lc.class_id
            )
        )
      );

    get diagnostics v_cancelled = row_count;

    -- 3) Re-point the junction for every kept future class to the CURRENT
    --    batch_subject (unchanged from 110/115).
    update public.batch_subject_live_classes j
    set batch_subject_id = v_slot.batch_subject_id,
        institute_id     = v_slot.institute_id
    from public.live_classes lc
    where lc.timetable_slot_id = p_slot_id
      and lc.class_id = j.class_id
      and lc.status = 'scheduled'::public.live_class_status
      and lc.scheduled_at > now()
      and j.batch_subject_id is distinct from v_slot.batch_subject_id
      and not exists (
        select 1 from public.batch_subject_live_classes j2
        where j2.class_id          = j.class_id
          and j2.batch_subject_id = v_slot.batch_subject_id
      );

    -- 4) FILL genuinely missing occurrences (unchanged from 110/115).
    v_created := public.materialize_timetable_classes(
      p_slot_id,
      current_date,
      current_date + 60
    );

  -- ═══════════════════════════════════════════════════════════════════════
  -- PAUSED / CANCELLED SLOT — cancel future scheduled occurrences only
  -- ═══════════════════════════════════════════════════════════════════════
  else
    update public.live_classes lc
    set status           = 'cancelled'::public.live_class_status,
        cancelled_at     = now(),
        cancelled_reason = 'This recurring timetable slot is no longer active.',
        updated_at       = now()
    where lc.timetable_slot_id = p_slot_id
      and lc.status = 'scheduled'::public.live_class_status
      and lc.scheduled_at > now()
      -- Phase 1 guard: resolved resolutions survive slot pausing.
      and not exists (
        select 1 from public.class_resolution_events cre
        where cre.timetable_slot_id = p_slot_id
          and cre.status = 'resolved'::public.resolution_status
          and (
            cre.occurrence_date = (lc.scheduled_at at time zone v_timezone)::date
            or cre.class_id = lc.class_id
          )
      );

    get diagnostics v_cancelled = row_count;
  end if;

  return v_restored + v_cancelled + v_created;
end;
$$;

comment on function public.reconcile_timetable_slot_internal(uuid) is
  'Internal reconciliation: restores matching future live_classes, cancels stale '
  'future scheduled classes, re-points batch junctions, and fills missing valid '
  'occurrences for one timetable slot. Identical behavior to migration 115 '
  'reconcile_timetable_slot (including the RESOLVED-resolution guard) minus the '
  'caller/scope checks, which callers enforce. Row-locks the slot. Callable only '
  'by the public wrapper, the AFTER UPDATE trigger, the institute sweep, and the '
  'migration backfill.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Public wrapper: reconcile_timetable_slot(uuid)
--   Original authorization + institute-scope behavior (identical to 115),
--   now delegating to the internal helper.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.reconcile_timetable_slot(p_slot_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute_id uuid;
begin
  -- Caller check (admins or service role for scheduled execution)
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can reconcile timetable slots.';
  end if;

  if p_slot_id is null then
    raise exception 'A timetable slot id is required.';
  end if;

  select institute_id into v_institute_id
  from public.timetable_slots
  where timetable_slot_id = p_slot_id;

  if v_institute_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  -- Institute scope (SECURITY DEFINER bypasses RLS)
  if auth.role() <> 'service_role'
     and v_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetables can only be reconciled for your own institute.';
  end if;

  return public.reconcile_timetable_slot_internal(p_slot_id);
end;
$$;

comment on function public.reconcile_timetable_slot(uuid) is
  'Restores/cancels future scheduled occurrences of a timetable slot to match '
  'its rule (unchanged from migration 110/115) PLUS the Phase-1 resolution '
  'guard, preserving substitute/reschedule outcomes. Public compatibility '
  'wrapper delegating to reconcile_timetable_slot_internal.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — reconcile_institute_timetable(uuid)
--   Reconciles EVERY slot of an institute (active, paused, cancelled) so the
--   scheduled process converges stale future classes AND creates missing valid
--   classes. Deterministic slot order avoids lock-ordering deadlocks between
--   concurrent sweeps.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.reconcile_institute_timetable(p_institute_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_id uuid;
  v_total   integer := 0;
begin
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can reconcile an institute timetable.';
  end if;

  if p_institute_id is null then
    raise exception 'An institute id is required.';
  end if;

  if auth.role() <> 'service_role'
     and p_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetables can only be reconciled for your own institute.';
  end if;

  for v_slot_id in
    select ts.timetable_slot_id
    from public.timetable_slots ts
    where ts.institute_id = p_institute_id
    order by ts.timetable_slot_id
  loop
    v_total := v_total + public.reconcile_timetable_slot_internal(v_slot_id);
  end loop;

  return v_total;
end;
$$;

comment on function public.reconcile_institute_timetable(uuid) is
  'Reconciles every timetable slot of an institute in deterministic order: '
  'restores matching future classes, cancels stale future scheduled classes, '
  're-points batch junctions, and fills missing valid occurrences. Used by the '
  'daily scheduled job so it converges instead of only inserting.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Row locking
--   4a. materialize_timetable_classes: lock the slot row (FOR NO KEY UPDATE) so
--       materialization serializes with concurrent slot edits / reconciliation.
--   4b. update_timetable_slot: lock the slot row (FOR UPDATE) so concurrent
--       editors serialize and the AFTER UPDATE trigger reconciles a consistent
--       final state.
--   Both re-creations are byte-for-byte identical to 113/108 except the added
--   lock clause — no behavior change otherwise.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.materialize_timetable_classes(
  p_slot_id   uuid,
  p_from_date date,
  p_to_date   date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot          record;
  v_timezone      text;
  v_occurrence    date;
  v_scheduled_at  timestamptz;
  v_duration_min  integer;
  v_title         varchar(500);
  v_class_id      uuid;
  v_created       integer := 0;
  v_plan_chapter  uuid;
  v_plan_topic    uuid;
begin
  -- Caller check (admins or service role for future cron)
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can materialize timetable classes.';
  end if;

  if p_from_date is null or p_to_date is null or p_to_date < p_from_date then
    raise exception 'A valid from/to date range is required.';
  end if;

  -- Load slot + joined batch/subject names (same shape as 109/113) with a row
  -- lock so materialization serializes with concurrent slot edits.
  select ts.timetable_slot_id,
         ts.institute_id,
         ts.teacher_id,
         ts.batch_subject_id,
         ts.day_of_week,
         ts.start_time,
         ts.end_time,
         ts.valid_from,
         ts.valid_until,
         ts.status,
         coalesce(bs.name, s.name)  as subject_display_name,
         b.name                     as batch_name
  into v_slot
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  join public.subjects s          on s.subject_id          = bs.subject_id
  join public.batches b           on b.batch_id            = bs.batch_id
  where ts.timetable_slot_id = p_slot_id
  for no key update of ts;

  if v_slot.timetable_slot_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  -- Institute scope (SECURITY DEFINER bypasses RLS)
  if auth.role() <> 'service_role'
     and v_slot.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetables can only be materialized for your own institute.';
  end if;

  -- Only active slots generate classes.
  if v_slot.status <> 'active'::public.timetable_slot_status then
    return 0;
  end if;

  -- Institute timezone
  select timezone into v_timezone
  from public.institutes
  where institute_id = v_slot.institute_id;

  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  v_duration_min := (extract(epoch from (v_slot.end_time - v_slot.start_time)) / 60)::integer;
  v_title := left(v_slot.subject_display_name || ' — ' || v_slot.batch_name, 500);

  -- Iterate occurrence dates in the requested window ∩ validity
  for v_occurrence in
    select g::date
    from generate_series(
      greatest(p_from_date, v_slot.valid_from),
      least(p_to_date, v_slot.valid_until),
      interval '1 day'
    ) g
    where extract(isodow from g) = v_slot.day_of_week
      and not exists (
        select 1 from public.institute_holidays h
        where h.institute_id = v_slot.institute_id
          and h.holiday_date = g::date
      )
      and not exists (
        select 1 from public.teacher_leaves l
        where l.institute_id = v_slot.institute_id
          and l.teacher_id = v_slot.teacher_id
          and l.status = 'active'::public.teacher_leave_status
          and l.start_date <= g::date
          and l.end_date >= g::date
      )
  loop
    -- Wall-clock slot time in the institute's timezone → UTC timestamptz
    v_scheduled_at := (v_occurrence + v_slot.start_time) at time zone v_timezone;

    -- Lesson-plan lookup: WHAT is planned for this (slot, date)
    v_plan_chapter := null;
    v_plan_topic   := null;
    select chapter_id, topic_id
      into v_plan_chapter, v_plan_topic
    from public.lesson_plans
    where timetable_slot_id = p_slot_id
      and occurrence_date = v_occurrence;

    -- FIXED INSERT: only columns that exist on the deployed live_classes.
    insert into public.live_classes (
      institute_id,
      teacher_id,
      title,
      scheduled_at,
      duration_min,
      status,
      is_recorded,
      timetable_slot_id,
      chapter_id,
      topic_id
    )
    values (
      v_slot.institute_id,
      v_slot.teacher_id,
      v_title,
      v_scheduled_at,
      v_duration_min,
      'scheduled'::public.live_class_status,
      true,
      p_slot_id,
      v_plan_chapter,
      v_plan_topic
    )
    on conflict (timetable_slot_id, scheduled_at)
      where timetable_slot_id is not null
    do nothing
    returning class_id into v_class_id;

    if v_class_id is not null then
      insert into public.batch_subject_live_classes (
        batch_subject_id, class_id, institute_id
      )
      values (
        v_slot.batch_subject_id, v_class_id, v_slot.institute_id
      )
      on conflict (batch_subject_id, class_id) do nothing;

      v_created := v_created + 1;
      v_class_id := null;
    end if;
  end loop;

  return v_created;
end;
$$;

comment on function public.materialize_timetable_classes(uuid, date, date) is
  'Idempotently generates live_classes occurrences for one active timetable '
  'slot within a date range, skipping holidays and teacher leaves. Returns '
  'the number of classes created (0 on re-runs). Row-locks the slot so it '
  'serializes with concurrent slot edits (unchanged behavior from 113).';

create or replace function public.update_timetable_slot(
  p_slot_id         uuid,
  p_teacher_id      uuid,
  p_batch_subject_id uuid,
  p_day_of_week     smallint,
  p_start_time      time,
  p_end_time        time,
  p_valid_from      date,
  p_valid_until     date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute_id uuid;
  v_batch_id uuid;
begin
  -- Role check
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only super admins or academic admins can update timetable slots.';
  end if;

  -- Slot must exist, belong to the caller's institute, and be row-locked so
  -- concurrent editors serialize (the AFTER UPDATE trigger then reconciles
  -- the final committed state).
  select institute_id into v_institute_id
  from public.timetable_slots
  where timetable_slot_id = p_slot_id
  for update;

  if v_institute_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  if v_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetable slots can only be updated within your own institute.';
  end if;

  -- Basic validation
  if p_day_of_week not between 1 and 7 then
    raise exception 'day_of_week must be between 1 (Monday) and 7 (Sunday).';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'end_time must be after start_time.';
  end if;
  if p_valid_until < p_valid_from then
    raise exception 'valid_until must be on or after valid_from.';
  end if;

  -- Batch-subject + teacher assignment validation
  if not exists (
    select 1 from public.batch_subjects bs
    where bs.batch_subject_id = p_batch_subject_id
      and bs.institute_id = v_institute_id
  ) then
    raise exception 'The selected batch-subject does not belong to this institute.';
  end if;

  select bs.batch_id into v_batch_id
  from public.batch_subjects bs
  where bs.batch_subject_id = p_batch_subject_id;

  if not exists (
    select 1 from public.batch_subject_teachers bst
    where bst.batch_subject_id = p_batch_subject_id
      and bst.teacher_id = p_teacher_id
      and bst.institute_id = v_institute_id
  ) then
    raise exception 'The selected teacher is not assigned to this batch-subject.';
  end if;

  -- Serialize concurrent edits
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_institute_id::text || ':' || p_teacher_id::text || ':' || p_day_of_week::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_institute_id::text || ':' || v_batch_id::text || ':' || p_day_of_week::text,
      0
    )
  );

  -- Conflict detection (exclude this slot)
  if exists (
    select 1 from public.find_timetable_slot_conflicts(
      v_institute_id, p_teacher_id, p_batch_subject_id,
      p_day_of_week, p_start_time, p_end_time, p_valid_from, p_valid_until,
      p_slot_id
    )
  ) then
    raise exception 'Conflicting timetable slot: same teacher or batch already has an active slot on this day/time within an overlapping validity window.';
  end if;

  -- Update
  update public.timetable_slots
  set teacher_id = p_teacher_id,
      batch_subject_id = p_batch_subject_id,
      day_of_week = p_day_of_week,
      start_time = p_start_time,
      end_time = p_end_time,
      valid_from = p_valid_from,
      valid_until = p_valid_until
  where timetable_slot_id = p_slot_id;
end;
$$;

comment on function public.update_timetable_slot(uuid, uuid, uuid, smallint, time, time, date, date) is
  'Full-field timetable slot update with conflict checks (unchanged from 108) '
  'plus a row lock on the slot so concurrent editors serialize. The AFTER '
  'UPDATE trigger then reconciles the final state.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — AFTER UPDATE trigger on timetable_slots
--   Fires reconciliation ONLY for schedule-affecting changes. Safe for bulk
--   import (114 extends validity only → excluded) and metadata-only updates.
--   Runs as SECURITY DEFINER so it bypasses RLS for the internal reconcile.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.trgfn_timetable_slots_reconcile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_role text;
begin
  -- Only schedule-affecting changes trigger reconciliation:
  --   * day_of_week / start_time / end_time / teacher_id / batch_subject_id /
  --     status changed
  --   * valid_from moved LATER (left-shortened) or valid_until moved EARLIER
  --     (right-shortened)
  -- Validity EXTENSION, updated_at-only, updated_by-only, and metadata-only
  -- updates are no-ops (extension can never create stale classes).
  if not (
    new.day_of_week is distinct from old.day_of_week
    or new.start_time  is distinct from old.start_time
    or new.end_time    is distinct from old.end_time
    or new.teacher_id  is distinct from old.teacher_id
    or new.batch_subject_id is distinct from old.batch_subject_id
    or new.status      is distinct from old.status
    or new.valid_from  > old.valid_from
    or new.valid_until < old.valid_until
  ) then
    return new;
  end if;

  -- Elevate to service_role for the duration of the reconcile so the internal
  -- helper's materialize call passes its caller check regardless of which
  -- legitimate path performed the UPDATE (admin RPC, service_role, SQL editor).
  v_prev_role := nullif(current_setting('request.jwt.claim.role', true), '');
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    perform public.reconcile_timetable_slot_internal(new.timetable_slot_id);
  exception when others then
    perform set_config('request.jwt.claim.role', coalesce(v_prev_role, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.role', coalesce(v_prev_role, ''), true);

  return new;
end;
$$;

drop trigger if exists trg_timetable_slots_reconcile_after_update on public.timetable_slots;
create trigger trg_timetable_slots_reconcile_after_update
  after update on public.timetable_slots
  for each row
  execute function public.trgfn_timetable_slots_reconcile();

comment on trigger trg_timetable_slots_reconcile_after_update on public.timetable_slots is
  'Reconciles the slot after any schedule-affecting UPDATE (day/time/teacher/'
  'batch-subject/status or validity shortening). Never fires for validity '
  'extension or metadata-only changes. Preserves the migration-115 '
  'RESOLVED-resolution guard.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Grants / revokes
--   Public RPCs: authenticated + service_role (same convention as 115).
--   Internal helpers + trigger function: not executable by clients.
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function public.reconcile_timetable_slot(uuid) from public, anon;
grant execute on function public.reconcile_timetable_slot(uuid) to authenticated, service_role;

revoke execute on function public.reconcile_institute_timetable(uuid) from public, anon;
grant execute on function public.reconcile_institute_timetable(uuid) to authenticated, service_role;

revoke execute on function public.reconcile_timetable_slot_internal(uuid) from public, anon, authenticated;
revoke execute on function public.trgfn_timetable_slots_reconcile() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — One-time backfill
--   Reconcile every slot (soft-cancels stale future scheduled classes; never
--   hard-deletes; respects the RESOLVED-resolution guard). Then re-label the
--   known stale class with a clear reason — ONLY if it was cancelled by the
--   sweep (i.e. no resolved resolution protects its occurrence).
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_slot_id uuid;
  v_total   integer := 0;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  for v_slot_id in
    select ts.timetable_slot_id
    from public.timetable_slots ts
    order by ts.timetable_slot_id
  loop
    v_total := v_total + public.reconcile_timetable_slot_internal(v_slot_id);
  end loop;
  raise notice 'Timetable stale-class backfill: reconciled % slots.', v_total;
end $$;

-- Known stale class (Aug-15 2026 class on a slot reconfigured to Thu 11:00
-- valid only through Aug-14): if the sweep cancelled it with the generic
-- superseded reason, give it the clearer reason. If a RESOLVED resolution
-- protects its occurrence, the sweep left it untouched and this stays a no-op.
update public.live_classes lc
set cancelled_reason = 'Stale occurrence outside slot validity — timetable reconfigured.',
    updated_at       = now()
where lc.class_id = '9ef7a7d7-f2fa-4774-8e4d-342cb8ada2d7'
  and lc.status = 'cancelled'::public.live_class_status
  and lc.cancelled_reason like 'Superseded by a timetable update%'
  and not exists (
    select 1 from public.class_resolution_events cre
    where cre.timetable_slot_id = lc.timetable_slot_id
      and cre.status = 'resolved'::public.resolution_status
      and (
        cre.occurrence_date = (lc.scheduled_at at time zone coalesce(
          (select timezone from public.institutes where institute_id = lc.institute_id),
          'Asia/Kolkata'
        ))::date
        or cre.class_id = lc.class_id
      )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 116 Timetable stale live_class reconciliation
-- ════════════════════════════════════════════════════════════════════════════
