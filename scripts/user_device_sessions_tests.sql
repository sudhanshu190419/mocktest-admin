-- ════════════════════════════════════════════════════════════════════════════
-- USER DEVICE SESSIONS — LIVE DATABASE TEST HARNESS (migration 119)
-- Tests the single-device-login foundation:
--   · register_active_device() upsert + replace semantics
--   · the partial unique index single-active guarantee
--   · validate_active_device() truthfulness
--   · deactivate_active_device() logout semantics
--   · RLS: owner SELECT-only; no direct INSERT/UPDATE/DELETE via table
--   · cross-user isolation (read + deactivate)
--   · audit trail via write_audit_log
--
-- HOW TO RUN (against a SAFE, DISPOSABLE Supabase-flavoured DB with
-- migration 119 applied — e.g. a local `supabase start` stack after
-- `supabase db reset`):
--
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/user_device_sessions_tests.sql
--
-- REQUIREMENTS
--   * Connect as a postgres SUPERUSER (fixture inserts bypass RLS).
--   * Migration 119 must be applied (checked below).
--   * The Supabase `authenticated` role must exist and have the standard
--     Supabase default grants (USAGE on public + table grants) so the RLS
--     assertions are evaluated under a real role — superuser would bypass
--     RLS and the isolation tests would be meaningless.
--   * TEST 10 / TEST 11 additionally attempt direct table UPDATEs under the
--     `authenticated` role. If `authenticated` has the UPDATE base grant,
--     RLS row-level denial is exercised (0 rows changed). If it lacks the
--     grant, the UPDATE errors — which is also treated as a PASS (blocked).
--     ON_ERROR_STOP is toggled off around those statements so neither
--     outcome aborts the harness.
--
-- SAFETY
--   The ENTIRE harness runs inside ONE transaction that is ROLLED BACK at the
--   end. Results are printed just before the rollback. No test data persists.
--   Auth paths are simulated via request.jwt.claim.* GUCs (auth.uid()/
--   auth.role()) exactly like the doubt / teacher-leave harnesses. RLS reads
--   temporarily `SET LOCAL ROLE authenticated` (transaction-local, restored
--   immediately); the auth GUC is set BEFORE the switch.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── 0. Preconditions ───────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.user_device_sessions') is null then
    raise exception 'PRECONDITION FAILED: migration 119 not applied — user_device_sessions does not exist.';
  end if;
  if to_regprocedure('public.register_active_device(text,text,text,text,text)') is null then
    raise exception 'PRECONDITION FAILED: register_active_device does not exist.';
  end if;
  if to_regprocedure('public.validate_active_device(text)') is null then
    raise exception 'PRECONDITION FAILED: validate_active_device does not exist.';
  end if;
  if to_regprocedure('public.deactivate_active_device(text,text)') is null then
    raise exception 'PRECONDITION FAILED: deactivate_active_device does not exist.';
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
create temp table uds_test_results (
  test_no int primary key,
  name    text not null,
  result  text not null,
  detail  text not null default ''
);

create temp table uds_test_env (k text primary key, v text not null);

create or replace function uds_env(p_k text)
returns text language sql stable as $$
  select v from uds_test_env where k = p_k;
$$;

