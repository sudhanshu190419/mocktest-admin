-- ════════════════════════════════════════════════════════════════════════════
-- TIMETABLE STALE LIVE_CLASS RECONCILIATION — LIVE DATABASE TEST HARNESS
-- Tests migration 116:
--   reconcile_timetable_slot_internal · reconcile_timetable_slot ·
--   reconcile_institute_timetable · AFTER UPDATE trigger on timetable_slots ·
--   row locking in materialize_timetable_classes + update_timetable_slot ·
--   one-time backfill behavior (resolution-guard compatibility)
--
-- HOW TO RUN (against a SAFE, DISPOSABLE Supabase-flavoured DB with migrations
-- 108–116 applied — e.g. a local `supabase start` stack after `supabase db reset`):
--
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/timetable_reconcile_tests.sql
--
-- REQUIREMENTS
--   * Connect as a postgres SUPERUSER (fixture inserts bypass RLS).
--   * Migrations 108–116 must be applied (checked below).
--
-- SAFETY
--   The ENTIRE harness runs inside ONE transaction that is ROLLED BACK at the
--   end. Results are printed just before the rollback. No test data persists.
--   Auth paths are simulated via request.jwt.claim.* GUCs
--   (auth.uid()/auth.role()) exactly like the teacher-leave harness.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── 0. Preconditions ───────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.reconcile_timetable_slot_internal(uuid)') is null then
    raise exception 'PRECONDITION FAILED: migration 116 not applied — reconcile_timetable_slot_internal does not exist.';
  end if;
  if to_regprocedure('public.reconcile_institute_timetable(uuid)') is null then
    raise exception 'PRECONDITION FAILED: migration 116 not applied — reconcile_institute_timetable does not exist.';
  end if;
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'timetable_slots'
      and t.tgname = 'trg_timetable_slots_reconcile_after_update'
  ) then
    raise exception 'PRECONDITION FAILED: migration 116 AFTER UPDATE trigger on timetable_slots missing.';
  end if;
  if current_setting('is_superuser') <> 'on' then
    raise exception 'PRECONDITION FAILED: connect as a superuser (e.g. postgres) so RLS cannot block fixture inserts.';
  end if;
end $$;

begin;

-- ── 1. Results / env stores + helpers ──────────────────────────────────────
create temp table tr_test_results (
  test_no int primary key,
  name    text not null,
  result  text not null,
  detail  text not null default ''
);

create temp table tr_test_env (k text primary key, v text not null);

create or replace function tr_env(p_k text)
returns text language sql stable as $$
  select v from tr_test_env where k = p_k;
$$;

