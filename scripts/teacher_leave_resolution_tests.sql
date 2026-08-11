-- ════════════════════════════════════════════════════════════════════════════
-- TEACHER LEAVE + CLASS RESOLUTION — LIVE DATABASE TEST HARNESS
-- Tests migration 115 RPCs:
--   submit_teacher_leave_request · cancel_teacher_leave_request ·
--   review_teacher_leave_request · resolve_class_with_substitute ·
--   reschedule_class_occurrence · assign_recorded_class ·
--   assign_mock_test_to_class · cancel_class_occurrence ·
--   cancel_class_resolution
--
-- HOW TO RUN (against a SAFE, DISPOSABLE Supabase-flavoured DB with migration
-- 115 applied — e.g. a local `supabase start` stack after `supabase db reset`):
--
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/teacher_leave_resolution_tests.sql
--
--   or:  scripts/run_teacher_leave_resolution_tests.sh "postgresql://postgres:postgres@localhost:54322/postgres"
--
-- REQUIREMENTS
--   * Connect as a postgres SUPERUSER (fixture inserts bypass RLS).
--   * Migration 115 must be applied (checked below).
--
-- SAFETY
--   The ENTIRE harness runs inside ONE transaction that is ROLLED BACK at the
--   end. Results are printed just before the rollback. No test data persists.
--   Auth paths are simulated via request.jwt.claim.* GUCs
--   (auth.uid()/auth.role()) exactly like the Phase 1B bulk-import harness.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── 0. Preconditions ───────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.submit_teacher_leave_request(date,date,text,public.leave_category_type,uuid[])') is null then
    raise exception 'PRECONDITION FAILED: migration 115 not applied — submit_teacher_leave_request does not exist.';
  end if;
  if to_regclass('public.class_resolution_events') is null
     or to_regclass('public.leave_request_occurrences') is null then
    raise exception 'PRECONDITION FAILED: migration 115 tables missing.';
  end if;
  if current_setting('is_superuser') <> 'on' then
    raise exception 'PRECONDITION FAILED: connect as a superuser (e.g. postgres) so RLS cannot block fixture inserts.';
  end if;
end $$;

begin;

-- ── 1. Results / env stores + helpers ──────────────────────────────────────
create temp table lr_test_results (
  test_no int primary key,
  name    text not null,
  result  text not null,
  detail  text not null default ''
);

create temp table lr_test_env (k text primary key, v text not null);

create or replace function lr_env(p_k text)
returns text language sql stable as $$
  select v from lr_test_env where k = p_k;
$$;