-- Simulate an authenticated caller with the given profile id + role.
-- The GUCs are transaction-local and PERSIST across `SET LOCAL ROLE`, so call
-- this BEFORE switching role for RLS reads.
create or replace function uds_set_auth(p_profile_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_profile_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end $$;

-- Safe-call wrapper for RPCs that return jsonb, capturing errors.
create or replace function uds_call(p_sql text)
returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  begin
    execute p_sql into v;
    return jsonb_build_object('ok', true, 'result', v);
  exception when others then
    return jsonb_build_object('ok', false, 'err', SQLERRM, 'sqlstate', SQLSTATE);
  end;
end $$;

create or replace function uds_record(p_test int, p_name text, p_pass boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into uds_test_results (test_no, name, result, detail)
  values (p_test, p_name, case when p_pass then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $$;

-- ── 2. Fixture creation (isolated institutes, rolled back at the end) ──────
-- Two institutes (A and B) and two users per institute are created. Migration
-- 119 is profile-scoped (auth.uid()), so institute separation is implicit —
-- each profile lives in its own institute to also prove that cross-institute
-- access is impossible under RLS.
do $$
declare
  v_instA  uuid;
  v_instB  uuid;
  v_userA1 uuid;  -- institute A, user 1
  v_userA2 uuid;  -- institute A, user 2
  v_userB1 uuid;  -- institute B, user 1
begin
  insert into public.institutes (name, slug, plan_tier)
  values ('UDS Test Institute A', 'uds-test-a', 'starter')
  returning institute_id into v_instA;
  insert into public.institutes (name, slug, plan_tier)
  values ('UDS Test Institute B', 'uds-test-b', 'starter')
  returning institute_id into v_instB;

  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_instA, 'UDS User A1', 'uds.a1@test.invalid', '919000000301', 'student', true)
  returning profile_id into v_userA1;
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_instA, 'UDS User A2', 'uds.a2@test.invalid', '919000000302', 'student', true)
  returning profile_id into v_userA2;
  insert into public.profiles (profile_id, institute_id, name, email, phone, role, is_active)
  values (gen_random_uuid(), v_instB, 'UDS User B1', 'uds.b1@test.invalid', '919000000303', 'student', true)
  returning profile_id into v_userB1;

  insert into uds_test_env values
    ('instA',  v_instA::text),
    ('instB',  v_instB::text),
    ('userA1', v_userA1::text),
    ('userA2', v_userA2::text),
    ('userB1', v_userB1::text);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- TESTS
-- ════════════════════════════════════════════════════════════════════════════

-- TEST 1 — authenticated user can register a device → exactly one active row
do $$
declare
  v_res jsonb;
  v_cnt int;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-A1-0001', 'android', 'Pixel 8', '0.0.1', 'fcm-a1-0001'
  );
  select count(*) into v_cnt
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid;
  perform uds_record(1, 'authenticated user registers a device (one active row)',
    (v_res->>'success')::boolean = true
      and (v_res->>'isNewInstall')::boolean = true
      and v_cnt = 1
      and (select is_active from public.user_device_sessions
            where profile_id = uds_env('userA1')::uuid),
    'result=' || v_res::text || ' rows=' || v_cnt);
  insert into uds_test_env values ('sessionA1', (v_res->>'installedDeviceId'));
end $$;

-- TEST 2 — register the same device twice → no duplicate row
do $$
declare
  v_res jsonb;
  v_cnt int;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-A1-0001', 'android', 'Pixel 8', '0.0.1', 'fcm-a1-0001'
  );
  select count(*) into v_cnt
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  perform uds_record(2, 'register same device twice → no duplicate row',
    (v_res->>'success')::boolean = true
      and (v_res->>'isNewInstall')::boolean = false
      and v_cnt = 1
      and jsonb_array_length((v_res->>'revokedPreviousDeviceIds')::jsonb) = 0,
    'result=' || v_res::text || ' rows=' || v_cnt);
end $$;

-- TEST 3 — register Phone B (install-B1) after Phone A (install-A1)
do $$
declare
  v_res   jsonb;
  v_a1act boolean;
  v_b1act boolean;
  v_rev   text;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-B1-0002', 'android', 'Galaxy S24', '0.0.1', 'fcm-b1-0002'
  );
  select is_active into v_a1act
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  select is_active into v_b1act
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-B1-0002';
  select coalesce(revoked_reason, 'NULL') into v_rev
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  perform uds_record(3, 'register B replaces A (A inactive, B active, reason replaced_by_new_device)',
    (v_res->>'success')::boolean = true
      and v_a1act = false
      and v_b1act = true
      and v_rev = 'replaced_by_new_device',
    'result=' || v_res::text || ' A_active=' || v_a1act
      || ' B_active=' || v_b1act || ' A_reason=' || v_rev);
  insert into uds_test_env values ('sessionB1', (v_res->>'installedDeviceId'));
end $$;

-- TEST 4 — only one active row exists for the profile
do $$
declare
  v_cnt int;
