-- ════════════════════════════════════════════════════════════════════════════
-- DOUBT SYSTEM — LIVE DATABASE TEST HARNESS
-- Tests migration 117 RPCs + RLS:
--   submit_student_doubt · reply_to_doubt · accept_doubt_answer ·
--   resolve_doubt · reopen_doubt · assign_doubt · archive_doubt ·
--   attach_doubt_file · doubt_visible_to_me · doubt_notify ·
--   RLS on student_doubts / doubt_replies / doubt_attachments
--
-- HOW TO RUN (against a SAFE, DISPOSABLE Supabase-flavoured DB with migration
-- 117 applied — e.g. a local `supabase start` stack after `supabase db reset`):
--
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/doubt_system_tests.sql
--
-- REQUIREMENTS
--   * Connect as a postgres SUPERUSER (fixture inserts bypass RLS).
--   * Migration 117 must be applied (checked below).
--   * The Supabase `authenticated` role must exist and have the standard
--     Supabase default grants (USAGE on public + SELECT on public tables) so
--     the RLS read assertions are evaluated under a real role — superuser
--     would bypass RLS and the isolation tests would be meaningless.
--
-- SAFETY
--   The ENTIRE harness runs inside ONE transaction that is ROLLED BACK at the
--   end. Results are printed just before the rollback. No test data persists.
--   Auth paths are simulated via request.jwt.claim.* GUCs
--   (auth.uid()/auth.role()) exactly like the teacher-leave harness.
--   RLS reads temporarily `SET LOCAL ROLE authenticated` (transaction-local,
--   restored immediately); the auth GUC is set BEFORE the switch.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── 0. Preconditions ───────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.submit_student_doubt(uuid,uuid,uuid,uuid,text,text,public.resource_category_type,uuid)') is null then
    raise exception 'PRECONDITION FAILED: migration 117 not applied — submit_student_doubt does not exist.';
  end if;
  if to_regprocedure('public.reply_to_doubt(uuid,text,text)') is null
     or to_regprocedure('public.assign_doubt(uuid,uuid)') is null
     or to_regprocedure('public.attach_doubt_file(uuid,text,text,bigint,uuid)') is null then
    raise exception 'PRECONDITION FAILED: migration 117 RPCs missing.';
  end if;
  if to_regclass('public.doubt_attachments') is null then
    raise exception 'PRECONDITION FAILED: migration 117 table doubt_attachments missing.';
  end if;
  if to_regrole('authenticated') is null then
    raise exception 'PRECONDITION FAILED: role "authenticated" does not exist — RLS read assertions need it.';
  end if;
  if current_setting('is_superuser') <> 'on' then
    raise exception 'PRECONDITION FAILED: connect as a superuser (e.g. postgres) so RLS cannot block fixture inserts.';
  end if;
end $$;

begin;

-- ── 1. Results / env stores + helpers ──────────────────────────────────────
create temp table ds_test_results (
  test_no int primary key,
  name    text not null,
  result  text not null,
  detail  text not null default ''
);

create temp table ds_test_env (k text primary key, v text not null);

create or replace function ds_env(p_k text)
returns text language sql stable as $$
  select v from ds_test_env where k = p_k;
$$;

