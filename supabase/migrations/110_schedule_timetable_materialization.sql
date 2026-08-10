-- ============================================================================
-- Migration: 110 — Automatic Timetable Materialization
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE (approved Option D architecture)
-- ════════════════════════════════════════════════════════════════════════════
-- Two complementary mechanisms keep `live_classes` populated from the
-- recurring `timetable_slots` rules WITHOUT materializing a full year:
--
--   A) IMMEDIATE (admin-triggered, app side)
--        Admin creates/updates a slot → the admin service calls
--        `materialize_institute_timetable` / `reconcile_timetable_slot`
--        best-effort for a rolling current_date → +60 day window.
--
--   B) DAILY CATCH-UP (this migration)
--        pg_cron → net.http_post → `timetable-materialization` Edge Function
--        → per active institute → `materialize_institute_timetable`.
--
-- The teacher calendar keeps reading `live_classes` only. No timetable rule
-- is duplicated into another table.
--
-- This migration adds TWO things:
--   1. SECTION 1 — `public.reconcile_timetable_slot(p_slot_id)`:
--        the atomic cancel-stale-then-regenerate RPC used by the admin
--        service for schedule-affecting edits and archive/deactivation.
--   2. SECTION 2 — the daily cron job `timetable-materialization-daily`,
--        registered exactly like migrations 097/104 (unschedule → schedule,
--        Vault-resolved URL, fail-safe when the secret is missing).
--
-- EXISTING RPCs (migration 108) are NOT modified:
--   public.materialize_timetable_classes(uuid, date, date)
--   public.materialize_institute_timetable(uuid, date, date)
-- Migration 108 / 109 are NOT edited. Idempotency reuses the existing
-- partial unique index `uq_live_classes_timetable_occurrence` + ON CONFLICT.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEPENDENCIES
-- ════════════════════════════════════════════════════════════════════════════
--   002 (live_class_status enum, live_classes), 074 (is_super_admin,
--   is_academic_admin), 021 (get_my_institute_id), 108 (timetable_slots,
--   materialize_timetable_classes), 097/104 (pg_cron, pg_net, vault schema).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — RPC: reconcile_timetable_slot
-- ════════════════════════════════════════════════════════════════════════════
-- Reconciles the future generated occurrences of ONE timetable slot against
-- its CURRENT rule, and — when the slot is still ACTIVE — fills any missing
-- occurrences for the next 60 days. Never touches live/completed classes,
-- sessions, recordings, or attendance/history. Atomic (single transaction).
--
-- CRITICAL DESIGN POINT (verified against the deployed schema):
--   uq_live_classes_timetable_occurrence uniquely indexes
--   (timetable_slot_id, scheduled_at) with status rows kept in the table, so
--   a naive "cancel everything then re-materialize" would collide with the
--   just-cancelled rows (ON CONFLICT DO NOTHING = no-op) and the classes
--   would stay cancelled forever — breaking pause → reactivate and
--   teacher-only edits. Reconcile therefore RESTORES/REFRESHES future rows
--   that still match the rule IN PLACE (status back to 'scheduled', updated
--   teacher/title/duration, junction re-pointed) and only CANCELS rows that
--   genuinely no longer match (wrong day/time, outside validity, holiday,
--   or teacher leave). Materialization then only fills real gaps.
--
-- Behavior by slot status:
--   active    → restore matching future rows + cancel stale future + fill gaps
--   paused    → cancel future scheduled occurrences (nothing regenerated)
--   cancelled → cancel future scheduled occurrences (nothing regenerated)
--
-- All occurrence math mirrors migration 109 exactly:
--   local date   = (scheduled_at AT TIME ZONE institute.timezone)::date
--   expected_at  = (local date + start_time) AT TIME ZONE institute.timezone
-- ============================================================================