-- Simulate an authenticated caller with the given profile id + role.
create or replace function tr_set_auth(p_profile_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_profile_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end $$;

create or replace function tr_record(p_test int, p_name text, p_pass boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into tr_test_results (test_no, name, result, detail)
  values (p_test, p_name, case when p_pass then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $$;

-- Materialize a single date as the service role (admin-only RPC).
create or replace function tr_materialize(p_date date)
returns integer language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  return public.materialize_timetable_classes(tr_env('slot')::uuid, p_date, p_date);
end $$;

-- Reset the shared fixture slot back to its canonical rule (t1, bs, Monday
-- 10:00-11:00, active, -30..+180). The AFTER UPDATE trigger fires on this too
-- (schedule-affecting), which is correct: it reconciles any classes left over
-- from the previous test back to the canonical schedule.
create or replace function tr_restore_slot()
returns void language plpgsql as $$
begin
  update public.timetable_slots
  set teacher_id = tr_env('t1')::uuid,
      batch_subject_id = tr_env('bs')::uuid,
      day_of_week = 1,
      start_time = time '10:00',
      end_time = time '11:00',
      valid_from = current_date - 30,
      valid_until = current_date + 180,
      status = 'active'
  where timetable_slot_id = tr_env('slot')::uuid;
end $$;

-- ── 1b. Schema quirk guard (transactional, rolled back with the harness) ────
-- Migration 114's slot-extension path writes timetable_slots.updated_by, but
-- NO migration declares that column (108 declares only created_by/created_at/
-- updated_at). The live DB has it out-of-band. To let tests 22/23 exercise the
-- 114 reuse+extension path on a fresh `supabase db reset` stack, add the column
-- here inside the harness transaction — it is rolled back with everything else.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'timetable_slots'
      and column_name = 'updated_by'
  ) then
    alter table public.timetable_slots
      add column updated_by uuid null default null;
  end if;
end $$;

-- ── 2. Fixture creation (isolated institute, rolled back at the end) ───────
do $$
declare
  v_inst    uuid;
  v_admin   uuid;
  v_t1      uuid;   -- teacher 1 (original slot teacher)
  v_t2      uuid;   -- teacher 2 (for teacher-change tests)
  v_stream  uuid;
  v_subj    uuid;
  v_batch   uuid;
  v_bs      uuid;
  v_bs2     uuid;   -- second batch-subject (same subject, batch B)
  v_batch2  uuid;
  v_ch      uuid;
  v_tp      uuid;
  v_slot    uuid;
  v_mon     date;
begin
  -- Institute
  insert into public.institutes (name, slug, plan_tier)
  values ('TR Test Institute', 'tr-test-inst', 'starter')
  returning institute_id into v_inst;

  -- Admin profile (role = 'admin') + super_admin grant (074)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'TR Admin', 'tr.admin@test.invalid', '919000000001', 'admin', true)
  returning profile_id into v_admin;
  insert into public.admin_roles (profile_id, institute_id, admin_role, access_status, granted_by)
  values (v_admin, v_inst, 'super_admin', 'approved', v_admin);

  -- Teacher 1 + profile
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'TR Teacher One', 'tr.teacher1@test.invalid', '919000000002', 'teacher', true)
  returning profile_id into v_t1;
  insert into public.teacher_details (profile_id, specialization)
  values (v_t1, 'physics') returning teacher_id into v_t1;

  -- Teacher 2 + profile (teacher-change / substitute scenarios)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'TR Teacher Two', 'tr.teacher2@test.invalid', '919000000003', 'teacher', true)
  returning profile_id into v_t2;
  insert into public.teacher_details (profile_id, specialization)
  values (v_t2, 'physics') returning teacher_id into v_t2;

  -- Academic structure
  insert into public.streams (institute_id, name, code)
  values (v_inst, 'TR Stream', 'TRS') returning stream_id into v_stream;
  insert into public.subjects (stream_id, name, code)
  values (v_stream, 'Physics', 'PHY') returning subject_id into v_subj;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'TR Batch A', 'TR-A', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_batch;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_batch, v_subj, v_inst) returning batch_subject_id into v_bs;
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id)
  values (v_bs, v_t1, v_inst);
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id)
  values (v_bs, v_t2, v_inst);

  -- Batch B + second batch-subject (for batch-subject change tests)
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'TR Batch B', 'TR-B', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_batch2;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_batch2, v_subj, v_inst) returning batch_subject_id into v_bs2;
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id)
  values (v_bs2, v_t1, v_inst);

  insert into public.chapters (subject_id, name)
  values (v_subj, 'Kinematics') returning chapter_id into v_ch;
  insert into public.topics (chapter_id, name)
  values (v_ch, 'Laws of Motion') returning topic_id into v_tp;

  -- Timetable slot: next Monday, 10:00-11:00, valid -30..+180 days
  v_mon := (date_trunc('week', current_date)::date + 7); -- next Monday
  insert into public.timetable_slots (
    institute_id, teacher_id, batch_subject_id, day_of_week,
    start_time, end_time, valid_from, valid_until, status, created_by
  )
  values (
    v_inst, v_t1, v_bs, 1, time '10:00', time '11:00',
    current_date - 30, current_date + 180, 'active', v_admin
  )
  returning timetable_slot_id into v_slot;

  insert into tr_test_env values
    ('inst',  v_inst::text),
    ('admin', v_admin::text),
    ('t1',    v_t1::text),
    ('t2',    v_t2::text),
    ('bs',    v_bs::text),
    ('bs2',   v_bs2::text),
    ('ch',    v_ch::text),
    ('tp',    v_tp::text),
    ('slot',  v_slot::text),
    ('mon',   v_mon::text);

  -- Lesson plan for the target Monday occurrence (chapter + topic)
  insert into public.lesson_plans (institute_id, timetable_slot_id, occurrence_date, chapter_id, topic_id, notes)
  values (v_inst, v_slot, v_mon, v_ch, v_tp, 'fixture lesson plan');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- TESTS
-- ════════════════════════════════════════════════════════════════════════════

-- TEST 1 — normal materialization: next Monday 10:00 class is created
do $$
declare
  v_created int;
  v_count   int;
  v_status  text;
  v_tz      text;
begin
  v_created := tr_materialize(tr_env('mon')::date);
  select count(*), min(status::text)
    into v_count, v_status
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid;

  select timezone into v_tz from public.institutes where institute_id = tr_env('inst')::uuid;

  perform tr_record(1, 'normal materialization',
    v_created = 1 and v_count = 1 and v_status = 'scheduled'
      and exists (
        select 1 from public.live_classes
        where timetable_slot_id = tr_env('slot')::uuid
          and scheduled_at = ((tr_env('mon')::date + time '10:00') at time zone coalesce(v_tz, 'Asia/Kolkata'))
      ),
    'created=' || v_created || ' count=' || v_count || ' status=' || v_status);
end $$;

-- TEST 2 — validity shortening: occurrence beyond new valid_until is cancelled
do $$
declare
  v_mon2 date := tr_env('mon')::date + 7;
  v_created int;
  v_cancelled int;
