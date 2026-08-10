-- ============================================================================
-- Migration: 111 — Live Class Start Security + Atomic Start/End
--
-- PostgreSQL 16 | Supabase Compatible | Additive & Non-Destructive
--
-- Phase 1 of the live-class lifecycle hardening.
--
--   1. public.start_scheduled_live_class(p_class_id uuid, p_room_name text)
--        Authoritative, atomic, concurrency-safe start transition:
--          live_classes:  scheduled → live  (persists room_name)
--          live_sessions: exactly one active row (created or revived)
--        Enforces (server-side only, never trusts the device clock or any
--        caller-supplied teacher_id):
--          - caller is an authenticated TEACHER (or service_role for tooling)
--          - class ownership (live_classes.teacher_id = authenticated teacher)
--          - status = 'scheduled'
--          - start window: scheduled_at - 10 minutes
--                          → scheduled_at + duration_min + 15 minutes
--          - batch assignment re-check via batch_subject_teachers whenever
--            the class has batch_subject_live_classes links (authoritative
--            assignment model — batch_teachers is never used)
--        Exactly one concurrent caller can claim the row (single atomic
--        UPDATE). Structured JSON codes: STARTED / ALREADY_LIVE / TOO_EARLY /
--        WINDOW_EXPIRED / NOT_AUTHORIZED / NOT_FOUND / CLASS_COMPLETED /
--        CLASS_CANCELLED / UNKNOWN.
--
--   2. public.end_live_class(p_class_id uuid)
--        Idempotent end transition:
--          live_sessions: live → ended (ended_reason = 'host_ended')
--          live_classes:  live → completed
--        Repeated / concurrent / retried End requests return ALREADY_ENDED
--        (success) and NEVER re-run attendance finalization. Attendance
--        finalization stays where it is today (frontend triggers
--        finalizeClassAttendance) but is gated on the transitioned flag so it
--        runs at most once per live → completed transition. The LiveKit
--        room_finished webhook behaviour is unchanged.
--
-- No columns are added to any table. No RLS policies are changed. Existing
-- live-class, timetable, recording, attendance and webhook behaviour is
-- preserved. Migration 108/109/110 are untouched.
--
-- Depends on existing helpers (021): public.is_teacher(),
--   public.get_my_teacher_id(); and existing constraints on live_sessions:
--   uq_live_sessions_class_id (1:1), ck_live_sessions_status_ended,
--   ck_live_sessions_ended_at.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — start_scheduled_live_class
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.start_scheduled_live_class(
  p_class_id uuid,
  p_room_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now          timestamptz := clock_timestamp();
  v_teacher_id   uuid;
  v_class        public.live_classes%rowtype;
  v_room         text;
  v_session_id   uuid;
  v_claimed      int;
  v_new_status   public.live_class_status;
  v_new_room     text;
begin
  -- ── 1. Authorization ─────────────────────────────────────────────────────
  -- Teacher-only (never is_admin() — finance/other admins must not gain
  -- teacher start privileges). service_role is allowed for future
  -- server-side tooling.
  if auth.role() = 'service_role' then
    v_teacher_id := null;
  elsif auth.role() = 'authenticated' and public.is_teacher() then
    v_teacher_id := public.get_my_teacher_id();
    if v_teacher_id is null then
      return jsonb_build_object(
        'success', false, 'code', 'NOT_AUTHORIZED',
        'message', 'Teacher identity could not be resolved.'
      );
    end if;
  else
    return jsonb_build_object(
      'success', false, 'code', 'NOT_AUTHORIZED',
      'message', 'Only teachers may start live classes.'
    );
  end if;

  -- ── 2. Load the class ────────────────────────────────────────────────────
  select * into v_class
    from public.live_classes
   where class_id = p_class_id;

  if not found then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_FOUND',
      'message', 'Live class not found.'
    );
  end if;

  -- ── 3. Ownership (authenticated identity, never a caller-supplied id) ───
  if v_teacher_id is not null
     and v_class.teacher_id is distinct from v_teacher_id then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_AUTHORIZED',
      'message', 'You do not own this live class.'
    );
  end if;

  -- ── 4. Status-based denials ──────────────────────────────────────────────
  if v_class.status = 'live'::public.live_class_status then
    select session_id into v_session_id
      from public.live_sessions
     where class_id = p_class_id;
    return jsonb_build_object(
      'success', false, 'code', 'ALREADY_LIVE',
      'message', 'This class is already live.',
      'class_id', p_class_id,
      'room_name', v_class.room_name,
      'session_id', v_session_id
    );
  end if;

  if v_class.status = 'completed'::public.live_class_status then
    return jsonb_build_object(
      'success', false, 'code', 'CLASS_COMPLETED',
      'message', 'This class has already been completed.'
    );
  end if;

  if v_class.status = 'cancelled'::public.live_class_status then
    return jsonb_build_object(
      'success', false, 'code', 'CLASS_CANCELLED',
      'message', 'This class has been cancelled.'
    );
  end if;

  if v_class.status <> 'scheduled'::public.live_class_status then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_FOUND',
      'message', 'Live class is not in a startable state.'
    );
  end if;

  -- ── 5. Batch assignment re-check (authoritative model) ──────────────────
  -- batch_subject_teachers remains the source of truth. If the class has
  -- batch_subject_live_classes links, the teacher must still be assigned to
  -- at least one corresponding batch_subject. Legacy classes without links
  -- are allowed through (compatibility).
  if v_teacher_id is not null
     and exists (
       select 1
         from public.batch_subject_live_classes
        where class_id = p_class_id
     )
     and not exists (
       select 1
         from public.batch_subject_live_classes bslc
         join public.batch_subject_teachers bst
           on bst.batch_subject_id = bslc.batch_subject_id
        where bslc.class_id = p_class_id
          and bst.teacher_id = v_teacher_id
          and bst.institute_id = v_class.institute_id
     ) then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_AUTHORIZED',
      'message', 'You are no longer assigned to the batch for this class.'
    );
  end if;

  -- ── 6. Start window (server time only) ──────────────────────────────────
  -- Allowed: scheduled_at - 10 minutes … scheduled_at + duration_min + 15 min
  if v_now < v_class.scheduled_at - interval '10 minutes' then
    return jsonb_build_object(
      'success', false, 'code', 'TOO_EARLY',
      'message', 'Class can be started 10 minutes before the scheduled time.'
    );
  end if;

  if v_now > v_class.scheduled_at
            + (v_class.duration_min * interval '1 minute')
            + interval '15 minutes' then
    return jsonb_build_object(
      'success', false, 'code', 'WINDOW_EXPIRED',
      'message', 'The start window for this class has expired.'
    );
  end if;

  -- ── 7. Atomic claim: scheduled → live ───────────────────────────────────
  -- Single UPDATE = the concurrency gate. The window/ownership/status checks
  -- are part of the WHERE, so exactly one concurrent caller can win.
  v_room := coalesce(
    nullif(trim(p_room_name), ''),
    'class-' || left(replace(v_class.class_id::text, '-', ''), 8)
  );

  update public.live_classes
     set status     = 'live'::public.live_class_status,
         room_name  = v_room,
         updated_at = v_now
   where class_id = p_class_id
     and teacher_id = v_class.teacher_id
     and status = 'scheduled'::public.live_class_status
     and v_now >= v_class.scheduled_at - interval '10 minutes'
     and v_now <= v_class.scheduled_at
                + (v_class.duration_min * interval '1 minute')
                + interval '15 minutes';

  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    -- Lost the race (or the row changed between read and claim).
    select status, room_name into v_new_status, v_new_room
      from public.live_classes
     where class_id = p_class_id;

    if v_new_status = 'live'::public.live_class_status then
      select session_id into v_session_id
        from public.live_sessions
       where class_id = p_class_id;
      return jsonb_build_object(
        'success', false, 'code', 'ALREADY_LIVE',
        'message', 'This class is already live.',
        'class_id', p_class_id,
        'room_name', v_new_room,
        'session_id', v_session_id
      );
    end if;

    return jsonb_build_object(
      'success', false, 'code', 'UNKNOWN',
      'message', 'The class could not be started. Please refresh and try again.'
    );
  end if;

  -- ── 8. Create / reuse the single live session ───────────────────────────
  -- uq_live_sessions_class_id guarantees at most one row per class. The
  -- DO UPDATE branch only revives a NON-live row (stale leftover from an
  -- inconsistent state). A legitimately ended historical session cannot be
  -- resurrected here because this code path is only reachable when the class
  -- was 'scheduled' and just got claimed — an ended session for a still
  -- scheduled class can only be leftover data, and re-activating it restores
  -- the live-class ⇔ active-session invariant.
  insert into public.live_sessions (
    class_id,
    institute_id,
    provider,
    status,
    started_at
  )
  values (
    p_class_id,
    v_class.institute_id,
    'livekit',
    'live'::public.live_session_status,
    v_now
  )
  on conflict (class_id) do update
    set status       = 'live'::public.live_session_status,
        started_at   = v_now,
        ended_at     = null,
        ended_reason = null,
        updated_at   = v_now
    where public.live_sessions.status
            is distinct from 'live'::public.live_session_status
  returning session_id into v_session_id;

  if v_session_id is null then
    -- Conflicting row was already 'live' → reuse it.
    select session_id into v_session_id
      from public.live_sessions
     where class_id = p_class_id;
  end if;

  -- ── 9. Return structured result ─────────────────────────────────────────
  return jsonb_build_object(
    'success',      true,
    'code',         'STARTED',
    'class_id',     p_class_id,
    'session_id',   v_session_id,
    'institute_id', v_class.institute_id,
    'title',        v_class.title,
    'room_name',    v_room,
    'scheduled_at', v_class.scheduled_at,
    'duration_min', v_class.duration_min
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — end_live_class
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.end_live_class(
  p_class_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now           timestamptz := clock_timestamp();
  v_teacher_id    uuid;
  v_class_teacher uuid;
  v_class_status  public.live_class_status;
  v_session_id    uuid;
  v_claimed       int;
begin
  -- ── 1. Authorization ─────────────────────────────────────────────────────
  if auth.role() = 'service_role' then
    v_teacher_id := null;
  elsif auth.role() = 'authenticated' and public.is_teacher() then
    v_teacher_id := public.get_my_teacher_id();
    if v_teacher_id is null then
      return jsonb_build_object(
        'success', false, 'code', 'NOT_AUTHORIZED',
        'message', 'Teacher identity could not be resolved.'
      );
    end if;
  else
    return jsonb_build_object(
      'success', false, 'code', 'NOT_AUTHORIZED',
      'message', 'Only teachers may end live classes.'
    );
  end if;

  -- ── 2. Load the class ────────────────────────────────────────────────────
  select teacher_id, status into v_class_teacher, v_class_status
    from public.live_classes
   where class_id = p_class_id;

  if not found then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_FOUND',
      'message', 'Live class not found.'
    );
  end if;

  -- ── 3. Ownership ─────────────────────────────────────────────────────────
  if v_teacher_id is not null
     and v_class_teacher is distinct from v_teacher_id then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_AUTHORIZED',
      'message', 'You do not own this live class.'
    );
  end if;

  -- ── 4. Idempotent class transition: live → completed ────────────────────
  update public.live_classes
     set status     = 'completed'::public.live_class_status,
         updated_at = v_now
   where class_id = p_class_id
     and status = 'live'::public.live_class_status;

  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    -- Class was not live when this request ran → report an idempotent no-op
    -- for an already-completed class (double click / two tabs / retry /
    -- webhook racing the teacher's End all land here).
    select status into v_class_status
      from public.live_classes
     where class_id = p_class_id;

    if v_class_status = 'completed'::public.live_class_status then
      return jsonb_build_object(
        'success', true, 'code', 'ALREADY_ENDED',
        'message', 'This class is already completed.',
        'class_id', p_class_id
      );
    end if;

    if v_class_status = 'cancelled'::public.live_class_status then
      return jsonb_build_object(
        'success', false, 'code', 'CLASS_CANCELLED',
        'message', 'This class has been cancelled.'
      );
    end if;

    if v_class_status = 'scheduled'::public.live_class_status then
      return jsonb_build_object(
        'success', false, 'code', 'CLASS_NOT_LIVE',
        'message', 'This class has not started yet.'
      );
    end if;

    return jsonb_build_object(
      'success', false, 'code', 'NOT_FOUND',
      'message', 'Live class not found.'
    );
  end if;

  -- ── 5. End the active session (idempotent) ───────────────────────────────
  -- 0 rows is fine (session already ended / never created) — the class
  -- transition above is the source of truth for the transitioned flag.
  update public.live_sessions
     set status       = 'ended'::public.live_session_status,
         ended_at     = v_now,
         ended_reason = 'host_ended',
         updated_at   = v_now
   where class_id = p_class_id
     and status = 'live'::public.live_session_status
  returning session_id into v_session_id;

  -- ── 6. Return structured result ─────────────────────────────────────────
  -- transitioned=true tells the caller to finalize attendance exactly once.
  return jsonb_build_object(
    'success',      true,
    'code',         'ENDED',
    'transitioned', true,
    'class_id',     p_class_id,
    'session_id',   v_session_id
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Privileges & Documentation
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function public.start_scheduled_live_class(uuid, text) from public;
revoke all on function public.end_live_class(uuid) from public;

grant execute on function public.start_scheduled_live_class(uuid, text)
  to authenticated, service_role;
grant execute on function public.end_live_class(uuid)
  to authenticated, service_role;

comment on function public.start_scheduled_live_class(uuid, text) is
  'Authoritative atomic start for a scheduled live class (Phase 1). Enforces '
  'teacher-only + ownership + status=scheduled + start window (scheduled_at '
  '-10 min … +duration +15 min) + batch_subject_teachers assignment, then '
  'atomically transitions scheduled→live and creates/reuses the single '
  'live_sessions row. Returns structured jsonb codes.';

comment on function public.end_live_class(uuid) is
  'Idempotent end for a live class (Phase 1). Atomically transitions '
  'live_sessions live→ended (host_ended) and live_classes live→completed. '
  'Repeated requests return ALREADY_ENDED; attendance finalization is the '
  'caller''s job and must run only when transitioned=true.';

-- END OF MIGRATION — 111 Live Class Start Security
