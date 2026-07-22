-- ============================================================================
-- Migration: Live Class Attendance Tracking
--
-- PostgreSQL 16 | Supabase Compatible
--
-- Changes to the attendance table:
--   1. Replace boolean `is_present` with `attendance_status varchar(20)`
--   2. Add `join_count integer NOT NULL DEFAULT 0`
--   3. Add check constraint for valid attendance_status values
--   4. Backfill existing rows
--   5. Drop indexes referencing is_present
--
-- New:
--   6. Function: calculate_class_attendance() — computes attendance_status
--      for all students in a class when the session ends
--
-- Depends on: Domain 04 (live_classes, live_sessions, attendance, attendance_events)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Schema Changes
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. Add new columns
alter table public.attendance
  add column attendance_status varchar(20) not null default 'absent';

alter table public.attendance
  add column join_count integer not null default 0;

-- 1b. Add check constraint for valid attendance_status values
alter table public.attendance
  add constraint ck_attendance_status_values
    check (attendance_status in ('present', 'partial', 'absent', 'excused'));

-- 1c. Backfill attendance_status from existing is_present values
update public.attendance
  set attendance_status = case
    when is_present = true then 'present'
    else 'absent'
  end;

-- 1d. Backfill join_count from attendance_events (if any events exist)
update public.attendance a
  set join_count = sub.cnt
  from (
    select attendance_id, count(*) as cnt
    from public.attendance_events
    where event_type = 'join'
    group by attendance_id
  ) sub
  where a.attendance_id = sub.attendance_id;

-- 1e. Drop old indexes referencing is_present (they will be recreated for attendance_status)
drop index if exists public.idx_attendance_class_is_present;
drop index if exists public.idx_attendance_student_is_present;

-- 1f. Drop old is_present column
alter table public.attendance
  drop column is_present;

-- 1g. Recreate indexes for attendance_status
create index if not exists idx_attendance_class_status
  on public.attendance (class_id, attendance_status);

create index if not exists idx_attendance_student_status
  on public.attendance (student_id, attendance_status);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Function: calculate_class_attendance
-- ════════════════════════════════════════════════════════════════════════════

/**
 * calculate_class_attendance
 *
 * Computes attendance_status for every student in a class based on their
 * accumulated duration_seconds as a percentage of the class duration.
 *
 * Thresholds (configurable via parameters):
 *   >= 75%  → present
 *   25–74%  → partial
 *   < 25%   → absent
 *
 * Also handles:
 *   - Students who never joined (no attendance record → NO OP)
 *   - Students still marked as "connected" (left_at IS NULL) — records a
 *     leave event for them with the session's ended_at as the leave time
 *   - Manual overrides (is_manual_override = true) — SKIPPED, not overwritten
 *
 * @param p_class_id   UUID of the live_classes row
 * @param p_present_threshold   Percentage threshold for 'present' (default 75)
 * @param p_partial_threshold   Percentage threshold for 'partial' (default 25)
 *
 * @returns TABLE of student_id, old_status, new_status for audit logging
 */
create or replace function public.calculate_class_attendance(
  p_class_id            uuid,
  p_present_threshold   numeric default 75.0,
  p_partial_threshold   numeric default 25.0
)
returns table (
  student_id        uuid,
  old_status        varchar(20),
  new_status        varchar(20),
  duration_seconds  integer,
  pct_attended      numeric(5,2)
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_start  timestamptz;
  v_session_end    timestamptz;
  v_total_seconds  numeric;
begin
  -- ── Get the live session's actual duration ────────────────────────────
  select ls.started_at, ls.ended_at
    into v_session_start, v_session_end
    from public.live_sessions ls
    where ls.class_id = p_class_id
      and ls.status = 'ended'
    limit 1;

  -- If the session hasn't ended yet, use now() as the end time
  if v_session_end is null then
    v_session_end := now();
  end if;

  -- Calculate total class duration in seconds
  v_total_seconds := extract(epoch from (v_session_end - v_session_start));

  -- Guard against zero or negative duration
  if v_total_seconds <= 0 then
    v_total_seconds := 1;  -- prevent division by zero
  end if;

  -- ── Finalize any students still marked as connected ──────────────────
  -- For students with left_at IS NULL, compute their remaining duration
  -- using their LAST JOIN event timestamp (NOT joined_at, which is the
  -- first join).
  -- Then insert a synthetic leave event and update the attendance record.
  insert into public.attendance_events (
    attendance_id, class_id, student_id, institute_id,
    event_type, event_timestamp
  )
  select
    a.attendance_id,
    a.class_id,
    a.student_id,
    a.institute_id,
    'leave',
    v_session_end
  from public.attendance a
  where a.class_id = p_class_id
    and a.left_at is null
    and a.attendance_id not in (
      -- Ensure we don't duplicate a LEAVE that was already recorded
      select ae.attendance_id
      from public.attendance_events ae
      where ae.attendance_id = a.attendance_id
        and ae.event_type = 'leave'
    );

  -- Update duration and left_at for finalized students using the LAST JOIN
  -- event timestamp (correct for students who joined, left, and rejoined).
  update public.attendance a
    set
      duration_seconds = a.duration_seconds + coalesce(
        (
          select greatest(0, extract(epoch from (v_session_end - last_join.ts)))::integer
          from (
            select ae.event_timestamp as ts
            from public.attendance_events ae
            where ae.attendance_id = a.attendance_id
              and ae.event_type = 'join'
            order by ae.event_timestamp desc
            limit 1
          ) last_join
        ),
        0
      ),
      left_at = v_session_end,
      updated_at = now()
    where a.class_id = p_class_id
      and a.left_at is null;

  -- ── Compute attendance_status for each student ───────────────────────
  return query
  with pct as (
    select
      a.attendance_id,
      a.student_id,
      a.duration_seconds,
      round(
        (a.duration_seconds::numeric / v_total_seconds) * 100.0,
        2
      ) as pct_attended,
      a.attendance_status as old_status,
      a.is_manual_override
    from public.attendance a
    where a.class_id = p_class_id
  )
  update public.attendance a
    set
      attendance_status = case
        when pct.is_manual_override then a.attendance_status  -- preserve override
        when pct.pct_attended >= p_present_threshold then 'present'
        when pct.pct_attended >= p_partial_threshold then 'partial'
        else 'absent'
      end,
      updated_at = now()
    from pct
    where a.attendance_id = pct.attendance_id
    returning
      a.student_id,
      pct.old_status,
      a.attendance_status,
      a.duration_seconds,
      pct.pct_attended;
end;
$$;

-- ── Grant execute to authenticated users ────────────────────────────────────
grant execute on function public.calculate_class_attendance(uuid, numeric, numeric)
  to authenticated, service_role;

comment on function public.calculate_class_attendance is
  'Computes attendance_status for all students in a class based on percentage '
  'of class duration attended. Thresholds: >= 75% → present, 25–74% → partial, '
  '< 25% → absent. Manual overrides are preserved.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Update column comments
-- ════════════════════════════════════════════════════════════════════════════

comment on column public.attendance.attendance_status is
  'Flexible attendance status: present (>=75%), partial (25-74%), absent (<25%), '
  'or excused (manual override). Computed automatically at session end.';

comment on column public.attendance.join_count is
  'Number of times the student joined/rejoined the live session. Tracks '
  'reconnections due to network drops or page refreshes.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — Live Class Attendance
-- ════════════════════════════════════════════════════════════════════════════