begin
  v_created := tr_materialize(v_mon2);
  -- Shorten valid_until to before v_mon2 (schedule-affecting → trigger fires)
  update public.timetable_slots
  set valid_until = v_mon2 - 2
  where timetable_slot_id = tr_env('slot')::uuid;

  select count(*) into v_cancelled
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and scheduled_at > now()
    and status = 'cancelled'
    and cancelled_reason like 'Superseded by a timetable update%';

  perform tr_record(2, 'validity shortening cancels stale class',
    v_cancelled >= 1
      and not exists (
        select 1 from public.live_classes
        where timetable_slot_id = tr_env('slot')::uuid
          and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon2
          and status = 'scheduled'
      ),
    'created=' || v_created || ' cancelled=' || v_cancelled);

  perform tr_restore_slot();
end $$;

-- TEST 3 — validity extension: a Monday beyond the original +180 validity
-- becomes materializable after extension, and the extension itself does not
-- cancel anything (extension-only updates are trigger no-ops — see test 23)
do $$
declare
  v_ext_date date;
  v_created  int;
begin
  perform tr_restore_slot();

  -- A Monday beyond the canonical valid_until (current_date + 180)
  v_ext_date := (date_trunc('week', current_date)::date + 7 + 182); -- +26 weeks

  -- Before extension: explicit single-date materialize must be a no-op
  v_created := tr_materialize(v_ext_date);
  if v_created <> 0 then
    raise exception 'TEST 3 PRE-CONDITION: occurrence beyond valid_until was materialized.';
  end if;

  -- Extend valid_until (extension-only → trigger must NOT fire / no cancellation)
  update public.timetable_slots
  set valid_until = v_ext_date + 7
  where timetable_slot_id = tr_env('slot')::uuid;

  -- After extension the occurrence is valid and materializes
  v_created := tr_materialize(v_ext_date);

  perform tr_record(3, 'validity extension materializes new occurrence',
    v_created = 1,
    'created=' || v_created);

  perform tr_restore_slot();
end $$;

-- TEST 4 — day-of-week change: old weekday cancelled, new weekday created
do $$
declare
  v_mon4  date := tr_env('mon')::date + 21;
  v_wed   date;
  v_created int;
  v_mon_ok boolean;
  v_wed_ok boolean;
begin
  v_created := tr_materialize(v_mon4);
  v_wed := v_mon4 + 2; -- Wednesday

  update public.timetable_slots
  set day_of_week = 3 -- Wednesday
  where timetable_slot_id = tr_env('slot')::uuid;

  select not exists (
    select 1 from public.live_classes
    where timetable_slot_id = tr_env('slot')::uuid
      and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon4
      and status = 'scheduled'
  ) into v_mon_ok;

  select exists (
    select 1 from public.live_classes
    where timetable_slot_id = tr_env('slot')::uuid
      and (scheduled_at at time zone 'Asia/Kolkata')::date = v_wed
      and status = 'scheduled'
      and scheduled_at = ((v_wed + time '10:00') at time zone 'Asia/Kolkata')
  ) into v_wed_ok;

  perform tr_record(4, 'day-of-week change reconciles occurrences',
    v_mon_ok and v_wed_ok,
    'monMoved=' || v_mon_ok || ' wedCreated=' || v_wed_ok);

  perform tr_restore_slot();
end $$;

-- TEST 5 — start-time change: old-time class cancelled, new-time created
do $$
declare
  v_mon5 date := tr_env('mon')::date + 28;
  v_created int;
  v_old_ok boolean;
  v_new_ok boolean;
begin
  v_created := tr_materialize(v_mon5);

  update public.timetable_slots
  set start_time = time '11:00', end_time = time '12:00'
  where timetable_slot_id = tr_env('slot')::uuid;

  select not exists (
    select 1 from public.live_classes
    where timetable_slot_id = tr_env('slot')::uuid
      and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon5
      and status = 'scheduled'
      and scheduled_at = ((v_mon5 + time '10:00') at time zone 'Asia/Kolkata')
  ) into v_old_ok;

  select exists (
    select 1 from public.live_classes
    where timetable_slot_id = tr_env('slot')::uuid
      and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon5
      and status = 'scheduled'
      and scheduled_at = ((v_mon5 + time '11:00') at time zone 'Asia/Kolkata')
  ) into v_new_ok;

  perform tr_record(5, 'start-time change reconciles occurrences',
    v_old_ok and v_new_ok,
    'oldGone=' || v_old_ok || ' newCreated=' || v_new_ok);

  perform tr_restore_slot();
end $$;

-- TEST 6 — end-time change: same start keeps the class, duration updated
do $$
declare
  v_mon6 date := tr_env('mon')::date + 35;
  v_created int;
  v_dur int;
begin
  v_created := tr_materialize(v_mon6);

  update public.timetable_slots
  set end_time = time '12:30' -- start unchanged → duration 150 min
  where timetable_slot_id = tr_env('slot')::uuid;

  select duration_min into v_dur
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon6
    and status = 'scheduled';

  perform tr_record(6, 'end-time change updates duration, keeps class',
    v_dur = 150,
    'duration=' || v_dur);

  perform tr_restore_slot();
end $$;