-- Simulate an authenticated caller with the given profile id + role.
-- The GUCs are transaction-local and PERSIST across `SET LOCAL ROLE`, so call
-- this BEFORE switching role for RLS reads.
create or replace function ds_set_auth(p_profile_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_profile_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end $$;

-- Safe-call wrapper for RPCs that return jsonb, capturing errors.
create or replace function ds_call(p_sql text)
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

create or replace function ds_record(p_test int, p_name text, p_pass boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into ds_test_results (test_no, name, result, detail)
  values (p_test, p_name, case when p_pass then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $$;

-- ── 2. Fixture creation (isolated institutes, rolled back at the end) ──────
do $$
declare
  v_inst    uuid;   -- institute A (main)
  v_xinst   uuid;   -- institute B (cross-institute)
  v_admin   uuid;   -- academic admin (institute A)
  v_stuA    uuid;   -- student A profile
  v_stuA_id uuid;   -- student A student_details id
  v_stuB    uuid;   -- student B profile (institute A, other student)
  v_stuB_id uuid;
  v_t1      uuid;   -- teacher 1 profile (institute A, physics specialization)
  v_t1_tid  uuid;   -- teacher 1 teacher_details id
  v_t2      uuid;   -- teacher 2 profile (institute A, NO physics spec)
  v_t2_tid  uuid;
  v_xt      uuid;   -- cross-institute teacher profile (institute B, physics spec)
  v_xt_tid  uuid;
  v_stream  uuid;
  v_subj    uuid;   -- Physics
  v_subj2   uuid;   -- Chemistry (teacher 2 specialization)
  v_ch      uuid;
  v_tp      uuid;
  v_batch   uuid;
  v_bs      uuid;
begin
  -- Institute A
  insert into public.institutes (name, slug, plan_tier)
  values ('DS Test Institute A', 'ds-test-a', 'starter')
  returning institute_id into v_inst;

  -- Academic admin (role='admin' + approved academic_admin grant)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DS Admin', 'ds.admin@test.invalid', '919000000101', 'admin', true)
  returning profile_id into v_admin;
  insert into public.admin_roles (profile_id, institute_id, admin_role, access_status, granted_by)
  values (v_admin, v_inst, 'academic_admin', 'approved', v_admin);

  -- Student A + student_details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DS Student A', 'ds.studentA@test.invalid', '919000000102', 'student', true)
  returning profile_id into v_stuA;
  insert into public.student_details (profile_id, institute_id)
  values (v_stuA, v_inst) returning student_id into v_stuA_id;

  -- Student B (same institute, different student — for ownership isolation)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DS Student B', 'ds.studentB@test.invalid', '919000000103', 'student', true)
  returning profile_id into v_stuB;
  insert into public.student_details (profile_id, institute_id)
  values (v_stuB, v_inst) returning student_id into v_stuB_id;

  -- Teacher 1 (Physics specialization) + teacher_details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DS Teacher One', 'ds.t1@test.invalid', '919000000104', 'teacher', true)
  returning profile_id into v_t1;
  insert into public.teacher_details (profile_id)
  values (v_t1) returning teacher_id into v_t1_tid;

  -- Teacher 2 (Chemistry only — ineligible for Physics doubts) + teacher_details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DS Teacher Two', 'ds.t2@test.invalid', '919000000105', 'teacher', true)
  returning profile_id into v_t2;
  insert into public.teacher_details (profile_id)
  values (v_t2) returning teacher_id into v_t2_tid;

  -- Institute B + cross-institute teacher (Physics specialization BUT other institute)
  insert into public.institutes (name, slug, plan_tier)
  values ('DS Test Institute B', 'ds-test-b', 'starter')
  returning institute_id into v_xinst;
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_xinst, 'DS X Teacher', 'ds.xt@test.invalid', '919000000106', 'teacher', true)
  returning profile_id into v_xt;
  insert into public.teacher_details (profile_id)
  values (v_xt) returning teacher_id into v_xt_tid;

  -- Academic structure (institute A)
  insert into public.streams (institute_id, name, code)
  values (v_inst, 'DS Stream', 'DSS') returning stream_id into v_stream;
  insert into public.subjects (stream_id, name, code)
  values (v_stream, 'Physics', 'PHY') returning subject_id into v_subj;
  insert into public.subjects (stream_id, name, code)
  values (v_stream, 'Chemistry', 'CHE') returning subject_id into v_subj2;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'DS Batch A', 'DS-A', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_batch;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_batch, v_subj, v_inst) returning batch_subject_id into v_bs;

  -- Enroll student A in the batch (required by submit_student_doubt for
  -- batch_subject-scoped doubts); student B is intentionally NOT enrolled.
  insert into public.batch_students (batch_id, student_id, status)
  values (v_batch, v_stuA_id, 'active');

  -- Teacher assignments: t1 teaches Physics batch_subject (routing path);
  -- t1 and t2 and xt have subject specializations (fallback path).
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id, role_in_batch)
  values (v_bs, v_t1_tid, v_inst, 'doubt_solver');
  insert into public.teacher_specializations (teacher_id, subject_id)
  values (v_t1_tid, v_subj);
  insert into public.teacher_specializations (teacher_id, subject_id)
  values (v_t2_tid, v_subj2);
  insert into public.teacher_specializations (teacher_id, subject_id)
  values (v_xt_tid, v_subj); -- physics spec, but institute B

  insert into public.chapters (subject_id, name)
  values (v_subj, 'Kinematics') returning chapter_id into v_ch;
  insert into public.topics (chapter_id, name)
  values (v_ch, 'Laws of Motion') returning topic_id into v_tp;

  insert into ds_test_env values
    ('inst',    v_inst::text),
    ('xinst',   v_xinst::text),
    ('admin',   v_admin::text),
    ('stuA',    v_stuA::text),
    ('stuA_id', v_stuA_id::text),
    ('stuB',    v_stuB::text),
    ('stuB_id', v_stuB_id::text),
    ('t1',      v_t1::text),
    ('t1_tid',  v_t1_tid::text),
    ('t2',      v_t2::text),
    ('t2_tid',  v_t2_tid::text),
    ('xt',      v_xt::text),
    ('xt_tid',  v_xt_tid::text),
    ('subj',    v_subj::text),
    ('ch',      v_ch::text),
    ('tp',      v_tp::text),
    ('batch',   v_batch::text),
    ('bs',      v_bs::text);