-- Simulate an authenticated caller with the given profile id + role.
create or replace function lr_set_auth(p_profile_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_profile_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end $$;

-- Safe-call wrapper for RPCs that return jsonb, capturing errors.
create or replace function lr_call(p_sql text)
returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  begin
    execute p_sql into v;
    return jsonb_build_object('ok', true, 'result', v);
  exception when others then
    return jsonb_build_object('ok', false, 'err', SQLERRM);
  end;
end $$;

create or replace function lr_record(p_test int, p_name text, p_pass boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into lr_test_results (test_no, name, result, detail)
  values (p_test, p_name, case when p_pass then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $$;

-- ── 2. Fixture creation (isolated institute, rolled back at the end) ───────
do $$
declare
  v_inst    uuid;
  v_admin   uuid;
  v_t1      uuid;   -- teacher 1 (original, goes on leave)
  v_t2      uuid;   -- teacher 2 (substitute)
  v_stream  uuid;
  v_subj    uuid;
  v_batch   uuid;
  v_bs      uuid;
  v_ch      uuid;
  v_tp      uuid;
  v_slot    uuid;
  v_mon     date;
begin
  -- Institute
  insert into public.institutes (name, slug, plan_tier)
  values ('LR Test Institute', 'lr-test-inst', 'starter')
  returning institute_id into v_inst;

  -- Admin profile (role = 'admin') + super_admin grant (074: needs admin_roles)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'LR Admin', 'lr.admin@test.invalid', '919000000001', 'admin', true)
  returning profile_id into v_admin;
  insert into public.admin_roles (profile_id, institute_id, admin_role, access_status, granted_by)
  values (v_admin, v_inst, 'super_admin', 'approved', v_admin);

  -- Teacher 1 + profile
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'LR Teacher One', 'lr.teacher1@test.invalid', '919000000002', 'teacher', true)
  returning profile_id into v_t1;
  insert into public.teacher_details (profile_id, specialization)
  values (v_t1, 'physics') returning teacher_id into v_t1;

  -- Teacher 2 + profile (substitute)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'LR Teacher Two', 'lr.teacher2@test.invalid', '919000000003', 'teacher', true)
  returning profile_id into v_t2;
  insert into public.teacher_details (profile_id, specialization)
  values (v_t2, 'physics') returning teacher_id into v_t2;

  -- Academic structure
  insert into public.streams (institute_id, name, code)
  values (v_inst, 'LR Stream', 'LRS') returning stream_id into v_stream;
  insert into public.subjects (stream_id, name, code)
  values (v_stream, 'Physics', 'PHY') returning subject_id into v_subj;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'LR Batch A', 'LR-A', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_batch;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_batch, v_subj, v_inst) returning batch_subject_id into v_bs;
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id)
  values (v_bs, v_t1, v_inst);
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id)
  values (v_bs, v_t2, v_inst);
  insert into public.chapters (subject_id, name)
  values (v_subj, 'Kinematics') returning chapter_id into v_ch;
  insert into public.topics (chapter_id, name)
  values (v_ch, 'Laws of Motion') returning topic_id into v_tp;

  -- Timetable slot: next Monday, 10:00-11:00, valid 90 days
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

  insert into lr_test_env values
    ('inst',  v_inst::text),
    ('admin', v_admin::text),
    ('t1',    v_t1::text),
    ('t2',    v_t2::text),
    ('bs',    v_bs::text),
    ('ch',    v_ch::text),
    ('tp',    v_tp::text),
    ('slot',  v_slot::text),
    ('mon',   v_mon::text);

  -- Lesson plan for the target Monday occurrence (chapter + topic)
  insert into public.lesson_plans (institute_id, timetable_slot_id, occurrence_date, chapter_id, topic_id, notes)
  values (v_inst, v_slot, v_mon, v_ch, v_tp, 'fixture lesson plan');
end $$;

-- ── 3. Helpers ─────────────────────────────────────────────────────────────
-- Materialize one occurrence as the service role (admin-only RPC).
create or replace function lr_materialize_occurrence(p_date date)
returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  return jsonb_build_object(
    'ok', true,
    'created', public.materialize_timetable_classes(lr_env('slot')::uuid, p_date, p_date)
  );
end $$;

-- Submit + approve a fresh leave for teacher1 on a given date, returning the
-- new pending resolution id.
create or replace function lr_leave_and_approve(p_date date, p_reason text)
returns uuid language plpgsql as $$
declare
  v_leave  uuid;
  v_resid  uuid;
begin
  perform lr_set_auth(lr_env('t1')::uuid);
  perform public.submit_teacher_leave_request(p_date, p_date, p_reason, 'casual');
  select leave_id into v_leave from public.teacher_leave_requests
  where teacher_id = lr_env('t1')::uuid and start_date = p_date
  order by created_at desc limit 1;
  perform lr_set_auth(lr_env('admin')::uuid);
  perform public.review_teacher_leave_request(v_leave, 'approve', 'auto-approve');
  select resolution_id into v_resid from public.class_resolution_events
  where leave_request_id = v_leave and status = 'pending' limit 1;
  return v_resid;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- TESTS
-- ════════════════════════════════════════════════════════════════════════════

-- TEST 1 — normal leave submission (teacher 1, own slot, future Monday)
do $$
declare
  v_res jsonb;
  v_leave uuid;
  v_count int;
begin
  perform lr_set_auth(lr_env('t1')::uuid);
  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date, lr_env('mon')::date, 'test leave', 'casual',
    array[lr_env('slot')::uuid]
  );
  v_leave := (v_res->>'leave_id')::uuid;
  select count(*) into v_count from public.leave_request_occurrences
  where leave_request_id = v_leave;
  perform lr_record(1, 'normal leave submission',
    (v_res->>'success')::boolean = true
      and (v_res->>'is_emergency')::boolean = false
      and v_count = 1,
    'result=' || v_res::text);
  insert into lr_test_env values ('leave1', v_leave::text);