-- TEST 7 — teacher change: existing future class re-pointed to new teacher
do $$
declare
  v_mon7 date := tr_env('mon')::date + 42;
  v_created int;
  v_teacher uuid;
begin
  v_created := tr_materialize(v_mon7);

  update public.timetable_slots
  set teacher_id = tr_env('t2')::uuid
  where timetable_slot_id = tr_env('slot')::uuid;

  select teacher_id into v_teacher
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon7
    and status = 'scheduled';

  perform tr_record(7, 'teacher change re-points future class',
    v_teacher = tr_env('t2')::uuid,
    'teacher=' || coalesce(v_teacher::text, 'null'));

  perform tr_restore_slot();
end $$;

-- TEST 8 — batch-subject change: junction re-pointed to new batch-subject
do $$
declare
  v_mon8 date := tr_env('mon')::date + 49;
  v_created int;
  v_junction uuid;
begin
  v_created := tr_materialize(v_mon8);

  update public.timetable_slots
  set batch_subject_id = tr_env('bs2')::uuid
  where timetable_slot_id = tr_env('slot')::uuid;

  select j.batch_subject_id into v_junction
  from public.batch_subject_live_classes j
  join public.live_classes lc on lc.class_id = j.class_id
  where lc.timetable_slot_id = tr_env('slot')::uuid
    and (lc.scheduled_at at time zone 'Asia/Kolkata')::date = v_mon8
    and lc.status = 'scheduled';

  perform tr_record(8, 'batch-subject change re-points junction',
    v_junction = tr_env('bs2')::uuid,
    'junction=' || coalesce(v_junction::text, 'null'));

  perform tr_restore_slot();
end $$;

-- TEST 9 — slot pause/cancel: future scheduled classes cancelled
do $$
declare
  v_mon9 date := tr_env('mon')::date + 56;
  v_created int;
  v_cancelled int;
begin
  v_created := tr_materialize(v_mon9);

  update public.timetable_slots
  set status = 'paused'
  where timetable_slot_id = tr_env('slot')::uuid;

  select count(*) into v_cancelled
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and status = 'cancelled'
    and cancelled_reason like 'This recurring timetable slot is no longer active%';

  perform tr_record(9, 'slot pause cancels future classes',
    v_created = 1 and v_cancelled >= 1
      and not exists (
        select 1 from public.live_classes
        where timetable_slot_id = tr_env('slot')::uuid
          and status = 'scheduled'
          and scheduled_at > now()
      ),
    'cancelled=' || v_cancelled);

  -- Reactivate for subsequent tests
  update public.timetable_slots
  set status = 'active'
  where timetable_slot_id = tr_env('slot')::uuid;

  perform tr_restore_slot();
end $$;

-- TEST 10 — metadata-only update: no reconciliation, no class changes
do $$
declare
  v_mon10 date := tr_env('mon')::date + 63;
  v_created int;
  v_same boolean;
begin
  v_created := tr_materialize(v_mon10);

  update public.timetable_slots
  set updated_at = now() -- metadata-only (no schedule-affecting column)
  where timetable_slot_id = tr_env('slot')::uuid;

  select not exists (
    select 1 from public.live_classes
    where timetable_slot_id = tr_env('slot')::uuid
      and status <> 'scheduled'
      and scheduled_at > now()
  ) into v_same;

  perform tr_record(10, 'metadata-only update is a no-op',
    v_created = 1 and v_same,
    'unchanged=' || v_same);
end $$;

-- TEST 11 — stale future class cancellation (out-of-window + wrong weekday)
do $$
declare
  v_stale_class uuid;
  v_cancelled boolean;
begin
  -- Simulate a stale class created under an old configuration: Saturday 15:00,
  -- matching neither the slot weekday nor start time, still in the future.
  insert into public.live_classes (
    institute_id, teacher_id, title, scheduled_at, duration_min,
    status, is_recorded, timetable_slot_id
  )
  values (
    tr_env('inst')::uuid, tr_env('t1')::uuid, 'Stale Class',
    ((tr_env('mon')::date + 5 + time '15:00') at time zone 'Asia/Kolkata'),
    60, 'scheduled', true, tr_env('slot')::uuid
  )
  returning class_id into v_stale_class;

  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status = 'cancelled' and cancelled_reason like 'Superseded by a timetable update%'
    into v_cancelled
  from public.live_classes
  where class_id = v_stale_class;

  perform tr_record(11, 'stale future class is cancelled',
    v_cancelled, 'cancelled=' || v_cancelled);
end $$;

-- TEST 12 — historical class protection: past classes untouched
do $$
declare
  v_hist_class uuid;
  v_status text;
begin
  insert into public.live_classes (
    institute_id, teacher_id, title, scheduled_at, duration_min,
    status, is_recorded, timetable_slot_id
  )
  values (
    tr_env('inst')::uuid, tr_env('t1')::uuid, 'Historical Class',
    ((tr_env('mon')::date - 21 + time '10:00') at time zone 'Asia/Kolkata'),
    60, 'completed', true, tr_env('slot')::uuid
  )
  returning class_id into v_hist_class;

  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status into v_status from public.live_classes where class_id = v_hist_class;

  perform tr_record(12, 'historical (past/completed) class untouched',
    v_status = 'completed', 'status=' || v_status);
