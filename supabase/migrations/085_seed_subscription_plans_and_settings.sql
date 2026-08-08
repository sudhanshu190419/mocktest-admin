-- ============================================================================
-- Migration: 085 — Seed Subscription Plans & System Settings
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Complete the subscription catalogue and seed the subscription
--          business-rule settings.
--
--   1. Seed the remaining subscription plans for every institute that already
--      offers a plan (Monthly already exists from migration 023):
--        • NEET Gold — Quarterly   (quarterly,   90 days,  ₹2,799)
--        • NEET Gold — Half-Yearly (half_yearly, 182 days, ₹4,999)
--        • NEET Gold — Yearly      (yearly,      365 days, ₹8,999)
--      including the corresponding plan_unlocks rows (all active features).
--   2. Seed subscription system settings for EVERY institute using the
--      existing system_settings infrastructure (Domain 10):
--        • grace_days            = 7    (integer)
--        • content_access_days   = 30   (integer)
--        • expiry_notice_days    = 3    (integer)
--        • renewal_grace_enabled = true (boolean)
--
-- Fully idempotent: safe to run multiple times. Uses ON CONFLICT ... DO NOTHING
-- so pre-existing plans/settings and any admin-customised values are preserved.
--
-- Depends on: Migration 012 (Domain 11 — plans, features, unlocks)
--             Migration 023 (seed — existing Monthly plan + features)
--             Migration 011 (Domain 10 — system_settings)
-- Reference: Phase 11A/11A.0 (approved) | 023 seed patterns
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Seed Quarterly / Half-Yearly / Yearly Plans
-- ════════════════════════════════════════════════════════════════════════════
-- Seeds the three remaining plans for each institute that already has at least
-- one subscription plan (the Monthly plan from 023 in the demo dataset).
-- The new plans reuse the institute's existing stream (the Monthly plan's
-- stream), the same feature set, and an admin profile as created_by.

do $$
declare
  v_row        record;
  v_admin_id   uuid;
  v_stream_id  uuid;
  v_plan_id    uuid;
begin

  -- Resolve an admin actor for created_by (prefer an admin of the target
  -- institute, fall back to any admin). Mirrors 023 using v_platform_admin_id.
  for v_row in
    select distinct sp.institute_id
    from public.subscription_plans sp
    order by sp.institute_id
  loop

    -- 1a. Admin actor for this institute
    select p.profile_id into v_admin_id
    from public.profiles p
    where p.role = 'admin'
      and (p.institute_id = v_row.institute_id or p.institute_id is null)
    order by p.created_at asc
    limit 1;

    if v_admin_id is null then
      select p.profile_id into v_admin_id
      from public.profiles p
      where p.role = 'admin'
      order by p.created_at asc
      limit 1;
    end if;

    -- Safety guard: created_by is NOT NULL on subscription_plans. If no admin
    -- profile exists at all, skip this institute's plan inserts (settings are
    -- still seeded separately below) instead of aborting the whole migration.
    if v_admin_id is null then
      raise notice 'Skipping plan seeding for institute % — no admin profile found', v_row.institute_id;
      continue;
    end if;

    -- 1b. Stream used by the institute's existing plans (typically NEET)
    select sp2.stream_id into v_stream_id
    from public.subscription_plans sp2
    where sp2.institute_id = v_row.institute_id
    order by sp2.created_at asc
    limit 1;

    -- ── Quarterly ────────────────────────────────────────────────────────
    insert into public.subscription_plans (
      institute_id, stream_id, name, slug, description,
      price, billing_cycle, duration_days, trial_days,
      is_featured, sort_order, created_by
    )
    values (
      v_row.institute_id, v_stream_id,
      'NEET Gold — Quarterly', 'neet-gold-quarterly',
      'Full access to all NEET preparation resources for 3 months. Includes live classes, mock tests, PYQ papers, and detailed analytics.',
      2799.00, 'quarterly', 90, 0,
      false, 2, v_admin_id
    )
    on conflict (institute_id, slug) do nothing
    returning plan_id into v_plan_id;

    if v_plan_id is null then
      select plan_id into v_plan_id from public.subscription_plans
      where institute_id = v_row.institute_id and slug = 'neet-gold-quarterly';
    end if;

    insert into public.plan_unlocks (plan_id, feature_id, is_enabled)
    select v_plan_id, feature_id, true
    from public.subscription_features
    where is_active = true
    on conflict (plan_id, feature_id) do nothing;

    -- ── Half-Yearly ──────────────────────────────────────────────────────
    insert into public.subscription_plans (
      institute_id, stream_id, name, slug, description,
      price, billing_cycle, duration_days, trial_days,
      is_featured, sort_order, created_by
    )
    values (
      v_row.institute_id, v_stream_id,
      'NEET Gold — Half-Yearly', 'neet-gold-half-yearly',
      'Full access to all NEET preparation resources for 6 months. Includes live classes, mock tests, PYQ papers, and detailed analytics.',
      4999.00, 'half_yearly', 182, 0,
      false, 3, v_admin_id
    )
    on conflict (institute_id, slug) do nothing
    returning plan_id into v_plan_id;

    if v_plan_id is null then
      select plan_id into v_plan_id from public.subscription_plans
      where institute_id = v_row.institute_id and slug = 'neet-gold-half-yearly';
    end if;

    insert into public.plan_unlocks (plan_id, feature_id, is_enabled)
    select v_plan_id, feature_id, true
    from public.subscription_features
    where is_active = true
    on conflict (plan_id, feature_id) do nothing;

    -- ── Yearly ───────────────────────────────────────────────────────────
    insert into public.subscription_plans (
      institute_id, stream_id, name, slug, description,
      price, billing_cycle, duration_days, trial_days,
      is_featured, sort_order, created_by
    )
    values (
      v_row.institute_id, v_stream_id,
      'NEET Gold — Yearly', 'neet-gold-yearly',
      'Full access to all NEET preparation resources for 12 months. Best value. Includes live classes, mock tests, PYQ papers, and detailed analytics.',
      8999.00, 'yearly', 365, 0,
      false, 4, v_admin_id
    )
    on conflict (institute_id, slug) do nothing
    returning plan_id into v_plan_id;

    if v_plan_id is null then
      select plan_id into v_plan_id from public.subscription_plans
      where institute_id = v_row.institute_id and slug = 'neet-gold-yearly';
    end if;

    insert into public.plan_unlocks (plan_id, feature_id, is_enabled)
    select v_plan_id, feature_id, true
    from public.subscription_features
    where is_active = true
    on conflict (plan_id, feature_id) do nothing;

  end loop;

  raise notice '✅ Subscription plans seeded — quarterly, half-yearly, yearly per institute with plans';