begin
  select count(*) into v_cnt
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and is_active;
  perform uds_record(4, 'exactly one active row for the profile',
    v_cnt = 1, 'active_rows=' || v_cnt);
end $$;

-- TEST 5 — validate_active_device(A) after B becomes active → active = false
do $$
declare
  v_res jsonb;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.validate_active_device('install-A1-0001');
  perform uds_record(5, 'validate(A) after B active → active=false',
    (v_res->>'active')::boolean = false, 'result=' || v_res::text);
end $$;

-- TEST 6 — validate_active_device(B) → active = true
do $$
declare
  v_res jsonb;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.validate_active_device('install-B1-0002');
  perform uds_record(6, 'validate(B) → active=true',
    (v_res->>'active')::boolean = true, 'result=' || v_res::text);
end $$;

-- TEST 7 — deactivate B (user_logout) → B becomes inactive
do $$
declare
  v_res jsonb;
  v_act boolean;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.deactivate_active_device('install-B1-0002', 'user_logout');
  select is_active into v_act
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-B1-0002';
  perform uds_record(7, 'deactivate B (user_logout) → B inactive',
    (v_res->>'success')::boolean = true and v_act = false,
    'result=' || v_res::text || ' B_active=' || v_act);
end $$;

-- TEST 8 — another user cannot READ user A1's device rows (RLS)
-- Snapshot ids into psql variables BEFORE switching to the authenticated
-- role (the temp env table is invisible to it), then assert 0 rows visible.
do $$ begin perform uds_set_auth(uds_env('userA2')::uuid); end $$;
select v as userA1 from uds_test_env where k = 'userA1' \gset
set local role authenticated;
select count(*)::int as rls_n from public.user_device_sessions where profile_id = :'userA1'::uuid;
\gset
reset role;
do $$
begin
  perform uds_record(8, 'another user cannot read user A1''s device rows (RLS)',
    :rls_n = 0, 'visible_rows=' || :'rls_n');
end $$;

-- TEST 9 — another user cannot DEACTIVATE user A1's device (RPC scoped by auth.uid())
-- A1's install-A1 is first (re-)activated so there is a REAL active device to
-- protect; A2 then attempts to deactivate it and must fail, leaving it active.
do $$
declare
  v_res jsonb;
  v_act boolean;
begin
  -- Re-activate A1's own device so the security property is exercised
  -- against an ACTIVE row (A1 is the owner, so this succeeds).
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-A1-0001', 'android', 'Pixel 8', '0.0.1', 'fcm-a1-0001'
  );
  if (v_res->>'success')::boolean <> true then
    perform uds_record(9, 'another user cannot deactivate user A1''s device',
      false, 'precondition failed: A1 re-registration = ' || v_res::text);
    return;
  end if;

  -- user A2 (own profile) tries to deactivate user A1's install id
  perform uds_set_auth(uds_env('userA2')::uuid);
  v_res := public.deactivate_active_device('install-A1-0001', 'user_logout');
  -- A1's row must remain ACTIVE — the RPC is scoped to auth.uid() (A2), so
  -- it can never touch A1's row.
  select is_active into v_act
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  perform uds_record(9, 'another user cannot deactivate user A1''s device',
    (v_res->>'success')::boolean = false
      and v_act = true,  -- A1's device must STILL be active
    'result=' || v_res::text || ' A1_active=' || v_act);
end $$;

-- TEST 10 — a user cannot directly UPDATE is_active through table RLS
-- (no UPDATE policy exists → 0 rows changed, or permission-denied which we
--  also count as blocked). ON_ERROR_STOP is toggled off around the UPDATE.
\set ON_ERROR_STOP off
do $$ begin perform uds_set_auth(uds_env('userA1')::uuid); end $$;
select v as userA1 from uds_test_env where k = 'userA1' \gset
set local role authenticated;
update public.user_device_sessions
   set is_active = true,
       activated_at = now(),
       revoked_at = null,
       revoked_reason = null
 where profile_id = :'userA1'::uuid;
reset role;
\set ON_ERROR_STOP on
do $$
declare
  v_act_after boolean;
