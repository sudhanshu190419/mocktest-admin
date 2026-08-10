# Subscription Lifecycle Scheduler — Deployment Guide

**Phase:** 11K.9 (deployment/infrastructure only) · **H4 fix:** environment-aware cron
**Edge Function:** `subscription-lifecycle`
**Schedule:** daily at 00:00 UTC (`0 0 * * *`)
**Mechanism:** `pg_cron` → `net.http_post` → Edge Function, with the function URL resolved at runtime from **Supabase Vault**

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
DO block (fail-safe guard)
   │  resolves URL at runtime:
   │    vault.decrypted_secrets → name = 'subscription_lifecycle_url'
   │  if missing/NULL/empty → raise exception, NO HTTP request
   ▼
net.http_post(url := <resolved URL>, body := '{}')        [pg_net extension]
   │  POST, no Authorization header (verify_jwt = false)
   ▼
<ENVIRONMENT_SUPABASE_URL>/functions/v1/subscription-lifecycle
   │  service-role client (SUPABASE_SERVICE_ROLE_KEY, auto-injected)
   ▼
student_subscriptions / subscription_grace_periods / notifications
```

**H4 change:** migration **097** originally hardcoded a single production Edge Function
URL inside the cron command. Migration **104** replaces that command with one that reads
the URL from Supabase Vault **at execution time**, so each environment calls its own
function. Migration **097 must NOT be edited** — 104 is the migration that replaces the
old cron job.

### Files in this phase

| File | Change |
|---|---|
| `supabase/migrations/097_schedule_subscription_lifecycle.sql` | **UNCHANGED (do not edit)** — original scheduler; its hardcoded URL is superseded by 104 |
| `supabase/migrations/104_make_subscription_lifecycle_cron_environment_aware.sql` | **NEW** — replaces the cron job with runtime Vault URL resolution; enables `pg_cron` + `pg_net` + `vault`; fail-safe when the secret is missing |
| `supabase/config.toml` | **UNCHANGED** — `[functions.subscription-lifecycle] verify_jwt = false` (required: the cron POSTs without a JWT) |
| `supabase/functions/subscription-lifecycle/index.ts` | **UNCHANGED** — business logic is untouched by design |

---

## 3. Per-environment configuration (Supabase Vault)

The migration is **environment-agnostic**. The **only** environment-specific value is the
function URL, stored as a Vault secret named **`subscription_lifecycle_url`**:

| Environment | Secret value to configure | How |
|---|---|---|
| **Local** (`supabase start`) | `http://127.0.0.1:54321/functions/v1/subscription-lifecycle` | `vault.create_secret(...)` in the local DB (optional; without it the job fails safely) |
| **Staging** | `<STAGING_SUPABASE_URL>/functions/v1/subscription-lifecycle` | Dashboard → Vault, or `vault.create_secret(...)` |
| **Production** | `<PRODUCTION_SUPABASE_URL>/functions/v1/subscription-lifecycle` | Dashboard → Vault, or `vault.create_secret(...)` |

**Every environment configures its own URL. Never copy production's secret into
staging or local — and never copy a staging/local value into production.**

Create the secret **once per environment** (Dashboard → Vault → Add new secret, or SQL):

```sql
select vault.create_secret(
  '<ENVIRONMENT_SUPABASE_URL>/functions/v1/subscription-lifecycle',
  'subscription_lifecycle_url',
  'Subscription lifecycle Edge Function URL for this environment'
);
```

> **Missing secret = safe failure.** If `subscription_lifecycle_url` does not exist,
> is NULL, or is empty when the cron job fires, the job raises a visible
> `SUBSCRIPTION_LIFECYCLE_URL_MISSING` exception **and makes no HTTP request**. There is
> **no fallback to any environment's URL** — in particular, no production fallback.
> Access control is unaffected (RLS is real-time). The migration itself emits a
> `WARNING` at deploy time if the secret is not yet configured, so a forgotten
> configuration is visible immediately.

**Vault access (least privilege):** no grant is required. The cron job executes as the
role that scheduled it (`postgres`, since migrations run as `postgres`), and
`vault.decrypted_secrets` is restricted to administrative roles by default — `anon` and
`authenticated` have no access. Nothing is broadened.

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
3. **Apply the migrations** (097 is already applied in existing environments; 104
   replaces the old cron job):
   ```bash
   supabase db push
   # or, for a single migration: supabase migration up --linked
   ```
4. **Configure the Vault secret** in the target database (see §3). Do this in **each**
   environment with that environment's own URL.
