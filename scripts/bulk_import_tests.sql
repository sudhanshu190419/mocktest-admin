-- ════════════════════════════════════════════════════════════════════════════
-- BULK TIMETABLE IMPORT RPC — LIVE DATABASE TEST HARNESS
-- Tests public.bulk_import_timetable(uuid, jsonb, jsonb, uuid) (migration 114).
--
-- HOW TO RUN (against a SAFE, DISPOSABLE Supabase-flavoured DB with migration
-- 114 applied — e.g. a local `supabase start` stack after `supabase db reset`):
--
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/bulk_import_tests.sql
--
--   or:  scripts/run_bulk_import_tests.sh "postgresql://postgres:postgres@localhost:54322/postgres"
--
-- REQUIREMENTS
--   * Connect as a postgres SUPERUSER (fixture inserts bypass RLS).
--   * Migration 114 must be applied (checked below).
--   * Test 29 (concurrency) is NOT here — it is run by the shell orchestrator.
--
-- SAFETY
--   The ENTIRE harness runs inside ONE transaction that is ROLLED BACK at the
--   end. Results are printed just before the rollback. No test data persists.
--   Auth paths are simulated via request.jwt.claim.* GUCs (auth.uid()/auth.role()).
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── 0. Preconditions ───────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.bulk_import_timetable(uuid,jsonb,jsonb,uuid)') is null then
    raise exception 'PRECONDITION FAILED: migration 114 not applied — bulk_import_timetable(uuid,jsonb,jsonb,uuid) does not exist.';
  end if;
  if current_setting('is_superuser') <> 'on' then
    raise exception 'PRECONDITION FAILED: connect as a superuser (e.g. postgres) so RLS cannot block fixture inserts.';
  end if;
end $$;

begin;

-- ── 1. Results / env stores + helpers ──────────────────────────────────────
create temp table bulk_test_results (
  test_no int primary key,
  name    text not null,
  result  text not null,
  detail  text not null default ''
);

create temp table bulk_test_env (k text primary key, v text not null);

create or replace function bulk_env(p_k text)
returns text language sql stable as $$
  select v from bulk_test_env where k = p_k;
$$;

-- Wraps the RPC, simulating a caller with the given JWT claims.
-- Returns {ok:true,result:<rpc jsonb>} or {ok:false,err:<sqlerrm>}.
create or replace function bulk_test_call(
  p_role text, p_sub uuid, p_institute uuid, p_slots jsonb, p_plans jsonb
) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  begin
    v := jsonb_build_object('ok', true, 'result',
         public.bulk_import_timetable(p_institute, p_slots, p_plans));
  exception when others then
    v := jsonb_build_object('ok', false, 'err', SQLERRM);
  end;
  return v;
end $$;

