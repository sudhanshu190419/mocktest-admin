-- ============================================================================
-- MAKE ME TOPPER: MIGRATION 219 REMOTE PREFLIGHT READ-ONLY DIAGNOSTIC SCRIPT
-- ============================================================================
--
-- Objective:
--   Performs a 100% read-only catalog audit of the remote Supabase PostgreSQL
--   database before Migration 219 is manually applied.
--
-- Safety Guarantees:
--   • STRICTLY READ-ONLY: Contains only SELECT statements against pg_catalog
--     and information_schema.
--   • ZERO MUTATIONS: Does NOT create, alter, drop, grant, insert, update,
--     or delete any objects or data.
--   • ZERO SIDE EFFECTS: Does NOT call state-modifying functions, Edge Functions,
--     or modify migration history.
--   • SAFE FOR SUPABASE SQL EDITOR: Can be pasted and executed directly in the
--     Supabase Dashboard SQL Editor tab.
--
-- Categories Audited:
--   1. Extensions & System Types (pgcrypto, custom enums)
--   2. Prerequisite Tables (18 core tables from migrations 001-096)
--   3. Prerequisite Constraints (PKs, FKs, CHECK constraints on tables)
--   4. Prerequisite Columns (all columns required by Migration 219)
--   5. Prerequisite Functions & Exact Signatures (is_admin, get_my_student_id, etc.)
--   6. Target Tables Pre-existence & Column/Constraint Drift (catches IF NOT EXISTS drift)
--   7. Target Tables Security Configuration (RLS state, policy existence, quarantine isolation)
--   8. Function Overwrites (authorize_live_class_access, verify_recording_playback_access)
--   9. Migration History Reconciliation Status (schema_migrations)
--
-- ============================================================================

with check_extension as (
  select
    '1. EXTENSIONS & SYSTEM' as category,
    'Extension: ' || e.extname as check_item,
    case when exists (select 1 from pg_extension where extname = e.extname) then 'PASS' else 'FAIL' end as status,
    case when exists (select 1 from pg_extension where extname = e.extname) then 'Extension "' || e.extname || '" is active.' else 'CRITICAL: Missing extension "' || e.extname || '".' end as details,
    'CREATE EXTENSION IF NOT EXISTS "' || e.extname || '" WITH SCHEMA extensions;' as remediation
  from (values 
    ('pgcrypto'),
    ('uuid-ossp')
  ) as e(extname)
),

check_enums as (
  select 
    '1. EXTENSIONS & SYSTEM' as category,
    'Enum: ' || t.typname as check_item,
    case when exists (select 1 from pg_type where typname = t.typname and typnamespace = (select oid from pg_namespace where nspname = 'public')) then 'PASS' else 'FAIL' end as status,
    case when exists (select 1 from pg_type where typname = t.typname and typnamespace = (select oid from pg_namespace where nspname = 'public')) then 'Enum public.' || t.typname || ' exists.' else 'CRITICAL: Missing enum type public.' || t.typname end as details,
    'Apply Domain 07 Commerce (008) and Domain 10 Administration (011) migrations first.' as remediation
  from (values 
    ('user_role'),
    ('payment_gateway'),
    ('payment_status'),
    ('currency_code'),
    ('audit_action_type')
  ) as t(typname)
),

check_prereq_tables as (
  select
    '2. PREREQUISITE TABLES' as category,
    'Table: public.' || t.tbl as check_item,
    case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tbl) then 'PASS' else 'FAIL' end as status,
    case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tbl) then 'Table public.' || t.tbl || ' exists.' else 'CRITICAL: Prerequisite table public.' || t.tbl || ' is MISSING.' end as details,
    'Ensure core migrations (001-012, 066-073) are applied before Migration 219.' as remediation
  from (values 
    ('courses'),
    ('student_details'),
    ('profiles'),
    ('institutes'),
    ('orders'),
    ('order_items'),
    ('payments'),
    ('batches'),
    ('course_batches'),
    ('batch_students'),
    ('live_classes'),
    ('recordings'),
    ('live_class_batch'),
    ('batch_subject_live_classes'),
    ('batch_subject_recordings'),
    ('batch_subjects'),
    ('teacher_details'),
    ('student_subscriptions')
  ) as t(tbl)
),