end $$;

-- TEST 2 — emergency classification: t2's class starts ~45 minutes from now
do $$
declare
  v_tz    text;
  v_start time;
  v_end   time;
  v_res   jsonb;
begin
  select coalesce(timezone, 'Asia/Kolkata') into v_tz
  from public.institutes where institute_id = lr_env('inst')::uuid;

  v_start := (clock_timestamp() at time zone v_tz)::time + interval '45 minutes';
  v_end   := v_start + interval '1 hour';

  insert into public.timetable_slots (
    institute_id, teacher_id, batch_subject_id, day_of_week,
    start_time, end_time, valid_from, valid_until, status, created_by
  )
  values (
    lr_env('inst')::uuid, lr_env('t2')::uuid, lr_env('bs')::uuid,
    extract(isodow from current_date)::smallint,
    v_start, v_end, current_date - 1, current_date + 30, 'active', lr_env('admin')::uuid
  );

  perform lr_set_auth(lr_env('t2')::uuid);
  v_res := public.submit_teacher_leave_request(
    current_date, current_date, 'emergency test', 'sick'
  );
  perform lr_record(2, 'emergency classification <24h',
    (v_res->>'success')::boolean = true
      and (v_res->>'is_emergency')::boolean = true,
    'result=' || v_res::text);
end $$;

-- TEST 3 — cross-institute rejection: teacher from another institute
do $$
declare
  v_other uuid;
  v_res  jsonb;
begin
  insert into public.institutes (name, slug, plan_tier)
  values ('LR Other Institute', 'lr-other-inst', 'starter')
  returning institute_id into v_other;
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_other, 'LR Other Teacher', 'lr.other@test.invalid', '919000000004', 'teacher', true)
  returning profile_id into v_other;
  insert into public.teacher_details (profile_id) values (v_other);

  perform lr_set_auth(v_other);
  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date, lr_env('mon')::date, 'cross-inst', 'casual',
    array[lr_env('slot')::uuid]
  );
  perform lr_record(3, 'cross-institute rejection',
    (v_res->>'ok')::boolean = false
      and v_res->>'err' like '%not an active slot%',
    'result=' || v_res::text);
end $$;

-- TEST 4 — teacher cannot submit for another teacher's slot (t2 using t1 slot)
do $$
declare
  v_res jsonb;
begin
  perform lr_set_auth(lr_env('t2')::uuid);
  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date, lr_env('mon')::date, 'not mine', 'casual',
    array[lr_env('slot')::uuid]
  );
  perform lr_record(4, 'teacher cannot use another teacher slot',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 5 — approve request (admin), creates teacher_leaves + pending resolutions
do $$
declare
  v_res    jsonb;
  v_tl     int;
  v_pending int;
begin
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.review_teacher_leave_request(lr_env('leave1')::uuid, 'approve', 'ok');
  select count(*) into v_tl from public.teacher_leaves
  where teacher_id = lr_env('t1')::uuid and status = 'active';
  select count(*) into v_pending from public.class_resolution_events
  where leave_request_id = lr_env('leave1')::uuid and status = 'pending';
  perform lr_record(5, 'approve creates teacher_leaves + pending resolutions',
    (v_res->>'success')::boolean = true and v_tl >= 1 and v_pending = 1,
    'result=' || v_res::text || ' teacher_leaves=' || v_tl || ' pending=' || v_pending);
end $$;

-- TEST 6 — reject request
do $$
declare
  v_res jsonb;
  v_leave uuid;
begin
  perform lr_set_auth(lr_env('t1')::uuid);
  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date + 7, lr_env('mon')::date + 7, 'to reject', 'casual'
  );
  v_leave := (v_res->>'leave_id')::uuid;
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.review_teacher_leave_request(v_leave, 'reject', 'no');
  perform lr_record(6, 'reject request',
    (v_res->>'success')::boolean = true and v_res->>'status' = 'rejected',
    'result=' || v_res::text);
end $$;

-- TEST 7 — pending resolution resolved with substitute (class not materialized)
do $$
declare
  v_res jsonb;
  v_resid uuid;
  v_cls   uuid;
