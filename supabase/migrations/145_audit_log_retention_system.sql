-- ============================================================================
-- Migration: 145 - Audit Log Retention & Automatic Purge System
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Features:
--   1. Updates `public.trgfn_audit_logs_prevent_delete()` to permit deletion
--      ONLY when executing within the authorized purge procedure
--      (`current_setting('audit.in_purge_job', true) = 'true'`). Normal client
--      DELETE operations remain strictly blocked by immutability enforcement.
--
--   2. Creates `public.purge_expired_audit_logs(p_dry_run boolean DEFAULT false)`
--      - SECURITY DEFINER, advisory-locked to prevent concurrent runs.
--      - Enforces minimum retention floor of 90 days.
--      - Purges ephemeral auth sessions (login/logout) older than 90 days.
--      - Purges routine operational CRUD older than 180 days.
--      - PERMANENTLY PRESERVES all critical security/forensic/academic actions:
--        'grant', 'revoke', 'suspend', 'reactivate', 'permanent_delete',
--        'result_released', 'result_unreleased', 'subjective_evaluation_saved',
--        'subjective_evaluation_finalized', 'approve', 'reject',
--        'device_approve', 'device_revoke', 'reset_password', 'failed_login'.
--      - Per-institute tenant scoping with automatic fallback to 90 days.
--      - Records every purge run into `public.audit_logs` (performed_at = now()).
--
--   3. Registers pg_cron job `audit-log-retention-weekly`
--      - Runs every Sunday at 03:00 UTC (`0 3 * * 0`).
-- ============================================================================

-- ── SECTION 1: Update Immutability Delete Trigger Function ──────────────────

CREATE OR REPLACE FUNCTION public.trgfn_audit_logs_prevent_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow DELETE only when explicitly executing inside the authorized purge procedure
  IF current_setting('audit.in_purge_job', true) = 'true' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'audit_logs rows are immutable — DELETE is not permitted. Use the automated retention purge job instead.';
END;
$$;

COMMENT ON FUNCTION public.trgfn_audit_logs_prevent_delete IS
  'Enforces audit log immutability by blocking all manual and client DELETE operations. '
  'Allows deletions only within the authorized system purge procedure via session context.';


-- ── SECTION 2: Automated Retention Purge Procedure ──────────────────────────

CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs(
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_acquired boolean;
  v_inst record;
  v_custom_retention_days text;
  v_auth_retention_days integer;
  v_routine_retention_days integer;
  v_cutoff_auth timestamptz;
  v_cutoff_routine timestamptz;
  v_deleted_inst_count integer := 0;
  v_total_deleted integer := 0;
  v_total_auth_deleted integer := 0;
  v_total_routine_deleted integer := 0;
  v_inst_auth_deleted integer := 0;
  v_inst_routine_deleted integer := 0;
  v_report jsonb := '[]'::jsonb;
  v_now timestamptz := now();
BEGIN
  -- 1. Prevent concurrent purge executions using transaction advisory lock
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('audit_log_purge_job'));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'Another audit log retention purge job is currently running.'
    );
  END IF;

  -- 2. Set transaction-local session parameter to authorize deletion trigger
  PERFORM set_config('audit.in_purge_job', 'true', true);

  -- 3. Iterate over all institutes present in the system
  FOR v_inst IN
    SELECT DISTINCT institute_id
    FROM public.institutes
    UNION
    SELECT DISTINCT institute_id
    FROM public.audit_logs
    WHERE institute_id IS NOT NULL
  LOOP
    -- Read institute-specific retention setting if configured
    SELECT setting_value
      INTO v_custom_retention_days
      FROM public.system_settings
     WHERE institute_id = v_inst.institute_id
       AND setting_key = 'audit_log_retention_days'
       AND is_active = true
     LIMIT 1;

    -- Enforce absolute retention floor of 90 days for auth and 180 days for routine CRUD
    IF v_custom_retention_days IS NOT NULL AND v_custom_retention_days ~ '^\d+$' THEN
      v_auth_retention_days := GREATEST(v_custom_retention_days::integer, 90);
    ELSE
      v_auth_retention_days := 90;
    END IF;

    v_routine_retention_days := GREATEST(v_auth_retention_days * 2, 180);

    v_cutoff_auth := v_now - (v_auth_retention_days || ' days')::interval;
    v_cutoff_routine := v_now - (v_routine_retention_days || ' days')::interval;

    v_inst_auth_deleted := 0;
    v_inst_routine_deleted := 0;

    -- Count / Delete eligible ephemeral auth logs (login, logout)
    IF p_dry_run THEN
      SELECT COUNT(*)
        INTO v_inst_auth_deleted
        FROM public.audit_logs
       WHERE institute_id = v_inst.institute_id
         AND action IN ('login'::public.audit_action_type, 'logout'::public.audit_action_type)
         AND performed_at < v_cutoff_auth;
    ELSE
      WITH deleted AS (
        DELETE FROM public.audit_logs
         WHERE institute_id = v_inst.institute_id
           AND action IN ('login'::public.audit_action_type, 'logout'::public.audit_action_type)
           AND performed_at < v_cutoff_auth
        RETURNING log_id
      )
      SELECT COUNT(*) INTO v_inst_auth_deleted FROM deleted;
    END IF;

    -- Count / Delete eligible routine CRUD logs
    IF p_dry_run THEN
      SELECT COUNT(*)
        INTO v_inst_routine_deleted
        FROM public.audit_logs
       WHERE institute_id = v_inst.institute_id
         AND action IN (
           'create'::public.audit_action_type,
           'update'::public.audit_action_type,
           'assign'::public.audit_action_type,
           'unassign'::public.audit_action_type,
           'archive'::public.audit_action_type,
           'submit'::public.audit_action_type
         )
         AND resource_type != 'audit_logs'
         AND performed_at < v_cutoff_routine;
    ELSE
      WITH deleted AS (
        DELETE FROM public.audit_logs
         WHERE institute_id = v_inst.institute_id
           AND action IN (
             'create'::public.audit_action_type,
             'update'::public.audit_action_type,
             'assign'::public.audit_action_type,
             'unassign'::public.audit_action_type,
             'archive'::public.audit_action_type,
             'submit'::public.audit_action_type
           )
           AND resource_type != 'audit_logs'
           AND performed_at < v_cutoff_routine
        RETURNING log_id
      )
      SELECT COUNT(*) INTO v_inst_routine_deleted FROM deleted;
    END IF;

    v_deleted_inst_count := v_inst_auth_deleted + v_inst_routine_deleted;
    v_total_auth_deleted := v_total_auth_deleted + v_inst_auth_deleted;
    v_total_routine_deleted := v_total_routine_deleted + v_inst_routine_deleted;
    v_total_deleted := v_total_deleted + v_deleted_inst_count;

    -- Record audit log entry for this institute purge execution
    IF NOT p_dry_run AND v_deleted_inst_count > 0 THEN
      INSERT INTO public.audit_logs (
        institute_id,
        profile_id,
        actor_role,
        action,
        resource_type,
        resource_id,
        metadata,
        outcome,
        reason,
        performed_at
      ) VALUES (
        v_inst.institute_id,
        NULL,
        NULL,
        'delete'::public.audit_action_type,
        'audit_logs',
        NULL,
        jsonb_build_object(
          'job', 'audit_log_retention_weekly',
          'dry_run', p_dry_run,
          'purged_count', v_deleted_inst_count,
          'auth_purged', v_inst_auth_deleted,
          'routine_purged', v_inst_routine_deleted,
          'auth_retention_days', v_auth_retention_days,
          'routine_retention_days', v_routine_retention_days,
          'cutoff_auth', v_cutoff_auth,
          'cutoff_routine', v_cutoff_routine,
          'exempt_preserved_actions', jsonb_build_array(
            'grant', 'revoke', 'suspend', 'reactivate', 'permanent_delete',
            'result_released', 'result_unreleased', 'subjective_evaluation_saved',
            'subjective_evaluation_finalized', 'approve', 'reject',
            'device_approve', 'device_revoke', 'reset_password', 'failed_login'
          )
        ),
        'success',
        'Automated weekly audit log retention purge',
        v_now
      );
    END IF;

    v_report := v_report || jsonb_build_object(
      'institute_id', v_inst.institute_id,
      'auth_purged', v_inst_auth_deleted,
      'routine_purged', v_inst_routine_deleted,
      'total_purged', v_deleted_inst_count,
      'auth_cutoff', v_cutoff_auth,
      'routine_cutoff', v_cutoff_routine
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'completed',
    'dry_run', p_dry_run,
    'executed_at', v_now,
    'total_purged', v_total_deleted,
    'total_auth_purged', v_total_auth_deleted,
    'total_routine_purged', v_total_routine_deleted,
    'institutes_processed', jsonb_array_length(v_report),
    'details', v_report
  );
END;
$$;

COMMENT ON FUNCTION public.purge_expired_audit_logs IS
  'Automated retention procedure: safely purges eligible low-risk audit logs beyond '
  'the 90-day/180-day retention windows while permanently preserving all security, '
  'forensic, compliance, and academic records. Audits its own execution.';


-- ── SECTION 3: Function Privileges ──────────────────────────────────────────

REVOKE ALL ON FUNCTION public.purge_expired_audit_logs(boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs(boolean)
  TO postgres, service_role;


-- ── SECTION 4: Weekly pg_cron Job Registration ─────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $migration$
BEGIN
  -- Unschedule previous instance if registered
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit-log-retention-weekly') THEN
    PERFORM cron.unschedule('audit-log-retention-weekly');
  END IF;

  -- Schedule to run every Sunday at 03:00 UTC
  PERFORM cron.schedule(
    'audit-log-retention-weekly',
    '0 3 * * 0',
    'SELECT public.purge_expired_audit_logs();'
  );

  RAISE NOTICE 'CRON_JOB_SCHEDULED: job=audit-log-retention-weekly schedule=0 3 * * 0 (Sunday 03:00 UTC)';
END
$migration$;