create or replace function bulk_test_record(p_test int, p_name text, p_pass boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into bulk_test_results (test_no, name, result, detail)
  values (p_test, p_name, case when p_pass then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $$;

create or replace function bulk_slot(p_key text, p_teacher uuid, p_bs uuid, p_day smallint,
  p_start text, p_end text, p_from date, p_until date)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'key', p_key, 'teacher_id', p_teacher, 'batch_subject_id', p_bs,
    'day_of_week', p_day, 'start_time', p_start, 'end_time', p_end,
    'valid_from', p_from, 'valid_until', p_until);
$$;

create or replace function bulk_plan(p_slot_key text, p_date date, p_chapter uuid, p_topic uuid, p_notes text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('slot_key', p_slot_key, 'occurrence_date', p_date,
    'chapter_id', p_chapter, 'topic_id', p_topic, 'notes', p_notes);
$$;

-- ── 2. Fixture setup (isolated test institutes A + B) ──────────────────────
do $$
declare
  v_monday date := date_trunc('week', current_date)::date;
  v_inst1 uuid; v_inst2 uuid;
  v_sa uuid; v_aa uuid; v_t1p uuid; v_t2p uuid; v_stp uuid; v_t2bp uuid;
  v_t1 uuid; v_t2 uuid; v_t2b uuid;
  v_stream uuid; v_sub_a uuid; v_sub_b uuid;
  v_b1 uuid; v_b2 uuid;
  v_bs1 uuid; v_bs2 uuid; v_bs3 uuid;
  v_ch_a1 uuid; v_ch_a2 uuid; v_ch_b1 uuid;
  v_tp_a1a uuid; v_tp_a1b uuid; v_tp_a2a uuid; v_tp_b1a uuid;
  v_stream2 uuid; v_sub2 uuid; v_b2b uuid; v_bs2b uuid; v_ch2 uuid; v_tp2 uuid;
begin
  -- Institutes A (main test) and B (cross-institute isolation)
  insert into public.institutes (name, slug, plan_tier)
  values ('Bulk Import Test A', 'bulk-import-test-a', 'starter') returning institute_id into v_inst1;
  insert into public.institutes (name, slug, plan_tier)
  values ('Bulk Import Test B', 'bulk-import-test-b', 'starter') returning institute_id into v_inst2;

  -- Profiles
  insert into public.profiles (profile_id, institute_id, name, email, role) values
    (gen_random_uuid(), v_inst1, 'Bulk Super Admin', 'bulk.superadmin@test.invalid', 'admin')
  returning profile_id into v_sa;
  insert into public.profiles (profile_id, institute_id, name, email, role) values
    (gen_random_uuid(), v_inst1, 'Bulk Academic Admin', 'bulk.academicadmin@test.invalid', 'admin')
  returning profile_id into v_aa;
  insert into public.profiles (profile_id, institute_id, name, email, role) values
    (gen_random_uuid(), v_inst1, 'Bulk Teacher One', 'bulk.teacher1@test.invalid', 'teacher')
  returning profile_id into v_t1p;
  insert into public.profiles (profile_id, institute_id, name, email, role) values
    (gen_random_uuid(), v_inst1, 'Bulk Teacher Two', 'bulk.teacher2@test.invalid', 'teacher')
  returning profile_id into v_t2p;
  insert into public.profiles (profile_id, institute_id, name, email, role) values
    (gen_random_uuid(), v_inst1, 'Bulk Student', 'bulk.student@test.invalid', 'student')
  returning profile_id into v_stp;
  insert into public.profiles (profile_id, institute_id, name, email, role) values
    (gen_random_uuid(), v_inst2, 'Bulk Teacher Inst2', 'bulk.teacher2b@test.invalid', 'teacher')
  returning profile_id into v_t2bp;

  -- Admin grants (role = 'admin' required by trg_admin_roles_check_role)
  insert into public.admin_roles (profile_id, institute_id, admin_role, access_status) values
    (v_sa, v_inst1, 'super_admin', 'approved');
  insert into public.admin_roles (profile_id, institute_id, admin_role, access_status) values
    (v_aa, v_inst1, 'academic_admin', 'approved');

  -- Teachers
  insert into public.teacher_details (profile_id, specialization) values (v_t1p, 'bulk-test')
  returning teacher_id into v_t1;
  insert into public.teacher_details (profile_id, specialization) values (v_t2p, 'bulk-test')
  returning teacher_id into v_t2;
  insert into public.teacher_details (profile_id, specialization) values (v_t2bp, 'bulk-test')
  returning teacher_id into v_t2b;

  -- Academic structure (A)
  insert into public.streams (institute_id, name, code) values (v_inst1, 'Bulk Stream', 'BST')
  returning stream_id into v_stream;
  insert into public.subjects (stream_id, name, code) values (v_stream, 'Bulk Physics', 'BPHY')
  returning subject_id into v_sub_a;
  insert into public.subjects (stream_id, name, code) values (v_stream, 'Bulk Chemistry', 'BCHM')
  returning subject_id into v_sub_b;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date) values
    (v_inst1, v_stream, 'Bulk Batch 1', 'BB1', '2026-27', v_monday - 90, v_monday + 365)
  returning batch_id into v_b1;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date) values
    (v_inst1, v_stream, 'Bulk Batch 2', 'BB2', '2026-27', v_monday - 90, v_monday + 365)
  returning batch_id into v_b2;

  -- Batch-subjects + teacher assignments (authoritative model)
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_b1, v_sub_a, v_inst1) returning batch_subject_id into v_bs1;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_b2, v_sub_b, v_inst1) returning batch_subject_id into v_bs2;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_b1, v_sub_b, v_inst1) returning batch_subject_id into v_bs3; -- same batch as BS1 (batch-conflict tests)

  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id) values
    (v_bs1, v_t1, v_inst1);
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id) values
    (v_bs2, v_t2, v_inst1);
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id) values
    (v_bs3, v_t2, v_inst1);

  -- Chapters + topics
  insert into public.chapters (subject_id, name) values (v_sub_a, 'Bulk Kinematics')
  returning chapter_id into v_ch_a1;
  insert into public.chapters (subject_id, name) values (v_sub_a, 'Bulk Dynamics')
  returning chapter_id into v_ch_a2;
  insert into public.chapters (subject_id, name) values (v_sub_b, 'Bulk Organic')
  returning chapter_id into v_ch_b1;
  insert into public.topics (chapter_id, name) values (v_ch_a1, 'Bulk Distance and Displacement')
  returning topic_id into v_tp_a1a;
  insert into public.topics (chapter_id, name) values (v_ch_a1, 'Bulk Speed and Velocity')
  returning topic_id into v_tp_a1b;
  insert into public.topics (chapter_id, name) values (v_ch_a2, 'Bulk Newton First Law')
  returning topic_id into v_tp_a2a;
  insert into public.topics (chapter_id, name) values (v_ch_b1, 'Bulk Hydrocarbons')
  returning topic_id into v_tp_b1a;

  -- Academic structure (B — cross-institute isolation)
  insert into public.streams (institute_id, name, code) values (v_inst2, 'Bulk Stream B', 'BSTB')
  returning stream_id into v_stream2;
  insert into public.subjects (stream_id, name, code) values (v_stream2, 'Bulk Subject 2', 'BSUB')
  returning subject_id into v_sub2;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date) values
    (v_inst2, v_stream2, 'Bulk Batch 2B', 'BB2B', '2026-27', v_monday - 90, v_monday + 365)
  returning batch_id into v_b2b;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_b2b, v_sub2, v_inst2) returning batch_subject_id into v_bs2b;
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id) values
    (v_bs2b, v_t2b, v_inst2);
  insert into public.chapters (subject_id, name) values (v_sub2, 'Bulk Chapter 2') returning chapter_id into v_ch2;
  insert into public.topics (chapter_id, name) values (v_ch2, 'Bulk Topic 2') returning topic_id into v_tp2;

  insert into bulk_test_env values
    ('inst1', v_inst1::text), ('inst2', v_inst2::text),
    ('sa', v_sa::text), ('aa', v_aa::text), ('stp', v_stp::text),
    ('t1', v_t1::text), ('t2', v_t2::text), ('t2b', v_t2b::text),
    ('bs1', v_bs1::text), ('bs2', v_bs2::text), ('bs3', v_bs3::text),
    ('bs2b', v_bs2b::text),
    ('sub_a', v_sub_a::text),
    ('ch_a1', v_ch_a1::text), ('ch_a2', v_ch_a2::text), ('ch_b1', v_ch_b1::text),
    ('ch2', v_ch2::text),
    ('tp_a1a', v_tp_a1a::text), ('tp_a1b', v_tp_a1b::text),
    ('tp_a2a', v_tp_a2a::text), ('tp_b1a', v_tp_b1a::text), ('tp2', v_tp2::text),
    ('monday', v_monday::text);
end $$;

