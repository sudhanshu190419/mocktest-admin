-- ============================================================================
-- Migration: 097 — Subscription Lifecycle Scheduler Deployment (Phase 11K.9)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 11K.9 — deployment/infrastructure ONLY. This phase makes the existing
-- subscription-lifecycle Edge Function (Phase 11B.1/11B.2, approved and
-- unchanged) run automatically on a schedule WITHOUT manual Supabase-dashboard
-- cron setup.
--
-- The scheduler is now repository-managed:
--   pg_cron  →  net.http_post  →  POST /functions/v1/subscription-lifecycle
--
-- NO business logic is modified:
--   • subscription lifecycle state machine  — untouched
--   • entitlement helpers / RLS              — untouched
--   • payment / renewal / conversion flow    — untouched
--   • LiveKit / recordings                   — untouched
--
-- IMPORTANT (infrastructure-only): this migration NEVER invokes the Edge
-- Function itself. It only registers the cron job. The first actual
-- invocation happens at the first scheduled run (00:00 UTC); operators can
-- manually verify executions afterwards via net._http_response (see
-- SECTION 3).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULE
-- ════════════════════════════════════════════════════════════════════════════
--   '0 0 * * *'   → daily at 00:00 UTC (matches the approved header comment
--                   inside subscription-lifecycle/index.ts).
--
-- The function is date-relative and idempotent:
--   • Every transition is an atomic conditional UPDATE
--     (WHERE status = 'active' / 'grace'), so overlapping or missed runs
--     cannot double-apply — a retry simply finds nothing left to do.
--   • Notifications are reference-idempotent — a retried run cannot
--     double-send.
--   • A missed execution self-heals on the next run (date-relative).
--   • Large backlogs drain across runs via BATCH_LIMIT (500), never in a
--     single unbounded invocation.
--   → A twice-daily schedule ('0 0,12 * * *') is equally safe if faster
--     catch-up is ever wanted. Daily is the default.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FUNCTION URL (production, fixed)
-- ════════════════════════════════════════════════════════════════════════════
-- The cron command posts to the production Edge Function URL directly:
--
--     https://ocolfottogbybitfpdqy.supabase.co/functions/v1/subscription-lifecycle
--
-- No database configuration parameter is used for URL resolution: hosted
-- Supabase does not allow per-database SET configuration, so the production
-- URL is hardcoded here and kept in sync with the project ref documented in
-- the deployment guide (Documentation/Subscription_Lifecycle_Scheduler_
-- Deployment.md). The job command is fully schema-qualified (net.http_post)
-- so it executes correctly under pg_cron's restricted search_path.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY pg_cron + pg_net (and not config.toml)
-- ════════════════════════════════════════════════════════════════════════════
-- The Supabase CLI config.toml has NO native [cron] / functions.schedule
-- support. The supported repository-managed mechanism is a SQL migration that
-- enables pg_cron + pg_net and creates a cron.job entry whose command POSTs
-- to the Edge Function. verify_jwt = false is configured for the function in
-- config.toml so the unauthenticated cron invocation is accepted (the job
-- command sends no Authorization header).
--
-- Reference: https://supabase.com/docs/guides/cron (scheduled edge functions)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Enable required extensions (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron  — provides cron.schedule / cron.unschedule / cron.job.
-- pg_net   — provides net.http_post (async HTTP from SQL).
-- Both are in the Supabase extension allowlist and are already installed on
-- this project through the Cron integration. IF NOT EXISTS keeps this
-- migration a no-op on projects where they are already enabled.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Create / replace the scheduled job (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Unschedule-then-schedule pattern: cron.schedule() raises if the jobname
-- already exists, so the job is removed first when present. Re-running this
-- migration therefore always converges to exactly ONE job row.
--
-- The job is registered but NOT executed here — the Edge Function is first
-- invoked by the scheduler at 00:00 UTC.
do $$
begin
  -- Replace any pre-existing job under the same name (dashboard-managed or
  -- from an earlier deploy). This makes the migration converge to exactly
  -- one row in cron.job.
  if exists (select 1 from cron.job where jobname = 'subscription-lifecycle-daily') then
    perform cron.unschedule('subscription-lifecycle-daily');
  end if;

  perform cron.schedule(
    'subscription-lifecycle-daily',
    '0 0 * * *',   -- daily at 00:00 UTC
    $cmd$
      select net.http_post(
        url := 'https://ocolfottogbybitfpdqy.supabase.co/functions/v1/subscription-lifecycle',
        headers             := '{"Content-Type": "application/json"}'::jsonb,
        body                := '{}'::jsonb,
        timeout_milliseconds := 30000   -- 30s: a full BATCH_LIMIT run + Deno
                                        -- cold start can exceed pg_net's 5s
                                        -- default; a timed-out run would
                                        -- silently skip that day's cycle
      );
    $cmd$
  );

  raise notice
    'SUBSCRIPTION_LIFECYCLE_SCHEDULED job=subscription-lifecycle-daily '
    'schedule=0 0 * * * '
    'url=https://ocolfottogbybitfpdqy.supabase.co/functions/v1/subscription-lifecycle '
    'registered successfully';
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Validation queries (run manually after deploy)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. The job exists, is active, and has the expected schedule:
--      select jobid, jobname, schedule, active, database, command
--      from cron.job
--      where jobname = 'subscription-lifecycle-daily';
--
-- 2. Extensions are enabled:
--      select extname, extversion
--      from pg_extension
--      where extname in ('pg_cron', 'pg_net')
--      order by extname;
--
-- 3. The job command targets the production URL (must show
--    https://ocolfottogbybitfpdqy.supabase.co/functions/v1/subscription-lifecycle):
--      select command
--      from cron.job
--      where jobname = 'subscription-lifecycle-daily';
--
-- 4. Most recent invocations (status 200 expected; watch for timeouts). Run
--    AFTER the first scheduled execution (or after a manual health-check
--    POST) to confirm the function responds:
--      select status, status_code, content, timed_out
--      from net._http_response
--      order by id desc
--      limit 5;
--
-- 5. No duplicate job rows after any re-run:
--      select jobname, count(*)
--      from cron.job
--      where jobname = 'subscription-lifecycle-daily'
--      group by jobname;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Stop the scheduled job. The Edge Function, extensions, and all business
-- logic remain deployed — only the automatic scheduling is removed:
--
--   select cron.unschedule('subscription-lifecycle-daily');
--
-- (pg_cron / pg_net extensions are intentionally NOT dropped: they are shared
-- platform infrastructure and other jobs may depend on them.)
--
-- After rollback, transitions/no-notifications return to the previous state:
-- the status column stays static until a manual POST/GET run, while real-time
-- access control remains enforced by the date-driven RLS entitlement helpers.
--
-- END OF MIGRATION 097
-- ============================================================================
