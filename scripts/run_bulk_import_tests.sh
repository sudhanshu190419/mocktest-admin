#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# BULK TIMETABLE IMPORT RPC — TEST ORCHESTRATOR
# Runs:
#   1. scripts/bulk_import_tests.sql   (tests 2–28, 30 — one transaction, auto-rolled-back)
#   2. Concurrency test (29)           (two parallel identical imports → exactly 1 slot)
#
# USAGE (against a SAFE, DISPOSABLE Supabase-flavoured DB with migration 114 applied):
#   scripts/run_bulk_import_tests.sh "postgresql://postgres:postgres@localhost:54322/postgres"
#   or:  DATABASE_URL=... scripts/run_bulk_import_tests.sh
#
# SAFETY: the concurrency test creates its own isolated institute (slug
# 'bulk-import-conc-test') and deletes it afterwards. The main harness never
# persists anything. NEVER point this at production.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "usage: $0 'postgresql://postgres:postgres@localhost:54322/postgres'" >&2
  exit 2
fi

# Locate psql (PATH first, then the standard Windows PG18 install)
PSQL="$(command -v psql 2>/dev/null)"
if [ -z "$PSQL" ] && [ -f "/c/Program Files/PostgreSQL/18/bin/psql.exe" ]; then
  PSQL="/c/Program Files/PostgreSQL/18/bin/psql.exe"
fi
if [ -z "$PSQL" ]; then
  echo "ERROR: psql not found on PATH (or in C:/Program Files/PostgreSQL/18)." >&2
  exit 2
fi

echo "==> using psql: $PSQL"
echo "==> target:     $DB_URL"
echo

# ── 1. Main harness (tests 2–28, 30) ───────────────────────────────────────
echo "==> Running main harness (scripts/bulk_import_tests.sql) ..."
"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/bulk_import_tests.sql"
HARNESS_RC=$?
if [ "$HARNESS_RC" -ne 0 ]; then
  echo "WARNING: harness exited with rc=$HARNESS_RC (some results may be missing)." >&2
fi
echo

# ── 2. Concurrency test (TEST 29) ──────────────────────────────────────────
echo "==> Running concurrency test (TEST 29) ..."
CONC_SLUG="bulk-import-conc-test"
CONC_EMAIL="bulk.conc.teacher@test.invalid"

# Cleanup SQL (FK-safe order) — used BOTH as a pre-purge (idempotent re-runs)
# and as post-test cleanup.
CLEANUP_SQL=$(cat <<SQL

do \$\$
declare
  v_inst uuid;
begin
  select institute_id into v_inst from public.institutes where slug = '$CONC_SLUG';
  if v_inst is null then return; end if;

  delete from public.live_classes where institute_id = v_inst;
  delete from public.timetable_slots where institute_id = v_inst;
  delete from public.batch_subject_teachers where institute_id = v_inst;
  delete from public.batch_subjects where institute_id = v_inst;
  delete from public.topics where chapter_id in (select chapter_id from public.chapters c join public.subjects s on s.subject_id = c.subject_id join public.streams st on st.stream_id = s.stream_id where st.institute_id = v_inst);
  delete from public.chapters where subject_id in (select subject_id from public.subjects s join public.streams st on st.stream_id = s.stream_id where st.institute_id = v_inst);
  delete from public.subjects where stream_id in (select stream_id from public.streams where institute_id = v_inst);
  delete from public.batches where institute_id = v_inst;
  delete from public.streams where institute_id = v_inst;
  delete from public.teacher_details where profile_id in (select profile_id from public.profiles where institute_id = v_inst);
  delete from public.profiles where institute_id = v_inst;
  delete from public.institutes where institute_id = v_inst;
end \$\$;
SQL
)

# Pre-purge: make the runner re-runnable even if a previous cleanup failed.
"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -c "$CLEANUP_SQL" >/dev/null 2>&1 || true

SETUP_SQL=$(cat <<SQL
-- isolated institute + entities for the concurrency test
insert into public.institutes (name, slug, plan_tier)
values ('Bulk Import Conc Test', '$CONC_SLUG', 'starter')
on conflict (slug) do nothing;

do \$\$
declare
  v_inst uuid;
  v_stream uuid; v_sub uuid; v_batch uuid; v_bs uuid;
  v_profile uuid; v_teacher uuid; v_ch uuid; v_tp uuid;
begin
  select institute_id into v_inst from public.institutes where slug = '$CONC_SLUG';

  insert into public.profiles (profile_id, institute_id, name, email, role) values
    (gen_random_uuid(), v_inst, 'Bulk Conc Teacher', '$CONC_EMAIL', 'teacher')
  returning profile_id into v_profile;
  insert into public.teacher_details (profile_id, specialization) values (v_profile, 'conc-test')
  returning teacher_id into v_teacher;

  insert into public.streams (institute_id, name, code) values (v_inst, 'Conc Stream', 'CST')
  returning stream_id into v_stream;
  insert into public.subjects (stream_id, name, code) values (v_stream, 'Conc Subject', 'CSUB')
  returning subject_id into v_sub;
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date)
  values (v_inst, v_stream, 'Conc Batch', 'CB1', '2026-27', current_date - 90, current_date + 365)
  returning batch_id into v_batch;
  insert into public.batch_subjects (batch_id, subject_id, institute_id) values (v_batch, v_sub, v_inst)
  returning batch_subject_id into v_bs;
  insert into public.batch_subject_teachers (batch_subject_id, teacher_id, institute_id)
  values (v_bs, v_teacher, v_inst);
  insert into public.chapters (subject_id, name) values (v_sub, 'Conc Chapter') returning chapter_id into v_ch;
  insert into public.topics (chapter_id, name) values (v_ch, 'Conc Topic') returning topic_id into v_tp;
