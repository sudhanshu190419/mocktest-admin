# Live Class Watchdog — Deployment Guide

## Overview

The **live-class-watchdog** prevents live classes from staying `status='live'` forever when the teacher disappears (browser crash, laptop shutdown, internet failure, Wi-Fi change, tab closure, OS suspension, unexpected disconnect).

**Policy:**
- Teacher heartbeat: every 60 seconds (client → `heartbeat_live_class()` RPC)
- Stale threshold: 15 minutes without a heartbeat
- Watchdog: every 5 minutes (pg_cron → Edge Function)
- Hard cap: `scheduled_at + duration_min + 15 minutes` (absolute bound, wins over heartbeats)
- Never-started classes: automatically cancelled after the start window expires

---

## 1. Migration 112

Apply the migration:

```sql
-- Via Supabase Dashboard → SQL Editor → New Query
-- Paste the contents of supabase/migrations/112_abandoned_live_class_recovery.sql
-- OR via CLI:
supabase migration up
```

**What it creates/changes:**
- `live_sessions.last_teacher_activity_at` column (DEFAULT `now()`) + partial index
- `end_live_class(uuid, text)` — CREATE OR REPLACE with `p_ended_reason` parameter (DEFAULT `'host_ended'`; watchdog passes `'watchdog_timeout'`)
- `heartbeat_live_class(uuid)` — teacher-owned SECURITY DEFINER RPC
- `finalize_class_attendance(uuid)` — atomic/idempotent attendance finalization
- `recover_stale_live_classes(uuid DEFAULT NULL)` — service-role-only recovery RPC
- pg_cron job `live-class-watchdog` (`*/5 * * * *` UTC)

**Verify:**
```sql
select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'live-class-watchdog';
-- Expected: 1 row, schedule = '*/5 * * * *', command contains NO URL literal
```

---

## 2. Edge Function Deployment

```bash
supabase functions deploy live-class-watchdog --no-verify-jwt
```

The function is deployed with `verify_jwt = false` (already set in `config.toml`). The cron job invokes it via `net.http_post` without an Authorization header.

**Environment variables:** (auto-injected by Supabase)
- `SUPABASE_URL` — Project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key
- `LIVEKIT_API_KEY` — LiveKit API key (required only for stopping active egress)
- `LIVEKIT_API_SECRET` — LiveKit API secret
- `LIVEKIT_URL` — LiveKit server URL

---

## 3. Vault Secret