end $$;

-- ── 3. RLS-read helper pattern ─────────────────────────────────────────────
-- For each RLS read we: (1) set the auth GUC as superuser via ds_set_auth,
-- (2) capture the target id into a psql variable (temp table is invisible to
-- the authenticated role), (3) SET LOCAL ROLE authenticated, run the query,
-- (4) RESET ROLE, (5) record the result.

-- ════════════════════════════════════════════════════════════════════════════
-- TESTS
-- ════════════════════════════════════════════════════════════════════════════

-- TEST 1 — student creates a doubt (general subject doubt)
do $$
declare
  v_res jsonb;
  v_doubt uuid;
begin
  perform ds_set_auth(ds_env('stuA')::uuid);
  v_res := public.submit_student_doubt(
    ds_env('subj')::uuid, null, null, null,
    'Friction in rolling motion?', 'Why is work done by friction zero in pure rolling?'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  perform ds_record(1, 'student creates doubt',
    (v_res->>'success')::boolean = true and v_doubt is not null
      and (select status from public.student_doubts where doubt_id = v_doubt) = 'open',
    'result=' || v_res::text);
  insert into ds_test_env values ('doubt1', v_doubt::text);
end $$;

-- TEST 2 — student can read own doubt (RLS, auth = stuA)
do $$ begin perform ds_set_auth(ds_env('stuA')::uuid); end $$;
select v as doubt1 from ds_test_env where k = 'doubt1' \gset
set local role authenticated;
select count(*)::int as rls_n from public.student_doubts where doubt_id = :'doubt1';
\gset
reset role;
do $$
begin
  perform ds_record(2, 'student can read own doubt',
    :rls_n = 1, 'count=' || :'rls_n');
end $$;

-- TEST 3 — student cannot read another student's doubt (RLS, auth = stuA)
do $$
declare
  v_res jsonb;
  v_doubt uuid;
begin
  perform ds_set_auth(ds_env('stuB')::uuid);
  v_res := public.submit_student_doubt(
    ds_env('subj')::uuid, null, null, null,
    'Second student doubt', 'A doubt belonging to student B only.'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  insert into ds_test_env values ('doubtB', v_doubt::text);
end $$;

do $$ begin perform ds_set_auth(ds_env('stuA')::uuid); end $$;
select v as doubtB from ds_test_env where k = 'doubtB' \gset
set local role authenticated;
select count(*)::int as rls_n from public.student_doubts where doubt_id = :'doubtB';
\gset
reset role;
do $$
begin
  perform ds_record(3, 'student cannot read another student doubt',
    :rls_n = 0, 'count=' || :'rls_n');
end $$;

-- TEST 4 — authorized teacher (specialization) can read the doubt (RLS, auth = t1)
do $$ begin perform ds_set_auth(ds_env('t1')::uuid); end $$;
select v as doubt1 from ds_test_env where k = 'doubt1' \gset
set local role authenticated;
select count(*)::int as rls_n from public.student_doubts where doubt_id = :'doubt1';
\gset
reset role;
do $$
begin
  perform ds_record(4, 'authorized teacher can read doubt',
    :rls_n = 1, 'count=' || :'rls_n');
end $$;

-- TEST 5 — unauthorized teacher (wrong specialization) cannot read (RLS, auth = t2)
do $$ begin perform ds_set_auth(ds_env('t2')::uuid); end $$;
select v as doubt1 from ds_test_env where k = 'doubt1' \gset
set local role authenticated;
select count(*)::int as rls_n from public.student_doubts where doubt_id = :'doubt1';
\gset
reset role;
do $$
begin
  perform ds_record(5, 'unauthorized teacher cannot read doubt',
    :rls_n = 0, 'count=' || :'rls_n');
end $$;

-- TEST 6 — cross-institute teacher cannot read (RLS + RPC)
do $$ begin perform ds_set_auth(ds_env('xt')::uuid); end $$;
select v as doubt1 from ds_test_env where k = 'doubt1' \gset
set local role authenticated;
select count(*)::int as rls_n from public.student_doubts where doubt_id = :'doubt1';
\gset
reset role;
do $$
declare
  v_res jsonb;
begin
  perform ds_set_auth(ds_env('xt')::uuid);
  v_res := ds_call(format('select public.reply_to_doubt(%L, %L)',
    ds_env('doubt1')::uuid, 'cross-institute attempt'));
  perform ds_record(6, 'cross-institute access fails',
    :rls_n = 0 and (v_res->>'ok')::boolean = false,
    'rls=' || :'rls_n' || ' rpc=' || v_res::text);
end $$;

-- TEST 7 — authorized teacher replies (answer)
do $$
declare
  v_res jsonb;
  v_reply uuid;
begin
  perform ds_set_auth(ds_env('t1')::uuid);
  v_res := public.reply_to_doubt(ds_env('doubt1')::uuid, 'Friction does no work here because the point of contact is instantaneously at rest.');
  v_reply := (v_res->>'reply_id')::uuid;
  perform ds_record(7, 'teacher replies',
    (v_res->>'success')::boolean = true and v_reply is not null
      and exists (select 1 from public.doubt_replies where reply_id = v_reply),
    'result=' || v_res::text);
  insert into ds_test_env values ('reply1', v_reply::text);
end $$;

-- TEST 8 — first_response_at is set by the trigger
do $$
declare
  v_fr timestamptz;
begin
  select first_response_at into v_fr from public.student_doubts where doubt_id = ds_env('doubt1')::uuid;
  perform ds_record(8, 'first_response_at set on teacher reply',
    v_fr is not null, 'first_response_at=' || coalesce(v_fr::text, 'NULL'));
end $$;

-- TEST 9 — student can see the teacher reply (RLS, auth = stuA)
do $$ begin perform ds_set_auth(ds_env('stuA')::uuid); end $$;
select v as doubt1 from ds_test_env where k = 'doubt1' \gset
set local role authenticated;
select count(*)::int as rls_n from public.doubt_replies where doubt_id = :'doubt1';
\gset
reset role;
do $$
begin
  perform ds_record(9, 'student can see teacher reply',
    :rls_n >= 1, 'count=' || :'rls_n');
end $$;

-- TEST 10 — admin assigns the teacher, student follow-up works
do $$
declare
  v_assign jsonb;
  v_res    jsonb;
  v_reply  uuid;
begin
  perform ds_set_auth(ds_env('admin')::uuid);
  v_assign := public.assign_doubt(ds_env('doubt1')::uuid, ds_env('t1_tid')::uuid);

  perform ds_set_auth(ds_env('stuA')::uuid);
  v_res := public.reply_to_doubt(
    ds_env('doubt1')::uuid,
    'Understood — so the contact point has zero instantaneous velocity.'
  );
  v_reply := (v_res->>'reply_id')::uuid;
  perform ds_record(10, 'student follow-up works after assignment',
    (v_assign->>'success')::boolean = true
      and (v_res->>'success')::boolean = true and v_reply is not null,
    'assign=' || v_assign::text || ' reply=' || v_res::text);
  insert into ds_test_env values ('reply2', v_reply::text);
end $$;

-- TEST 11 — teacher receives the follow-up notification
do $$
declare
  v_n int;
begin
  select count(*) into v_n
  from public.notification_recipients nr
  join public.notifications n on n.notification_id = nr.notification_id
  where n.event_type = 'doubt_follow_up'
    and nr.profile_id = ds_env('t1')::uuid;
  perform ds_record(11, 'teacher receives follow-up notification',
    v_n >= 1, 'notifs=' || v_n);
end $$;

-- TEST 12 — resolution via accepted answer (auto-resolve trigger)
do $$
declare
  v_res jsonb;
  v_status text;
begin
  perform ds_set_auth(ds_env('stuA')::uuid);
  v_res := public.accept_doubt_answer(ds_env('doubt1')::uuid, ds_env('reply1')::uuid);
  select status into v_status from public.student_doubts where doubt_id = ds_env('doubt1')::uuid;
  perform ds_record(12, 'resolution via accepted answer',
    (v_res->>'success')::boolean = true and v_status = 'resolved',
    'result=' || v_res::text || ' status=' || coalesce(v_status, 'NULL'));
end $$;

-- TEST 13 — resolved_at is stamped
do $$
declare
  v_ra timestamptz;
  v_rb uuid;
begin
  select resolved_at, resolved_by into v_ra, v_rb
  from public.student_doubts where doubt_id = ds_env('doubt1')::uuid;
  perform ds_record(13, 'resolved_at + resolved_by stamped',
    v_ra is not null and v_rb = ds_env('t1')::uuid,
    'resolved_at=' || coalesce(v_ra::text, 'NULL') || ' resolved_by=' || coalesce(v_rb::text, 'NULL'));
end $$;

-- TEST 14 — student reopens a resolved doubt
do $$
declare
  v_res jsonb;
  v_status text;
  v_count smallint;
begin
  perform ds_set_auth(ds_env('stuA')::uuid);
  v_res := public.reopen_doubt(ds_env('doubt1')::uuid);
  select status, reopened_count into v_status, v_count
  from public.student_doubts where doubt_id = ds_env('doubt1')::uuid;
  perform ds_record(14, 'reopen works (student)',
    (v_res->>'success')::boolean = true and v_status = 'open' and v_count = 1,
    'result=' || v_res::text || ' status=' || coalesce(v_status, 'NULL') || ' count=' || v_count);
end $$;

-- TEST 15 — reopen count increments on a second reopen cycle
do $$
declare
  v_res jsonb;
  v_count smallint;
begin
  perform ds_set_auth(ds_env('stuA')::uuid);
  -- resolve again directly, then reopen again
  perform public.resolve_doubt(ds_env('doubt1')::uuid);
  v_res := public.reopen_doubt(ds_env('doubt1')::uuid);
  select reopened_count into v_count from public.student_doubts where doubt_id = ds_env('doubt1')::uuid;
  perform ds_record(15, 'reopen count increments',
    (v_res->>'success')::boolean = true and v_count = 2,
    'result=' || v_res::text || ' count=' || v_count);
end $$;

-- TEST 16 — invalid status transition fails (reopen a non-resolved doubt)
do $$
declare
  v_res jsonb;
begin
  perform ds_set_auth(ds_env('stuA')::uuid);
  v_res := ds_call(format('select public.reopen_doubt(%L)',
    ds_env('doubt1')::uuid)); -- currently open (test 15 ended with reopen)
  perform ds_record(16, 'invalid transition (reopen non-resolved) fails',
    (v_res->>'ok')::boolean = false
      and v_res->>'err' like '%Only resolved doubts%',
    'result=' || v_res::text);
end $$;

-- TEST 17 — admin assignment works (assign + reassign)
do $$
declare
  v_res jsonb;
  v_assigned uuid;
begin
  perform ds_set_auth(ds_env('admin')::uuid);
  v_res := public.assign_doubt(ds_env('doubt1')::uuid, ds_env('t1_tid')::uuid);
  select assigned_to into v_assigned from public.student_doubts where doubt_id = ds_env('doubt1')::uuid;
  perform ds_record(17, 'admin assignment works',
    (v_res->>'success')::boolean = true
      and (v_res->>'reassigned')::boolean = true
      and v_assigned = ds_env('t1_tid')::uuid,
    'result=' || v_res::text);
end $$;

-- TEST 18 — unauthorized assignment fails (teacher tries to assign)
do $$
declare
  v_res jsonb;
begin
  perform ds_set_auth(ds_env('t1')::uuid);
  v_res := ds_call(format('select public.assign_doubt(%L, %L)',
    ds_env('doubt1')::uuid, ds_env('t2_tid')::uuid));
  perform ds_record(18, 'unauthorized assignment fails',
    (v_res->>'ok')::boolean = false,
    'result=' || v_res::text);
end $$;

-- TEST 19 — attachment authorization works (owner + authorized teacher)
do $$
declare
  v_stu jsonb;
  v_tch jsonb;
begin
  perform ds_set_auth(ds_env('stuA')::uuid);
  v_stu := public.attach_doubt_file(
    ds_env('doubt1')::uuid, 'ds-test-a/doubt1/question.jpg', 'image/jpeg', 20480
  );
  perform ds_set_auth(ds_env('t1')::uuid);
  v_tch := public.attach_doubt_file(
    ds_env('doubt1')::uuid, 'ds-test-a/doubt1/solution.pdf', 'application/pdf', 1048576
  );
  perform ds_record(19, 'attachment authorization works (owner + teacher)',
    (v_stu->>'success')::boolean = true and (v_tch->>'success')::boolean = true
      and (select count(*) from public.doubt_attachments where doubt_id = ds_env('doubt1')::uuid) = 2,
    'student=' || v_stu::text || ' teacher=' || v_tch::text);
end $$;

-- TEST 20 — cross-institute attachment access fails (RPC + RLS)
do $$ begin perform ds_set_auth(ds_env('xt')::uuid); end $$;
select v as doubt1 from ds_test_env where k = 'doubt1' \gset
set local role authenticated;
select count(*)::int as rls_n from public.doubt_attachments where doubt_id = :'doubt1';
\gset
reset role;
do $$
declare
  v_res jsonb;
begin
  perform ds_set_auth(ds_env('xt')::uuid);
  v_res := ds_call(format(
    'select public.attach_doubt_file(%L, %L, %L, %L)',
    ds_env('doubt1')::uuid, 'ds-test-b/doubt1/steal.jpg', 'image/jpeg', 1024));
  perform ds_record(20, 'cross-institute attachment access fails',
    :rls_n = 0 and (v_res->>'ok')::boolean = false,
    'rls=' || :'rls_n' || ' rpc=' || v_res::text);
end $$;

-- TEST 21 — notifications created correctly (all expected events)
do $$
declare
  v_submitted int;
  v_answered  int;
  v_assigned  int;
  v_followup  int;
  v_resolved  int;
  v_reopened  int;
begin
  select count(*) into v_submitted from public.notifications where event_type = 'doubt_submitted';
  select count(*) into v_answered  from public.notifications where event_type = 'doubt_answered';
  select count(*) into v_assigned  from public.notifications where event_type = 'doubt_assigned';
  select count(*) into v_followup  from public.notifications where event_type = 'doubt_follow_up';
  select count(*) into v_resolved  from public.notifications where event_type = 'doubt_resolved';
  select count(*) into v_reopened  from public.notifications where event_type = 'doubt_reopened';
  perform ds_record(21, 'notifications created for all events',
    v_submitted >= 1 and v_answered >= 1 and v_assigned >= 1
      and v_followup >= 1 and v_resolved >= 1 and v_reopened >= 1,
    'submitted=' || v_submitted || ' answered=' || v_answered || ' assigned=' || v_assigned
      || ' followup=' || v_followup || ' resolved=' || v_resolved || ' reopened=' || v_reopened);
end $$;

-- TEST 22 — audit events created for doubt lifecycle
do $$
declare
  v_aud int;
begin
  select count(*) into v_aud from public.audit_logs
  where resource_type = 'student_doubt';
  perform ds_record(22, 'audit events created',
    v_aud >= 1, 'audit_rows=' || v_aud);
end $$;

-- TEST 23 — concurrent/duplicate actions handled safely
--   (a) duplicate storage_path on the same doubt → unique violation
--   (b) accepting a second TEACHER answer clears the previous accepted answer
--   (c) a student cannot accept their OWN follow-up as the solution
do $$
declare
  v_err      text;
  v_accepted int;
  v_res      jsonb;
  v_reply3   uuid;
begin
  -- (a) duplicate attachment path
  begin
    perform ds_set_auth(ds_env('stuA')::uuid);
    perform public.attach_doubt_file(
      ds_env('doubt1')::uuid, 'ds-test-a/doubt1/question.jpg', 'image/jpeg', 8192
    );
    v_err := 'no error';
  exception when unique_violation then
    v_err := 'unique_violation';
  when others then
    v_err := SQLERRM;
  end;

  -- (b) teacher posts a second answer, student accepts it → exactly one
  --     accepted answer remains (the previous one, reply1, is cleared)
  perform ds_set_auth(ds_env('t1')::uuid);
  v_res := public.reply_to_doubt(
    ds_env('doubt1')::uuid,
    'Further clarity: the point of contact has zero displacement relative to the ground in pure rolling.'
  );
  v_reply3 := (v_res->>'reply_id')::uuid;

  perform ds_set_auth(ds_env('stuA')::uuid);
  perform public.accept_doubt_answer(ds_env('doubt1')::uuid, v_reply3);
  select count(*) into v_accepted from public.doubt_replies
  where doubt_id = ds_env('doubt1')::uuid and is_accepted_answer = true;

  -- (c) student cannot accept their OWN follow-up (reply2 is student-authored)
  perform ds_set_auth(ds_env('stuA')::uuid);
  v_res := ds_call(format('select public.accept_doubt_answer(%L, %L)',
    ds_env('doubt1')::uuid, ds_env('reply2')::uuid));

  perform ds_record(23, 'duplicate/self-accept actions handled safely',
    v_err = 'unique_violation' and v_accepted = 1
      and (v_res->>'ok')::boolean = false,
    'dup_path_err=' || v_err || ' accepted=' || v_accepted
      || ' self_accept=' || v_res::text);
end $$;

-- TEST 24 — failed transaction rolls back completely
do $$
declare
  v_before int;
  v_after  int;
  v_res    jsonb;
begin
  -- Invalid submission (title too short) must raise and insert nothing.
  select count(*) into v_before from public.student_doubts
  where student_id = ds_env('stuA_id')::uuid;
  perform ds_set_auth(ds_env('stuA')::uuid);
  v_res := ds_call(format(
    'select public.submit_student_doubt(%L, %L, %L, %L, %L, %L, %L, %L)',
    ds_env('subj')::uuid, null, null, null, 'x', 'too short title', null, null));
  select count(*) into v_after from public.student_doubts
  where student_id = ds_env('stuA_id')::uuid;

  perform ds_record(24, 'failed transaction rolls back',
    (v_res->>'ok')::boolean = false and v_after = v_before,
    'before=' || v_before || ' after=' || v_after || ' result=' || v_res::text);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- RESULTS
-- ════════════════════════════════════════════════════════════════════════════

\echo
\echo '=== DOUBT SYSTEM — TEST RESULTS ==='
select test_no, name, result, detail from ds_test_results order by test_no;

\echo
\echo 'NOTE: harness ran inside ONE transaction — rolling back now, no test data persists.'
rollback;