end $$;

-- TEST 13 — started/live protection: live and started classes untouched
do $$
declare
  v_live_class uuid;
  v_started_class uuid;
  v_live_ok boolean;
  v_started_ok boolean;
begin
  -- "live" class in the past
  insert into public.live_classes (
    institute_id, teacher_id, title, scheduled_at, duration_min,
    status, is_recorded, timetable_slot_id
  )
  values (
    tr_env('inst')::uuid, tr_env('t1')::uuid, 'Live Class',
    (now() - interval '5 minutes'),
    60, 'live', true, tr_env('slot')::uuid
  )
  returning class_id into v_live_class;

  -- "scheduled" class that has already started (scheduled_at in the past)
  insert into public.live_classes (
    institute_id, teacher_id, title, scheduled_at, duration_min,
    status, is_recorded, timetable_slot_id
  )
  values (
    tr_env('inst')::uuid, tr_env('t1')::uuid, 'Started Class',
    (now() - interval '30 minutes'),
    60, 'scheduled', true, tr_env('slot')::uuid
  )
  returning class_id into v_started_class;

  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status = 'live' into v_live_ok from public.live_classes where class_id = v_live_class;
  select status = 'scheduled' into v_started_ok from public.live_classes where class_id = v_started_class;

  perform tr_record(13, 'started/live classes protected',
    v_live_ok and v_started_ok,
    'live=' || v_live_ok || ' started=' || v_started_ok);
end $$;

-- TEST 14 — completed protection: completed future-dated class untouched
do $$
declare
  v_comp_class uuid;
  v_status text;
begin
  insert into public.live_classes (
    institute_id, teacher_id, title, scheduled_at, duration_min,
    status, is_recorded, timetable_slot_id
  )
  values (
    tr_env('inst')::uuid, tr_env('t1')::uuid, 'Future Completed',
    ((tr_env('mon')::date + 70 + time '10:00') at time zone 'Asia/Kolkata'),
    60, 'completed', true, tr_env('slot')::uuid
  )
  returning class_id into v_comp_class;

  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status into v_status from public.live_classes where class_id = v_comp_class;

  perform tr_record(14, 'completed class untouched',
    v_status = 'completed', 'status=' || v_status);
end $$;

-- TEST 15 — resolved substitute protection: reconcile must not revert it
do $$
declare
  v_mon15 date := tr_env('mon')::date + 77;
  v_class uuid;
  v_teacher uuid;
  v_resolved boolean;
begin
  perform tr_materialize(v_mon15);

  select class_id into v_class
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon15
    and status = 'scheduled';

  -- Simulate the resolve_class_with_substitute outcome: resolution recorded,
  -- class teacher replaced with t2 (differs from slot teacher t1).
  insert into public.class_resolution_events (
    institute_id, leave_request_id, timetable_slot_id, occurrence_date, class_id,
    resolution_type, status, new_teacher_id, resolved_by, resolved_at
  )
  values (
    tr_env('inst')::uuid, null, tr_env('slot')::uuid, v_mon15, v_class,
    'substitute_teacher', 'resolved', tr_env('t2')::uuid, tr_env('admin')::uuid, now()
  );
  update public.live_classes set teacher_id = tr_env('t2')::uuid
  where class_id = v_class;

  -- Force a reconciliation: WITHOUT the guard the restore step would revert
  -- the class to the slot teacher t1; WITH the guard it must stay t2.
  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status, teacher_id into v_resolved, v_teacher
  from public.live_classes where class_id = v_class;

  perform tr_record(15, 'resolved substitute survives reconciliation',
    v_resolved and v_teacher = tr_env('t2')::uuid,
    'status=' || v_resolved || ' teacher=' || coalesce(v_teacher::text, 'null'));
end $$;

-- TEST 16 — resolved reschedule protection
do $$
declare
  v_mon16 date := tr_env('mon')::date + 84;
  v_class uuid;
  v_resolved boolean;
begin
  perform tr_materialize(v_mon16);

  select class_id into v_class
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon16
    and status = 'scheduled';

  -- Simulate the reschedule_class_occurrence outcome: original class moved to
  -- a NEW time that no longer matches the slot rule; resolution recorded.
  insert into public.class_resolution_events (
    institute_id, leave_request_id, timetable_slot_id, occurrence_date, class_id,
    resolution_type, status, new_scheduled_at, resolved_by, resolved_at
  )
  values (
    tr_env('inst')::uuid, null, tr_env('slot')::uuid, v_mon16, v_class,
    'reschedule', 'resolved',
    ((v_mon16 + time '14:00') at time zone 'Asia/Kolkata'),
    tr_env('admin')::uuid, now()
  );
  update public.live_classes
  set scheduled_at = ((v_mon16 + time '14:00') at time zone 'Asia/Kolkata')
  where class_id = v_class;

  -- WITHOUT the guard the cancel step would cancel this now-mismatched class;
  -- WITH the guard it must remain scheduled.
  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status = 'scheduled' into v_resolved
  from public.live_classes where class_id = v_class;

  perform tr_record(16, 'resolved reschedule survives reconciliation',
    v_resolved, 'protected=' || v_resolved);