check_prereq_constraints as (
  -- Verifies critical constraints on prerequisite tables, checking BOTH constraint name AND target table in public schema
  select
    '2. PREREQUISITE CONSTRAINTS' as category,
    'Constraint: ' || c.con_name || ' on public.' || c.tbl as check_item,
    case
      when exists (
        select 1 from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = c.tbl
          and con.conname = c.con_name
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = c.tbl
          and con.conname = c.con_name
      ) then 'Constraint ' || c.con_name || ' verified on public.' || c.tbl || '.'
      else 'CRITICAL: Constraint ' || c.con_name || ' is MISSING on public.' || c.tbl || ' (or exists on wrong relation).'
    end as details,
    c.remediation
  from (values
    ('payments', 'pk_payments', 'Ensure Migration 008 (Domain 07 Commerce) is applied.'),
    ('orders', 'pk_orders', 'Ensure Migration 008 (Domain 07 Commerce) is applied.'),
    ('order_items', 'pk_order_items', 'Ensure Migration 008 (Domain 07 Commerce) is applied.'),
    ('student_details', 'pk_student_details', 'Ensure Migration 002 (Domain 01 Foundation) is applied.'),
    ('courses', 'pk_courses', 'Ensure Migration 005 (Domain 04 Academic) is applied.'),
    ('batches', 'pk_batches', 'Ensure Migration 003 (Domain 02 Academic Structure) is applied.'),
    ('batch_students', 'pk_batch_students', 'Ensure Migration 003 (Domain 02 Academic Structure) is applied.'),
    ('order_items', 'fk_order_items_course', 'Ensure Migration 043 (Course Purchase Commerce Schema) is applied.'),
    ('order_items', 'ck_order_items_item_type_consistency', 'Ensure Migration 043 / 090 (Course Scoped Subscriptions) is applied.')
  ) as c(tbl, con_name, remediation)
),

check_prereq_columns as (
  select
    '3. PREREQUISITE COLUMNS' as category,
    'Column: public.' || c.tbl || '.' || c.col as check_item,
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = c.tbl and column_name = c.col) then 'PASS' else 'FAIL' end as status,
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = c.tbl and column_name = c.col) 
      then 'Column ' || c.col || ' exists on public.' || c.tbl || '.'
      else 'CRITICAL: Column ' || c.col || ' is MISSING on public.' || c.tbl || '.'
    end as details,
    case 
      when c.tbl = 'payments' and c.col in ('refund_amount', 'refund_gateway_id') then 'Ensure Migration 008 (Domain 07 Commerce) is applied.'
      when c.tbl = 'payments' and c.col = 'paid_at' then 'Ensure Migration 008/012 includes paid_at timestamp on payments.'
      when c.tbl = 'student_subscriptions' and c.col in ('grace_end_date', 'content_access_end_date') then 'Ensure Migration 204 (Subscription Grace Parity) is applied.'
      when c.tbl = 'order_items' and c.col = 'course_id' then 'Ensure Migration 043 (Course Purchase Commerce Schema) is applied.'
      when c.tbl = 'order_items' then 'Ensure Migration 008 (Domain 07 Commerce) is applied.'
      when c.tbl = 'institutes' and c.col = 'timezone' then 'Ensure Migration 108 (Timetable Foundation) is applied.'
      else 'Apply missing table migrations for ' || c.tbl || '.'
    end as remediation
  from (values
    -- payments critical columns
    ('payments', 'payment_id'),
    ('payments', 'order_id'),
    ('payments', 'amount'),
    ('payments', 'currency'),
    ('payments', 'status'),
    ('payments', 'paid_at'),
    ('payments', 'refund_amount'),
    ('payments', 'refund_gateway_id'),
    ('payments', 'gateway'),
    ('payments', 'gateway_payment_id'),
    -- orders critical columns
    ('orders', 'order_id'),
    ('orders', 'student_id'),
    ('orders', 'institute_id'),
    ('orders', 'total_amount'),
    ('orders', 'status'),
    -- order_items critical columns (Domain 07 Commerce + Migration 043)
    ('order_items', 'item_id'),
    ('order_items', 'order_id'),
    ('order_items', 'institute_id'),
    ('order_items', 'item_type'),
    ('order_items', 'item_name'),
    ('order_items', 'course_id'),
    ('order_items', 'unit_price'),
    ('order_items', 'quantity'),
    ('order_items', 'discount_amount'),
    ('order_items', 'line_total'),
    -- courses & student_details
    ('courses', 'course_id'),
    ('student_details', 'student_id'),
    ('student_details', 'profile_id'),
    ('student_details', 'institute_id'),
    ('profiles', 'profile_id'),
    ('profiles', 'role'),
    ('institutes', 'institute_id'),
    ('institutes', 'timezone'),
    -- batches & batch_students
    ('batches', 'batch_id'),
    ('batches', 'end_date'),
    ('batch_students', 'batch_id'),
    ('batch_students', 'student_id'),
    ('batch_students', 'status'),
    -- live classes & recordings
    ('live_classes', 'class_id'),
    ('live_classes', 'institute_id'),
    ('live_classes', 'teacher_id'),
    ('live_classes', 'title'),
    ('live_classes', 'scheduled_at'),
    ('live_classes', 'status'),
    ('recordings', 'recording_id'),
    ('recordings', 'class_id'),
    ('recordings', 'institute_id'),
    ('recordings', 'storage_bucket'),
    ('recordings', 'storage_path'),
    ('recordings', 'status'),
    ('recordings', 'recorded_at'),
    -- student_subscriptions
    ('student_subscriptions', 'subscription_id'),
    ('student_subscriptions', 'student_id'),
    ('student_subscriptions', 'course_id'),
    ('student_subscriptions', 'status'),
    ('student_subscriptions', 'start_date'),
    ('student_subscriptions', 'end_date'),
    ('student_subscriptions', 'grace_end_date'),
    ('student_subscriptions', 'content_access_end_date')
  ) as c(tbl, col)
),