end \$\$;
SQL
)

"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -c "$SETUP_SQL" >/dev/null

CONC_INST=$("$PSQL" "$DB_URL" -Atc "select institute_id from public.institutes where slug = '$CONC_SLUG';")
CONC_T1=$("$PSQL" "$DB_URL" -Atc "select td.teacher_id from public.teacher_details td join public.profiles p on p.profile_id = td.profile_id where p.email = '$CONC_EMAIL';")
CONC_BS=$("$PSQL" "$DB_URL" -Atc "select bs.batch_subject_id from public.batch_subjects bs join public.institutes i on i.institute_id = bs.institute_id where i.slug = '$CONC_SLUG';")
CONC_CH=$("$PSQL" "$DB_URL" -Atc "select c.chapter_id from public.chapters c join public.subjects s on s.subject_id = c.subject_id join public.streams st on st.stream_id = s.stream_id join public.institutes i on i.institute_id = st.institute_id where i.slug = '$CONC_SLUG';")
CONC_TP=$("$PSQL" "$DB_URL" -Atc "select t.topic_id from public.topics t where t.chapter_id = '$CONC_CH'::uuid limit 1;")

if [ -z "$CONC_INST" ] || [ -z "$CONC_T1" ] || [ -z "$CONC_BS" ] || [ -z "$CONC_CH" ] || [ -z "$CONC_TP" ]; then
  echo "ERROR: concurrency setup failed (missing ids)." >&2
  exit 1
fi

IMP_SQL="select set_config('request.jwt.claim.role','service_role',false), public.bulk_import_timetable(
  '$CONC_INST'::uuid,
  jsonb_build_array(jsonb_build_object(
    'key','conc-slot','teacher_id','$CONC_T1'::uuid,'batch_subject_id','$CONC_BS'::uuid,
    'day_of_week',1,'start_time','10:00:00','end_time','11:00:00',
    'valid_from',(date_trunc('week',current_date)::date - 7),
    'valid_until',(date_trunc('week',current_date)::date + 84))),
  jsonb_build_array(jsonb_build_object(
    'slot_key','conc-slot','occurrence_date',(date_trunc('week',current_date)::date + 7),
    'chapter_id','$CONC_CH'::uuid,'topic_id','$CONC_TP'::uuid,'notes','concurrency test'))
);"

echo "==> launching two parallel imports ..."
"$PSQL" "$DB_URL" -Atc "$IMP_SQL" > /tmp/bulk_conc_a.out 2>&1 &
PID_A=$!
"$PSQL" "$DB_URL" -Atc "$IMP_SQL" > /tmp/bulk_conc_b.out 2>&1 &
PID_B=$!
wait "$PID_A" "$PID_B"

A_OK=$(grep -c '"success" *: *true' /tmp/bulk_conc_a.out 2>/dev/null || true)
B_OK=$(grep -c '"success" *: *true' /tmp/bulk_conc_b.out 2>/dev/null || true)
SLOT_COUNT=$("$PSQL" "$DB_URL" -Atc "select count(*) from public.timetable_slots where institute_id = '$CONC_INST'::uuid and start_time = time '10:00:00' and end_time = time '11:00:00';")
PLAN_COUNT=$("$PSQL" "$DB_URL" -Atc "select count(*) from public.lesson_plans lp join public.timetable_slots ts on ts.timetable_slot_id = lp.timetable_slot_id where ts.institute_id = '$CONC_INST'::uuid;")

echo
echo "   import A succeeded: $A_OK    import B succeeded: $B_OK"
echo "   timetable_slots after concurrent imports: $SLOT_COUNT (expected 1)"
echo "   lesson_plans after concurrent imports:    $PLAN_COUNT (expected 1)"
if [ "$A_OK" -ge 1 ] && [ "$B_OK" -ge 1 ] && [ "$SLOT_COUNT" = "1" ] && [ "$PLAN_COUNT" = "1" ]; then
  echo "   TEST 29 (concurrency) => PASS"
else
  echo "   TEST 29 (concurrency) => FAIL"
fi

# ── Cleanup: remove only the concurrency test institute (FK-safe order) ────
CLEAN_RC=$("$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -c "$CLEANUP_SQL" >/dev/null 2>&1 && echo ok || echo failed)
echo
echo "==> concurrency-test cleanup: $CLEAN_RC"

echo
echo "DONE — see TEST RESULTS above. Main harness rolled back; concurrency institute removed."
