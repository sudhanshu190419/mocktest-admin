# Timetable Materialization Scheduler — Deployment Guide

**Phase:** Automatic timetable materialization (approved Option D: immediate + daily catch-up)
**Schedule:** daily at 00:00 UTC (`0 0 * * *`)
**Mechanism:** `pg_cron` → `net.http_post` → Edge Function, with the function URL resolved at runtime from Supabase Vault
**Window:** rolling `current_date → current_date + 60 days`

## What this does

`timetable_slots` are recurring **rules**; `live_classes` are the **actual class occurrences** shown on the teacher calendar. Two mechanisms populate them:

1. **Immediate (Part A, app-side):** after the admin creates/updates/activates/pauses/cancels a timetable slot, the admin service best-effort calls `materialize_institute_timetable` (create) or `reconcile_timetable_slot` (update/status) for the next 60 days. Best-effort = a failure never fails the mutation; the daily job recovers.
2. **Daily catch-up (Part B, this guide):** `timetable-materialization-daily` posts to the `timetable-materialization` Edge Function, which calls `materialize_institute_timetable` per institute for `current_date → +60 days`.

Idempotency is guaranteed by the existing partial unique index `uq_live_classes_timetable_occurrence` (`live_classes (timetable_slot_id, scheduled_at)` where `timetable_slot_id is not null`) plus `ON CONFLICT DO NOTHING` — re-runs create no duplicates.

## Components

| Component | Location |
|---|---|
| Reconcile RPC + cron registration | `supabase/migrations/110_schedule_timetable_materialization.sql` |
| Edge Function | `supabase/functions/timetable-materialization/index.ts` |
| config.toml entry | `[functions.timetable-materialization] verify_jwt = false` |
| Existing RPCs (UNCHANGED) | `materialize_timetable_classes` / `materialize_institute_timetable` (migration 108, fixed by 109) |
| Immediate materialization wiring | `src/services/admin/timetableAdminService.ts`, `src/hooks/admin/useTimetableAdmin.ts`, `src/components/admin/timetable/TimetableFormModal.tsx` |

## Deployment steps

### 1. Apply migration 110

```
supabase db push
```

This registers the `timetable-materialization-daily` cron job (unschedule-then-schedule → exactly one `cron.job` row) and creates `public.reconcile_timetable_slot(uuid)`.

### 2. Deploy the Edge Function

```
supabase functions deploy timetable-materialization
```

`verify_jwt = false` is set in `supabase/config.toml` (required: the cron POSTs without an Authorization header). The function uses the **service role** (server-side only) to invoke the SECURITY DEFINER RPCs. It resolves institutes from the data (`timetable_slots where status = 'active'`) and never accepts an `institute_id` from the request body.

### 3. Create the Vault secret (per environment)

The cron command resolves the function URL at runtime from the Vault secret **`timetable_materialization_url`**. Create it for each environment (Dashboard → Vault, or SQL):

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/timetable-materialization',
  'timetable_materialization_url',
  'Daily timetable materialization Edge Function URL (environment-specific)'
);
```

If the secret is missing when the job fires, the job **raises** and issues **no HTTP request** (fail-safe; no fallback to another environment's URL).

### 4. Verify the cron job

```sql
select jobid, jobname, schedule, active, database, username, command
from cron.job
where jobname = 'timetable-materialization-daily';
-- Expect exactly 1 row; schedule = '0 0 * * *'; command contains NO URL literal.

select extname, extversion
from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault')
order by extname;

select name, created_at
from vault.decrypted_secrets
where name = 'timetable_materialization_url';
```

### 5. Manual cron execution

```sql
select cron.run_job((select jobid from cron.job
                      where jobname = 'timetable-materialization-daily'));
```

### 6. Inspect job logs / outcomes

```sql
select status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 5;

select status, status_code, content, timed_out
from net._http_response
order by id desc
limit 5;
```

The Edge Function also emits structured JSON logs (`service: "timetable-materialization"`) with events `JOB_STARTED`, `INSTITUTES_RESOLVED`, `INSTITUTE_MATERIALIZED`, `INSTITUTE_MATERIALIZATION_FAILED`, `JOB_COMPLETED`, `JOB_FAILED` — searchable in the Functions logs.

## Manual testing paths (Part 8 of the task)

| Path | How |
|---|---|
| **A. Edge Function directly** | `curl -X POST https://<ref>.supabase.co/functions/v1/timetable-materialization` (or GET for health) |
| **B. cron job manually** | `select cron.run_job((select jobid from cron.job where jobname = 'timetable-materialization-daily'));` |
| **C. RPC directly** | `select public.materialize_institute_timetable('<institute_id>', current_date, current_date + 60);`<br>`select public.reconcile_timetable_slot('<slot_id>');` |
| **D. Admin timetable creation** | Create/edit/pause/cancel a slot in `/admin/timetable` → classes appear on `/teacher/timetable` calendar within seconds (best-effort) |

## Rollback / disable

Stop the scheduled job only (keeps the function, extensions, RPCs, and business logic):

```sql
select cron.unschedule('timetable-materialization-daily');
```

To also drop the reconcile RPC (not recommended mid-cycle):

```sql
drop function if exists public.reconcile_timetable_slot(uuid);
```

## Safety notes

- **Multi-institute:** institutes are enumerated from active `timetable_slots`; each is materialized independently, so Institute A failure never affects Institute B.
- **History is never mutated:** `reconcile_timetable_slot` cancels only future `scheduled` occurrences of its slot; live/completed classes, sessions, recordings, and attendance are untouched.
- **No service-role exposure:** the service key exists only inside the Edge Function (server-side); the frontend never sees it.
- **Migration 108 / 109 are unchanged**; no duplicate uniqueness mechanism was added.