begin
  select resolution_id into v_resid from public.class_resolution_events
  where leave_request_id = lr_env('leave1')::uuid and status = 'pending'
  limit 1;

  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.resolve_class_with_substitute(v_resid, lr_env('t2')::uuid);
  select class_id into v_cls from public.class_resolution_events
  where resolution_id = v_resid;

  perform lr_record(7, 'substitute assigned (creates occurrence class)',
    (v_res->>'success')::boolean = true and v_cls is not null
      and (select teacher_id from public.live_classes where class_id = v_cls) = lr_env('t2')::uuid,
    'result=' || v_res::text);
  insert into lr_test_env values ('cls7', v_cls::text);
end $$;

-- TEST 8 — invalid substitute (unassigned teacher)
do $$
declare
  v_other uuid;
  v_res   jsonb;
  v_resid uuid;
begin
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), lr_env('inst')::uuid, 'LR Unassigned', 'lr.unassigned@test.invalid', '919000000005', 'teacher', true)
  returning profile_id into v_other;
  insert into public.teacher_details (profile_id) values (v_other);

  v_resid := lr_leave_and_approve(lr_env('mon')::date + 14, 'sub test');

  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.resolve_class_with_substitute(v_resid, v_other);
  perform lr_record(8, 'invalid substitute rejected',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 9 — reschedule rejected for a non-pending (already resolved) resolution
do $$
declare
  v_resid uuid;
  v_res   jsonb;
begin
  select resolution_id into v_resid from public.class_resolution_events
  where leave_request_id = lr_env('leave1')::uuid and status = 'resolved'
  limit 1;

  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.reschedule_class_occurrence(
    v_resid, lr_env('mon')::date + 7, time '11:00', time '12:00'
  );
  perform lr_record(9, 'reschedule rejected for non-pending resolution',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 10 — reschedule a PENDING resolution to a later Monday
do $$
declare
  v_res   jsonb;
  v_resid uuid;
  v_new_d date;
begin
  v_resid := lr_leave_and_approve(lr_env('mon')::date + 21, 'reschedule test');
  v_new_d := lr_env('mon')::date + 28;

  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.reschedule_class_occurrence(
    v_resid, v_new_d, time '12:00', time '13:00'
  );
  perform lr_record(10, 'reschedule pending resolution',
    (v_res->>'success')::boolean = true and v_res->>'type' = 'reschedule'
      and (v_res->>'new_scheduled_at')::timestamptz is not null,
    'result=' || v_res::text);
end $$;

-- TEST 11 — cancel a pending resolution (supersede)
do $$
declare
  v_resid uuid;
  v_res   jsonb;
begin
  v_resid := lr_leave_and_approve(lr_env('mon')::date + 35, 'cancel res test');
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.cancel_class_resolution(v_resid, 'changed my mind');
  perform lr_record(11, 'cancel pending resolution',
    (v_res->>'success')::boolean = true and v_res->>'status' = 'cancelled',
    'result=' || v_res::text);
end $$;

-- TEST 12 — recorded class: materialize a future Monday, replace with recording
do $$
declare
  v_res    jsonb;
  v_resid  uuid;
  v_rec    uuid;
  v_cls    uuid;
  v_date   date;
begin
  v_date := lr_env('mon')::date + 7;
  perform lr_materialize_occurrence(v_date);
  select class_id into v_cls from public.live_classes
  where timetable_slot_id = lr_env('slot')::uuid
    and status = 'scheduled'
    and (scheduled_at at time zone 'Asia/Kolkata')::date = v_date
  order by scheduled_at desc limit 1;

  insert into public.recordings (
    institute_id, teacher_id, class_id, title, recording_type, status, playback_url
  )
  values (
    lr_env('inst')::uuid, lr_env('t1')::uuid, v_cls, 'LR Recording', 'live_class',
    'completed', 'https://example.invalid/lr-rec.mp4'
  )
  returning recording_id into v_rec;

  v_resid := lr_leave_and_approve(v_date, 'recorded test');

  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.assign_recorded_class(v_resid, v_rec);
  perform lr_record(12, 'recorded class replacement',
    (v_res->>'success')::boolean = true and v_res->>'type' = 'recorded_class'
      and exists (
        select 1 from public.batch_subject_recordings bsr
        where bsr.recording_id = v_rec and bsr.batch_subject_id = lr_env('bs')::uuid
      )
      and exists (
        select 1 from public.live_classes
        where class_id = v_cls and status = 'cancelled'
      ),
    'result=' || v_res::text);
end $$;

-- TEST 13 — invalid recording (another institute)
do $$
declare
  v_res  jsonb;
  v_rec  uuid;
  v_resid uuid;
  v_other uuid;
  v_other_teacher uuid;
begin
  select institute_id into v_other from public.institutes where slug = 'lr-other-inst';
  select teacher_id into v_other_teacher from public.teacher_details td
    join public.profiles p on p.profile_id = td.profile_id
   where p.email = 'lr.other@test.invalid';

  insert into public.recordings (institute_id, teacher_id, title, recording_type, status)
  values (v_other, v_other_teacher, 'Other Rec', 'live_class', 'completed')
  returning recording_id into v_rec;

  v_resid := lr_leave_and_approve(lr_env('mon')::date + 42, 'rec invalid');
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.assign_recorded_class(v_resid, v_rec);
  perform lr_record(13, 'invalid recording rejected',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 14 — mock test assignment
do $$
declare
  v_res   jsonb;
  v_test  uuid;
  v_resid uuid;
begin
  insert into public.mock_tests (
    institute_id, teacher_id, stream_id, subject_id, title, duration_min,
    total_marks, status, test_type
  )
  select lr_env('inst')::uuid, lr_env('t1')::uuid, s.stream_id, s.subject_id,
         'LR Mock', 60, 100, 'published', 'test'
  from public.subjects s where s.code = 'PHY'
  returning test_id into v_test;

  v_resid := lr_leave_and_approve(lr_env('mon')::date + 49, 'mock test');
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.assign_mock_test_to_class(v_resid, v_test);
  perform lr_record(14, 'mock test assignment',
    (v_res->>'success')::boolean = true and v_res->>'type' = 'mock_test'
      and exists (
        select 1 from public.batch_mock_tests bmt
        where bmt.test_id = v_test
          and bmt.batch_id = (select batch_id from public.batch_subjects where batch_subject_id = lr_env('bs')::uuid)
      ),
    'result=' || v_res::text);
end $$;

-- TEST 15 — invalid mock test (draft)
do $$
declare
  v_test uuid;
  v_res  jsonb;
  v_resid uuid;
begin
  insert into public.mock_tests (
    institute_id, teacher_id, stream_id, subject_id, title, duration_min,
    total_marks, status, test_type
  )
  select lr_env('inst')::uuid, lr_env('t1')::uuid, s.stream_id, s.subject_id,
         'LR Draft Mock', 60, 100, 'draft', 'test'
  from public.subjects s where s.code = 'PHY'
  returning test_id into v_test;

  v_resid := lr_leave_and_approve(lr_env('mon')::date + 56, 'mock invalid');
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.assign_mock_test_to_class(v_resid, v_test);
  perform lr_record(15, 'invalid mock test rejected',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 16 — cancel class occurrence (pending resolution)
do $$
declare
  v_resid uuid;
  v_res   jsonb;
begin
  v_resid := lr_leave_and_approve(lr_env('mon')::date + 63, 'cancel class');
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.cancel_class_occurrence(v_resid, 'no substitute available');
  perform lr_record(16, 'cancel class occurrence',
    (v_res->>'success')::boolean = true and v_res->>'type' = 'cancelled',
    'result=' || v_res::text);
end $$;

-- TEST 17 — duplicate active resolution prevention (partial unique index)
do $$
declare
  v_err text;
begin
  begin
    -- mon already has a RESOLVED resolution from TEST 7 → a second active
    -- (pending) row must violate the partial unique index.
    insert into public.class_resolution_events (
      institute_id, leave_request_id, timetable_slot_id, occurrence_date,
      resolution_type, status, prev_teacher_id
    )
    values (
      lr_env('inst')::uuid, lr_env('leave1')::uuid, lr_env('slot')::uuid,
      lr_env('mon')::date, 'cancelled', 'pending', lr_env('t1')::uuid
    );
    v_err := 'no error';
  exception when unique_violation then
    v_err := 'unique_violation';
  when others then
    v_err := SQLERRM;
  end;
  perform lr_record(17, 'duplicate active resolution prevented',
    v_err = 'unique_violation',
    'err=' || v_err);
end $$;

-- TEST 18 — live class protection (cannot request leave for a live class)
do $$
declare
  v_res jsonb;
begin
  perform lr_set_auth(lr_env('t1')::uuid);
  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date, lr_env('mon')::date, 'live protection', 'casual'
  );
  -- mon already has a resolved substitute class (status scheduled). Make it
  -- live first, then submission must fail.
  update public.live_classes
  set status = 'live'
  where class_id = lr_env('cls7')::uuid;

  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date, lr_env('mon')::date, 'live protection', 'casual'
  );
  perform lr_record(18, 'live class protection',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 19 — completed class protection
do $$
declare
  v_res jsonb;
begin
  update public.live_classes
  set status = 'completed'
  where class_id = lr_env('cls7')::uuid;

  perform lr_set_auth(lr_env('t1')::uuid);
  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date, lr_env('mon')::date, 'completed protection', 'casual'
  );
  perform lr_record(19, 'completed class protection',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 20 — teacher cancels own pending request
do $$
declare
  v_res  jsonb;
  v_leave uuid;
begin
  perform lr_set_auth(lr_env('t1')::uuid);
  v_res := public.submit_teacher_leave_request(
    lr_env('mon')::date + 70, lr_env('mon')::date + 70, 'cancel mine', 'casual'
  );
  v_leave := (v_res->>'leave_id')::uuid;
  v_res := public.cancel_teacher_leave_request(v_leave);
  perform lr_record(20, 'teacher cancels own pending request',
    (v_res->>'success')::boolean = true and v_res->>'status' = 'cancelled',
    'result=' || v_res::text);
end $$;

-- TEST 21 — teacher cannot cancel another teacher's request
do $$
declare
  v_res jsonb;
begin
  perform lr_set_auth(lr_env('t2')::uuid);
  v_res := public.cancel_teacher_leave_request(lr_env('leave1')::uuid);
  perform lr_record(21, 'cannot cancel another teacher request',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 22 — recurring timetable + lesson plan untouched by resolutions
do $$
declare
  v_slots int;
  v_plans int;
begin
  select count(*) into v_slots from public.timetable_slots
  where timetable_slot_id = lr_env('slot')::uuid;
  select count(*) into v_plans from public.lesson_plans
  where timetable_slot_id = lr_env('slot')::uuid;
  perform lr_record(22, 'recurring slot + lesson plan unchanged',
    v_slots = 1 and v_plans >= 1,
    'slots=' || v_slots || ' plans=' || v_plans);
end $$;

-- TEST 23 — notifications generated for leave + class_resolved
do $$
declare
  v_sub int;
  v_res int;
begin
  select count(*) into v_sub from public.notifications
  where event_type in ('leave_request_submitted', 'leave_request_emergency');
  select count(*) into v_res from public.notifications
  where event_type = 'class_resolved';
  perform lr_record(23, 'notifications generated',
    v_sub >= 1 and v_res >= 1,
    'leave_notifs=' || v_sub || ' resolved_notifs=' || v_res);
end $$;

-- TEST 24 — audit logs written
do $$
declare
  v_aud int;
begin
  select count(*) into v_aud from public.audit_logs
  where resource_type in ('teacher_leave_request', 'class_resolution_events');
  perform lr_record(24, 'audit logs written',
    v_aud >= 1,
    'audit_rows=' || v_aud);
end $$;

-- TEST 25 — reconcile does NOT revert a resolved occurrence
do $$
declare
  v_before int;
  v_after  int;
begin
  select count(*) into v_before
  from public.live_classes lc
  where lc.timetable_slot_id = lr_env('slot')::uuid
    and lc.status = 'scheduled'
    and exists (
      select 1 from public.class_resolution_events cre
      where cre.timetable_slot_id = lc.timetable_slot_id
        and cre.status = 'resolved'
        and (cre.occurrence_date = (lc.scheduled_at at time zone 'Asia/Kolkata')::date
             or cre.class_id = lc.class_id)
    );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.reconcile_timetable_slot(lr_env('slot')::uuid);

  select count(*) into v_after
  from public.live_classes lc
  where lc.timetable_slot_id = lr_env('slot')::uuid
    and lc.status = 'scheduled'
    and exists (
      select 1 from public.class_resolution_events cre
      where cre.timetable_slot_id = lc.timetable_slot_id
        and cre.status = 'resolved'
        and (cre.occurrence_date = (lc.scheduled_at at time zone 'Asia/Kolkata')::date
             or cre.class_id = lc.class_id)
    );

  perform lr_record(25, 'reconcile does not revert resolved occurrence',
    v_before = v_after and v_after >= 1,
    'before=' || v_before || ' after=' || v_after);
end $$;

-- TEST 26 — reschedule then reconcile: original occurrence stays cancelled and
-- the new class survives (migration 108 caveat: never move a class in place).
do $$
declare
  v_res     jsonb;
  v_resid   uuid;
  v_src     date;
  v_tgt     date;
  v_old_cls uuid;
  v_new_cls uuid;
  v_old_st  text;
  v_new_st  text;
begin
  v_src := lr_env('mon')::date + 84;
  v_tgt := lr_env('mon')::date + 91;

  -- Materialize the source Monday so the reschedule has a class to cancel
  perform lr_materialize_occurrence(v_src);
  v_resid := lr_leave_and_approve(v_src, 'reschedule-then-reconcile');
  select class_id into v_old_cls from public.class_resolution_events
  where resolution_id = v_resid;

  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.reschedule_class_occurrence(
    v_resid, v_tgt, time '12:00', time '13:00', lr_env('t2')::uuid
  );
  v_new_cls := (v_res->>'class_id')::uuid;

  -- Reconcile must NOT revive the cancelled original nor cancel the new class
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.reconcile_timetable_slot(lr_env('slot')::uuid);

  select status into v_old_st from public.live_classes where class_id = v_old_cls;
  select status into v_new_st from public.live_classes where class_id = v_new_cls;

  perform lr_record(26, 'reschedule survives reconcile (original cancelled, new scheduled)',
    (v_res->>'success')::boolean = true
      and v_old_cls is distinct from v_new_cls
      and v_old_st = 'cancelled'
      and v_new_st = 'scheduled',
    'old=' || coalesce(v_old_st, 'null') || ' new=' || coalesce(v_new_st, 'null') || ' res=' || v_res::text);
end $$;

-- TEST 27 — substitute succeeds even after reconcile cancelled the class
-- (leave supersession): the class is revived with the substitute teacher.
do $$
declare
  v_date    date;
  v_resid   uuid;
  v_res     jsonb;
  v_cls     uuid;
  v_status  text;
  v_teacher uuid;
  v_cre_res text;
begin
  v_date := lr_env('mon')::date + 98;

  perform lr_materialize_occurrence(v_date);
  v_resid := lr_leave_and_approve(v_date, 'substitute-after-reconcile');

  -- Reconcile cancels the leave-covered class (teacher_leaves blocks it)
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.reconcile_timetable_slot(lr_env('slot')::uuid);

  -- The admin must still be able to resolve with a substitute
  perform lr_set_auth(lr_env('admin')::uuid);
  v_res := public.resolve_class_with_substitute(v_resid, lr_env('t2')::uuid);
  v_cls := (v_res->>'class_id')::uuid;

  select status, teacher_id into v_status, v_teacher
  from public.live_classes where class_id = v_cls;
  select status into v_cre_res from public.class_resolution_events
  where resolution_id = v_resid;

  perform lr_record(27, 'substitute succeeds after reconcile cancelled the class',
    (v_res->>'success')::boolean = true
      and v_status = 'scheduled'
      and v_teacher = lr_env('t2')::uuid
      and v_cre_res = 'resolved',
    'class=' || coalesce(v_status, 'null') || ' teacher=' || coalesce(v_teacher::text, 'null')
      || ' cre=' || coalesce(v_cre_res, 'null') || ' res=' || v_res::text);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- RESULTS
-- ════════════════════════════════════════════════════════════════════════════

\echo
\echo '=== TEACHER LEAVE + CLASS RESOLUTION — TEST RESULTS ==='
select test_no, name, result, detail from lr_test_results order by test_no;

\echo
\echo 'NOTE: harness ran inside ONE transaction — rolling back now, no test data persists.'
rollback;