check_prereq_functions as (
  -- Verifies exact function signatures, argument counts, argument types, return types, and SECURITY DEFINER flags
  select
    '4. PREREQUISITE FUNCTIONS' as category,
    'Function Signature: public.' || f.fn_name || '(' || coalesce(f.expected_argtypes, '') || ') -> ' || f.expected_rettype as check_item,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = f.fn_name
          and (f.expected_nargs is null or p.pronargs = f.expected_nargs)
          and (f.expected_argtypes is null or oidvectortypes(p.proargtypes) = f.expected_argtypes)
          and (f.expected_rettype is null or p.prorettype::regtype::text = f.expected_rettype)
          and (f.expected_secdef is null or p.prosecdef = f.expected_secdef)
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = f.fn_name
          and (f.expected_nargs is null or p.pronargs = f.expected_nargs)
          and (f.expected_argtypes is null or oidvectortypes(p.proargtypes) = f.expected_argtypes)
          and (f.expected_rettype is null or p.prorettype::regtype::text = f.expected_rettype)
          and (f.expected_secdef is null or p.prosecdef = f.expected_secdef)
      ) then 'Verified: public.' || f.fn_name || '(' || coalesce(f.expected_argtypes, '') || ') returns ' || f.expected_rettype || ' [SECURITY DEFINER=' || f.expected_secdef::text || '].'
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = f.fn_name
      ) then 'CRITICAL SIGNATURE MISMATCH: public.' || f.fn_name || ' exists but has signature ' || (
        select pg_get_function_arguments(p.oid) || ' -> ' || p.prorettype::regtype::text || ' (secdef: ' || p.prosecdef::text || ')'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.fn_name limit 1
      ) || ', expected (' || coalesce(f.expected_argtypes, '') || ') -> ' || f.expected_rettype || ' [secdef=' || f.expected_secdef::text || '].'
      else 'CRITICAL: Prerequisite function public.' || f.fn_name || ' is MISSING entirely.'
    end as details,
    f.remediation
  from (values
    ('is_admin', 0, '', 'boolean', true, 'Apply Migration 021 (RLS Policies & Helpers).'),
    ('get_my_student_id', 0, '', 'uuid', true, 'Apply Migration 021 (RLS Policies & Helpers).'),
    ('can_student_access_content', 1, 'uuid', 'boolean', true, 'Apply Migration 096 / 204 (Subscription Grace Parity & Content Access).'),
    ('is_permanent_course_owner', 1, 'uuid', 'boolean', true, 'Apply Migration 096 (Subscription Entitlement Ownership).'),
    ('write_audit_log', null, null, 'jsonb', true, 'Apply Migration 076 (Audit Infrastructure).')
  ) as f(fn_name, expected_nargs, expected_argtypes, expected_rettype, expected_secdef, remediation)
),

