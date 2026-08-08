# Subscription Lifecycle Scheduler — Deployment Guide

**Phase:** 11K.9 (deployment/infrastructure only)
**Edge Function:** `subscription-lifecycle`
**Schedule:** daily at 00:00 UTC (`0 0 * * *`)
**Mechanism:** `pg_cron` → `net.http_post` → Edge Function (repository-managed, no dashboard setup)

---

## 1. What this automates

The `subscription-lifecycle` Edge Function advances `student_subscriptions` through
the approved Phase 11B state machine **and** dispatches lifecycle notifications:

| Job responsibility | Details |
|---|---|
| **ACTIVE → GRACE** | `status='active'` + `end_date < today` + `grace_end_date` valid → `status='grace'`, inserts an unresolved `subscription_grace_periods` row |
| **GRACE → EXPIRED** | `status='grace'` + `grace_end_date < today` → `status='expired'`, resolves the grace row as `expired_no_payment` |
| **Notifications** | N1 expiry reminders (7/3/1 days), N2 grace started, N3 grace ending (1 day), N4 expired, N5 content-window ending, N6 content-window expired |
| **Safety** | Idempotent (conditional UPDATE claims), retry-safe, overlapping-run safe, missed runs self-heal (date-relative), batch-limited (500) |

**Important:** even without this scheduler, students **lose access on expiry** because the
RLS entitlement helpers (`can_student_access_live_course` / `can_student_access_content`)
evaluate status **+ date boundaries in real time**. The scheduler is what keeps the
`status` column accurate and sends the notifications.

---

## 2. Architecture

```
pg_cron (cron.job)
   │  '0 0 * * *'  (00:00 UTC)
   ▼
net.http_post(url := <function-url>, body := '{}')        [pg_net extension]
   │  POST, no Authorization header (verify_jwt = false)
   ▼
https://<project-ref>.supabase.co/functions/v1/subscription-lifecycle
   │  service-role client (SUPABASE_SERVICE_ROLE_KEY, auto-injected)
   ▼
student_subscriptions / subscription_grace_periods / notifications
```

### Files in this phase

| File | Change |
|---|---|
| `supabase/migrations/097_schedule_subscription_lifecycle.sql` | **NEW** — enables `pg_cron` + `pg_net`, creates/replaces the `subscription-lifecycle-daily` job (idempotent), validation queries, rollback |
| `supabase/config.toml` | **EDITED** — `[functions.subscription-lifecycle] verify_jwt = false` (required: the cron POSTs without a JWT) |
| `supabase/functions/subscription-lifecycle/index.ts` | **UNCHANGED** — business logic is untouched by design |

---

## 3. Per-environment setup

The migration is **environment-agnostic**. The only environment-specific value is the
function URL, resolved from the Postgres configuration parameter
`app.settings.subscription_lifecycle_url`:

| Environment | URL value | Configuration needed? |
|---|---|---|
| **Local** (`supabase start`) | `http://127.0.0.1:54321/functions/v1/subscription-lifecycle` | **None** — migration falls back to this automatically |
| **Staging** | `https://<staging-ref>.supabase.co/functions/v1/subscription-lifecycle` | One `ALTER DATABASE` command |
| **Production** | `https://ocolfottogbybitfpdqy.supabase.co/functions/v1/subscription-lifecycle` (current linked project) | One `ALTER DATABASE` command |

Set the parameter **once per hosted database** (via the Supabase SQL editor or `psql`):

```sql
alter database postgres
  set app.settings.subscription_lifecycle_url =
    'https://<project-ref>.supabase.co/functions/v1/subscription-lifecycle';
```

> The migration emits a `WARNING` at deploy time if the parameter is unset, so a
> forgotten hosted configuration is visible immediately. Until set, the job posts to
> the local fallback and fails harmlessly (no transitions / notifications) — access
> control is unaffected.

---

## 4. Deploy steps (in order)

1. **Deploy the Edge Function** (unchanged code, but ensure it is live):
   ```bash
   supabase functions deploy subscription-lifecycle
   ```
2. **Deploy the configuration** (pushes `config.toml` `verify_jwt` flags):
   ```bash
   supabase functions deploy subscription-lifecycle --no-verify-jwt
   # or, after a normal deploy, confirm the flag below
   ```
   Alternatively confirm in the dashboard (Edge Functions → subscription-lifecycle)
   that **"Enforce JWT" is OFF**.
3. **Apply the migration** (enables extensions + creates the cron job):
   ```bash
   supabase db push
   # or, for a single migration: supabase migration up --linked
   ```
4. **Set the function URL** in the target hosted database (see §3).
5. **Verify** (§5).

---

## 5. Health-check procedure