end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Seed Subscription System Settings
-- ════════════════════════════════════════════════════════════════════════════
-- Uses the existing Domain-10 system_settings store (per-institute key-value,
-- TEXT values + data_type contract, is_system = TRUE = platform-seeded and
-- protected from deletion). ON CONFLICT (institute_id, setting_key) DO NOTHING
-- preserves any admin-customised values on re-run.

insert into public.system_settings (
  institute_id, setting_key, setting_value, data_type,
  display_name, description, category, is_active, is_system
)
select
  i.institute_id,
  s.setting_key,
  s.setting_value,
  s.data_type::public.setting_data_type,
  s.display_name,
  s.description,
  s.category,
  true,
  true
from public.institutes i
cross join (
  values
    (
      'grace_days', '7', 'integer',
      'Grace Period (days)',
      'Number of days after the subscription end date during which a student retains full access (including live classes) before the content-only window begins.',
      'subscription'
    ),
    (
      'content_access_days', '30', 'integer',
      'Content Access Window (days)',
      'Number of days after the grace period during which Recorded Classes, Notes, PDFs and Downloads remain accessible. After this window everything is inaccessible until renewal.',
      'subscription'
    ),
    (
      'expiry_notice_days', '3', 'integer',
      'Expiry Notice (days)',
      'How many days before expiry the subscription_expiring notification is sent to the student.',
      'subscription'
    ),
    (
      'renewal_grace_enabled', 'true', 'boolean',
      'Renewal Grace Enabled',
      'When true, a subscription whose renewal fails enters the grace period instead of expiring immediately.',
      'subscription'
    )
) as s(setting_key, setting_value, data_type, display_name, description, category)
on conflict (institute_id, setting_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Validation Queries (run after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 3/4/5. Plans exist:
--    select slug, name, price, billing_cycle, duration_days, trial_days, is_featured
--    from public.subscription_plans
--    where slug in ('neet-gold-monthly', 'neet-gold-quarterly',
--                   'neet-gold-half-yearly', 'neet-gold-yearly')
--    order by sort_order;
--
--    plan_unlocks linked per plan (expect 8 features each):
--    select sp.slug, count(pu.unlock_id) filter (where pu.is_enabled) as features_linked
--    from public.subscription_plans sp
--    left join public.plan_unlocks pu on pu.plan_id = sp.plan_id
--    where sp.slug like 'neet-gold-%'
--    group by sp.slug
--    order by sp.slug;
--
-- 8. System settings seeded:
--    select institute_id, setting_key, setting_value, data_type, is_system
--    from public.system_settings
--    where setting_key in ('grace_days', 'content_access_days',
--                          'expiry_notice_days', 'renewal_grace_enabled')
--    order by setting_key, institute_id;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- NOTE: Only safe when no student_subscriptions / order_items reference the
-- new plans (true immediately after seeding). Order matters — plan_unlocks
-- (FK RESTRICT) must be removed before the plans.
--
-- delete from public.plan_unlocks
-- where plan_id in (
--   select plan_id from public.subscription_plans
--   where slug in ('neet-gold-quarterly', 'neet-gold-half-yearly', 'neet-gold-yearly')
-- );
--
-- delete from public.subscription_plans
-- where slug in ('neet-gold-quarterly', 'neet-gold-half-yearly', 'neet-gold-yearly');
--
-- delete from public.system_settings
-- where setting_key in ('grace_days', 'content_access_days',
--                       'expiry_notice_days', 'renewal_grace_enabled');

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 085 Seed Subscription Plans & System Settings
-- ════════════════════════════════════════════════════════════════════════════
