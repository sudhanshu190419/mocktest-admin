-- ============================================================================
-- MIGRATION 112 — ABANDONED LIVE CLASS RECOVERY (Phase 2)
--
-- Prevents live classes from remaining status='live' forever when the teacher
-- disappears (browser crash, laptop shutdown, internet failure, Wi-Fi change,
-- tab closure, OS suspension, unexpected disconnect).
--
-- APPROVED POLICY (Phase 2):
--   - Teacher heartbeat:  every 60 seconds (client → heartbeat_live_class)
--   - Stale threshold:     15 minutes without a heartbeat
--   - Watchdog:            every 5 minutes (pg_cron → Edge Function → RPC)
--   - Practical recovery:  ~15–20 minutes after the last heartbeat
--   - Hard cap:            scheduled_at + duration_min + 15 minutes (wins)
--   - Never-started:       scheduled classes expire (→ cancelled) only after
--                          the Phase 1 start window has fully passed:
--                          scheduled_at + duration_min + 15 minutes
--
-- WHAT THIS MIGRATION CREATES / CHANGES
--   1. live_sessions.last_teacher_activity_at timestamptz NOT NULL DEFAULT now()
--      (the DEFAULT initializes the value when start_scheduled_live_class()
--       INSERTs the session — migration 111 is NOT modified)
--   2. Partial index for stale-live-session scans:
--        live_sessions (status, last_teacher_activity_at) WHERE status='live'
--      (no new live_classes index: idx_live_classes_status_scheduled_at from
--       migration 005 already covers the never-started expiry scan)
--   3. end_live_class(p_class_id, p_ended_reason DEFAULT 'host_ended')
--      — CREATE OR REPLACE preserving ALL Phase 1 behavior; the watchdog
--        passes 'watchdog_timeout'. Default keeps existing callers working.
--   4. heartbeat_live_class(p_class_id) — SECURITY DEFINER, teacher-owned,
--      only updates a LIVE session.
--   5. finalize_class_attendance(p_class_id) — SECURITY DEFINER, one atomic /
--      idempotent attendance finalization (absent creation + synthetic
--      leaves + calculate_class_attendance).
--   6. recover_stale_live_classes(p_institute_id DEFAULT NULL) — SECURITY
--      DEFINER, service-role only. Two independent operations:
--        OP1 live recovery:  end_live_class('watchdog_timeout') for stale /
--                            hard-capped live classes + finalize attendance
--        OP2 never-started:  scheduled → cancelled after the start window
--   7. pg_cron job "live-class-watchdog" (*/5 * * * * UTC) → pg_net →
--      Edge Function (Vault secret "live_class_watchdog_url"), same
--      environment-aware pattern as migrations 097/104/110.
--
-- ATTENDANCE NOTE: for a never-started class NO attendance is created (there
-- is no session; calculate_class_attendance needs a session row). Students
-- already map 'cancelled' classes into their Completed section (student app
-- maps 'completed','cancelled' → Completed) — no student-app change needed.
--
-- @module migrations/112
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Heartbeat column + partial index
-- ════════════════════════════════════════════════════════════════════════════

alter table public.live_sessions
  add column if not exists last_teacher_activity_at timestamptz not null default now();

comment on column public.live_sessions.last_teacher_activity_at is
  'Phase 2 — last time the owning teacher client confirmed it is still in the '
  'live session. Updated by heartbeat_live_class() every ~60s. The watchdog '
  'recover_stale_live_classes() treats a session whose activity is older than '
  '15 minutes as abandoned (unless the hard cap already expired it). The '
  'DEFAULT now() means the value is automatically initialized when the session '
  'row is created by start_scheduled_live_class().';

-- Partial index: fast scan of "which live sessions are stale?" — O(active
-- classes) instead of O(all sessions).
create index if not exists ix_live_sessions_live_activity
  on public.live_sessions (status, last_teacher_activity_at)
  where status = 'live';

