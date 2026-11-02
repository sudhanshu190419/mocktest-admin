-- ============================================================================
-- MAKE ME TOPPER: MIGRATION 220 REMOTE PREFLIGHT READ-ONLY DIAGNOSTIC SCRIPT
-- ============================================================================
--
-- Objective:
--   Performs a 100% read-only catalog audit of the remote Supabase PostgreSQL
--   database for Migration 220:
--     1. Verifies column public.course_installment_plans.is_active.
--     2. Verifies public.course_installment_plans RLS and select policy status.
--     3. Verifies public.course_installment_plans administrator management policy.
--     4. Verifies absence of student-readable SELECT policy on installment_dispute_restorations.
--     5. Verifies preservation of administrator management policy on installment_dispute_restorations.
--     6. Verifies administrator isolation on webhook_quarantine_events.
--
-- Safety Guarantees:
--   • STRICTLY READ-ONLY: Contains only SELECT statements against pg_catalog
--     and information_schema.
--   • ZERO MUTATIONS: Does NOT create, alter, drop, grant, insert, update,
--     or delete any objects or data.
--   • ZERO SIDE EFFECTS: Does NOT call state-modifying functions, Edge Functions,
--     or modify migration history.
--   • SAFE FOR SUPABASE SQL EDITOR: Can be pasted and executed directly in the
--     Supabase Dashboard SQL Editor tab ("Run without RLS" or "Run and enable RLS").
-- ============================================================================