-- ── TEST 2 — Basic RPC: one slot + one lesson ─────────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int; v_ch uuid; v_tp uuid;
  v_slots jsonb := jsonb_build_array(bulk_slot('t2-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t2-slot', v_m + 7, bulk_env('ch_a1')::uuid, bulk_env('tp_a1a')::uuid, 'bulk test 2'));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'rpc err: ' || coalesce(v->>'err', '?'); end if;
  if v_pass and (v->'result'->>'slotsCreated')::int <> 1 then v_pass := false; v_detail := 'slotsCreated=' || (v->'result'->>'slotsCreated'); end if;
  if v_pass and (v->'result'->>'plansCreated')::int <> 1 then v_pass := false; v_detail := 'plansCreated=' || (v->'result'->>'plansCreated'); end if;
  if v_pass then
    select count(*) into v_rows from public.timetable_slots
    where teacher_id = bulk_env('t1')::uuid and batch_subject_id = bulk_env('bs1')::uuid
      and day_of_week = 1 and start_time = time '10:00:00' and end_time = time '11:00:00';
    if v_rows <> 1 then v_pass := false; v_detail := 'slot rows=' || v_rows; end if;
  end if;
  if v_pass then
    select count(*) into v_rows from public.lesson_plans lp
    join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
    where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
      and lp.occurrence_date = v_m + 7;
    if v_rows <> 1 then v_pass := false; v_detail := 'plan rows=' || v_rows; end if;
  end if;
  if v_pass then
    select lp.chapter_id, lp.topic_id into v_ch, v_tp from public.lesson_plans lp
    join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
    where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
      and lp.occurrence_date = v_m + 7;
    if v_ch is distinct from bulk_env('ch_a1')::uuid or v_tp is distinct from bulk_env('tp_a1a')::uuid then
      v_pass := false; v_detail := 'wrong chapter/topic stored';
    end if;
  end if;
  perform bulk_test_record(2, 'Basic RPC: 1 slot + 1 plan', v_pass, v_detail);
exception when others then
  perform bulk_test_record(2, 'Basic RPC: 1 slot + 1 plan', false, SQLERRM);
end $$;

-- ── TEST 3 — Same schedule across 3 dates → 1 slot + 3 plans ──────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t3-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '11:00:00', '12:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(
    bulk_plan('t3-slot', v_m + 7,  bulk_env('ch_a1')::uuid, bulk_env('tp_a1a')::uuid),
    bulk_plan('t3-slot', v_m + 14, bulk_env('ch_a1')::uuid, null),             -- chapter-only
    bulk_plan('t3-slot', v_m + 21, bulk_env('ch_a1')::uuid, bulk_env('tp_a1b')::uuid)
  );
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'rpc err: ' || coalesce(v->>'err', '?'); end if;
  if v_pass and (v->'result'->>'slotsCreated')::int <> 1 then v_pass := false; v_detail := 'slotsCreated=' || (v->'result'->>'slotsCreated'); end if;
  if v_pass and (v->'result'->>'plansCreated')::int <> 3 then v_pass := false; v_detail := 'plansCreated=' || (v->'result'->>'plansCreated'); end if;
  if v_pass then
    select count(*) into v_rows from public.timetable_slots
    where teacher_id = bulk_env('t1')::uuid and batch_subject_id = bulk_env('bs1')::uuid
      and day_of_week = 1 and start_time = time '11:00:00' and end_time = time '12:00:00';
    if v_rows <> 1 then v_pass := false; v_detail := 'slot rows=' || v_rows; end if;
  end if;
  if v_pass then
    select count(*) into v_rows from public.lesson_plans lp
    join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
    where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
      and ts.start_time = time '11:00:00';
    if v_rows <> 3 then v_pass := false; v_detail := 'plan rows=' || v_rows; end if;
  end if;
  perform bulk_test_record(3, 'Same slot / 3 lessons -> 1 slot + 3 plans', v_pass, v_detail);
exception when others then
  perform bulk_test_record(3, 'Same slot / 3 lessons -> 1 slot + 3 plans', false, SQLERRM);
end $$;

-- ── TEST 4 — Repeated identical import (idempotent) ───────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t3-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '11:00:00', '12:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(
    bulk_plan('t3-slot', v_m + 7,  bulk_env('ch_a1')::uuid, bulk_env('tp_a1a')::uuid),
    bulk_plan('t3-slot', v_m + 14, bulk_env('ch_a1')::uuid, null),
    bulk_plan('t3-slot', v_m + 21, bulk_env('ch_a1')::uuid, bulk_env('tp_a1b')::uuid)
  );
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'rpc err: ' || coalesce(v->>'err', '?'); end if;
  if v_pass and (v->'result'->>'slotsCreated')::int <> 0 then v_pass := false; v_detail := 'slotsCreated=' || (v->'result'->>'slotsCreated'); end if;
  if v_pass and (v->'result'->>'slotsReused')::int <> 1 then v_pass := false; v_detail := 'slotsReused=' || (v->'result'->>'slotsReused'); end if;
  if v_pass and (v->'result'->>'plansUpdated')::int <> 3 then v_pass := false; v_detail := 'plansUpdated=' || (v->'result'->>'plansUpdated'); end if;
  if v_pass then
    select count(*) into v_rows from public.timetable_slots
    where teacher_id = bulk_env('t1')::uuid and batch_subject_id = bulk_env('bs1')::uuid
      and day_of_week = 1 and start_time = time '11:00:00' and end_time = time '12:00:00';
    if v_rows <> 1 then v_pass := false; v_detail := 'duplicate slot created: rows=' || v_rows; end if;
  end if;
  if v_pass then
    select count(*) into v_rows from public.lesson_plans lp
    join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
    where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
      and ts.start_time = time '11:00:00';
    if v_rows <> 3 then v_pass := false; v_detail := 'plan rows after re-import=' || v_rows; end if;
  end if;
  perform bulk_test_record(4, 'Repeated import is idempotent (reuse + update)', v_pass, v_detail);
exception when others then
  perform bulk_test_record(4, 'Repeated import is idempotent (reuse + update)', false, SQLERRM);
end $$;