create or replace function public.reconcile_timetable_slot(p_slot_id uuid)
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
  -- ── Caller check (admins or service role for scheduled execution) ──────
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can reconcile timetable slots.';
  end if;

  if p_slot_id is null then
    raise exception 'A timetable slot id is required.';
  end if;

  -- ── Load slot + joined batch/subject names (same shape as 109) ─────────
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
  where ts.timetable_slot_id = p_slot_id;

  if v_slot.timetable_slot_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  -- ── Institute scope (SECURITY DEFINER bypasses RLS) ────────────────────
  -- Bind the operation to the caller's own institute; the service role is
  -- exempt (intended for future scheduled/system execution).
  if auth.role() <> 'service_role'
     and v_slot.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetables can only be reconciled for your own institute.';
  end if;

  -- ── Institute timezone (default Asia/Kolkata — matches 108/109) ────────
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
    --    In-place UPDATE avoids colliding with the unique (slot, scheduled_at)
    --    index occupied by these very rows. Covers: pause → reactivate
    --    (status 'cancelled' → 'scheduled'), teacher reassignment, batch/subject
    --    reassignment (title + junction re-pointed below), and end-time-only
    --    changes (duration refreshed). The CHECK constraint (005) requires
    --    cancelled_at = NULL whenever status != 'cancelled'.
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
      -- Restore rows the TIMETABLE SYSTEM cancelled (pause / stale-schedule
      -- reasons) and always refresh rows that are still 'scheduled'. The
      -- existing manual cancel flow (cancelScheduledClass called without a
      -- reason) writes cancelled_reason = NULL, so a NULL reason can NEVER be
      -- treated as a timetable-system cancellation — otherwise a manually
      -- cancelled future occurrence would be silently resurrected by a later
      -- slot edit or pause → reactivate cycle.
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
      );

    get diagnostics v_restored = row_count;

    -- 2) CANCEL future scheduled rows that no longer match the current rule
    --    (wrong weekday, changed start time, outside validity, now a holiday,
    --    or covered by an active teacher leave). Live / completed / historical
    --    rows are never touched; already-cancelled rows stay cancelled.
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
      );

    get diagnostics v_cancelled = row_count;

    -- 3) Re-point the junction for every kept future class to the CURRENT
    --    batch_subject (covers batch/subject reassignment on edit).
    update public.batch_subject_live_classes j
    set batch_subject_id = v_slot.batch_subject_id,
        institute_id     = v_slot.institute_id
    from public.live_classes lc
    where lc.timetable_slot_id = p_slot_id
      and lc.class_id = j.class_id
      and lc.status = 'scheduled'::public.live_class_status
      and lc.scheduled_at > now()
      and j.batch_subject_id is distinct from v_slot.batch_subject_id
      -- Bulletproof against the (batch_subject_id, class_id) unique index:
      -- never repoint a class onto a batch_subject it already has a junction
      -- row for (which would raise a unique violation and abort the txn).
      and not exists (
        select 1 from public.batch_subject_live_classes j2
        where j2.class_id          = j.class_id
          and j2.batch_subject_id = v_slot.batch_subject_id
      );

    -- 4) FILL genuinely missing occurrences (new dates, moved times).
    --    ON CONFLICT makes this a no-op for keys that still exist — the
    --    existing 108/109 idempotency mechanism, reused unchanged.
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
      and lc.scheduled_at > now();

    get diagnostics v_cancelled = row_count;
  end if;

  return v_restored + v_cancelled + v_created;
end;
$$;

comment on function public.reconcile_timetable_slot(uuid) is
  'Restores/cancels future scheduled occurrences of a timetable slot to match '
  'its current rule (never history, live classes, sessions, recordings, or '
  'attendance) and, when the slot is active, fills missing occurrences for the '
  'next 60 days. Returns restored + cancelled + created counts. Callable by '
  'super/academic admins or the service role.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Required extensions (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron  — provides cron.schedule / cron.unschedule / cron.job.