check_auth_functions as (
  select
    '4. PREREQUISITE FUNCTIONS' as category,
    'Auth Helper: auth.' || a.fn_name || '() -> ' || a.expected_rettype as check_item,
    case when exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'auth'
        and p.proname = a.fn_name
        and p.pronargs = 0
        and p.prorettype::regtype::text = a.expected_rettype
    ) then 'PASS' else 'FAIL' end as status,
    case when exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'auth'
        and p.proname = a.fn_name
        and p.pronargs = 0
        and p.prorettype::regtype::text = a.expected_rettype
    ) then 'Supabase auth.' || a.fn_name || '() returning ' || a.expected_rettype || ' is available.'
      else 'CRITICAL: Supabase auth.' || a.fn_name || '() is missing or has unexpected return type in auth schema.'
    end as details,
    'Check Supabase Auth service configuration.' as remediation
  from (values
    ('uid', 'uuid'),
    ('role', 'text')
  ) as a(fn_name, expected_rettype)
),

check_existing_target_tables as (
  select
    '5. TARGET TABLES (PRE-EXISTENCE / DRIFT)' as category,
    'Target Table: public.' || t.tbl as check_item,
    case
      when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tbl)
      then 'WARN'
      else 'PASS'
    end as status,
    case
      when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tbl)
      then 'WARNING: Table public.' || t.tbl || ' ALREADY EXISTS. CREATE TABLE IF NOT EXISTS will skip it; verify schema drift below.'
      else 'Table public.' || t.tbl || ' does not exist yet; Migration 219 will create it cleanly.'
    end as details,
    case
      when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tbl)
      then 'Check column-level drift checks below. If missing columns exist, run ALTER TABLE to align schema before 219.'
      else 'No action needed.'
    end as remediation
  from (values
    ('course_installment_plans'),
    ('student_course_agreements'),
    ('student_installment_schedule'),
    ('installment_payment_allocations'),
    ('installment_adjustments'),
    ('installment_dispute_restorations'),
    ('webhook_quarantine_events')
  ) as t(tbl)
),

check_target_column_drift as (
  -- If a target table already exists, verify it contains the full set of Revision 34 columns
  select
    '5. TARGET TABLES (PRE-EXISTENCE / DRIFT)' as category,
    'Column Drift: public.' || cd.tbl || '.' || cd.col as check_item,
    case
      -- Table doesn't exist -> PASS (clean creation)
      when not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = cd.tbl)
      then 'PASS'
      -- Table exists AND column exists -> PASS
      when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = cd.tbl and column_name = cd.col)
      then 'PASS'
      -- Table exists BUT column is MISSING -> FAIL (CREATE TABLE IF NOT EXISTS will NOT add it!)
      else 'FAIL'
    end as status,
    case
      when not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = cd.tbl)
      then 'Table public.' || cd.tbl || ' does not exist yet (clean creation).'
      when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = cd.tbl and column_name = cd.col)
      then 'Column ' || cd.col || ' exists on pre-existing table public.' || cd.tbl || '.'
      else 'CRITICAL DRIFT: Table public.' || cd.tbl || ' exists but column ' || cd.col || ' is MISSING. CREATE TABLE IF NOT EXISTS will not add it!'
    end as details,
    'ALTER TABLE public.' || cd.tbl || ' ADD COLUMN ' || cd.col || ' ' || cd.def || ';' as remediation
  from (values
    ('student_course_agreements', 'requires_admin_review', 'boolean not null default false'),
    ('student_course_agreements', 'terms_version', 'text not null default ''v1.0'''),
    ('student_course_agreements', 'agreement_date', 'date null'),
    ('student_installment_schedule', 'revised_due_date', 'date null'),
    ('student_installment_schedule', 'waiver_amount', 'numeric(10,2) not null default 0.00'),
    ('student_installment_schedule', 'payment_id', 'uuid null'),
    ('installment_adjustments', 'restored_amount', 'numeric(10,2) not null default 0.00'),
    ('installment_adjustments', 'gateway_event_id', 'varchar(255) null'),
    ('installment_dispute_restorations', 'provider_reference_id', 'varchar(255) not null'),
    ('webhook_quarantine_events', 'gateway_event_id', 'varchar(255) not null')
  ) as cd(tbl, col, def)
),