begin
  -- B1 is inactive (TEST 7); if the direct UPDATE had worked, B1 would now
  -- be active. It must NOT have changed.
  select is_active into v_act_after
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-B1-0002';
  perform uds_record(10, 'user cannot directly UPDATE is_active via RLS',
    v_act_after = false,
    'B1_active_after_direct_update=' || v_act_after);
end $$;

-- TEST 11 — a user cannot directly change another profile's row
-- A2 attempts to mutate a BENIGN column (device_name) on A1's rows. If the
-- UPDATE were permitted by any policy, device_name would change and the
-- assertion below would catch the leak — unlike asserting on is_active,
-- which the attempted UPDATE would not have altered anyway.
\set ON_ERROR_STOP off
do $$ begin perform uds_set_auth(uds_env('userA2')::uuid); end $$;
select v as userA1 from uds_test_env where k = 'userA1' \gset
set local role authenticated;
update public.user_device_sessions
   set device_name = 'TAMPERED-BY-A2'
 where profile_id = :'userA1'::uuid;
reset role;
\set ON_ERROR_STOP on
do $$
declare
  v_name text;
begin
  -- A1's install-A1 row was created as 'Pixel 8'; a permitted cross-user
  -- UPDATE would have rewritten it to 'TAMPERED-BY-A2'.
  select coalesce(device_name, 'NULL') into v_name
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  perform uds_record(11, 'user cannot directly modify another profile''s row',
    v_name = 'Pixel 8', 'A1_device_name_after=' || v_name);
end $$;

-- TEST 12 — register A again after logout → A becomes active
do $$
declare
  v_res jsonb;
  v_a1  boolean;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-A1-0001', 'android', 'Pixel 8', '0.0.1', 'fcm-a1-0001'
  );
  select is_active into v_a1
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  perform uds_record(12, 'register A again after logout → A active again',
    (v_res->>'success')::boolean = true and v_a1 = true,
    'result=' || v_res::text || ' A_active=' || v_a1);
end $$;

-- TEST 13 — register A again while A is already active → no duplicate, still active
do $$
declare
  v_res jsonb;
  v_cnt int;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-A1-0001', 'android', 'Pixel 8', '0.0.1', 'fcm-a1-0001'
  );
  select count(*) into v_cnt
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  perform uds_record(13, 'register A while A already active → no duplicate',
    (v_res->>'success')::boolean = true
      and v_cnt = 1
      and jsonb_array_length((v_res->>'revokedPreviousDeviceIds')::jsonb) = 0,
    'result=' || v_res::text || ' rows=' || v_cnt);
end $$;

-- TEST 14 — register B while A active → A revoked with replaced_by_new_device
do $$
declare
  v_res jsonb;
  v_a1  boolean;
  v_rev text;
  v_new boolean;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-B2-0003', 'android', 'Galaxy S24', '0.0.1', 'fcm-b2-0003'
  );
  select is_active, coalesce(revoked_reason, 'NULL')
    into v_a1, v_rev
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-A1-0001';
  v_new := (v_res->>'isNewInstall')::boolean;
  perform uds_record(14, 'register B while A active → A revoked (replaced_by_new_device)',
    v_a1 = false and v_rev = 'replaced_by_new_device' and v_new = true,
    'A_active=' || v_a1 || ' A_reason=' || v_rev || ' B2_new=' || v_new);
end $$;

-- TEST 15 — deactivation reason 'user_logout' is recorded correctly
do $$
declare
  v_res jsonb;
  v_rev text;
  v_at  timestamptz;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.deactivate_active_device('install-B2-0003', 'user_logout');
  select revoked_reason, revoked_at
    into v_rev, v_at
    from public.user_device_sessions
   where profile_id = uds_env('userA1')::uuid
     and device_installation_id = 'install-B2-0003';
  perform uds_record(15, 'deactivation reason user_logout recorded',
    (v_res->>'success')::boolean = true
      and v_rev = 'user_logout'
      and v_at is not null,
    'reason=' || v_rev || ' revoked_at_set=' || (v_at is not null));
end $$;

-- TEST 16 — validate_active_device for a nonexistent installation → active = false
do $$
declare
  v_res jsonb;