end $$;

-- TEST 17 — recorded-class resolution protection
do $$
declare
  v_mon17 date := tr_env('mon')::date + 91;
  v_class uuid;
  v_resolved boolean;
begin
  perform tr_materialize(v_mon17);

  select class_id into v_class
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon17
    and status = 'scheduled';

  -- Simulate the assign_recorded_class outcome: original live class cancelled
  -- for live delivery; resolution recorded. Reconcile must NOT revive it.
  insert into public.class_resolution_events (
    institute_id, leave_request_id, timetable_slot_id, occurrence_date, class_id,
    resolution_type, status, resolved_by, resolved_at
  )
  values (
    tr_env('inst')::uuid, null, tr_env('slot')::uuid, v_mon17, v_class,
    'recorded_class', 'resolved', tr_env('admin')::uuid, now()
  );
  update public.live_classes
  set status = 'cancelled', cancelled_at = now(),
      cancelled_reason = 'Replaced by a recorded class.'
  where class_id = v_class;

  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status = 'cancelled'
    and cancelled_reason = 'Replaced by a recorded class.'
    into v_resolved
  from public.live_classes where class_id = v_class;

  perform tr_record(17, 'recorded-class resolution survives reconciliation',
    v_resolved, 'protected=' || v_resolved);
end $$;

-- TEST 18 — mock-test resolution protection
do $$
declare
  v_mon18 date := tr_env('mon')::date + 98;
  v_class uuid;
  v_resolved boolean;
begin
  perform tr_materialize(v_mon18);

  select class_id into v_class
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon18
    and status = 'scheduled';

  -- Simulate the assign_mock_test_to_class outcome: original live class
  -- cancelled for live delivery; resolution recorded. Reconcile must NOT
  -- revive it and must NOT rematerialize the occurrence (unique index).
  insert into public.class_resolution_events (
    institute_id, leave_request_id, timetable_slot_id, occurrence_date, class_id,
    resolution_type, status, resolved_by, resolved_at
  )
  values (
    tr_env('inst')::uuid, null, tr_env('slot')::uuid, v_mon18, v_class,
    'mock_test', 'resolved', tr_env('admin')::uuid, now()
  );
  update public.live_classes
  set status = 'cancelled', cancelled_at = now(),
      cancelled_reason = 'Replaced by a mock test.'
  where class_id = v_class;

  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select status = 'cancelled'
    and cancelled_reason = 'Replaced by a mock test.'
    into v_resolved
  from public.live_classes where class_id = v_class;

  perform tr_record(18, 'mock-test resolution survives reconciliation',
    v_resolved, 'protected=' || v_resolved);
end $$;

-- TEST 19 — cancelled occurrence protection: manually cancelled class is not
-- restored and is not re-materialized (partial unique index prevents dupes)
do $$
declare
  v_mon19 date := tr_env('mon')::date + 105;
  v_created int;
  v_class uuid;
  v_after int;
  v_still_cancelled boolean;
begin
  v_created := tr_materialize(v_mon19);

  select class_id into v_class
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon19
    and status = 'scheduled';

  -- Manual cancellation (NOT a timetable-system cancellation → not restorable)
  update public.live_classes
  set status = 'cancelled', cancelled_at = now(), cancelled_reason = 'Class cancelled by admin'
  where class_id = v_class;

  perform public.reconcile_timetable_slot_internal(tr_env('slot')::uuid);

  select count(*) into v_after
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon19;

  select status = 'cancelled' and cancelled_reason = 'Class cancelled by admin'
    into v_still_cancelled
  from public.live_classes where class_id = v_class;

  perform tr_record(19, 'manually cancelled occurrence not restored/duplicated',
    v_created = 1 and v_after = 1 and v_still_cancelled,
    'count=' || v_after || ' stillCancelled=' || v_still_cancelled);
end $$;

-- TEST 20 — concurrent edit + materialization: row lock + advisory locks keep
-- edit → reconcile atomic and deadlock-free (single-transaction simulation;
-- real two-session races are prevented by FOR NO KEY UPDATE / FOR UPDATE +
-- pg_advisory_xact_lock + the partial unique index)
do $$
declare
  v_mon20 date := tr_env('mon')::date + 112;
  v_rpc_ok boolean := false;
  v_err text := '';
  v_created int;
  v_ok boolean;