check_target_constraint_drift as (
  -- If target tables exist, check critical unique constraints required for composite foreign keys and idempotency
  -- Verifies BOTH constraint name AND specific table relation in public schema
  select
    '5. TARGET TABLES (PRE-EXISTENCE / DRIFT)' as category,
    'Constraint Drift: ' || c.con_name || ' on public.' || c.tbl as check_item,
    case
      when not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = c.tbl)
      then 'PASS'
      when exists (
        select 1 from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = c.tbl
          and con.conname = c.con_name
      ) then 'PASS'
      else 'FAIL'
    end as status,
    case
      when not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = c.tbl)
      then 'Parent table public.' || c.tbl || ' does not exist yet (clean creation).'
      when exists (
        select 1 from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = c.tbl
          and con.conname = c.con_name
      ) then 'Constraint ' || c.con_name || ' verified on public.' || c.tbl || '.'
      else 'CRITICAL DRIFT: Constraint ' || c.con_name || ' missing on pre-existing public.' || c.tbl || ' (or exists on wrong relation).'
    end as details,
    'ALTER TABLE public.' || c.tbl || ' ADD CONSTRAINT ' || c.con_name || ' ' || c.con_def || ';' as remediation
  from (values
    ('student_installment_schedule', 'uq_schedule_agreement_schedule', 'unique (agreement_id, schedule_id)'),
    ('student_course_agreements', 'uq_student_course_agreement', 'unique (student_id, course_id)'),
    ('installment_payment_allocations', 'uq_payment_schedule_allocation', 'unique (payment_id, schedule_id)'),
    ('installment_adjustments', 'uq_installment_adjustments_gateway_event', 'unique (gateway_event_id)'),
    ('installment_dispute_restorations', 'uq_dispute_restorations_event', 'unique (gateway_event_id)'),
    ('installment_dispute_restorations', 'uq_dispute_restorations_provider_ref', 'unique (provider_reference_id)'),
    ('webhook_quarantine_events', 'uq_webhook_quarantine_event', 'unique (gateway_event_id)')
  ) as c(tbl, con_name, con_def)
),

