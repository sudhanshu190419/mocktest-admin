-- ============================================================================
-- Migration: 104 — Environment-Aware Subscription Lifecycle Scheduler (H4)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE (H4 fix)
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 097 hardcoded a single production Edge Function URL inside the
-- cron job command. That makes the same migration schedule a job against
-- whichever project the URL points at — regardless of the environment
-- (local / staging / production) the migration is applied to.
--
-- This migration REPLACES that fixed command with one that resolves the
-- function URL AT RUNTIME from Supabase Vault, so each environment targets
-- its own subscription-lifecycle function:
--
--   pg_cron
--     →  vault.decrypted_secrets  (secret name: "subscription_lifecycle_url")
--     →  net.http_post            (POST, Content-Type: application/json, body {})
--     →  <environment's own Edge Function>
--
-- NO environment-specific value is stored in this migration. The URL lives
-- ONLY in the per-environment Vault secret named "subscription_lifecycle_url".
-- Changing an environment's configuration therefore requires NO new migration.
--
-- FAIL-SAFE: if the secret is missing / NULL / empty when the job fires, the
-- job raises a visible exception and DOES NOT issue any HTTP request. There is
-- NO fallback to any environment's URL — in particular no production fallback.
--
-- Migration 097 is intentionally NOT edited. Replaying 097 then 104 converges
-- to the environment-aware job. Re-running 104 always converges to exactly one
-- cron.job row.
--
-- SECURITY: only the secret NAME is referenced here. No service-role key, JWT,
-- Razorpay secret, Authorization token, or secret VALUE is ever stored, logged,
-- or printed by this migration. See SECTION 4 for validation queries.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VAULT ACCESS (least privilege)
-- ════════════════════════════════════════════════════════════════════════════
-- No GRANT is added by this migration:
--   • The cron job runs as the role that scheduled it. Migrations applied via
--     `supabase db push` / `supabase migration up` run as the `postgres` role,
--     so the job executes as `postgres`.
--   • The `vault.decrypted_secrets` view is restricted to administrative roles
--     (`postgres` / `supabase_admin`) by default. `anon` and `authenticated`
--     have NO access.
--   • Therefore `postgres` (the cron execution role) can already read the
--     secret, and no permission broadening is required.
-- Reference: the official Supabase Vault documentation. Vault is provided by the
-- `supabase_vault` extension, which is platform-provisioned on every Supabase
-- project and installs its objects in the `vault` schema. This migration therefore
-- does NOT create or recreate the Vault extension (see SECTION 1).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Required extensions (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron  — provides cron.schedule / cron.unschedule / cron.job.
-- pg_net   — provides net.http_post (async HTTP from SQL).
--
-- VAULT: NOT created here. The `vault` objects (vault.decrypted_secrets,
-- vault.secrets, vault.create_secret) are provided by the `supabase_vault`
-- extension, which is platform-provisioned on every Supabase project and
-- installed in the `vault` schema. "vault" is the SCHEMA name, not the
-- extension name — issuing a CREATE EXTENSION targeting the vault schema would
-- be wrong here, and `supabase_vault` is intentionally not recreated (it is
-- already provisioned and managed by the platform).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Create / replace the scheduled job (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Unschedule-then-schedule pattern (same as 097): cron.schedule() raises if the
-- jobname already exists, so the job is removed first when present. Re-running
-- this migration therefore always converges to exactly ONE job row.
--
-- The job command resolves the environment URL at execution time from the
-- Vault secret "subscription_lifecycle_url" and fails safely when missing.
-- NOTE: the outer DO block uses a distinct dollar-quote tag ($migration$) so
-- it does not collide with the $cmd$ cron command (which itself contains an
-- inner do $$ block). Nested dollar-quoting requires a unique tag per level.
do $migration$
begin
  -- Replace any pre-existing job under the same name (created by migration 097
  -- or by a prior run of this migration).
  if exists (select 1 from cron.job where jobname = 'subscription-lifecycle-daily') then
    perform cron.unschedule('subscription-lifecycle-daily');
  end if;

  perform cron.schedule(
    'subscription-lifecycle-daily',
    '0 0 * * *',   -- daily at 00:00 UTC (unchanged from 097)
    $cmd$
      do $$
      declare
        v_lifecycle_url text;
      begin
        -- Resolve this environment's function URL at execution time.
        select decrypted_secret
          into v_lifecycle_url
          from vault.decrypted_secrets
         where name = 'subscription_lifecycle_url'
         limit 1;

        -- FAIL-SAFE: never issue an HTTP request when the configuration is
        -- missing. The exception aborts this run BEFORE net.http_post, so no
        -- URL is ever called. The error is recorded in cron.job_run_details.
        if v_lifecycle_url is null or v_lifecycle_url = '' then
          raise exception
            'SUBSCRIPTION_LIFECYCLE_URL_MISSING: Vault secret "subscription_lifecycle_url" '
            'is not configured for this environment. Lifecycle run skipped (fail-safe) - '
            'no HTTP request was issued.';
        end if;

        -- Same request contract as migration 097: POST, Content-Type
        -- application/json, empty body, 30s timeout.
        perform net.http_post(
          url                 := v_lifecycle_url,
          headers             := '{"Content-Type": "application/json"}'::jsonb,
          body                := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      end
      $$;
    $cmd$
  );

  -- Deploy-time visibility (warning only, never an error): if the secret is not
  -- configured yet, the job is still registered but will fail safely at runtime
  -- until the secret is created for this environment. Only the secret NAME is
  -- mentioned — never its value.
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'subscription_lifecycle_url'
  ) then
    raise warning
      'SUBSCRIPTION_LIFECYCLE_URL_MISSING: Vault secret "subscription_lifecycle_url" is '
      'not configured yet. The cron job is registered but will fail safely at runtime '
      'until the secret is created for this environment (Dashboard -> Vault, or '
      'vault.create_secret).';
  else
    raise notice
      'SUBSCRIPTION_LIFECYCLE_SCHEDULED job=subscription-lifecycle-daily '
      'schedule=0 0 * * * registered successfully (environment-aware)';
  end if;
end
$migration$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Stop the scheduled job (keeps the function, extensions, and all business
-- logic deployed — only the automatic scheduling is removed):
--
--   select cron.unschedule('subscription-lifecycle-daily');
--
-- (pg_cron / pg_net extensions, and the platform-provisioned supabase_vault
-- extension that provides the `vault` schema, are intentionally NOT dropped:
-- they are shared platform infrastructure and other objects may depend on them.)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Validation queries (run manually after deploy)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Exactly one job exists, with the unchanged contract:
--      select jobid, jobname, schedule, active, database, username, command
--      from cron.job
--      where jobname = 'subscription-lifecycle-daily';
--    Expected: exactly 1 row; schedule = '0 0 * * *'; username = the role the
--    migration ran as (postgres); command contains NO URL literal (it resolves
--    the secret at runtime instead).
--
-- 2. Extensions are enabled (note: Vault's extension name is `supabase_vault`,
--    not `vault`; `vault` is the schema it installs into):
--      select extname, extversion
--      from pg_extension
--      where extname in ('pg_cron', 'pg_net', 'supabase_vault')
--      order by extname;
--
-- 3. The secret exists for THIS environment (selects the NAME only — the
--    decrypted value is NOT displayed here):
--      select name, created_at
--      from vault.decrypted_secrets
--      where name = 'subscription_lifecycle_url';
--
-- 4. Manual run to prove the fail-safe (run while the secret is missing —
--    expects a SUBSCRIPTION_LIFECYCLE_URL_MISSING exception and NO HTTP call):
--      select cron.run_job((select jobid from cron.job
--                            where jobname = 'subscription-lifecycle-daily'));
--    After creating the secret, re-run and expect status 'Succeeded' in:
--      select status, return_message, start_time, end_time
--      from cron.job_run_details
--      order by start_time desc
--      limit 5;
--
-- 5. HTTP outcome after a successful run (status 200 expected):
--      select status, status_code, content, timed_out
--      from net._http_response
--      order by id desc
--      limit 5;
--
-- 6. No duplicate job rows after any re-run:
--      select jobname, count(*)
--      from cron.job
--      where jobname = 'subscription-lifecycle-daily'
--      group by jobname;
--
-- END OF MIGRATION 104
-- ============================================================================