-- ── TEST 5 — Lesson update in place (no duplicate) ────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int; v_ch uuid; v_tp uuid;
  v_slots jsonb := jsonb_build_array(bulk_slot('t3-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '11:00:00', '12:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t3-slot', v_m + 7, bulk_env('ch_a2')::uuid, bulk_env('tp_a2a')::uuid));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'rpc err: ' || coalesce(v->>'err', '?'); end if;
  if v_pass and (v->'result'->>'plansUpdated')::int <> 1 then v_pass := false; v_detail := 'plansUpdated=' || (v->'result'->>'plansUpdated'); end if;
  if v_pass then
    select count(*) into v_rows from public.lesson_plans lp
    join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
    where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
      and ts.start_time = time '11:00:00' and lp.occurrence_date = v_m + 7;
    if v_rows <> 1 then v_pass := false; v_detail := 'plan rows after update=' || v_rows; end if;
  end if;
  if v_pass then
    select lp.chapter_id, lp.topic_id into v_ch, v_tp from public.lesson_plans lp
    join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
    where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
      and ts.start_time = time '11:00:00' and lp.occurrence_date = v_m + 7;
    if v_ch is distinct from bulk_env('ch_a2')::uuid or v_tp is distinct from bulk_env('tp_a2a')::uuid then
      v_pass := false; v_detail := 'chapter/topic not updated';
    end if;
  end if;
  perform bulk_test_record(5, 'Lesson update in place (same plan row)', v_pass, v_detail);
exception when others then
  perform bulk_test_record(5, 'Lesson update in place (same plan row)', false, SQLERRM);
end $$;

-- ── TEST 6 — Chapter-only lesson (topic_id NULL) ─────────────────────────
do $$
declare
  v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_ch uuid; v_tp uuid; v_rows int;
begin
  select lp.chapter_id, lp.topic_id into v_ch, v_tp from public.lesson_plans lp
  join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
  where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
    and ts.start_time = time '11:00:00' and lp.occurrence_date = v_m + 14;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then v_pass := false; v_detail := 'chapter-only plan row missing'; end if;
  if v_pass and v_ch is distinct from bulk_env('ch_a1')::uuid then v_pass := false; v_detail := 'chapter mismatch'; end if;
  if v_pass and v_tp is not null then v_pass := false; v_detail := 'topic_id should be NULL'; end if;
  perform bulk_test_record(6, 'Chapter-only lesson (topic NULL)', v_pass, v_detail);
exception when others then
  perform bulk_test_record(6, 'Chapter-only lesson (topic NULL)', false, SQLERRM);
end $$;

-- ── TEST 7 — Wrong chapter for subject → reject + full rollback ───────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t7-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '09:00:00', '10:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t7-slot', v_m + 7, bulk_env('ch_a1')::uuid, null)); -- Physics chapter on Chemistry bs
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%does not belong to the subject%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t2')::uuid and batch_subject_id = bulk_env('bs2')::uuid
    and day_of_week = 1 and start_time = time '09:00:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'slot created despite failure: ' || v_rows; end if;
  perform bulk_test_record(7, 'Wrong chapter/subject rejected + rollback', v_pass, v_detail);
exception when others then
  perform bulk_test_record(7, 'Wrong chapter/subject rejected + rollback', false, SQLERRM);
end $$;

-- ── TEST 8 — Wrong topic for chapter → reject + rollback ─────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t8-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '08:30:00', '09:30:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t8-slot', v_m + 14, bulk_env('ch_b1')::uuid, bulk_env('tp_a1a')::uuid)); -- topic of another chapter
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%does not belong to the selected chapter%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t2')::uuid and batch_subject_id = bulk_env('bs2')::uuid
    and day_of_week = 1 and start_time = time '08:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'slot created despite failure: ' || v_rows; end if;
  perform bulk_test_record(8, 'Wrong topic/chapter rejected + rollback', v_pass, v_detail);
exception when others then
  perform bulk_test_record(8, 'Wrong topic/chapter rejected + rollback', false, SQLERRM);
end $$;

-- ── TEST 9 — Unassigned teacher → reject + rollback ──────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t9-slot', bulk_env('t1')::uuid, bulk_env('bs2')::uuid, 1, '07:30:00', '08:30:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t9-slot', v_m + 21, bulk_env('ch_b1')::uuid, null));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%not assigned to this batch-subject%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t1')::uuid and batch_subject_id = bulk_env('bs2')::uuid
    and day_of_week = 1 and start_time = time '07:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'slot created despite failure: ' || v_rows; end if;
  perform bulk_test_record(9, 'Unassigned teacher rejected + rollback', v_pass, v_detail);
exception when others then
  perform bulk_test_record(9, 'Unassigned teacher rejected + rollback', false, SQLERRM);
end $$;

-- ── TEST 10 — Cross-institute rejected ───────────────────────────────────
do $$
declare
  v jsonb; v_pass1 boolean := false; v_pass2 boolean := false; v_pass boolean := false;
  v_detail text := '';
  v_m date := bulk_env('monday')::date;
  -- (a) admin of inst1 passes p_institute_id = inst2
  v_slots jsonb := jsonb_build_array(bulk_slot('t10-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
  -- (b) admin of inst1 uses an inst2 batch_subject while passing inst1
  v_slots2 jsonb := jsonb_build_array(bulk_slot('t10b-slot', bulk_env('t2b')::uuid, bulk_env('bs2b')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst2')::uuid, v_slots, '[]'::jsonb);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%own institute%' then v_pass1 := true; end if;
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots2, '[]'::jsonb);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%does not belong to this institute%' then v_pass2 := true; end if;
  v_pass := v_pass1 and v_pass2;
  if not v_pass then v_detail := 'a=' || v_pass1::text || ' b=' || v_pass2::text; end if;
  perform bulk_test_record(10, 'Cross-institute access rejected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(10, 'Cross-institute access rejected', false, SQLERRM);
end $$;

-- ── TEST 11 — Weekday mismatch → reject + rollback ────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t11-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '06:30:00', '07:30:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t11-slot', v_m + 8, bulk_env('ch_b1')::uuid, null)); -- Tuesday on a Monday slot
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%day of week%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t2')::uuid and batch_subject_id = bulk_env('bs2')::uuid
    and day_of_week = 1 and start_time = time '06:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'slot created despite failure: ' || v_rows; end if;
  perform bulk_test_record(11, 'Weekday mismatch rejected + rollback', v_pass, v_detail);
exception when others then
  perform bulk_test_record(11, 'Weekday mismatch rejected + rollback', false, SQLERRM);
end $$;

-- ── TEST 12 — Out-of-validity date → reject + rollback ────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t12-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '05:30:00', '06:30:00', v_m + 7, v_m + 14));
  v_plans jsonb := jsonb_build_array(bulk_plan('t12-slot', v_m + 21, bulk_env('ch_b1')::uuid, null)); -- Monday but AFTER valid_until
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%outside the timetable slot%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t2')::uuid and batch_subject_id = bulk_env('bs2')::uuid
    and day_of_week = 1 and start_time = time '05:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'slot created despite failure: ' || v_rows; end if;
  perform bulk_test_record(12, 'Out-of-validity date rejected + rollback', v_pass, v_detail);