check_target_table_security as (
  -- If target tables pre-exist, inspect whether RLS is enabled and policies are properly configured
  select
    '5. TARGET TABLES (PRE-EXISTENCE / DRIFT)' as category,
    'Target Security: public.' || s.tbl || ' RLS & Policies' as check_item,
    case
      -- Table doesn't exist yet -> PASS (clean creation; Migration 219 will enable RLS and create policies)
      when not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = s.tbl)
      then 'PASS'
      -- Table exists but RLS is NOT enabled -> FAIL (critical exposure)
      when exists (
        select 1 from pg_class rel
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public' and rel.relname = s.tbl and rel.relrowsecurity = false
      ) then 'FAIL'
      -- If quarantine table, ensure NO student/public policy exists (must not expose sensitive records to students)
      when s.tbl = 'webhook_quarantine_events' and exists (
        select 1 from pg_policy pol
        join pg_class rel on rel.oid = pol.polrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public' and rel.relname = s.tbl
          and pol.polname not like '%admin%'
      ) then 'FAIL'
      -- Otherwise PASS
      else 'PASS'
    end as status,
    case
      when not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = s.tbl)
      then 'Table public.' || s.tbl || ' does not exist yet (Migration 219 will enable RLS and create policies).'
      when exists (
        select 1 from pg_class rel
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public' and rel.relname = s.tbl and rel.relrowsecurity = false
      ) then 'CRITICAL SECURITY DEFECT: Pre-existing public.' || s.tbl || ' has Row Level Security DISABLED!'
      when s.tbl = 'webhook_quarantine_events' and exists (
        select 1 from pg_policy pol
        join pg_class rel on rel.oid = pol.polrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public' and rel.relname = s.tbl
          and pol.polname not like '%admin%'
      ) then 'CRITICAL SECURITY DEFECT: Non-admin policy found on webhook_quarantine_events! Sensitive quarantine records are exposed to students.'
      else 'Verified: Pre-existing public.' || s.tbl || ' has RLS enabled with ' || (
        select count(*)::text from pg_policy pol join pg_class rel on rel.oid = pol.polrelid join pg_namespace nsp on nsp.oid = rel.relnamespace where nsp.nspname = 'public' and rel.relname = s.tbl
      ) || ' policy/policies.'
    end as details,
    'Ensure Migration 219 RLS policies are applied; do not manually enable RLS without accompanying policies.' as remediation
  from (values
    ('course_installment_plans'),
    ('student_course_agreements'),
    ('student_installment_schedule'),
    ('installment_payment_allocations'),
    ('installment_adjustments'),
    ('installment_dispute_restorations'),
    ('webhook_quarantine_events')
  ) as s(tbl)
),

