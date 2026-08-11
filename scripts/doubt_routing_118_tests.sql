-- ════════════════════════════════════════════════════════════════════════════
-- DOUBT ROUTING + ACADEMIC SCOPE — LIVE DATABASE TEST HARNESS (migration 118)
-- Tests migration 118 behavior on top of migration 117:
--   submit_student_doubt academic-scope resolution + teacher routing:
--     · subject-only auto-resolve (single match) / ambiguous reject
--     · batch_subject strict validation (active, institute, subject match,
--       student active-batch membership)
--     · 1 teacher → auto-assign assigned_to + doubt_assigned notification
--     · >1 teachers → assigned_to NULL + doubt_submitted fan-out
--     · 0 teachers → assigned_to NULL + doubt_unassigned → Academic/Super
--       Admin notification
--     · chapter/topic consistency (unchanged from 117)
--     · student SELECT-only RLS (cannot UPDATE assigned_to)
--     · legacy doubts unchanged · assign_doubt intact · attachment RLS intact
--
-- HOW TO RUN (against a SAFE, DISPOSABLE Supabase-flavoured DB with
-- migrations 117 + 118 applied — e.g. a local `supabase start` stack after
-- `supabase db reset`):
--
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/doubt_routing_118_tests.sql
--
-- REQUIREMENTS
--   * Connect as a postgres SUPERUSER (fixture inserts bypass RLS).
--   * Migrations 117 AND 118 must be applied (checked below).
--   * The Supabase `authenticated` role must exist and have the standard
--     Supabase default grants (USAGE on public + SELECT on public tables) so
--     the RLS read assertions are evaluated under a real role — superuser
--     would bypass RLS and the isolation tests would be meaningless.
--   * TEST 15 additionally tries an UPDATE under the `authenticated` role. If
--     `authenticated` has the UPDATE base grant, RLS row-level denial is
--     exercised (0 rows changed). If it lacks the grant, the UPDATE errors —
--     which is also treated as a PASS (blocked). ON_ERROR_STOP is toggled off
--     around that statement so neither outcome aborts the harness.
--
-- SAFETY
--   The ENTIRE harness runs inside ONE transaction that is ROLLED BACK at the
--   end. Results are printed just before the rollback. No test data persists.
--   Auth paths are simulated via request.jwt.claim.* GUCs
--   (auth.uid()/auth.role()) exactly like the teacher-leave / doubt harnesses.
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
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_event_type'
      and e.enumlabel = 'doubt_unassigned'
  ) then
    raise exception 'PRECONDITION FAILED: migration 118 not applied — doubt_unassigned event missing.';
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
create temp table dr_test_results (
  test_no int primary key,
  name    text not null,
  result  text not null,
  detail  text not null default ''
);

create temp table dr_test_env (k text primary key, v text not null);

create or replace function dr_env(p_k text)
returns text language sql stable as $$
  select v from dr_test_env where k = p_k;
$$;