exception when others then
  perform bulk_test_record(12, 'Out-of-validity date rejected + rollback', false, SQLERRM);
end $$;

-- ── TEST 13 — Teacher time conflict → reject (no new slot) ────────────────
-- Existing: T1/BS1 Monday 10:00-11:00 (created by test 2).
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t13-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:30:00', '11:30:00', v_m - 56, v_m + 84));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, '[]'::jsonb);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%already has an active slot%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t1')::uuid and batch_subject_id = bulk_env('bs1')::uuid
    and day_of_week = 1 and start_time = time '10:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'conflicting slot created: ' || v_rows; end if;
  perform bulk_test_record(13, 'Teacher time conflict rejected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(13, 'Teacher time conflict rejected', false, SQLERRM);
end $$;

-- ── TEST 14 — Batch time conflict → reject (no new slot) ──────────────────
-- Existing: batch B1 Monday 10:00-11:00 (via BS1, test 2). Import BS3 (same batch B1), different teacher.
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t14-slot', bulk_env('t2')::uuid, bulk_env('bs3')::uuid, 1, '10:30:00', '11:30:00', v_m - 56, v_m + 84));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, '[]'::jsonb);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%already has an active slot%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t2')::uuid and batch_subject_id = bulk_env('bs3')::uuid
    and day_of_week = 1 and start_time = time '10:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'conflicting slot created: ' || v_rows; end if;
  perform bulk_test_record(14, 'Batch time conflict rejected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(14, 'Batch time conflict rejected', false, SQLERRM);
end $$;

-- ── TEST 15 — Existing slot validity extension ────────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int; v_until date;
  v_slots jsonb;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', bulk_env('sa')::text, true);
  perform public.create_timetable_slot(bulk_env('inst1')::uuid, bulk_env('t1')::uuid, bulk_env('bs1')::uuid,
         1, time '14:00:00', time '15:00:00', v_m + 7, v_m + 14);

  v_slots := jsonb_build_array(bulk_slot('t15-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '14:00:00', '15:00:00', v_m + 7, v_m + 21));
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, '[]'::jsonb);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'rpc err: ' || coalesce(v->>'err','?'); end if;
  if v_pass and (v->'result'->>'slotsReused')::int <> 1 then v_pass := false; v_detail := 'slotsReused=' || (v->'result'->>'slotsReused'); end if;
  if v_pass and (v->'result'->>'slotsExtended')::int <> 1 then v_pass := false; v_detail := 'slotsExtended=' || (v->'result'->>'slotsExtended'); end if;
  if v_pass then
    select count(*), max(valid_until) into v_rows, v_until from public.timetable_slots
    where teacher_id = bulk_env('t1')::uuid and batch_subject_id = bulk_env('bs1')::uuid
      and day_of_week = 1 and start_time = time '14:00:00' and end_time = time '15:00:00';
    if v_rows <> 1 then v_pass := false; v_detail := 'expected 1 slot, got ' || v_rows; end if;
    if v_pass and v_until <> v_m + 21 then v_pass := false; v_detail := 'valid_until=' || v_until || ' expected ' || (v_m + 21); end if;
  end if;
  perform bulk_test_record(15, 'Existing slot validity extension (reuse + extend)', v_pass, v_detail);
exception when others then
  perform bulk_test_record(15, 'Existing slot validity extension (reuse + extend)', false, SQLERRM);
end $$;

-- ── TEST 16 — Disjoint validity → second slot created (matches create_timetable_slot) ──
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', bulk_env('sa')::text, true);
  perform public.create_timetable_slot(bulk_env('inst1')::uuid, bulk_env('t1')::uuid, bulk_env('bs1')::uuid,
         1, time '16:00:00', time '17:00:00', v_m + 7, v_m + 14);

  v_slots := jsonb_build_array(bulk_slot('t16-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '16:00:00', '17:00:00', v_m + 49, v_m + 77));
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, '[]'::jsonb);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'rpc err: ' || coalesce(v->>'err','?'); end if;
  if v_pass and (v->'result'->>'slotsCreated')::int <> 1 then v_pass := false; v_detail := 'slotsCreated=' || (v->'result'->>'slotsCreated'); end if;
  if v_pass then
    select count(*) into v_rows from public.timetable_slots
    where teacher_id = bulk_env('t1')::uuid and batch_subject_id = bulk_env('bs1')::uuid
      and day_of_week = 1 and start_time = time '16:00:00' and end_time = time '17:00:00';
    if v_rows <> 2 then v_pass := false; v_detail := 'expected 2 disjoint slots, got ' || v_rows; end if;
  end if;
  perform bulk_test_record(16, 'Disjoint validity creates a separate slot', v_pass, v_detail);
exception when others then
  perform bulk_test_record(16, 'Disjoint validity creates a separate slot', false, SQLERRM);
end $$;

-- ── TESTS 17-21 — History protection + propagation on the t2 slot (10:00-11:00) ──
do $$
declare
  v_m date := bulk_env('monday')::date;
  v_slot uuid; v_sub uuid;
begin
  select ts.timetable_slot_id, ts.batch_subject_id into v_slot, v_sub
  from public.timetable_slots ts
  where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
    and ts.day_of_week = 1 and ts.start_time = time '10:00:00' and ts.end_time = time '11:00:00';

  -- occurrence dates: completed (-42d), live (-35d), started-scheduled (-28d), future (+7d), cancelled (+14d)
  insert into public.live_classes (institute_id, teacher_id, subject_id, title, scheduled_at, duration_min, status, is_recorded, timetable_slot_id) values
    (bulk_env('inst1')::uuid, bulk_env('t1')::uuid, v_sub, 'bulk completed', (v_m - 42 + time '10:00') at time zone 'Asia/Kolkata', 60, 'completed', false, v_slot),
    (bulk_env('inst1')::uuid, bulk_env('t1')::uuid, v_sub, 'bulk live',       (v_m - 35 + time '10:00') at time zone 'Asia/Kolkata', 60, 'live',       false, v_slot),
    (bulk_env('inst1')::uuid, bulk_env('t1')::uuid, v_sub, 'bulk started',    (v_m - 28 + time '10:00') at time zone 'Asia/Kolkata', 60, 'scheduled',  false, v_slot),
    (bulk_env('inst1')::uuid, bulk_env('t1')::uuid, v_sub, 'bulk future',     (v_m + 7  + time '10:00') at time zone 'Asia/Kolkata', 60, 'scheduled',  false, v_slot),
    (bulk_env('inst1')::uuid, bulk_env('t1')::uuid, v_sub, 'bulk cancelled',  (v_m + 14 + time '10:00') at time zone 'Asia/Kolkata', 60, 'cancelled',  false, v_slot);
  insert into bulk_test_env values ('t2_slot', v_slot::text), ('t2_subject', v_sub::text);
end $$;

-- TEST 17 — Completed class protected
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t2-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t2-slot', v_m - 42, bulk_env('ch_a1')::uuid, bulk_env('tp_a1a')::uuid));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%started or completed%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.lesson_plans
  where timetable_slot_id = bulk_env('t2_slot')::uuid and occurrence_date = v_m - 42;
  if v_rows <> 0 then v_pass := false; v_detail := 'plan created despite lock: ' || v_rows; end if;
  perform bulk_test_record(17, 'Completed class protected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(17, 'Completed class protected', false, SQLERRM);
end $$;

-- TEST 18 — Live class protected
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t2-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t2-slot', v_m - 35, bulk_env('ch_a1')::uuid, bulk_env('tp_a1a')::uuid));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%started or completed%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.lesson_plans
  where timetable_slot_id = bulk_env('t2_slot')::uuid and occurrence_date = v_m - 35;
  if v_rows <> 0 then v_pass := false; v_detail := 'plan created despite lock: ' || v_rows; end if;
  perform bulk_test_record(18, 'Live class protected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(18, 'Live class protected', false, SQLERRM);
end $$;

-- TEST 19 — Started scheduled class protected (scheduled_at <= now())
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t2-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t2-slot', v_m - 28, bulk_env('ch_a1')::uuid, bulk_env('tp_a1a')::uuid));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%started or completed%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  select count(*) into v_rows from public.lesson_plans
  where timetable_slot_id = bulk_env('t2_slot')::uuid and occurrence_date = v_m - 28;
  if v_rows <> 0 then v_pass := false; v_detail := 'plan created despite lock: ' || v_rows; end if;
  perform bulk_test_record(19, 'Started scheduled class protected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(19, 'Started scheduled class protected', false, SQLERRM);
end $$;

-- TEST 20 — Future scheduled class: plan allowed + propagated to the class
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_ch uuid; v_tp uuid; v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t2-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t2-slot', v_m + 7, bulk_env('ch_a2')::uuid, bulk_env('tp_a2a')::uuid)); -- different lesson
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'rpc err: ' || coalesce(v->>'err','?'); end if;
  if v_pass then
    select lp.chapter_id, lp.topic_id into v_ch, v_tp from public.lesson_plans lp
    where lp.timetable_slot_id = bulk_env('t2_slot')::uuid and lp.occurrence_date = v_m + 7;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then v_pass := false; v_detail := 'plan row missing'; end if;
    if v_pass and (v_ch is distinct from bulk_env('ch_a2')::uuid or v_tp is distinct from bulk_env('tp_a2a')::uuid) then
      v_pass := false; v_detail := 'plan chapter/topic mismatch';
    end if;
  end if;
  if v_pass then
    -- propagation: the future scheduled class must carry the new chapter/topic
    select lc.chapter_id, lc.topic_id into v_ch, v_tp from public.live_classes lc
    where lc.timetable_slot_id = bulk_env('t2_slot')::uuid
      and (lc.scheduled_at at time zone 'Asia/Kolkata')::date = v_m + 7;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then v_pass := false; v_detail := 'future class row missing'; end if;
    if v_pass and (v_ch is distinct from bulk_env('ch_a2')::uuid or v_tp is distinct from bulk_env('tp_a2a')::uuid) then
      v_pass := false; v_detail := 'class not propagated';
    end if;
  end if;
  if v_pass then
    -- historical rows must remain untouched (no chapter, original statuses)
    select count(*) into v_rows from public.live_classes
    where timetable_slot_id = bulk_env('t2_slot')::uuid
      and ((scheduled_at at time zone 'Asia/Kolkata')::date in (v_m - 42, v_m - 35))
      and chapter_id is not null;
    if v_rows <> 0 then v_pass := false; v_detail := 'historical class rewritten!'; end if;
  end if;
  perform bulk_test_record(20, 'Future class: plan + propagation, history untouched', v_pass, v_detail);
exception when others then
  perform bulk_test_record(20, 'Future class: plan + propagation, history untouched', false, SQLERRM);
end $$;

-- TEST 21 — Cancelled class: plan recorded (documented), class untouched
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_rows int; v_status text; v_ch text;
  v_slots jsonb := jsonb_build_array(bulk_slot('t2-slot', bulk_env('t1')::uuid, bulk_env('bs1')::uuid, 1, '10:00:00', '11:00:00', v_m - 56, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t2-slot', v_m + 14, bulk_env('ch_a1')::uuid, null));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'true' then v_pass := false; v_detail := 'expected success (cancelled not locked): ' || coalesce(v->>'err','?'); end if;
  if v_pass then
    select count(*) into v_rows from public.lesson_plans
    where timetable_slot_id = bulk_env('t2_slot')::uuid and occurrence_date = v_m + 14;
    if v_rows <> 1 then v_pass := false; v_detail := 'plan row missing'; end if;
  end if;
  if v_pass then
    select status::text, chapter_id::text into v_status, v_ch from public.live_classes
    where timetable_slot_id = bulk_env('t2_slot')::uuid
      and (scheduled_at at time zone 'Asia/Kolkata')::date = v_m + 14;
    if v_status <> 'cancelled' then v_pass := false; v_detail := 'cancelled class was modified! status=' || v_status; end if;
    if v_pass and v_ch is not null then v_pass := false; v_detail := 'cancelled class chapter was modified!'; end if;
  end if;
  perform bulk_test_record(21, 'Cancelled class: plan recorded, class untouched', v_pass, v_detail);
exception when others then
  perform bulk_test_record(21, 'Cancelled class: plan recorded, class untouched', false, SQLERRM);
end $$;

-- ── TEST 22 — Atomic rollback: 10 valid rows + 1 invalid → nothing committed ──
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_plans jsonb; v_rows int;
  v_slots jsonb := jsonb_build_array(bulk_slot('t22-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '04:30:00', '05:30:00', v_m + 7, v_m + 84));
begin
  select jsonb_agg(bulk_plan('t22-slot', v_m + 7 + g * 7, bulk_env('ch_b1')::uuid, bulk_env('tp_b1a')::uuid))
    into v_plans from generate_series(0, 9) g;  -- 10 valid Monday plans
  v_plans := v_plans || jsonb_build_array(bulk_plan('t22-slot', v_m + 10, bulk_env('ch_b1')::uuid, null)); -- row 11: Wednesday -> invalid

  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%day of week%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;

  select count(*) into v_rows from public.timetable_slots
  where teacher_id = bulk_env('t2')::uuid and batch_subject_id = bulk_env('bs2')::uuid
    and day_of_week = 1 and start_time = time '04:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'slot committed despite failure: ' || v_rows; end if;

  select count(*) into v_rows from public.lesson_plans lp
  join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id
  where ts.teacher_id = bulk_env('t2')::uuid and ts.batch_subject_id = bulk_env('bs2')::uuid
    and ts.start_time = time '04:30:00';
  if v_rows <> 0 then v_pass := false; v_detail := 'plans committed despite failure: ' || v_rows; end if;

  perform bulk_test_record(22, 'Atomic rollback: 10 valid + 1 invalid -> ZERO rows', v_pass, v_detail);
exception when others then
  perform bulk_test_record(22, 'Atomic rollback: 10 valid + 1 invalid -> ZERO rows', false, SQLERRM);
end $$;

-- ── TEST 23 — Duplicate slot keys rejected ────────────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_s1 jsonb := bulk_slot('dup-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '04:00:00', '05:00:00', v_m + 7, v_m + 84);
  v_slots jsonb := jsonb_build_array(v_s1, v_s1);
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, '[]'::jsonb);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%Duplicate slot key%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  perform bulk_test_record(23, 'Duplicate slot keys rejected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(23, 'Duplicate slot keys rejected', false, SQLERRM);
end $$;

-- ── TEST 24 — Unknown slot key rejected ───────────────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_slots jsonb := jsonb_build_array(bulk_slot('k24-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '03:30:00', '04:30:00', v_m + 7, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('does-not-exist', v_m + 7, bulk_env('ch_b1')::uuid, null));
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%unknown timetable slot key%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  perform bulk_test_record(24, 'Unknown slot key rejected', v_pass, v_detail);
exception when others then
  perform bulk_test_record(24, 'Unknown slot key rejected', false, SQLERRM);
end $$;

-- ── TEST 25 — Non-array payload rejected ──────────────────────────────────
do $$
declare
  v jsonb; v_pass1 boolean := false; v_pass2 boolean := false;
  v_detail text := '';
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, '{}'::jsonb, '[]'::jsonb);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%JSON arrays%' then v_pass1 := true; end if;
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, '[]'::jsonb, '{}'::jsonb);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%JSON arrays%' then v_pass2 := true; end if;
  if not (v_pass1 and v_pass2) then v_detail := 's1=' || v_pass1::text || ' s2=' || v_pass2::text; end if;
  perform bulk_test_record(25, 'Non-array payload rejected', v_pass1 and v_pass2, v_detail);
exception when others then
  perform bulk_test_record(25, 'Non-array payload rejected', false, SQLERRM);
end $$;

-- ── TEST 26 — Non-object elements rejected ────────────────────────────────
do $$
declare
  v jsonb; v_pass1 boolean := false; v_pass2 boolean := false;
  v_detail text := '';
begin
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, '[null]'::jsonb, '[]'::jsonb);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%must be a JSON object%' then v_pass1 := true; end if;
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, '["text"]'::jsonb, '[]'::jsonb);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%must be a JSON object%' then v_pass2 := true; end if;
  if not (v_pass1 and v_pass2) then v_detail := 's1=' || v_pass1::text || ' s2=' || v_pass2::text; end if;
  perform bulk_test_record(26, 'Non-object elements rejected', v_pass1 and v_pass2, v_detail);
exception when others then
  perform bulk_test_record(26, 'Non-object elements rejected', false, SQLERRM);
end $$;

-- ── TEST 27 — 5,000-row cap enforced ──────────────────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_slots jsonb;
begin
  select jsonb_agg(jsonb_build_object('key', 'k' || g)) into v_slots
  from generate_series(1, 5001) g;
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst1')::uuid, v_slots, '[]'::jsonb);
  if (v->>'ok') <> 'false' then v_pass := false; v_detail := 'expected rejection, got ok=' || (v->>'ok'); end if;
  if v_pass and coalesce(v->>'err','') not like '%at most 5,000%' then v_pass := false; v_detail := 'err=' || coalesce(v->>'err',''); end if;
  perform bulk_test_record(27, '5,000-row cap enforced', v_pass, v_detail);
exception when others then
  perform bulk_test_record(27, '5,000-row cap enforced', false, SQLERRM);
end $$;

-- ── TEST 28 — Security matrix ─────────────────────────────────────────────
do $$
declare
  v jsonb; v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_ok1 boolean := false; v_ok2 boolean := false; v_ok3 boolean := false;
  v_ok4 boolean := false; v_ok5 boolean := false;
  v_slots jsonb := jsonb_build_array(bulk_slot('t28-slot', bulk_env('t2')::uuid, bulk_env('bs2')::uuid, 1, '03:30:00', '04:30:00', v_m + 7, v_m + 84));
  v_plans jsonb := jsonb_build_array(bulk_plan('t28-slot', v_m + 7, bulk_env('ch_b1')::uuid, bulk_env('tp_b1a')::uuid));
  v_slots_b jsonb := jsonb_build_array(bulk_slot('t28b-slot', bulk_env('t2b')::uuid, bulk_env('bs2b')::uuid, 1, '09:00:00', '10:00:00', v_m + 7, v_m + 84));
  v_plans_b jsonb := jsonb_build_array(bulk_plan('t28b-slot', v_m + 7, bulk_env('ch2')::uuid, bulk_env('tp2')::uuid));
begin
  -- (a) teacher denied
  v := bulk_test_call('authenticated', bulk_env('t1')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%Only admins or the service role%' then v_ok1 := true; end if;
  -- (b) student denied
  v := bulk_test_call('authenticated', bulk_env('stp')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%Only admins or the service role%' then v_ok2 := true; end if;
  -- (c) academic admin allowed within own institute
  v := bulk_test_call('authenticated', bulk_env('aa')::uuid, bulk_env('inst1')::uuid, v_slots, v_plans);
  if (v->>'ok') = 'true' and (v->'result'->>'slotsCreated')::int = 1 then v_ok3 := true; end if;
  -- (d) service_role allowed, and allowed to target another institute
  v := bulk_test_call('service_role', null, bulk_env('inst2')::uuid, v_slots_b, v_plans_b);
  if (v->>'ok') = 'true' and (v->'result'->>'slotsCreated')::int = 1 then v_ok4 := true; end if;
  -- (e) super admin cross-institute denied
  v := bulk_test_call('authenticated', bulk_env('sa')::uuid, bulk_env('inst2')::uuid, v_slots_b, v_plans_b);
  if (v->>'ok') = 'false' and coalesce(v->>'err','') like '%own institute%' then v_ok5 := true; end if;

  v_pass := v_ok1 and v_ok2 and v_ok3 and v_ok4 and v_ok5;
  if not v_pass then
    v_detail := format('teacherDenied=%s studentDenied=%s academicAdminOk=%s serviceRoleOk=%s crossInstituteDenied=%s',
      v_ok1, v_ok2, v_ok3, v_ok4, v_ok5);
  end if;
  perform bulk_test_record(28, 'Security matrix (teacher/student denied, admin+service allowed, cross-inst denied)', v_pass, v_detail);
exception when others then
  perform bulk_test_record(28, 'Security matrix (teacher/student denied, admin+service allowed, cross-inst denied)', false, SQLERRM);
end $$;

-- ── TEST 30 — Materialization integration ─────────────────────────────────
-- Migration 114 must NOT create live_classes; the existing materializer must
-- consume the imported slot + plans.
do $$
declare
  v_pass boolean := true; v_detail text := '';
  v_m date := bulk_env('monday')::date;
  v_slot uuid; v_count int; v_ch uuid; v_tp uuid; v_found int;
begin
  select ts.timetable_slot_id into v_slot
  from public.timetable_slots ts
  where ts.teacher_id = bulk_env('t1')::uuid and ts.batch_subject_id = bulk_env('bs1')::uuid
    and ts.day_of_week = 1 and ts.start_time = time '11:00:00' and ts.end_time = time '12:00:00'; -- t3 slot

  -- 114 must not have created any class for this slot
  select count(*) into v_count from public.live_classes where timetable_slot_id = v_slot;
  if v_count <> 0 then v_pass := false; v_detail := 'migration 114 created live_classes!'; end if;

  -- existing materializer consumes slot + plans
  if v_pass then
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claim.sub', '', true);
    select public.materialize_timetable_classes(v_slot, v_m - 56, v_m + 84) into v_count;
    if v_count < 3 then v_pass := false; v_detail := 'materializer created only ' || v_count || ' classes'; end if;
  end if;

  if v_pass then
    -- d_future1 -> CH_A2/TP_A2a (updated in test 5)
    select lc.chapter_id, lc.topic_id into v_ch, v_tp from public.live_classes lc
    where lc.timetable_slot_id = v_slot and (lc.scheduled_at at time zone 'Asia/Kolkata')::date = v_m + 7;
    get diagnostics v_found = row_count;
    if v_found <> 1 then v_pass := false; v_detail := 'no class row at d+7'; end if;
    if v_pass and (v_ch is distinct from bulk_env('ch_a2')::uuid or v_tp is distinct from bulk_env('tp_a2a')::uuid) then
      v_pass := false; v_detail := 'class at d+7 missing planned lesson';
    end if;
  end if;
  if v_pass then
    -- d_future2 -> CH_A1 chapter-only
    select lc.chapter_id, lc.topic_id into v_ch, v_tp from public.live_classes lc
    where lc.timetable_slot_id = v_slot and (lc.scheduled_at at time zone 'Asia/Kolkata')::date = v_m + 14;
    get diagnostics v_found = row_count;
    if v_found <> 1 then v_pass := false; v_detail := 'no class row at d+14'; end if;
    if v_pass and (v_ch is distinct from bulk_env('ch_a1')::uuid or v_tp is not null) then
      v_pass := false; v_detail := 'class at d+14 missing chapter-only lesson';
    end if;
  end if;
  if v_pass then
    -- d_future3 -> CH_A1/TP_A1b
    select lc.chapter_id, lc.topic_id into v_ch, v_tp from public.live_classes lc
    where lc.timetable_slot_id = v_slot and (lc.scheduled_at at time zone 'Asia/Kolkata')::date = v_m + 21;
    get diagnostics v_found = row_count;
    if v_found <> 1 then v_pass := false; v_detail := 'no class row at d+21'; end if;
    if v_pass and (v_ch is distinct from bulk_env('ch_a1')::uuid or v_tp is distinct from bulk_env('tp_a1b')::uuid) then
      v_pass := false; v_detail := 'class at d+21 missing planned lesson';
    end if;
  end if;
  perform bulk_test_record(30, 'Materialization consumes imported slot + plans (114 writes no classes)', v_pass, v_detail);
exception when others then
  perform bulk_test_record(30, 'Materialization consumes imported slot + plans (114 writes no classes)', false, SQLERRM);
end $$;

-- ── Final results (printed before the rollback) ───────────────────────────
\echo
\echo '=== BULK IMPORT RPC TEST RESULTS ==='
select test_no, name, result, detail from bulk_test_results order by test_no;

\echo
\echo '=== SUMMARY ==='
select
  count(*) filter (where result = 'PASS') as passed,
  count(*) filter (where result = 'FAIL') as failed,
  count(*) filter (where result not in ('PASS','FAIL')) as other
from bulk_test_results;

-- Everything above is discarded — nothing ever persists from this harness.
rollback;

\echo
\echo 'DONE — harness transaction rolled back; no test data persisted.'