check_function_overwrites as (
  -- 1. Target Exact Signature Verification: authorize_live_class_access
  select
    '6. FUNCTION SIGNATURES & OVERWRITES' as category,
    'Target Signature: public.authorize_live_class_access(uuid, uuid, text) -> jsonb' as check_item,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'authorize_live_class_access'
          and (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
          and p.pronargs = 3
          and p.prorettype = 'jsonb'::regtype
      )
      then 'PASS'
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'authorize_live_class_access'
      )
      then 'WARN'
      else 'INFO'
    end as status,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'authorize_live_class_access'
          and (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
          and p.pronargs = 3
          and p.prorettype = 'jsonb'::regtype
      )
      then 'Intended canonical signature verified: ' || (
        select pg_get_function_arguments(p.oid) || ' -> ' || p.prorettype::regtype::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'authorize_live_class_access'
          and (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
          and p.pronargs = 3
          and p.prorettype = 'jsonb'::regtype
        limit 1
      ) || '. Exact input argument types (uuid, uuid, text), argument count (3), and return type (jsonb) match. Migration 219 will cleanly replace its implementation in-place via CREATE OR REPLACE FUNCTION.'
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'authorize_live_class_access'
      )
      then 'Function public.authorize_live_class_access exists with non-canonical identity arguments or return type! CREATE OR REPLACE FUNCTION may fail or create an overload.'
      else 'Function public.authorize_live_class_access is not yet present; will be created fresh by Migration 219.'
    end as details,
    'Verify that callers pass (p_user_id, p_class_id, p_room_name) and handle JSONB response.' as remediation

  union all

  -- 2. Comprehensive Overload Check: authorize_live_class_access
  select
    '6. FUNCTION SIGNATURES & OVERWRITES' as category,
    'Legacy Overload Check: public.authorize_live_class_access' as check_item,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'authorize_live_class_access'
          and not (
            (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
            and p.pronargs = 3
            and p.prorettype = 'jsonb'::regtype
          )
      )
      then 'WARN'
      else 'PASS'
    end as status,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'authorize_live_class_access'
          and not (
            (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
            and p.pronargs = 3
            and p.prorettype = 'jsonb'::regtype
          )
      )
      then 'WARNING: Non-canonical signature or unexpected overload(s) detected: ' || coalesce((
        select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || p.prorettype::regtype::text, '; ')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'authorize_live_class_access'
          and not (
            (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
            and p.pronargs = 3
            and p.prorettype = 'jsonb'::regtype
          )
      ), '') || '. A non-canonical overload will NOT be replaced by CREATE OR REPLACE FUNCTION. Migration 219 includes explicit DROP FUNCTION IF EXISTS public.authorize_live_class_access(uuid, uuid).'
      else 'No unintended legacy overloads or non-canonical signatures found for public.authorize_live_class_access.'
    end as details,
    'Migration 219 safely drops legacy 2-arg overload before re-creating the function.' as remediation

  union all

  -- 3. Target Exact Signature Verification: verify_recording_playback_access
  select
    '6. FUNCTION SIGNATURES & OVERWRITES' as category,
    'Target Signature: public.verify_recording_playback_access(uuid) -> jsonb' as check_item,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'verify_recording_playback_access'
          and (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
          and p.pronargs = 1
          and p.prorettype = 'jsonb'::regtype
      )
      then 'PASS'
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'verify_recording_playback_access'
      )
      then 'WARN'
      else 'INFO'
    end as status,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'verify_recording_playback_access'
          and (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
          and p.pronargs = 1
          and p.prorettype = 'jsonb'::regtype
      )
      then 'Intended canonical signature verified: ' || (
        select pg_get_function_arguments(p.oid) || ' -> ' || p.prorettype::regtype::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'verify_recording_playback_access'
          and (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
          and p.pronargs = 1
          and p.prorettype = 'jsonb'::regtype
        limit 1
      ) || '. Exact input argument type (uuid), argument count (1), and return type (jsonb) match. Migration 219 will cleanly replace its implementation in-place via CREATE OR REPLACE FUNCTION.'
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'verify_recording_playback_access'
      )
      then 'Function public.verify_recording_playback_access exists with non-canonical identity arguments or return type! CREATE OR REPLACE FUNCTION may fail or create an overload.'
      else 'Function public.verify_recording_playback_access is not yet present; will be created fresh by Migration 219.'
    end as details,
    'Verify that callers pass (p_recording_id) and handle JSONB response.' as remediation

  union all

  -- 4. Comprehensive Overload Check: verify_recording_playback_access
  select
    '6. FUNCTION SIGNATURES & OVERWRITES' as category,
    'Legacy Overload Check: public.verify_recording_playback_access' as check_item,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'verify_recording_playback_access'
          and not (
            (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
            and p.pronargs = 1
            and p.prorettype = 'jsonb'::regtype
          )
      )
      then 'WARN'
      else 'PASS'
    end as status,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'verify_recording_playback_access'
          and not (
            (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
            and p.pronargs = 1
            and p.prorettype = 'jsonb'::regtype
          )
      )
      then 'WARNING: Non-canonical signature or unexpected overload(s) detected: ' || coalesce((
        select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || p.prorettype::regtype::text, '; ')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'verify_recording_playback_access'
          and not (
            (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
            and p.pronargs = 1
            and p.prorettype = 'jsonb'::regtype
          )
      ), '') || '. A non-canonical overload will NOT be replaced by CREATE OR REPLACE FUNCTION. Migration 219 includes explicit DROP FUNCTION IF EXISTS public.verify_recording_playback_access(uuid, uuid).'
      else 'No unintended legacy overloads or non-canonical signatures found for public.verify_recording_playback_access.'
    end as details,
    'Migration 219 safely drops legacy overloads before re-creating the function.' as remediation

  union all

  -- 5. Existing Function In-Place Replacement Notice
  select
    '6. FUNCTION SIGNATURES & OVERWRITES' as category,
    'Function In-Place Replacement: public.' || fo.fn_name as check_item,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = fo.fn_name
      )
      then 'WARN'
      else 'PASS'
    end as status,
    case
      when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = fo.fn_name
      )
      then 'NOTICE: Function public.' || fo.fn_name || ' will have its procedural body replaced with ' || fo.impact || '.'
      else 'Function public.' || fo.fn_name || ' is new; will be cleanly created.'
    end as details,
    'Backup existing database before applying Migration 219.' as remediation
  from (values
    ('authorize_live_class_access', 'Server-Side Quad-Check live-class authorization [returns jsonb]'),
    ('verify_recording_playback_access', 'Unpaid-gap recording restriction logic [returns jsonb]')
  ) as fo(fn_name, impact)
),