Create the Vault secret that tells the cron job the Edge Function URL:

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/live-class-watchdog',
  'live_class_watchdog_url',
  'URL of the live-class-watchdog Edge Function for the current environment'
);
```

**Verify:**
```sql
select name, created_at
from vault.decrypted_secrets
where name = 'live_class_watchdog_url';
```

---

## 4. Cron Validation

### 4.1 Manual run with missing secret (expect failure)

```sql
select cron.run_job((
  select jobid from cron.job where jobname = 'live-class-watchdog'
));
```

Check the result:
```sql
select status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 5;
```

Expected: `status = 'Failed'`, `return_message` contains `LIVE_CLASS_WATCHDOG_URL_MISSING`.

### 4.2 Manual run after creating the secret (expect success)

```sql
select cron.run_job((
  select jobid from cron.job where jobname = 'live-class-watchdog'
));
```

Expected: `status = 'Succeeded'`.

### 4.3 Check Edge Function logs

```bash
supabase functions logs live-class-watchdog --tail 50
```

Expected structured log entries:
- `JOB_STARTED`
- `INSTITUTES_RESOLVED`
- `INSTITUTE_RECOVERED` (per institute)
- `JOB_COMPLETED` (with counts)

---

## 5. Testing

### 5.1 Normal heartbeat

1. Start a live class as a teacher.
2. Confirm `live_sessions.last_teacher_activity_at` updates every ~60 seconds:
   ```sql
   select last_teacher_activity_at, updated_at
   from live_sessions
   where class_id = '<class-uuid>';
   ```

### 5.2 Teacher remains active for 20+ minutes

1. Keep the class live and heartbeating.
2. After 20 minutes, confirm the class is still `status='live'` (heartbeat keeps it alive).

### 5.3 Teacher disappears (stale heartbeat)

1. Start a live class and wait for a heartbeat.
2. Stop the heartbeat (close the tab / disconnect network).
3. Confirm the class remains live for at least 15 minutes.
4. After ~15–20 minutes, confirm:
   ```sql
   select status from live_classes where class_id = '<class-uuid>';
   -- Expected: 'completed'
   select status, ended_reason from live_sessions where class_id = '<class-uuid>';
   -- Expected: 'ended', 'watchdog_timeout'
   ```

### 5.4 Teacher never starts

1. Create a scheduled class (do not start).
2. Wait until `scheduled_at + duration_min + 15 minutes` has passed.
3. After the next watchdog run, confirm:
   ```sql
   select status, cancelled_reason from live_classes where class_id = '<class-uuid>';
   -- Expected: 'cancelled', 'Start window expired (teacher did not start)'
   ```

### 5.5 Teacher manually ends

1. Start a live class.
2. Click "END SESSION & SAVE".
3. Confirm:
   ```sql
   select status, cancelled_reason from live_classes where class_id = '<class-uuid>';
   -- Expected: 'completed' (or check via live_sessions.ended_reason = 'host_ended')
   ```

### 5.6 Manual End vs watchdog race

1. Start a live class.
2. Simultaneously trigger the watchdog and click End.
3. Confirm exactly one transition (`transitioned=true`) — no duplicate attendance.

### 5.7 Watchdog runs twice

1. Trigger the watchdog twice in quick succession.
2. Confirm no duplicate attendance, no duplicate recording stop, no duplicate session.

### 5.8 Recording active during abandonment

1. Start a live class with recording.
2. Simulate teacher abandonment.
3. Confirm the watchdog ends the class and stops the active egress.

### 5.9 Recording already completed

1. Start a live class, start recording, then stop recording.
2. Simulate teacher abandonment.
3. Confirm the watchdog does NOT attempt to stop the already-completed recording.

### 5.10 Browser visibility refocus

1. Start a live class.
2. Switch to another tab, wait 10 seconds, switch back.
3. Confirm a heartbeat is sent immediately on visibility/refocus.

### 5.11 Timetable-generated class

1. Create a timetable slot and materialize it.
2. Confirm the heartbeat/watchdog work identically to a one-off class.

### 5.12 One-off scheduled class

1. Create a one-off scheduled class.
2. Confirm the heartbeat/watchdog work identically.

---

## 6. Expected Logs

### Normal run (no stale classes)
```json
{"level":"info","service":"live-class-watchdog","event":"JOB_STARTED","method":"POST"}
{"level":"info","service":"live-class-watchdog","event":"INSTITUTES_RESOLVED","count":1}
{"level":"info","service":"live-class-watchdog","event":"INSTITUTE_RECOVERED","instituteId":"...","recoveredLiveClasses":0,"expiredScheduledClasses":0,"attendanceFinalized":0}
{"level":"info","service":"live-class-watchdog","event":"JOB_COMPLETED","institutes":1,"recoveredLiveClasses":0,"expiredScheduledClasses":0,"attendanceFinalized":0,"egressStopped":0,"errors":0,"executionTimeMs":42}
```

### Run with stale classes
```json
{"level":"info","service":"live-class-watchdog","event":"JOB_STARTED","method":"POST"}
{"level":"info","service":"live-class-watchdog","event":"INSTITUTES_RESOLVED","count":1}
{"level":"info","service":"live-class-watchdog","event":"INSTITUTE_RECOVERED","instituteId":"...","recoveredLiveClasses":3,"expiredScheduledClasses":1,"attendanceFinalized":3}
{"level":"info","service":"live-class-watchdog","event":"EGRESS_STOPPED","instituteId":"...","recordingId":"...","egressId":"EG_..."}
{"level":"info","service":"live-class-watchdog","event":"JOB_COMPLETED","institutes":1,"recoveredLiveClasses":3,"expiredScheduledClasses":1,"attendanceFinalized":3,"egressStopped":1,"errors":0,"executionTimeMs":312}
```

---

## 7. Rollback

### Disable the cron job only
```sql
select cron.unschedule('live-class-watchdog');
```

### Full rollback (remove the entire feature)
```sql
-- 1. Stop the cron job
select cron.unschedule('live-class-watchdog');

-- 2. Drop functions (in dependency order)
drop function if exists public.recover_stale_live_classes(uuid);
drop function if exists public.finalize_class_attendance(uuid);
drop function if exists public.heartbeat_live_class(uuid);
drop function if exists public.end_live_class(uuid, text);

-- 3. Drop the index and column
drop index if exists ix_live_sessions_live_activity;
alter table public.live_sessions drop column last_teacher_activity_at;
```

**Note:** Extensions (`pg_cron`, `pg_net`, `supabase_vault`) are shared infrastructure and are NOT dropped.

---

## 8. Failure Recovery

| Failure | Mitigation |
|---|---|
| **Cron job misses one run** | Next run (5 min later) recovers all stale classes — staleness threshold is based on `clock_timestamp()`, not last-run time |
| **Edge Function unavailable** | `net.http_post` fails; next cron tick retries |
| **DB temporarily unavailable** | Next tick succeeds; end_live_class atomic claim prevents double-transition |
| **Teacher reconnects while watchdog is processing** | If watchdog claimed → class completed; heartbeat returns ALREADY_ENDED. If not yet claimed → heartbeat refreshes last_teacher_activity_at → no longer stale |
| **Watchdog runs twice concurrently** | Both call end_live_class; exactly one claims, other gets ALREADY_ENDED → no duplicate attendance or egress stop |
| **Egress stop fails** | `recording-timeout` (2h) remains the backstop for stuck recordings |
| **Vault secret missing** | Cron job fails safely with a clear exception; no HTTP request is issued; job logs the error in `cron.job_run_details` |