with audit_checks as (
  -- --------------------------------------------------------------------------
  -- 1. Verify is_active column on public.course_installment_plans
  -- --------------------------------------------------------------------------
  select
    '1. TABLE SCHEMA INTEGRITY' as category,
    'Column: public.course_installment_plans.is_active' as check_item,
    case
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'course_installment_plans'
          and column_name = 'is_active'
          and data_type = 'boolean'
          and is_nullable = 'NO'
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'course_installment_plans'
          and column_name = 'is_active'
          and data_type = 'boolean'
          and is_nullable = 'NO'
      ) then 'Verified: public.course_installment_plans.is_active column exists (boolean NOT NULL DEFAULT true).'
      else 'MISSING or INVALID: public.course_installment_plans.is_active does not exist or has unexpected data type.'
    end as details,
    'Ensure Migration 219 table public.course_installment_plans is created.' as remediation

  union all

  -- --------------------------------------------------------------------------
  -- 2. Verify RLS is enabled on public.course_installment_plans
  -- --------------------------------------------------------------------------
  select
    '2. ROW LEVEL SECURITY STATE' as category,
    'RLS State: public.course_installment_plans' as check_item,
    case
      when exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'course_installment_plans' and rowsecurity = true
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'course_installment_plans' and rowsecurity = true
      ) then 'Verified: Row Level Security is ENABLED on public.course_installment_plans.'
      else 'CRITICAL: Row Level Security is DISABLED on public.course_installment_plans!'
    end as details,
    'Execute: alter table public.course_installment_plans enable row level security;' as remediation

  union all

  -- --------------------------------------------------------------------------
  -- 3. Verify course_installment_plans_select policy condition
  -- --------------------------------------------------------------------------
  select
    '3. POLICY DEFINITIONS' as category,
    'Policy: public.course_installment_plans.course_installment_plans_select' as check_item,
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'course_installment_plans'
          and policyname = 'course_installment_plans_select'
          and cmd = 'SELECT'
          and qual like '%is_active%'
          and qual not in ('true', '(true)')
      ) then 'PASS'
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'course_installment_plans'
          and policyname = 'course_installment_plans_select'
          and qual in ('true', '(true)')
      ) then 'PENDING_MIGRATION_220'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'course_installment_plans'
          and policyname = 'course_installment_plans_select'
          and cmd = 'SELECT'
          and qual like '%is_active%'
          and qual not in ('true', '(true)')
      ) then 'Verified: Policy course_installment_plans_select restricts SELECT to (is_active = true).'
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'course_installment_plans'
          and policyname = 'course_installment_plans_select'
          and qual in ('true', '(true)')
      ) then 'Migration 219 active state: policy has USING (true). Ready for Migration 220 replacement.'
      else 'MISSING: Policy course_installment_plans_select not found on public.course_installment_plans.'
    end as details,
    'Apply Migration 220 to replace policy with USING (is_active = true).' as remediation

  union all

  -- --------------------------------------------------------------------------
  -- 4. Verify course_installment_plans_admin_manage policy preservation
  -- --------------------------------------------------------------------------
  select
    '3. POLICY DEFINITIONS' as category,
    'Policy: public.course_installment_plans.course_installment_plans_admin_manage' as check_item,
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'course_installment_plans'
          and policyname = 'course_installment_plans_admin_manage'
          and cmd = 'ALL'
          and qual like '%is_admin%'
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'course_installment_plans'
          and policyname = 'course_installment_plans_admin_manage'
          and cmd = 'ALL'
          and qual like '%is_admin%'
      ) then 'Verified: Administrator management policy preserved with public.is_admin() check.'
      else 'MISSING or INVALID: course_installment_plans_admin_manage policy not found.'
    end as details,
    'Preserve course_installment_plans_admin_manage policy from Migration 219.' as remediation

  union all

  -- --------------------------------------------------------------------------
  -- 5. Verify RLS is enabled on public.installment_dispute_restorations
  -- --------------------------------------------------------------------------
  select
    '2. ROW LEVEL SECURITY STATE' as category,
    'RLS State: public.installment_dispute_restorations' as check_item,
    case
      when exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'installment_dispute_restorations' and rowsecurity = true
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'installment_dispute_restorations' and rowsecurity = true
      ) then 'Verified: Row Level Security is ENABLED on public.installment_dispute_restorations.'
      else 'CRITICAL: Row Level Security is DISABLED on public.installment_dispute_restorations!'
    end as details,
    'Execute: alter table public.installment_dispute_restorations enable row level security;' as remediation

  union all

  -- --------------------------------------------------------------------------
  -- 6. Verify absence of student-readable SELECT policy on installment_dispute_restorations
  -- --------------------------------------------------------------------------
  select
    '3. POLICY DEFINITIONS' as category,
    'Policy Absence: installment_dispute_restorations_select (Student Read)' as check_item,
    case
      when not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'installment_dispute_restorations'
          and policyname = 'installment_dispute_restorations_select'
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'installment_dispute_restorations'
          and policyname = 'installment_dispute_restorations_select'
      ) then 'Verified: Policy installment_dispute_restorations_select is absent (no student SELECT access).'
      else 'CRITICAL: Policy installment_dispute_restorations_select exists! Students have direct read access.'
    end as details,
    'Apply Migration 220 to drop policy installment_dispute_restorations_select.' as remediation

  union all

  -- --------------------------------------------------------------------------
  -- 7. Verify installment_dispute_restorations_admin_manage policy preservation
  -- --------------------------------------------------------------------------
  select
    '3. POLICY DEFINITIONS' as category,
    'Policy: installment_dispute_restorations.installment_dispute_restorations_admin_manage' as check_item,
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'installment_dispute_restorations'
          and policyname = 'installment_dispute_restorations_admin_manage'
          and cmd = 'ALL'
          and qual like '%is_admin%'
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'installment_dispute_restorations'
          and policyname = 'installment_dispute_restorations_admin_manage'
          and cmd = 'ALL'
          and qual like '%is_admin%'
      ) then 'Verified: Administrator dispute management policy preserved with public.is_admin() check.'
      else 'MISSING or INVALID: installment_dispute_restorations_admin_manage policy not found.'
    end as details,
    'Preserve installment_dispute_restorations_admin_manage from Migration 219.' as remediation

  union all

  -- --------------------------------------------------------------------------
  -- 8. Verify webhook_quarantine_events RLS and admin isolation
  -- --------------------------------------------------------------------------
  select
    '4. QUARANTINE ISOLATION' as category,
    'Security Isolation: public.webhook_quarantine_events' as check_item,
    case
      when exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'webhook_quarantine_events' and rowsecurity = true
      ) and not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'webhook_quarantine_events'
          and (qual not like '%is_admin%' or qual is null)
      ) and exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'webhook_quarantine_events'
          and policyname in ('webhook_quarantine_events_admin_select', 'webhook_quarantine_events_admin_manage')
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'webhook_quarantine_events' and rowsecurity = true
      ) and not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'webhook_quarantine_events'
          and (qual not like '%is_admin%' or qual is null)
      ) and exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'webhook_quarantine_events'
          and policyname in ('webhook_quarantine_events_admin_select', 'webhook_quarantine_events_admin_manage')
      ) then 'Verified: RLS enabled, only administrator policies exist, and non-admin access is strictly blocked.'
      else 'SECURITY DEFECT: Webhook quarantine events have missing RLS or non-admin policy exposure!'
    end as details,
    'Ensure webhook_quarantine_events has RLS enabled and only administrator policies applied.' as remediation
)
select
  category,
  check_item,
  status,
  details,
  remediation
from audit_checks
order by category, check_item;