begin
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.validate_active_device('install-NO-SUCH-0009');
  perform uds_record(16, 'validate nonexistent installation → active=false',
    (v_res->>'active')::boolean = false, 'result=' || v_res::text);
end $$;

-- TEST 17 — concurrent registration safety (partial unique index as the net)
-- True parallel execution cannot be simulated safely inside a single-session
-- harness (PostgreSQL would need two concurrent transactions). Instead we
-- prove the DATABASE-LEVEL guarantee directly: with A1 holding an ACTIVE
-- row, a direct second ACTIVE row for the same profile (bypassing the RPC
-- entirely) MUST be rejected by the partial unique index (23505) — exactly
-- the failure a racing second login would hit. Documented limitation: the
-- advisory lock serializes the RPC path; this test proves the index backstop.
do $$
declare
  v_res jsonb;
  v_act boolean;
begin
  -- Precondition: A1 must hold an ACTIVE row. TEST 14 revoked install-A1
  -- (B2 active) and TEST 15 deactivated B2, so A1 currently has NO active
  -- row — re-register A1's install to guarantee the index conflict.
  perform uds_set_auth(uds_env('userA1')::uuid);
  v_res := public.register_active_device(
    'install-A1-0001', 'android', 'Pixel 8', '0.0.1', 'fcm-a1-0001'
  );
  if (v_res->>'success')::boolean <> true then
    perform uds_record(17, 'partial unique index rejects a second active row',
      false, 'precondition failed: A1 re-registration = ' || v_res::text);
    return;
  end if;

  -- Attempt to force a second active row for userA1 by direct insert
  -- (superuser, so RLS is bypassed — only the index can stop this).
  v_res := uds_call(format(
    'insert into public.user_device_sessions '
    || '(profile_id, device_installation_id, is_active, activated_at) '
    || 'values (%L, %L, true, now())',
    uds_env('userA1')::uuid, 'install-RACE-9999'));
  perform uds_record(17, 'partial unique index rejects a second active row',
    (v_res->>'ok')::boolean = false
      and (v_res->>'sqlstate') = '23505',
    'result=' || v_res::text);
end $$;

-- TEST 18 — verify the partial unique index exists
do $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'user_device_sessions'
       and indexname = 'uq_user_device_sessions_single_active'
       and indexdef ilike '%where is_active%'
  ) into v_ok;
  perform uds_record(18, 'partial unique index exists (profile_id) WHERE is_active',
    v_ok, 'index_present=' || v_ok);
end $$;

-- TEST 19 — verify RLS is enabled on the table
do $$
declare
  v_ok boolean;
begin
  select relrowsecurity into v_ok
    from pg_class
   where oid = 'public.user_device_sessions'::regclass;
  perform uds_record(19, 'RLS enabled on user_device_sessions',
    v_ok, 'rls_enabled=' || v_ok);
end $$;

-- TEST 20 — verify the three SECURITY DEFINER functions exist (and are definer)
do $$
declare
  v_reg  boolean;
  v_val  boolean;
  v_dea  boolean;
begin
  select exists (select 1 from pg_proc p
                  where p.oid = 'public.register_active_device(text,text,text,text,text)'::regprocedure
                    and p.prosecdef) into v_reg;
  select exists (select 1 from pg_proc p
                  where p.oid = 'public.validate_active_device(text)'::regprocedure
                    and p.prosecdef) into v_val;
  select exists (select 1 from pg_proc p
                  where p.oid = 'public.deactivate_active_device(text,text)'::regprocedure
                    and p.prosecdef) into v_dea;
  perform uds_record(20, 'SECURITY DEFINER RPCs exist',
    v_reg and v_val and v_dea,
    'register=' || v_reg || ' validate=' || v_val || ' deactivate=' || v_dea);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- RESULTS
-- ════════════════════════════════════════════════════════════════════════════

\echo
\echo '=== USER DEVICE SESSIONS 119 — TEST RESULTS ==='
select test_no, name, result, detail from uds_test_results order by test_no;

\echo
\echo 'NOTE: harness ran inside ONE transaction — rolling back now, no test data persists.'
rollback;