-- pg_net   — provides net.http_post (async HTTP from SQL).
-- VAULT: NOT created here — provided by the platform-provisioned
-- `supabase_vault` extension (schema `vault`), same as migration 104.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Create / replace the scheduled job (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Unschedule-then-schedule pattern (same as 097/104): cron.schedule() raises
-- if the jobname already exists, so the job is removed first when present.
-- Re-running this migration always converges to exactly ONE cron.job row.
--
-- The job command resolves the environment URL at execution time from the
-- Vault secret "timetable_materialization_url" and fails safely when missing.
-- NOTE: the outer DO block uses a distinct dollar-quote tag ($migration$) so
-- it does not collide with the $cmd$ cron command (which itself contains an
-- inner do $$ block) — exactly like migration 104.
do $migration$
begin
  if exists (select 1 from cron.job where jobname = 'timetable-materialization-daily') then
    perform cron.unschedule('timetable-materialization-daily');
  end if;

  perform cron.schedule(
    'timetable-materialization-daily',
    '0 0 * * *',   -- daily at 00:00 UTC
    $cmd$
      do $$
      declare
        v_materialization_url text;
      begin
        -- Resolve this environment's function URL at execution time.
        select decrypted_secret
          into v_materialization_url
          from vault.decrypted_secrets
         where name = 'timetable_materialization_url'
         limit 1;

        -- FAIL-SAFE: never issue an HTTP request when the configuration is
        -- missing. The exception aborts this run BEFORE net.http_post, so no
        -- URL is ever called. The error is recorded in cron.job_run_details.
        if v_materialization_url is null or v_materialization_url = '' then
          raise exception
            'TIMETABLE_MATERIALIZATION_URL_MISSING: Vault secret '
            '"timetable_materialization_url" is not configured for this '
            'environment. Materialization run skipped (fail-safe) - no HTTP '
            'request was issued.';
        end if;

        -- Same request contract as 097/104: POST, Content-Type
        -- application/json, empty body, 30s timeout.
        perform net.http_post(
          url                 := v_materialization_url,
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
    select 1 from vault.decrypted_secrets where name = 'timetable_materialization_url'
  ) then
    raise warning
      'TIMETABLE_MATERIALIZATION_URL_MISSING: Vault secret '
      '"timetable_materialization_url" is not configured yet. The cron job is '
      'registered but will fail safely at runtime until the secret is created '
      'for this environment (Dashboard -> Vault, or vault.create_secret).';
  else
    raise notice
      'TIMETABLE_MATERIALIZATION_SCHEDULED job=timetable-materialization-daily '
      'schedule=0 0 * * * registered successfully (environment-aware)';
  end if;
end
$migration$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Stop the scheduled job (keeps the Edge Function, extensions, RPCs, and all
-- business logic deployed — only the automatic scheduling is removed):
--
--   select cron.unschedule('timetable-materialization-daily');
--
-- (pg_cron / pg_net extensions, and the platform-provisioned supabase_vault
-- extension that provides the `vault` schema, are intentionally NOT dropped:
-- they are shared platform infrastructure and other objects may depend on
-- them — same as 097/104.)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Validation queries (run manually after deploy)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Exactly one job exists, with the expected contract:
--      select jobid, jobname, schedule, active, database, username, command
--      from cron.job
--      where jobname = 'timetable-materialization-daily';
--    Expected: exactly 1 row; schedule = '0 0 * * *'; command contains NO URL
--    literal (it resolves the secret at runtime instead).
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
--      where name = 'timetable_materialization_url';
--
-- 4. Manual run to prove the fail-safe (run while the secret is missing —
--    expects a TIMETABLE_MATERIALIZATION_URL_MISSING exception and NO HTTP call):
--      select cron.run_job((select jobid from cron.job
--                            where jobname = 'timetable-materialization-daily'));
--    After creating the secret, re-run and expect status 'Succeeded' in:
--      select status, return_message, start_time, end_time
--      from cron.job_run_details
--      order by start_time desc
--      limit 5;
--
-- 5. HTTP outcome after a successful run (status 200 expected):
--      select status, status_code, content, timed_out
--      from net._http_response
--      order by id desc
--      limit 5;
--
-- 6. No duplicate job rows after any re-run:
--      select jobname, count(*)
--      from cron.job
--      where jobname = 'timetable-materialization-daily'
--      group by jobname;
--
-- END OF MIGRATION 110
-- ============================================================================