-- NOTE: no new index is added for the never-started expiry scan. Migration
-- 005 already provides:
--   idx_live_classes_status_scheduled_at on public.live_classes (status, scheduled_at)
-- which covers WHERE status='scheduled' AND scheduled_at + duration + 15min < now().

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — end_live_class (CREATE OR REPLACE with ended_reason)
-- ════════════════════════════════════════════════════════════════════════════
-- Preserves ALL Phase 1 behavior: SECURITY DEFINER, search_path='', ownership
-- checks, atomic live_classes claim, idempotent live_sessions end,
-- ALREADY_ENDED no-op, transitioned flag. Adds an optional p_ended_reason
-- parameter (DEFAULT 'host_ended') so the watchdog can record
-- 'watchdog_timeout' without breaking existing callers that pass only
-- p_class_id.
create or replace function public.end_live_class(
  p_class_id    uuid,
  p_ended_reason text default 'host_ended'
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
  -- ── 0. Validate ended_reason ───────────────────────────────────────────
  if p_ended_reason is null
     or p_ended_reason not in ('host_ended', 'watchdog_timeout') then
    return jsonb_build_object(
      'success', false, 'code', 'INVALID_END_REASON',
      'message', 'Invalid ended_reason. Allowed values: host_ended, watchdog_timeout.'
    );
  end if;

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
    -- webhook racing the teacher's End / watchdog racing the teacher all
    -- land here).
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
         ended_reason = p_ended_reason,
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
-- SECTION 3 — heartbeat_live_class
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher client liveness heartbeat. SECURITY DEFINER so it bypasses RLS
-- (live_sessions has no teacher UPDATE policy) while enforcing ownership
-- server-side. Only the owning teacher may heartbeat; a student or another
-- teacher always fails. Only a LIVE session is updated.
create or replace function public.heartbeat_live_class(
  p_class_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id    uuid;
  v_class_teacher uuid;
  v_class_status  public.live_class_status;
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
      'message', 'Only teachers may send heartbeats.'
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

  -- ── 4. Class must be live ────────────────────────────────────────────────
  if v_class_status <> 'live'::public.live_class_status then
    return jsonb_build_object(
      'success', false, 'code', 'ALREADY_ENDED',
      'message', 'This class is no longer live; heartbeat ignored.'
    );
  end if;

  -- ── 5. Update the live session's activity timestamp ──────────────────────
  update public.live_sessions
     set last_teacher_activity_at = clock_timestamp(),
         updated_at               = clock_timestamp()
   where class_id = p_class_id
     and status   = 'live'::public.live_session_status;

  if not found then
    return jsonb_build_object(
      'success', false, 'code', 'ALREADY_ENDED',
      'message', 'No active live session to heartbeat.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'code',    'LIVE',
    'class_id', p_class_id
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — finalize_class_attendance
-- ════════════════════════════════════════════════════════════════════════════
-- One atomic / idempotent attendance finalization path (the watchdog needs it
-- because the client-side liveClassAttendanceService.finalizeClassAttendance
-- is not available to a service-role Edge Function). It:
--   1. Creates 'absent' attendance rows for enrolled students who never
--      joined (ON CONFLICT (class_id, student_id) DO NOTHING — same guard the
--      client uses).
--   2. Calls calculate_class_attendance(), which records synthetic LEAVE
--      events for still-connected students (guarded against duplicates),
--      updates duration / left_at, and recomputes attendance_status while
--      preserving is_manual_override.
-- Re-running converges to the same result (idempotent).
create or replace function public.finalize_class_attendance(
  p_class_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute_id uuid;
  v_present int := 0;
  v_partial int := 0;
  v_absent  int := 0;
  v_excused int := 0;
  v_total   int := 0;
begin
  -- ── Resolve the class / institute ──────────────────────────────────────
  select institute_id into v_institute_id
    from public.live_classes
   where class_id = p_class_id;

  if v_institute_id is null then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_FOUND',
      'message', 'Live class not found.'
    );
  end if;

  -- ── 1. Create absent records for enrolled students who never joined ────
  -- Mirrors liveClassAttendanceService.createAbsentRecordsForMissingStudents:
  -- batch IDs come from batch_subject_live_classes → batch_subjects, enrolled
  -- students from batch_students, existing rows are excluded, and the unique
  -- constraint (class_id, student_id) makes the insert idempotent.
  insert into public.attendance (
    class_id,
    student_id,
    institute_id,
    joined_at,
    left_at,
    duration_seconds,
    join_count,
    attendance_status,
    is_manual_override
  )
  select
    p_class_id,
    bs.student_id,
    v_institute_id,
    null,
    null,
    0,
    0,
    'absent',
    false
  from public.batch_students bs
  where bs.batch_id in (
    select distinct bs2.batch_id
      from public.batch_subject_live_classes bslc
      join public.batch_subjects bs2
        on bs2.batch_subject_id = bslc.batch_subject_id
     where bslc.class_id = p_class_id
  )
  and bs.student_id not in (
    select a.student_id
      from public.attendance a
     where a.class_id = p_class_id
  )
  on conflict (class_id, student_id) do nothing;

  -- ── 2. Synthetic LEAVE + duration + status calculation ──────────────────
  -- calculate_class_attendance is SECURITY INVOKER; inside this SECURITY
  -- DEFINER function it runs as the function owner (bypasses RLS), which is
  -- exactly what the service-role watchdog needs.
  select
    count(*) filter (where r.new_status = 'present'),
    count(*) filter (where r.new_status = 'partial'),
    count(*) filter (where r.new_status = 'absent'),
    count(*) filter (where r.new_status = 'excused'),
    count(*)
  into v_present, v_partial, v_absent, v_excused, v_total
  from public.calculate_class_attendance(p_class_id, 75.0, 25.0) r;

  -- ── 3. Structured result ────────────────────────────────────────────────
  return jsonb_build_object(
    'success',       true,
    'code',          'FINALIZED',
    'class_id',      p_class_id,
    'totalStudents', v_total,
    'present',       v_present,
    'partial',       v_partial,
    'absent',        v_absent,
    'excused',       v_excused,
    'finalized',     true
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — recover_stale_live_classes
-- ════════════════════════════════════════════════════════════════════════════
-- Service-role-only watchdog entry point. Two INDEPENDENT cleanup operations:
--
--   OP1 — LIVE CLASS RECOVERY (CASE B: started then disappeared)
--     Candidates: live_classes.status='live' joined to a live session where
--       heartbeat stale > 15 min  OR  hard cap reached
--       (now() > scheduled_at + duration_min + 15 min — wins over heartbeats)
--     For each: end_live_class(class_id, 'watchdog_timeout'); when
--     transitioned=true → finalize_class_attendance(class_id).
--
--   OP2 — NEVER-STARTED EXPIRY (CASE A: teacher never joined)
--     Candidates: live_classes.status='scheduled' where the Phase 1 start
--       window has fully passed: scheduled_at + duration_min + 15 min < now().
--     For each: scheduled → cancelled (cancelled_at, cancelled_reason).
--       NO attendance, NO session, NO recording.
--
-- Idempotent: every transition reuses the atomic WHERE status=... claim
-- patterns, so concurrent runs / manual runs never double-transition or
-- double-finalize. Returns a JSON summary with recovered/expired counts and
-- the recovered class IDs (so the Edge Function can stop their recordings).
create or replace function public.recover_stale_live_classes(
  p_institute_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recovered     int := 0;
  v_expired       int := 0;
  v_finalized     int := 0;
  v_recovered_ids uuid[] := '{}'::uuid[];
  v_expired_ids   uuid[] := '{}'::uuid[];
  v_errors        jsonb  := '[]'::jsonb;
  v_result        jsonb;
  r               record;
begin
  -- ── 0. Authorization: service_role only ────────────────────────────────
  -- Normal teachers/students can never trigger recovery. Super Admin can run
  -- it directly for operational testing ONLY through a service-role context
  -- (e.g. the Edge Function or a service-role RPC call) — there is no
  -- authenticated-role path into this function.
  if auth.role() <> 'service_role' then
    return jsonb_build_object(
      'success', false, 'code', 'NOT_AUTHORIZED',
      'message', 'Only the service role may run abandoned-class recovery.'
    );
  end if;

  -- ── OP1 — LIVE CLASS RECOVERY (stale heartbeat OR hard cap) ─────────────
  for r in
    select lc.class_id
      from public.live_classes lc
      join public.live_sessions ls
        on ls.class_id = lc.class_id
       and ls.status   = 'live'::public.live_session_status
     where lc.status = 'live'::public.live_class_status
       and (p_institute_id is null or lc.institute_id = p_institute_id)
       and (
         ls.last_teacher_activity_at < now() - interval '15 minutes'
         or now() > lc.scheduled_at + make_interval(mins => lc.duration_min)
                   + interval '15 minutes'
       )
  loop
    begin
      v_result := public.end_live_class(r.class_id, 'watchdog_timeout');
      if (v_result->>'code') = 'ENDED'
         and coalesce((v_result->>'transitioned')::boolean, false) then
        v_recovered := v_recovered + 1;
        v_recovered_ids := array_append(v_recovered_ids, r.class_id);
        -- Finalize attendance (idempotent); best-effort so a finalization
        -- failure never blocks the class transition.
        begin
          perform public.finalize_class_attendance(r.class_id);
          v_finalized := v_finalized + 1;
        exception when others then
          v_errors := v_errors || jsonb_build_object(
            'class_id', r.class_id,
            'step',     'finalize_attendance',
            'error',    SQLERRM
          );
        end;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'class_id', r.class_id,
        'step',     'end_live_class',
        'error',    SQLERRM
      );
    end;
  end loop;

  -- ── OP2 — NEVER-STARTED EXPIRY (start window fully passed) ──────────────
  for r in
    select class_id
      from public.live_classes
     where status = 'scheduled'::public.live_class_status
       and (p_institute_id is null or institute_id = p_institute_id)
       and scheduled_at + make_interval(mins => duration_min)
           + interval '15 minutes' < now()
  loop
    -- The WHERE clause repeats the status + window conditions so a
    -- simultaneous legitimate start (which atomically flips status → live)
    -- cannot be overwritten by this expiry.
    update public.live_classes
       set status           = 'cancelled'::public.live_class_status,
           cancelled_at     = clock_timestamp(),
           cancelled_reason = 'Start window expired (teacher did not start)',
           updated_at       = clock_timestamp()
     where class_id = r.class_id
       and status   = 'scheduled'::public.live_class_status
       and scheduled_at + make_interval(mins => duration_min)
           + interval '15 minutes' < now();

    if found then
      v_expired := v_expired + 1;
      v_expired_ids := array_append(v_expired_ids, r.class_id);
    end if;
  end loop;

  -- ── Result summary ───────────────────────────────────────────────────────
  return jsonb_build_object(
    'success',                true,
    'code',                   'RECOVERY_COMPLETE',
    'recoveredLiveClasses',   v_recovered,
    'expiredScheduledClasses', v_expired,
    'attendanceFinalized',    v_finalized,
    'recoveredClassIds',      to_jsonb(v_recovered_ids),
    'expiredClassIds',        to_jsonb(v_expired_ids),
    'errors',                 v_errors
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Privileges
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function public.end_live_class(uuid, text) from public;
revoke all on function public.heartbeat_live_class(uuid) from public;
revoke all on function public.finalize_class_attendance(uuid) from public;
revoke all on function public.recover_stale_live_classes(uuid) from public;

grant execute on function public.end_live_class(uuid, text)
  to authenticated, service_role;
grant execute on function public.heartbeat_live_class(uuid)
  to authenticated, service_role;
grant execute on function public.finalize_class_attendance(uuid)
  to service_role;
grant execute on function public.recover_stale_live_classes(uuid)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Required extensions + pg_cron registration
-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron  — provides cron.schedule / cron.unschedule / cron.job.
-- pg_net   — provides net.http_post (async HTTP from SQL).
-- VAULT: NOT created here — provided by the platform-provisioned
-- `supabase_vault` extension (schema `vault`), same as migrations 104/110.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Unschedule-then-schedule pattern (same as 097/104/110): cron.schedule()
-- raises if the jobname already exists, so the job is removed first when
-- present. Re-running this migration always converges to exactly ONE row.
-- The job command resolves the environment URL at execution time from the
-- Vault secret "live_class_watchdog_url" and fails safely when missing.
do $migration$
begin
  if exists (select 1 from cron.job where jobname = 'live-class-watchdog') then
    perform cron.unschedule('live-class-watchdog');
  end if;

  perform cron.schedule(
    'live-class-watchdog',
    '*/5 * * * *',   -- every 5 minutes UTC
    $cmd$
      do $$
      declare
        v_watchdog_url text;
      begin
        -- Resolve this environment's function URL at execution time.
        select decrypted_secret
          into v_watchdog_url
          from vault.decrypted_secrets
         where name = 'live_class_watchdog_url'
         limit 1;

        -- FAIL-SAFE: never issue an HTTP request when the configuration is
        -- missing. The exception aborts this run BEFORE net.http_post, so no
        -- URL is ever called. The error is recorded in cron.job_run_details.
        if v_watchdog_url is null or v_watchdog_url = '' then
          raise exception
            'LIVE_CLASS_WATCHDOG_URL_MISSING: Vault secret '
            '"live_class_watchdog_url" is not configured for this '
            'environment. Watchdog run skipped (fail-safe) - no HTTP '
            'request was issued.';
        end if;

        -- Same request contract as 097/104/110: POST, Content-Type
        -- application/json, empty body, 30s timeout.
        perform net.http_post(
          url                 := v_watchdog_url,
          headers             := '{"Content-Type": "application/json"}'::jsonb,
          body                := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      end
      $$;
    $cmd$
  );

  -- Deploy-time visibility (warning only, never an error): if the secret is
  -- not configured yet, the job is still registered but will fail safely at
  -- runtime until the secret is created for this environment. Only the secret
  -- NAME is mentioned — never its value.
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'live_class_watchdog_url'
  ) then
    raise warning
      'LIVE_CLASS_WATCHDOG_URL_MISSING: Vault secret '
      '"live_class_watchdog_url" is not configured yet. The cron job is '
      'registered but will fail safely at runtime until the secret is created '
      'for this environment (Dashboard -> Vault, or vault.create_secret).';
  else
    raise notice
      'LIVE_CLASS_WATCHDOG_SCHEDULED job=live-class-watchdog '
      'schedule=*/5 * * * * registered successfully (environment-aware)';
  end if;
end
$migration$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Stop the scheduled job (keeps the Edge Function, extensions, RPCs, and all
-- business logic deployed — only the automatic scheduling is removed):
--
--   select cron.unschedule('live-class-watchdog');
--
-- To remove the schema pieces entirely (inverse order):
--   drop function if exists public.recover_stale_live_classes(uuid);
--   drop function if exists public.finalize_class_attendance(uuid);
--   drop function if exists public.heartbeat_live_class(uuid);
--   drop function if exists public.end_live_class(uuid, text);
--   drop index if exists ix_live_sessions_live_activity;
--   alter table public.live_sessions drop column last_teacher_activity_at;
--
-- (pg_cron / pg_net extensions, and the platform-provisioned supabase_vault
-- extension that provides the `vault` schema, are intentionally NOT dropped:
-- they are shared platform infrastructure and other objects may depend on
-- them — same as 097/104/110.)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — Validation queries (run manually after deploy)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Exactly one job exists, with the expected contract:
--      select jobid, jobname, schedule, active, database, username, command
--      from cron.job
--      where jobname = 'live-class-watchdog';
--    Expected: exactly 1 row; schedule = '*/5 * * * *'; command contains NO
--    URL literal (it resolves the secret at runtime instead).
--
-- 2. Extensions are enabled (Vault's extension name is `supabase_vault`):
--      select extname, extversion
--      from pg_extension
--      where extname in ('pg_cron', 'pg_net', 'supabase_vault')
--      order by extname;
--
-- 3. The secret exists for THIS environment (selects the NAME only — the
--    decrypted value is NOT displayed here):
--      select name, created_at
--      from vault.decrypted_secrets
--      where name = 'live_class_watchdog_url';
--
-- 4. Manual run to prove the fail-safe (run while the secret is missing —
--    expects a LIVE_CLASS_WATCHDOG_URL_MISSING exception and NO HTTP call):
--      select cron.run_job((select jobid from cron.job
--                            where jobname = 'live-class-watchdog'));
--    After creating the secret, re-run and expect status 'Succeeded' in:
--      select status, return_message, start_time, end_time
--      from cron.job_run_details
--      order by start_time desc
--      limit 5;
--
-- 5. Direct RPC sanity check (service-role context, e.g. via the Edge
--    Function or a service-role client — returns a summary JSONB):
--      select public.recover_stale_live_classes(null);
--
-- 6. Heartbeat ownership is enforced:
--      -- as the owning teacher  → { success: true, code: 'LIVE' }
--      select public.heartbeat_live_class('<live class uuid>');
--      -- as a student / other teacher → NOT_AUTHORIZED
-- ============================================================================

-- END OF MIGRATION — 112 Abandoned Live Class Recovery