begin
  perform tr_restore_slot();
  perform tr_set_auth(tr_env('admin')::uuid);
  begin
    perform public.update_timetable_slot(
      tr_env('slot')::uuid, tr_env('t1')::uuid, tr_env('bs')::uuid,
      1, time '10:00', time '11:00', current_date - 30, current_date + 180
    );
    v_rpc_ok := true;
  exception when others then
    v_err := SQLERRM;
  end;

  -- Re-materialize after the atomic update (must not deadlock, must not dupe)
  v_created := tr_materialize(v_mon20);

  select count(*) = 1 into v_ok
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon20;

  perform tr_record(20, 'concurrent edit + materialization stays consistent',
    v_rpc_ok and v_created = 1 and v_ok,
    'rpcOk=' || v_rpc_ok || ' err=' || v_err || ' created=' || v_created || ' single=' || v_ok);
end $$;

-- TEST 21 — concurrent edit + resolution: resolved occurrence survives a
-- concurrent slot edit (substitute then re-schedule-affecting edit)
do $$
declare
  v_mon21 date := tr_env('mon')::date + 119;
  v_created int;
  v_class uuid;
  v_sub boolean := false;
begin
  v_created := tr_materialize(v_mon21);

  select class_id into v_class
  from public.live_classes
  where timetable_slot_id = tr_env('slot')::uuid
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_mon21
    and status = 'scheduled';

  insert into public.class_resolution_events (
    institute_id, leave_request_id, timetable_slot_id, occurrence_date, class_id,
    resolution_type, status, new_teacher_id, resolved_by, resolved_at
  )
  values (
    tr_env('inst')::uuid, null, tr_env('slot')::uuid, v_mon21, v_class,
    'substitute_teacher', 'resolved', tr_env('t2')::uuid, tr_env('admin')::uuid, now()
  );

  -- Concurrent schedule-affecting edit fires the trigger + reconciliation
  update public.timetable_slots
  set start_time = time '11:00', end_time = time '12:00'
  where timetable_slot_id = tr_env('slot')::uuid;

  select status = 'scheduled'
    into v_sub
  from public.live_classes where class_id = v_class;

  perform tr_record(21, 'resolved occurrence survives concurrent slot edit',
    v_sub,
    'protected=' || v_sub);
end $$;

-- TEST 22 — bulk import idempotency: same identity + SAME window reuses the
-- slot without duplicating it and without extending validity
-- (pure-reuse path; the extension path is covered by test 23)
do $$
declare
  v_res1 jsonb;
  v_res2 jsonb;
  v_count int;
begin
  perform tr_set_auth(tr_env('admin')::uuid);

  -- Import a NEW slot identity (Wednesday 14:00–15:00, same teacher+batch-subject)
  v_res1 := public.bulk_import_timetable(
    tr_env('inst')::uuid,
    jsonb_build_array(jsonb_build_object(
      'key', 'S1',
      'teacher_id', tr_env('t1')::uuid,
      'batch_subject_id', tr_env('bs')::uuid,
      'day_of_week', 3,
      'start_time', '14:00',
      'end_time', '15:00',
      'valid_from', current_date + 1,
      'valid_until', current_date + 30
    )),
    '[]'::jsonb,
    tr_env('admin')::uuid
  );

  -- Re-import the SAME identity with the SAME window → must REUSE, no dupes,
  -- no validity change (pure idempotency)
  v_res2 := public.bulk_import_timetable(
    tr_env('inst')::uuid,
    jsonb_build_array(jsonb_build_object(
      'key', 'S2',
      'teacher_id', tr_env('t1')::uuid,
      'batch_subject_id', tr_env('bs')::uuid,
      'day_of_week', 3,
      'start_time', '14:00',
      'end_time', '15:00',
      'valid_from', current_date + 1,
      'valid_until', current_date + 30
    )),
    '[]'::jsonb,
    tr_env('admin')::uuid
  );

  select count(*) into v_count
  from public.timetable_slots
  where institute_id = tr_env('inst')::uuid
    and teacher_id = tr_env('t1')::uuid
    and batch_subject_id = tr_env('bs')::uuid
    and day_of_week = 3 and start_time = time '14:00' and end_time = time '15:00';

  perform tr_record(22, 'bulk import idempotent slot reuse',
    (v_res1->>'slotsCreated')::int = 1 and (v_res1->>'success')::boolean
      and (v_res2->>'slotsReused')::int = 1 and (v_res2->>'success')::boolean
      and (v_res2->>'slotsExtended')::int = 0
      and v_count = 1,
    'res1=' || v_res1::text || ' res2=' || v_res2::text || ' slots=' || v_count);
end $$;

-- TEST 23 — migration-114 compatibility: bulk import + extension never
-- reconciles stale classes (extension-only updates are trigger no-ops)
do $$
declare
  v_res1 jsonb;
  v_res2 jsonb;
  v_cancelled int;