-- Simulate an authenticated caller with the given profile id + role.
-- The GUCs are transaction-local and PERSIST across `SET LOCAL ROLE`, so call
-- this BEFORE switching role for RLS reads.
create or replace function dr_set_auth(p_profile_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_profile_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end $$;

-- Safe-call wrapper for RPCs that return jsonb, capturing errors.
create or replace function dr_call(p_sql text)
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

create or replace function dr_record(p_test int, p_name text, p_pass boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into dr_test_results (test_no, name, result, detail)
  values (p_test, p_name, case when p_pass then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $$;

-- ── 2. Fixture creation (isolated institutes, rolled back at the end) ──────
do $$
declare
  v_inst     uuid;  -- institute A (main)
  v_xinst    uuid;  -- institute B (cross-institute)
  v_admin    uuid;  -- academic admin (institute A)
  v_super    uuid;  -- super admin (institute A)
  v_stuA     uuid;  -- student A profile
  v_stuA_id  uuid;  -- student A student_details id
  v_stuB     uuid;  -- student B profile (institute A, other student)
  v_stuB_id  uuid;
  v_t1       uuid;  -- teacher 1 profile (physics, batch-subject assigned)
  v_t1_tid   uuid;
  v_t2       uuid;  -- teacher 2 profile (chemistry, batch-subject assigned)
  v_t2_tid   uuid;
  v_stream   uuid;
  v_phy      uuid;  -- Physics
  v_chem     uuid;  -- Chemistry
  v_bio      uuid;  -- Biology (exists, but in NO batch → unrelated subject)
  v_ch1      uuid;  -- Physics chapter 1
  v_ch2      uuid;  -- Physics chapter 2 (for topic-mismatch test)
  v_ch3      uuid;  -- Chemistry chapter (for invalid-chapter test)
  v_tp1      uuid;  -- topic of chapter 1
  v_tp2      uuid;  -- topic of chapter 2
  v_bA       uuid;  -- Batch A (student A enrolled; physics T1, chemistry T1+T2)
  v_bsA_phy  uuid;  -- Batch A physics
  v_bsA_chem uuid;  -- Batch A chemistry
  v_bB       uuid;  -- Batch B (student A enrolled; physics, NO teachers)
  v_bsB_phy  uuid;  -- Batch B physics
  v_bC       uuid;  -- Batch C (student A NOT enrolled)
  v_bsC_phy  uuid;  -- Batch C physics
  v_xstream  uuid;
  v_xphy     uuid;
  v_xbatch   uuid;
  v_xbs_phy  uuid;  -- cross-institute batch_subject (Physics in institute B)
begin
  -- Institute A
  insert into public.institutes (name, slug, plan_tier)
  values ('DR Test Institute A', 'dr-test-a', 'starter')
  returning institute_id into v_inst;

  -- Academic admin (role='admin' + approved academic_admin grant)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DR Academic Admin', 'dr.admin@test.invalid', '919000000201', 'admin', true)
  returning profile_id into v_admin;
  insert into public.admin_roles (profile_id, institute_id, admin_role, access_status, granted_by)
  values (v_admin, v_inst, 'academic_admin', 'approved', v_admin);

  -- Super admin (role='admin' + approved super_admin grant)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DR Super Admin', 'dr.super@test.invalid', '919000000202', 'admin', true)
  returning profile_id into v_super;
  insert into public.admin_roles (profile_id, institute_id, admin_role, access_status, granted_by)
  values (v_super, v_inst, 'super_admin', 'approved', v_super);

  -- Student A + student_details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DR Student A', 'dr.studentA@test.invalid', '919000000203', 'student', true)
  returning profile_id into v_stuA;
  insert into public.student_details (profile_id, institute_id)
  values (v_stuA, v_inst) returning student_id into v_stuA_id;

  -- Student B (same institute, different student — for ownership isolation)
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DR Student B', 'dr.studentB@test.invalid', '919000000204', 'student', true)
  returning profile_id into v_stuB;
  insert into public.student_details (profile_id, institute_id)
  values (v_stuB, v_inst) returning student_id into v_stuB_id;

  -- Teacher 1 (physics) + teacher_details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DR Teacher One', 'dr.t1@test.invalid', '919000000205', 'teacher', true)
  returning profile_id into v_t1;
  insert into public.teacher_details (profile_id)
  values (v_t1) returning teacher_id into v_t1_tid;

  -- Teacher 2 (chemistry) + teacher_details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_inst, 'DR Teacher Two', 'dr.t2@test.invalid', '919000000206', 'teacher', true)
  returning profile_id into v_t2;
  insert into public.teacher_details (profile_id)
  values (v_t2) returning teacher_id into v_t2_tid;

  -- Institute B (cross-institute) + physics there
  insert into public.institutes (name, slug, plan_tier)
  values ('DR Test Institute B', 'dr-test-b', 'starter')
  returning institute_id into v_xinst;
  insert into public.streams (institute_id, name, code)
  values (v_xinst, 'DR X Stream', 'DRX') returning stream_id into v_xstream;
  insert into public.subjects (stream_id, name, code)
  values (v_xstream, 'Physics', 'XPHY') returning subject_id into v_xphy;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_xinst, v_xstream, 'DR X Batch', 'DRX-B', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_xbatch;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_xbatch, v_xphy, v_xinst) returning batch_subject_id into v_xbs_phy;

  -- Academic structure (institute A)
  insert into public.streams (institute_id, name, code)
  values (v_inst, 'DR Stream', 'DRS') returning stream_id into v_stream;
  insert into public.subjects (stream_id, name, code)
  values (v_stream, 'Physics', 'PHY') returning subject_id into v_phy;
  insert into public.subjects (stream_id, name, code)
  values (v_stream, 'Chemistry', 'CHE') returning subject_id into v_chem;
  insert into public.subjects (stream_id, name, code)
  values (v_stream, 'Biology', 'BIO') returning subject_id into v_bio;

  -- Batch A (physics T1; chemistry T1+T2 — the multiple-teacher case)
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'DR Batch A', 'DR-A', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_bA;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_bA, v_phy, v_inst) returning batch_subject_id into v_bsA_phy;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_bA, v_chem, v_inst) returning batch_subject_id into v_bsA_chem;

  -- Batch B (physics, NO teachers — the zero-teacher case)
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'DR Batch B', 'DR-B', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_bB;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_bB, v_phy, v_inst) returning batch_subject_id into v_bsB_phy;

  -- Batch C (physics, student A NOT enrolled — the other-batch case)
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'DR Batch C', 'DR-C', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_bC;
  insert into public.batch_subjects (batch_id, subject_id, institute_id)
  values (v_bC, v_phy, v_inst) returning batch_subject_id into v_bsC_phy;

  -- Enrollments: student A → Batch A (active). Batch B is added during
  -- TEST 5 (ambiguity). Student B → Batch A (active).
  insert into public.batch_students (batch_id, student_id, status)
  values (v_bA, v_stuA_id, 'active');
  insert into public.batch_students (batch_id, student_id, status)
  values (v_bA, v_stuB_id, 'active');

  -- Teacher assignments:
  --   Batch A physics   → t1 only   (single-teacher auto-assign)
  --   Batch A chemistry → t1 + t2   (multiple-teacher → NULL)
  --   Batch B physics   → none      (zero-teacher → admin fallback)
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id, role_in_batch)
  values (v_bsA_phy, v_t1_tid, v_inst, 'doubt_solver');
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id, role_in_batch)
  values (v_bsA_chem, v_t1_tid, v_inst, 'doubt_solver');
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id, role_in_batch)
  values (v_bsA_chem, v_t2_tid, v_inst, 'doubt_solver');

  -- Chapters / topics (physics: 2 chapters; chemistry: 1 chapter)
  insert into public.chapters (subject_id, name)
  values (v_phy, 'Kinematics') returning chapter_id into v_ch1;
  insert into public.chapters (subject_id, name)
  values (v_phy, 'Laws of Motion') returning chapter_id into v_ch2;
  insert into public.chapters (subject_id, name)
  values (v_chem, 'Chemical Bonding') returning chapter_id into v_ch3;
  insert into public.topics (chapter_id, name)
  values (v_ch1, 'Equations of Motion') returning topic_id into v_tp1;
  insert into public.topics (chapter_id, name)
  values (v_ch2, 'Newton''s Laws') returning topic_id into v_tp2;

  -- t1 specializes Physics (needed for assign_doubt eligibility in TEST 17:
  -- assign_doubt validates teacher eligibility via batch_subject_teachers OR
  -- teacher_specializations on the doubt's subject).
  insert into public.teacher_specializations (teacher_id, subject_id)
  values (v_t1_tid, v_phy);

  insert into dr_test_env values
    ('inst',      v_inst::text),
    ('xinst',     v_xinst::text),
    ('admin',     v_admin::text),
    ('super',     v_super::text),
    ('stuA',      v_stuA::text),
    ('stuA_id',   v_stuA_id::text),
    ('stuB',      v_stuB::text),
    ('stuB_id',   v_stuB_id::text),
    ('t1',        v_t1::text),
    ('t1_tid',    v_t1_tid::text),
    ('t2',        v_t2::text),
    ('t2_tid',    v_t2_tid::text),
    ('phy',       v_phy::text),
    ('chem',      v_chem::text),
    ('bio',       v_bio::text),
    ('ch1',       v_ch1::text),
    ('ch2',       v_ch2::text),
    ('ch3',       v_ch3::text),
    ('tp1',       v_tp1::text),
    ('tp2',       v_tp2::text),
    ('bA',        v_bA::text),
    ('bsA_phy',   v_bsA_phy::text),
    ('bsA_chem',  v_bsA_chem::text),
    ('bB',        v_bB::text),
    ('bsB_phy',   v_bsB_phy::text),
    ('bsC_phy',   v_bsC_phy::text),
    ('xbs_phy',   v_xbs_phy::text);
end $$;

-- ── 3. Legacy-doubt fixture (migration-117 style: batch_subject NULL) ──────
-- Inserted directly as superuser to simulate a pre-118 doubt. Must remain
-- completely untouched by everything that follows (TEST 16).
do $$
declare
  v_legacy uuid;
begin
  insert into public.student_doubts (
    student_id, subject_id, title, description, status
  )
  values (
    dr_env('stuA_id')::uuid, dr_env('phy')::uuid,
    'Legacy doubt (pre-118)', 'Created before migration 118; must stay untouched.',
    'open'::public.doubt_status_type
  )
  returning doubt_id into v_legacy;
  insert into dr_test_env values ('legacy_doubt', v_legacy::text);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- TESTS
-- ════════════════════════════════════════════════════════════════════════════

-- TEST 1 — student with one active batch + one subject submits a valid doubt
do $$
declare
  v_res   jsonb;
  v_doubt uuid;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := public.submit_student_doubt(
    dr_env('phy')::uuid, null, null, dr_env('bsA_phy')::uuid,
    'Rolling without slipping?', 'Why does friction do no work in pure rolling?'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  perform dr_record(1, 'valid doubt with matching batch_subject succeeds',
    (v_res->>'success')::boolean = true and v_doubt is not null
      and (select status from public.student_doubts where doubt_id = v_doubt) = 'open',
    'result=' || v_res::text);
  insert into dr_test_env values ('doubt1', v_doubt::text);
end $$;

-- TEST 2 — student submits an unrelated subject (no batch_subject anywhere)
do $$
declare
  v_res jsonb;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := dr_call(format(
    'select public.submit_student_doubt(%L, null, null, null, %L, %L)',
    dr_env('bio')::uuid, 'Biology doubt', 'Biology is not in any of my batches.'));
  perform dr_record(2, 'unrelated subject rejected',
    (v_res->>'ok')::boolean = false
      and position('not part of any of your active batches' in (v_res->>'err')) > 0,
    'result=' || v_res::text);
end $$;

-- TEST 3 — student submits a batch_subject of a batch they are NOT in
do $$
declare
  v_res jsonb;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := dr_call(format(
    'select public.submit_student_doubt(%L, null, null, %L, %L, %L)',
    dr_env('phy')::uuid, dr_env('bsC_phy')::uuid, 'Not my batch', 'This batch is not mine.'));
  perform dr_record(3, 'batch_subject of another batch rejected',
    (v_res->>'ok')::boolean = false
      and position('not enrolled' in (v_res->>'err')) > 0,
    'result=' || v_res::text);
end $$;

-- TEST 4 — matching subject + valid batch_subject succeeds (chemistry path)
do $$
declare
  v_res   jsonb;
  v_doubt uuid;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := public.submit_student_doubt(
    dr_env('chem')::uuid, null, null, dr_env('bsA_chem')::uuid,
    'Why is water a dipole?', 'Explain the polar nature of the water molecule.'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  perform dr_record(4, 'matching subject + valid batch_subject succeeds',
    (v_res->>'success')::boolean = true and v_doubt is not null
      and (select batch_subject_id from public.student_doubts where doubt_id = v_doubt)::text = dr_env('bsA_chem'),
    'result=' || v_res::text);
  insert into dr_test_env values ('doubt4', v_doubt::text);
end $$;

-- TEST 5 — subject-only submission when the subject is in TWO active batches
do $$
begin
  -- enroll student A into Batch B as well → Physics now matches 2 batches
  insert into public.batch_students (batch_id, student_id, status)
  values (dr_env('bB')::uuid, dr_env('stuA_id')::uuid, 'active');
end $$;

do $$
declare
  v_res jsonb;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := dr_call(format(
    'select public.submit_student_doubt(%L, null, null, null, %L, %L)',
    dr_env('phy')::uuid, 'Ambiguous physics', 'Physics is in two of my batches now.'));
  perform dr_record(5, 'ambiguous subject-only submission rejected',
    (v_res->>'ok')::boolean = false
      and position('multiple of your batches' in (v_res->>'err')) > 0,
    'result=' || v_res::text);
end $$;

-- TEST 6 — subject-only submission with exactly ONE matching batch_subject
do $$
declare
  v_res   jsonb;
  v_doubt uuid;
  v_bs    text;
begin
  -- Chemistry exists ONLY in Batch A for student A → unambiguous.
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := public.submit_student_doubt(
    dr_env('chem')::uuid, null, null, null,
    'Chemistry auto-resolved', 'Subject-only chemistry should resolve to Batch A chemistry.'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  select coalesce(batch_subject_id::text, 'NULL') into v_bs
  from public.student_doubts where doubt_id = v_doubt;
  perform dr_record(6, 'unambiguous subject-only submission auto-resolves',
    (v_res->>'success')::boolean = true and v_bs = dr_env('bsA_chem'),
    'result=' || v_res::text || ' batch_subject=' || v_bs);
  insert into dr_test_env values ('doubt6', v_doubt::text);
end $$;

-- TEST 7 — exactly ONE teacher on the batch_subject → auto-assign
do $$
declare
  v_res   jsonb;
  v_doubt uuid;
  v_assign text;
  v_notif int;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := public.submit_student_doubt(
    dr_env('phy')::uuid, null, null, dr_env('bsA_phy')::uuid,
    'Single-teacher routing', 'One teacher is assigned to this batch subject.'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  select coalesce(assigned_to::text, 'NULL') into v_assign
  from public.student_doubts where doubt_id = v_doubt;
  select count(*) into v_notif
  from public.notification_recipients nr
  join public.notifications n on n.notification_id = nr.notification_id
  where n.reference_id = v_doubt
    and n.event_type = 'doubt_assigned'::public.notification_event_type
    and nr.profile_id = dr_env('t1')::uuid;
  perform dr_record(7, 'single teacher auto-assigns assigned_to + notifies',
    v_assign = dr_env('t1_tid') and v_notif >= 1,
    'assigned_to=' || v_assign || ' t1_notif=' || v_notif);
  insert into dr_test_env values ('doubt7', v_doubt::text);
end $$;

-- TEST 8 — multiple teachers on the batch_subject → assigned_to stays NULL
do $$
declare
  v_res   jsonb;
  v_doubt uuid;
  v_assign text;
  v_notif int;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := public.submit_student_doubt(
    dr_env('chem')::uuid, null, null, dr_env('bsA_chem')::uuid,
    'Multi-teacher routing', 'Two teachers are assigned to this batch subject.'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  select coalesce(assigned_to::text, 'NULL') into v_assign
  from public.student_doubts where doubt_id = v_doubt;
  -- both teachers should have received the doubt_submitted fan-out
  select count(distinct nr.profile_id) into v_notif
  from public.notification_recipients nr
  join public.notifications n on n.notification_id = nr.notification_id
  where n.reference_id = v_doubt
    and n.event_type = 'doubt_submitted'::public.notification_event_type;
  perform dr_record(8, 'multiple teachers → assigned_to NULL + fan-out',
    v_assign = 'NULL' and v_notif = 2,
    'assigned_to=' || v_assign || ' notified_teachers=' || v_notif);
  insert into dr_test_env values ('doubt8', v_doubt::text);
end $$;

-- TEST 9 — zero teachers on the batch_subject → assigned_to NULL
do $$
declare
  v_res   jsonb;
  v_doubt uuid;
  v_assign text;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := public.submit_student_doubt(
    dr_env('phy')::uuid, null, null, dr_env('bsB_phy')::uuid,
    'Zero-teacher routing', 'No teacher is assigned to this batch subject.'
  );
  v_doubt := (v_res->>'doubt_id')::uuid;
  select coalesce(assigned_to::text, 'NULL') into v_assign
  from public.student_doubts where doubt_id = v_doubt;
  perform dr_record(9, 'zero teachers → assigned_to NULL',
    v_assign = 'NULL',
    'assigned_to=' || v_assign);
  insert into dr_test_env values ('doubt9', v_doubt::text);
end $$;

-- TEST 10 — zero teachers → Academic Admin receives doubt_unassigned
do $$
declare
  v_notif int;
begin
  select count(*) into v_notif
  from public.notification_recipients nr
  join public.notifications n on n.notification_id = nr.notification_id
  where n.reference_id = dr_env('doubt9')::uuid
    and n.event_type = 'doubt_unassigned'::public.notification_event_type
    and nr.profile_id = dr_env('admin')::uuid;
  perform dr_record(10, 'zero teachers → academic admin notified',
    v_notif >= 1, 'academic_admin_notif=' || v_notif);
end $$;

-- TEST 11 — zero teachers → Super Admin receives doubt_unassigned
do $$
declare
  v_notif int;
begin
  select count(*) into v_notif
  from public.notification_recipients nr
  join public.notifications n on n.notification_id = nr.notification_id
  where n.reference_id = dr_env('doubt9')::uuid
    and n.event_type = 'doubt_unassigned'::public.notification_event_type
    and nr.profile_id = dr_env('super')::uuid;
  perform dr_record(11, 'zero teachers → super admin notified',
    v_notif >= 1, 'super_admin_notif=' || v_notif);
end $$;

-- TEST 12 — cross-institute batch_subject rejected
do $$
declare
  v_res jsonb;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := dr_call(format(
    'select public.submit_student_doubt(%L, null, null, %L, %L, %L)',
    dr_env('phy')::uuid, dr_env('xbs_phy')::uuid, 'X institute', 'Not my institute.'));
  perform dr_record(12, 'cross-institute batch_subject rejected',
    (v_res->>'ok')::boolean = false
      and position('does not belong to your institute' in (v_res->>'err')) > 0,
    'result=' || v_res::text);
end $$;

-- TEST 13 — chapter that does not belong to the subject rejected
-- (Physics subject + Chemistry chapter = inconsistent academic context)
do $$
declare
  v_res jsonb;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := dr_call(format(
    'select public.submit_student_doubt(%L, %L, null, %L, %L, %L)',
    dr_env('phy')::uuid, dr_env('ch3')::uuid, dr_env('bsA_phy')::uuid,
    'Wrong chapter', 'ch3 is a Chemistry chapter, not Physics.'));
  perform dr_record(13, 'chapter of a different subject rejected',
    (v_res->>'ok')::boolean = false
      and position('does not belong to the selected subject' in (v_res->>'err')) > 0,
    'result=' || v_res::text);
end $$;

-- TEST 14 — topic that does not belong to the chapter rejected
do $$
declare
  v_res jsonb;
begin
  -- tp2 belongs to ch2; using ch1 + tp2 must be rejected.
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := dr_call(format(
    'select public.submit_student_doubt(%L, %L, %L, %L, %L, %L)',
    dr_env('phy')::uuid, dr_env('ch1')::uuid, dr_env('tp2')::uuid, dr_env('bsA_phy')::uuid,
    'Topic mismatch', 'tp2 is from a different chapter.'));
  perform dr_record(14, 'topic of another chapter rejected',
    (v_res->>'ok')::boolean = false
      and position('does not belong to the selected chapter' in (v_res->>'err')) > 0,
    'result=' || v_res::text);
end $$;

-- TEST 15 — student cannot manipulate assigned_to directly (RLS, auth = stuA)
-- The student SELECT-only policy (migration 118) means the authenticated role
-- has NO UPDATE policy on student_doubts → an UPDATE silently touches 0 rows
-- (or is denied outright where `authenticated` lacks the UPDATE base grant —
-- both are valid "blocked" outcomes). We capture ids into psql variables
-- BEFORE switching to the authenticated role (temp table dr_test_env is
-- invisible to it), run the UPDATE under `set local role authenticated` with
-- ON_ERROR_STOP temporarily off (a permission-denied error must not abort the
-- harness), restore, then verify assigned_to is intact.
\set ON_ERROR_STOP off
do $$ begin perform dr_set_auth(dr_env('stuA')::uuid); end $$;
select v as doubt1 from dr_test_env where k = 'doubt1' \gset
select v as t2tid from dr_test_env where k = 't2_tid' \gset
set local role authenticated;
update public.student_doubts
   set assigned_to = :'t2tid'::uuid
 where doubt_id = :'doubt1';
reset role;
\set ON_ERROR_STOP on
do $$
declare
  v_assign text;
begin
  select coalesce(assigned_to::text, 'NULL') into v_assign
  from public.student_doubts where doubt_id = dr_env('doubt1')::uuid;
  perform dr_record(15, 'student cannot update assigned_to (SELECT-only RLS)',
    v_assign = 'NULL',
    'assigned_to=' || v_assign);
end $$;

-- TEST 16 — legacy doubt (pre-118) remains completely unchanged
do $$
declare
  v_bs   text;
  v_assign text;
  v_status text;
begin
  select coalesce(batch_subject_id::text, 'NULL'),
         coalesce(assigned_to::text, 'NULL'),
         status
    into v_bs, v_assign, v_status
  from public.student_doubts where doubt_id = dr_env('legacy_doubt')::uuid;
  perform dr_record(16, 'legacy doubt unchanged (no backfill/re-routing)',
    v_bs = 'NULL' and v_assign = 'NULL' and v_status = 'open',
    'batch_subject=' || v_bs || ' assigned_to=' || v_assign || ' status=' || v_status);
end $$;

-- TEST 17 — academic admin can still assign a teacher (assign_doubt intact)
do $$
declare
  v_res jsonb;
begin
  perform dr_set_auth(dr_env('admin')::uuid);
  v_res := public.assign_doubt(dr_env('doubt9')::uuid, dr_env('t1_tid')::uuid);
  perform dr_record(17, 'academic admin assigns teacher',
    (v_res->>'success')::boolean = true
      and (v_res->>'assigned_to')::uuid = dr_env('t1_tid')::uuid,
    'result=' || v_res::text);
end $$;

-- TEST 18 — non-admin (student) cannot assign
do $$
declare
  v_res jsonb;
begin
  perform dr_set_auth(dr_env('stuA')::uuid);
  v_res := dr_call(format(
    'select public.assign_doubt(%L, %L)',
    dr_env('doubt1')::uuid, dr_env('t2_tid')::uuid));
  perform dr_record(18, 'student cannot assign a teacher',
    (v_res->>'ok')::boolean = false
      and position('Only academic admins' in (v_res->>'err')) > 0,
    'result=' || v_res::text);
end $$;

-- TEST 19 — teacher sees only permitted doubts (RLS, auth = t2)
-- t2 is assigned to Batch A chemistry only → must see doubt8 (chemistry)
-- but NOT doubt7 (physics).
do $$ begin perform dr_set_auth(dr_env('t2')::uuid); end $$;
select v as doubt7 from dr_test_env where k = 'doubt7' \gset
select v as doubt8 from dr_test_env where k = 'doubt8' \gset
set local role authenticated;
select count(*)::int as phys_n from public.student_doubts where doubt_id = :'doubt7';
\gset
select count(*)::int as chem_n from public.student_doubts where doubt_id = :'doubt8';
\gset
reset role;
do $$
begin
  perform dr_record(19, 'teacher sees only permitted doubts',
    :phys_n = 0 and :chem_n = 1,
    'physics=' || :'phys_n' || ' chemistry=' || :'chem_n');
end $$;

-- TEST 20 — student cannot see another student's doubt (RLS, auth = stuB)
do $$
declare
  v_doubt uuid;
begin
  -- student B creates their own doubt
  perform dr_set_auth(dr_env('stuB')::uuid);
  v_doubt := (public.submit_student_doubt(
    dr_env('chem')::uuid, null, null, dr_env('bsA_chem')::uuid,
    'Student B doubt', 'Only student B should see this.'
  )->>'doubt_id')::uuid;
  insert into dr_test_env values ('doubtB', v_doubt::text);
end $$;

do $$ begin perform dr_set_auth(dr_env('stuA')::uuid); end $$;
select v as doubtB from dr_test_env where k = 'doubtB' \gset
set local role authenticated;
select count(*)::int as rls_n from public.student_doubts where doubt_id = :'doubtB';
\gset
reset role;
do $$
begin
  perform dr_record(20, 'student cannot read another student''s doubt',
    :rls_n = 0, 'count=' || :'rls_n');
end $$;

-- TEST 21 — attachment access remains protected (RLS, auth = stuA)
do $$
declare
  v_att uuid;
begin
  -- superuser inserts an attachment row for student B's doubt
  insert into public.doubt_attachments (
    doubt_id, uploaded_by, bucket, storage_path, mime_type, size_bytes
  )
  values (
    dr_env('doubtB')::uuid, dr_env('stuB')::uuid,
    'doubt-attachments', 'inst/doubtB/file.jpg', 'image/jpeg', 1024
  )
  returning attachment_id into v_att;
  insert into dr_test_env values ('attB', v_att::text);
end $$;

do $$ begin perform dr_set_auth(dr_env('stuA')::uuid); end $$;
select v as doubtB from dr_test_env where k = 'doubtB' \gset
set local role authenticated;
select count(*)::int as att_n from public.doubt_attachments where doubt_id = :'doubtB';
\gset
reset role;
do $$
begin
  perform dr_record(21, 'attachment access remains protected (cross-student)',
    :att_n = 0, 'count=' || :'att_n');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- RESULTS
-- ════════════════════════════════════════════════════════════════════════════

\echo
\echo '=== DOUBT ROUTING 118 — TEST RESULTS ==='
select test_no, name, result, detail from dr_test_results order by test_no;

\echo
\echo 'NOTE: harness ran inside ONE transaction — rolling back now, no test data persists.'
rollback;