### a) Job is registered and active
```sql
select jobid, jobname, schedule, active, database, command
from cron.job
where jobname = 'subscription-lifecycle-daily';
```
Expect exactly **one** row, `active = t`, `schedule = '0 0 * * *'`.

### b) Extensions are enabled
```sql
select extname, extversion from pg_extension
where extname in ('pg_cron', 'pg_net') order by extname;
```

### c) Resolved URL is correct (hosted environments)
```sql
select current_setting('app.settings.subscription_lifecycle_url', true) as lifecycle_url;
```
Must **not** be the `127.0.0.1` fallback in staging/production.

### d) Manual run (does not wait for midnight)
```bash
# POST (cron-style) or GET (same code path — both are allowed)
curl -X POST "https://<project-ref>.supabase.co/functions/v1/subscription-lifecycle" \
  -H "Content-Type: application/json" -d '{}'
```
The response is a JSON summary, e.g.:
```json
{ "processed": 0, "active_to_grace": 0, "grace_to_expired": 0,
  "skipped": 0, "failed": 0, "notifications_sent": 0,
  "notifications_skipped": 0, "notifications_failed": 0, "execution_time": 123 }
```
A manual run is **safe to execute at any time** — date-gated transitions + idempotent
notifications mean it cannot advance anything early or send duplicates.

### e) Recent scheduled invocations
```sql
select status, status_code, content, timed_out
from net._http_response
order by id desc
limit 5;
```
Expect `status = 'SUCCESS'`, `status_code = 200`. An **empty result is normal until the
first scheduled run** (or until a manual POST in §d). `timed_out = true` means the run
started but did not complete in the HTTP timeout (30s) — the next cycle self-heals.

### f) No duplicate job rows (after any re-run of the migration)
```sql
select jobname, count(*) from cron.job
where jobname = 'subscription-lifecycle-daily' group by jobname;
```
Expect `count = 1` — the migration always unschedules before scheduling.

---

## 6. Safety & idempotency guarantees (re-confirmed)

| Scenario | Behaviour |
|---|---|
| Cron fires twice / overlapping runs | Safe — conditional `UPDATE … WHERE status='active'/'grace'` atomically claims each row; the second run finds nothing to do |
| Migration re-run | Safe — job is unscheduled (if present) then recreated; exactly one `cron.job` row |
| Missed execution (outage) | Self-heals — logic is date-relative; the next run catches up (batch-limited) |
| Manual unauthenticated POST | Safe — cannot force early transitions (date-gated) and cannot duplicate notifications (reference-idempotent). Residual risk is bounded spurious runs / notification dispatch (public DoS surface). Future hardening (outside this phase): add a shared-secret header check inside the function if the endpoint must not be publicly triggerable |
| Notification double-send | Impossible — reference-based idempotency guards every lifecycle notification |
| Duplicate grace records | Impossible — the grace-row insert happens only after the atomic status claim succeeds |
| `verify_jwt = true` accident | Job silently fails with 401 — symptom: `status_code = 401` in `net._http_response` |

---

## 7. Rollback

Stop the scheduled job (keeps the function, extensions, and all business logic):

```sql
select cron.unschedule('subscription-lifecycle-daily');
```

Optional cleanup:
```sql
alter database postgres reset app.settings.subscription_lifecycle_url;
```

`pg_cron` / `pg_net` extensions are intentionally **not** dropped (shared platform
infrastructure). After rollback the system returns to the previous state: status stays
static until a manual run, notifications stop, and real-time access control continues to
enforce expiry via the date-driven RLS helpers.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cron.job` row missing after deploy | Migration not applied | `supabase db push`; re-run migration |
| Job present but never runs | Hosted plan/DB restrictions on `pg_cron` | Enable the extension via Dashboard → Database → Extensions, then re-apply migration |
| `status_code = 401` in `net._http_response` | `verify_jwt` still on | Deploy with `--no-verify-jwt` / turn off "Enforce JWT" |
| `status_code = 404` | Wrong URL (e.g., local fallback on hosted) | Set `app.settings.subscription_lifecycle_url` (§3) |
| WARNING at migration time | GUC not set for hosted env | Run the `ALTER DATABASE … SET` command |
| Slow catch-up after long outage | `BATCH_LIMIT = 500` per run | Safe to switch to twice-daily (`0 0,12 * * *`) — still idempotent |

---

## 9. Notes / out of scope

- `recording-timeout` remains dashboard-managed (historical precedent). The same
  pg_cron + pg_net pattern can be applied to it later if repository-managed scheduling
  for that job is desired.
- No Edge Function, helper, RLS, payment, renewal, conversion, LiveKit, or recording
  code was modified in this phase.