check_migration_history as (
  select
    '7. MIGRATION HISTORY' as category,
    'Supabase Schema Migrations Table' as check_item,
    case
      when exists (
        select 1 from information_schema.tables
        where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
      )
      then 'PASS'
      else 'WARN'
    end as status,
    case
      when exists (
        select 1 from information_schema.tables
        where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
      )
      then 'supabase_migrations.schema_migrations exists.'
      else 'supabase_migrations.schema_migrations table does NOT exist. CLI tracking may not be initialized.'
    end as details,
    'After verifying applied database state, run "supabase migration repair --status applied 219".' as remediation
),

check_migration_record as (
  select
    '7. MIGRATION HISTORY' as category,
    'Migration 219 Recorded Status' as check_item,
    case
      when not exists (
        select 1 from information_schema.tables
        where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
      )
      then 'INFO'
      when exists (
        select 1 from supabase_migrations.schema_migrations
        where version like '219%' or name like '%installment_foundation%'
      )
      then 'WARN'
      else 'PASS'
    end as status,
    case
      when not exists (
        select 1 from information_schema.tables
        where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
      )
      then 'Cannot check migration record: supabase_migrations.schema_migrations not found.'
      when exists (
        select 1 from supabase_migrations.schema_migrations
        where version like '219%' or name like '%installment_foundation%'
      )
      then 'WARNING: Migration 219 is ALREADY marked as applied in schema_migrations.'
      else 'Migration 219 is not yet recorded in schema_migrations.'
    end as details,
    'Verify if 219 was previously partially applied.' as remediation
),

all_checks as (
  select * from check_extension
  union all select * from check_enums
  union all select * from check_prereq_tables
  union all select * from check_prereq_constraints
  union all select * from check_prereq_columns
  union all select * from check_prereq_functions
  union all select * from check_auth_functions
  union all select * from check_existing_target_tables
  union all select * from check_target_column_drift
  union all select * from check_target_constraint_drift
  union all select * from check_target_table_security
  union all select * from check_function_overwrites
  union all select * from check_migration_history
  union all select * from check_migration_record
),

summary as (
  select
    '0. OVERALL PREFLIGHT SUMMARY' as category,
    'Migration 219 Readiness' as check_item,
    case
      when count(*) filter (where status = 'FAIL') > 0 then 'FAIL'
      when count(*) filter (where status = 'WARN') > 0 then 'WARN'
      else 'PASS'
    end as status,
    'Total Checks: ' || count(*) || 
    ' | Passed: ' || count(*) filter (where status = 'PASS') || 
    ' | Warnings: ' || count(*) filter (where status = 'WARN') || 
    ' | Failures: ' || count(*) filter (where status = 'FAIL') ||
    case
      when count(*) filter (where status = 'FAIL') > 0 
      then ' ===> DO NOT APPLY MIGRATION 219 UNTIL ALL FAILURES ARE RESOLVED.'
      when count(*) filter (where status = 'WARN') > 0 
      then ' ===> REVIEW ALL WARNINGS BEFORE PROCEEDING.'
      else ' ===> ALL PREREQUISITES VERIFIED. MIGRATION 219 IS READY FOR APPLICATION.'
    end as details,
    case
      when count(*) filter (where status = 'FAIL') > 0 
      then 'Review FAIL rows below and apply prerequisite migrations or schema adjustments.'
      else 'Follow ordered manual application checklist in REVISION_219_MANUAL_APPLY_PREFLIGHT.md.'
    end as remediation,
    0 as sort_order
  from all_checks
),

items_with_order as (
  select
    category,
    check_item,
    status,
    details,
    remediation,
    case status
      when 'FAIL' then 1
      when 'WARN' then 2
      when 'PASS' then 3
      else 4
    end as sort_order
  from all_checks
)

select
  category,
  check_item,
  status,
  details,
  remediation
from (
  select * from summary
  union all
  select * from items_with_order
) final_report
order by
  sort_order,
  category,
  check_item;
