#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# TEACHER LEAVE + CLASS RESOLUTION — TEST ORCHESTRATOR
# Runs: scripts/teacher_leave_resolution_tests.sql  (tests 1–25 — ONE
# transaction, results printed, then ROLLED BACK — nothing persists).
#
# USAGE (against a SAFE, DISPOSABLE Supabase-flavoured DB with migration 115
# applied — e.g. a local `supabase start` stack after `supabase db reset`):
#   scripts/run_teacher_leave_resolution_tests.sh "postgresql://postgres:postgres@localhost:54322/postgres"
#   or:  DATABASE_URL=... scripts/run_teacher_leave_resolution_tests.sh
#
# SAFETY: the harness creates isolated fixtures inside ONE transaction that
# is always rolled back, so no test data ever persists. NEVER point this at
# production.
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

echo "==> Running teacher-leave/resolution harness (scripts/teacher_leave_resolution_tests.sql) ..."
"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/teacher_leave_resolution_tests.sql"
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "WARNING: harness exited with rc=$RC (some results may be missing)." >&2
  exit "$RC"
fi

echo
echo "DONE — see TEST RESULTS above. The harness ran inside ONE transaction and rolled back; no test data persists."
