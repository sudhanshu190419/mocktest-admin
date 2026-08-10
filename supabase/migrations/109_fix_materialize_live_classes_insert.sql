-- ============================================================================
-- Migration: 109 — Fix materialize_timetable_classes live_classes INSERT
--
-- PostgreSQL 16 | Supabase Compatible | Idempotent
--
-- ## Why this migration exists
--
-- Migration 108 introduced public.materialize_timetable_classes() which
-- INSERTed into public.live_classes including a `subject_id` column.
--
-- The real (deployed) live_classes table DOES NOT contain subject_id.
-- First real materialization attempt failed with:
--
--   ERROR: 42703: column "subject_id" of relation "live_classes" does not exist
--
-- ## Root cause
--
-- Migration 005's DDL declares live_classes.subject_id NOT NULL, but the
-- DEPLOYED schema has diverged from the repo migration files — the real
-- live_classes table has no subject_id column. The existing application
-- creation flow (teacherLiveClassService.scheduleLiveClass and
-- teacherService.startLiveClass) is authoritative and NEVER writes
-- subject_id; it inserts only:
--
--   institute_id, teacher_id, chapter_id, title, description,
--   scheduled_at, duration_min, status, is_recorded
--
-- and connects the class to its batch + subject exclusively through the
-- junction table:
--
--   live_classes ── batch_subject_live_classes ── batch_subjects
--                                                        ├── batch_id
--                                                        └── subject_id
--
-- ## What this migration does
--
-- create or replace public.materialize_timetable_classes() with the SAME
-- logic as migration 108 (timezone conversion, holiday/leave skip,
-- institute-scope guard, advisory idempotency via
-- uq_live_classes_timetable_occurrence) but an INSERT that references ONLY
-- columns that actually exist on the deployed live_classes table.
--
-- ## What it does NOT do
--
--   • Does NOT add subject_id to live_classes (schema stays untouched).
--   • Does NOT redesign live_classes / batch_subject_live_classes.
--   • Does NOT modify teacher scheduling, LiveKit, recording, or student UI.
--   • Does NOT modify migration 108 (already applied; left as-is so fresh
--     databases replay 108 → 109 and end in the same correct state).
--
-- Depends on: migration 108 (timetable_slots, live_classes.timetable_slot_id,
--             uq_live_classes_timetable_occurrence, institutes.timezone).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Schema guard: fresh-DB vs deployed-DB divergence
-- ════════════════════════════════════════════════════════════════════════════
-- The DEPLOYED live_classes table has NO subject_id column (42703 on the
-- first real test). But the repo's migration 005 still declares
-- live_classes.subject_id NOT NULL with no default. On a NEW database built
-- by replaying migrations 001 → 109, the corrected INSERT (which omits
-- subject_id, matching the app flow) would otherwise fail with a NOT NULL
-- violation instead of 42703.
--
-- This guard relaxes the constraint ONLY when the column exists:
--   • deployed DB (no column)        → no-op, nothing changes
--   • fresh repo-built DB (column, NOT NULL) → becomes nullable; batch/subject
--     linkage continues exclusively through batch_subject_live_classes,
--     exactly as the application creates classes today.
-- It never adds a column and never touches the deployed schema.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'live_classes'
      and column_name = 'subject_id'
  ) then
    alter table public.live_classes alter column subject_id drop not null;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Replace materialize_timetable_classes
-- ════════════════════════════════════════════════════════════════════════════
-- Generates actual live_classes occurrences for ONE active slot within a
-- date range. Idempotent: ON CONFLICT against uq_live_classes_timetable_occurrence
-- makes re-runs no-ops. Skips institute holidays and active teacher leaves.
-- Callable by super/academic admins or the service role (future cron).
--
-- scheduled_at = (occurrence_date + start_time) AT TIME ZONE institutes.timezone
-- duration_min = end_time - start_time (minutes)
-- status       = 'scheduled' (compatible with the existing teacher flow:
--               startScheduledClass → 'live' → recording)
--
-- Subject/batch linkage is via batch_subject_live_classes — matching the
-- existing application creation flow exactly. No live_classes.subject_id.

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
begin
  -- ── Caller check (admins or service role for future cron) ────────────
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can materialize timetable classes.';
  end if;

  if p_from_date is null or p_to_date is null or p_to_date < p_from_date then
    raise exception 'A valid from/to date range is required.';
  end if;

  -- ── Load slot + joined batch/subject names ───────────────────────────
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
  where ts.timetable_slot_id = p_slot_id;

  if v_slot.timetable_slot_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  -- ── Institute scope (SECURITY DEFINER bypasses RLS) ──────────────────
  -- The caller role was already verified above; now bind the operation to
  -- the caller's own institute so an admin cannot materialize another
  -- institute's slot by passing its UUID. The service role is exempt
  -- because this function is intended to support future scheduled/cron
  -- execution across institutes.
  if auth.role() <> 'service_role'
     and v_slot.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetables can only be materialized for your own institute.';
  end if;

  -- Only active slots generate classes.
  if v_slot.status <> 'active'::public.timetable_slot_status then
    return 0;
  end if;

  -- ── Institute timezone ───────────────────────────────────────────────
  select timezone into v_timezone
  from public.institutes
  where institute_id = v_slot.institute_id;

  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  v_duration_min := (extract(epoch from (v_slot.end_time - v_slot.start_time)) / 60)::integer;
  v_title := left(v_slot.subject_display_name || ' — ' || v_slot.batch_name, 500);

  -- ── Iterate occurrence dates in the requested window ∩ validity ──────
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

    -- FIXED INSERT: only columns that exist on the deployed live_classes.
    -- subject_id removed — batch/subject linkage happens below via
    -- batch_subject_live_classes (identical to the app's own creation flow).
    insert into public.live_classes (
      institute_id,
      teacher_id,
      title,
      scheduled_at,
      duration_min,
      status,
      is_recorded,
      timetable_slot_id
    )
    values (
      v_slot.institute_id,
      v_slot.teacher_id,
      v_title,
      v_scheduled_at,
      v_duration_min,
      'scheduled'::public.live_class_status,
      true,
      p_slot_id
    )
    on conflict (timetable_slot_id, scheduled_at)
      where timetable_slot_id is not null
    do nothing
    returning class_id into v_class_id;

    if v_class_id is not null then
      -- Broadcast to the batch via the existing subject-scoped junction
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
  'the number of classes created (0 on re-runs). Batch/subject linkage via '
  'batch_subject_live_classes (no live_classes.subject_id).';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 109 Materialize live_classes INSERT fix
-- ════════════════════════════════════════════════════════════════════════════