begin
  perform tr_set_auth(tr_env('admin')::uuid);

  -- First import creates a Thursday 16:00 slot
  v_res1 := public.bulk_import_timetable(
    tr_env('inst')::uuid,
    jsonb_build_array(jsonb_build_object(
      'key', 'S3',
      'teacher_id', tr_env('t2')::uuid,
      'batch_subject_id', tr_env('bs')::uuid,
      'day_of_week', 4,
      'start_time', '16:00',
      'end_time', '17:00',
      'valid_from', current_date + 1,
      'valid_until', current_date + 30
    )),
    '[]'::jsonb,
    tr_env('admin')::uuid
  );

  -- Second import extends the window (reuse+extend) — must NOT cancel classes
  v_res2 := public.bulk_import_timetable(
    tr_env('inst')::uuid,
    jsonb_build_array(jsonb_build_object(
      'key', 'S4',
      'teacher_id', tr_env('t2')::uuid,
      'batch_subject_id', tr_env('bs')::uuid,
      'day_of_week', 4,
      'start_time', '16:00',
      'end_time', '17:00',
      'valid_from', current_date + 1,
      'valid_until', current_date + 90
    )),
    '[]'::jsonb,
    tr_env('admin')::uuid
  );

  select count(*) into v_cancelled
  from public.live_classes lc
  where lc.status = 'cancelled'
    and lc.cancelled_reason like 'Superseded by a timetable update%'
    and lc.timetable_slot_id in (
      select timetable_slot_id from public.timetable_slots
      where institute_id = tr_env('inst')::uuid
        and batch_subject_id = tr_env('bs')::uuid
        and day_of_week = 4 and start_time = time '16:00'
    );

  perform tr_record(23, 'bulk import extension does not cancel classes',
    (v_res1->>'success')::boolean and (v_res2->>'success')::boolean
      and (v_res2->>'slotsReused')::int = 1
      and (v_res2->>'slotsExtended')::int = 1
      and v_cancelled = 0,
    'res1=' || v_res1::text || ' res2=' || v_res2::text || ' cancelled=' || v_cancelled);
end $$;

-- TEST 24 — exact reproduction of the discovered bug:
--   Saturday 15:00 slot → materialize Aug-15-equivalent → reconfigure to
--   Thursday 11:00 valid until Friday → stale Saturday class cancelled,
--   valid Thursday class remains/materializes
do $$
declare
  v_sat   date;
  v_thu   date;
  v_slot2 uuid;
  v_class_sat uuid;
  v_cancelled boolean;
  v_thu_ok boolean;
begin
  -- Next week's Saturday (always strictly in the future, weekday-independent):
  -- this week's Monday + 12 days = Saturday of NEXT week. Its Thursday is
  -- then always >= next-week Wednesday, so both dates are safely future.
  v_sat := (date_trunc('week', current_date)::date + 12);
  v_thu := v_sat - 2; -- Thursday of the same week

  -- Saturday 15:00–16:00 slot valid around that week
  insert into public.timetable_slots (
    institute_id, teacher_id, batch_subject_id, day_of_week,
    start_time, end_time, valid_from, valid_until, status, created_by
  )
  values (
    tr_env('inst')::uuid, tr_env('t1')::uuid, tr_env('bs')::uuid, 6,
    time '15:00', time '16:00',
    v_sat - 7, v_sat + 7, 'active', tr_env('admin')::uuid
  )
  returning timetable_slot_id into v_slot2;

  -- Materialize the Saturday class
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.materialize_timetable_classes(v_slot2, v_sat, v_sat);

  select class_id into v_class_sat
  from public.live_classes
  where timetable_slot_id = v_slot2 and (scheduled_at at time zone 'Asia/Kolkata')::date = v_sat;

  -- Reconfigure: Thursday 11:00, valid through Friday (Saturday now invalid)
  update public.timetable_slots
  set day_of_week = 4, start_time = time '11:00', end_time = time '12:00',
      valid_from = v_thu, valid_until = v_thu + 1
  where timetable_slot_id = v_slot2;

  -- Trigger fired reconciliation during the UPDATE:
  select status = 'cancelled' and cancelled_reason like 'Superseded by a timetable update%'
    into v_cancelled
  from public.live_classes where class_id = v_class_sat;

  select exists (
    select 1 from public.live_classes
    where timetable_slot_id = v_slot2
      and (scheduled_at at time zone 'Asia/Kolkata')::date = v_thu
      and status = 'scheduled'
      and scheduled_at = ((v_thu + time '11:00') at time zone 'Asia/Kolkata')
  ) into v_thu_ok;

  perform tr_record(24, 'bug reproduction: stale Saturday class cancelled, Thursday class valid',
    v_class_sat is not null and v_cancelled and v_thu_ok,
    'satClass=' || coalesce(v_class_sat::text, 'null')
      || ' satCancelled=' || v_cancelled || ' thuValid=' || v_thu_ok);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- RESULTS
-- ════════════════════════════════════════════════════════════════════════════

\echo
\echo '=== TIMETABLE STALE LIVE_CLASS RECONCILIATION — TEST RESULTS ==='
select test_no, name, result, detail from tr_test_results order by test_no;

\echo
\echo 'NOTE: harness ran inside ONE transaction — rolling back now, no test data persists.'
rollback;