5. **Verify** (§5).

> Ordering note: if 104 is applied before the secret exists, the job is still
> registered and fails safely until the secret is created — no cleanup or re-run
> needed afterwards.

---

## 5. Health-check procedure

### a) Job is registered and active
```sql
select jobid, jobname, schedule, active, database, username, command
from cron.job
where jobname = 'subscription-lifecycle-daily';
```
Expect exactly **one** row, `active = t`, `schedule = '0 0 * * *'`, and a `command`
that contains **no URL literal** (it resolves the secret at runtime).

### b) Extensions are enabled
```sql
select extname, extversion from pg_extension
where extname in ('pg_cron', 'pg_net', 'vault') order by extname;
```

### c) Secret exists for this environment (NAME only — no decrypted value shown)
```sql
select name, created_at
from vault.decrypted_secrets
where name = 'subscription_lifecycle_url';
```
Must return exactly one row in **every** environment, with that environment's own value.

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

### g) Fail-safe proof (optional, while the secret is missing in a scratch DB)
```sql
select cron.run_job((select jobid from cron.job
                      where jobname = 'subscription-lifecycle-daily'));
```
Expect a `SUBSCRIPTION_LIFECYCLE_URL_MISSING` exception and **no** HTTP call.

---

## 6. Safety & idempotency guarantees (re-confirmed)

| Scenario | Behaviour |
|---|---|
| Cron fires twice / overlapping runs | Safe — conditional `UPDATE … WHERE status='active'/'grace'` atomically claims each row; the second run finds nothing to do |
| Migration 104 re-run | Safe — job is unscheduled (if present) then recreated; exactly one `cron.job` row |
| 097 already applied | 104 unschedules the hardcoded job and replaces it with the environment-aware one |
| 097 never applied | 104 still works — it enables the extensions and creates the job itself |
| Missed execution (outage) | Self-heals — logic is date-relative; the next run catches up (batch-limited) |
| **Vault secret missing/NULL/empty** | **Job raises `SUBSCRIPTION_LIFECYCLE_URL_MISSING`; no HTTP request; no fallback; no cross-environment call** |
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

Optional cleanup of the per-environment secret (Dashboard → Vault, or `vault.delete_secret`):

```sql
select vault.delete_secret(id)
from vault.decrypted_secrets
where name = 'subscription_lifecycle_url';
```

`pg_cron` / `pg_net` / `vault` extensions are intentionally **not** dropped (shared
platform infrastructure). After rollback the system returns to the previous state: status
stays static until a manual run, notifications stop, and real-time access control
continues to enforce expiry via the date-driven RLS helpers.

> Rollback of the H4 fix alone: if you need the **old hardcoded** behaviour back, you
> would re-apply migration 097's scheduling logic — but that reintroduces the H4 issue.
> Prefer keeping 104 and simply updating the Vault secret instead.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cron.job` row missing after deploy | Migration not applied | `supabase db push`; re-run migration 104 |
| Job present but never runs | Hosted plan/DB restrictions on `pg_cron` | Enable the extension via Dashboard → Database → Extensions, then re-apply migration 104 |
| `status_code = 401` in `net._http_response` | `verify_jwt` still on | Deploy with `--no-verify-jwt` / turn off "Enforce JWT" |
| `SUBSCRIPTION_LIFECYCLE_URL_MISSING` in `cron.job_run_details` | Vault secret missing for this environment | Create `subscription_lifecycle_url` with that environment's URL (§3) |
| WARNING at migration time | Secret not configured yet | Create the secret (§3); no need to re-run the migration |
| Job calls the wrong environment's function | Wrong URL in this environment's secret | Update the secret in Dashboard → Vault to this environment's URL |
| Slow catch-up after long outage | `BATCH_LIMIT = 500` per run | Safe to switch to twice-daily (`0 0,12 * * *`) — still idempotent |

---

## 9. Notes / out of scope

- `recording-timeout` remains dashboard-managed (historical precedent). The same
  pg_cron + pg_net + Vault pattern can be applied to it later if repository-managed
  scheduling for that job is desired.
- No Edge Function, helper, RLS, payment, renewal, conversion, LiveKit, recording,
  H2, or notification business-logic code was modified for H4. Migration 103
  (`transition_subscription_to_grace()`) and the lifecycle Edge Function remain
  untouched — the only change is **how pg_cron reaches the function**.
- The `subscription_lifecycle_url` secret contains the **URL only**. Never store
  service-role keys, JWT secrets, Razorpay secrets, or Authorization tokens in it —
  and never in any migration.
