-- ============================================================================
-- Migration: 088 — Repair Missing Subscription Features & Plan Unlocks
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Production data repair. The subscription catalogue is partially
--          seeded: subscription_plans contains the expected plans (Monthly
--          from 023, plus Quarterly / Half-Yearly / Yearly from 085), but
--          subscription_features and plan_unlocks are EMPTY. As a result,
--          the mobile plans query — which embeds plan_unlocks!inner and
--          subscription_features!inner (INNER JOINs) — drops every plan
--          from the response and the app shows "No plans available".
--
-- Root cause (verified against migration history):
--   • Migration 023_seed_data.sql STEP 8 is the ONLY migration in the
--     entire history that inserts into subscription_features. The
--     production database never received those 8 canonical feature rows.
--   • Both 023 and 085 create plan_unlocks via source-driven joins:
--       insert into public.plan_unlocks (plan_id, feature_id, is_enabled)
--       select ... from public.subscription_features where is_active = true
--     An empty features table therefore silently produces zero unlock
--     rows (no error, no warning).
--   • RLS is NOT a factor: the SELECT policy on subscription_features is
--     global (is_active = true, no institute filter) and plan_unlocks
--     visibility follows parent-plan visibility (all plans are visible).
--
-- Repair strategy:
--   1. Insert the canonical 8 subscription_features using the EXACT values
--      from Migration 023 STEP 8 — nothing invented, nothing renamed.
--   2. Backfill plan_unlocks for EVERY active plan × EVERY active feature.
--   Both statements are fully idempotent (ON CONFLICT ... DO NOTHING) and
--   safe to re-run. Existing plans, existing unlock rows, RLS, triggers,
--   functions and application code are untouched.
--
-- Scope: ONLY public.subscription_features and public.plan_unlocks.
--
-- Depends on: Migration 012 (Domain 11 — tables, FKs, unique constraints)
--             Migration 023 (canonical feature definitions — reused verbatim)
-- Reference: Phase 11E.1/11E.2 root-cause analysis (approved) | 085 seed style
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Insert the canonical 8 subscription features
-- ════════════════════════════════════════════════════════════════════════════
-- Values copied VERBATIM from 023_seed_data.sql STEP 8 (lines 497–507) so
-- the feature catalogue is byte-for-byte identical to the originally
-- intended seed. ON CONFLICT (feature_key) DO NOTHING keeps the migration
-- idempotent and preserves any pre-existing/admin-modified rows (feature_id,
-- is_active, sort_order, etc. are never overwritten). All values satisfy the
-- table CHECK constraints from 012 (key format ^[a-z][a-z0-9_]*$, etc.).

insert into public.subscription_features (feature_key, display_name, description, category, sort_order)
values
  ('live_classes_access',    'Live Classes',      'Access to all live classes',                'live_classes',      1),
  ('recorded_classes_access','Recorded Classes',  'Access to recorded lecture library',         'recorded_classes',  2),
  ('mock_tests_access',      'Mock Tests',        'Access to all mock tests',                   'mock_tests',        3),
  ('pyq_papers_access',      'PYQ Papers',        'Access to previous year question papers',    'pyq_papers',        4),
  ('notes_access',           'Notes',             'Access to study notes',                      'notes',             5),
  ('assignments_access',     'Assignments',       'Access to assignments',                      'assignments',       6),
  ('analytics_access',       'Analytics',         'Access to performance analytics',            'analytics',         7),
  ('downloads_access',       'Downloads',         'Download content for offline access',        'downloads',         8)
on conflict (feature_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Backfill plan_unlocks (every active plan × every active feature)
-- ════════════════════════════════════════════════════════════════════════════
-- Cross join of active plans with active features reproduces exactly the
-- unlock set the original seeds (023/085) intended — but driven per-plan so
-- ALL plans are repaired (Monthly plus 085's three), not only newly created
-- ones. ON CONFLICT (plan_id, feature_id) DO NOTHING is idempotent and never
-- overrides an existing unlock row (e.g. a feature the admin intentionally
-- disabled or removed stays as-is).
--
-- This intentionally applies the platform-wide active feature set to every
-- active plan in EVERY institute (the canonical 023/085 semantics: plans
-- unlock all active features). A future plan that should expose only a
-- subset of features is a deliberate per-plan override, not a regression.
-- The unique constraint uq_plan_unlocks_plan_feature (012) backs the conflict
-- target; both FKs (plan → subscription_plans, feature → subscription_features)
-- are satisfied by construction.

insert into public.plan_unlocks (plan_id, feature_id, is_enabled)
select sp.plan_id, sf.feature_id, true
from public.subscription_plans sp
cross join public.subscription_features sf
where sp.is_active = true
  and sf.is_active = true
on conflict (plan_id, feature_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Validation Queries (run after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Features seeded (expect exactly 8, all active):
--    select feature_key, display_name, category, sort_order, is_active
--    from public.subscription_features
--    order by sort_order;
--
-- 2. Unlocks backfilled per plan (expect 8 enabled features per active plan):
--    select sp.slug,
--           count(pu.unlock_id) as unlocks_total,
--           count(pu.unlock_id) filter (where pu.is_enabled) as unlocks_enabled
--    from public.subscription_plans sp
--    left join public.plan_unlocks pu on pu.plan_id = sp.plan_id
--    where sp.is_active = true
--    group by sp.slug
--    order by sp.slug;
--
-- 3. No active plan left without unlocks (expect 0 rows):
--    select sp.plan_id, sp.slug
--    from public.subscription_plans sp
--    left join public.plan_unlocks pu on pu.plan_id = sp.plan_id
--    where sp.is_active = true
--    group by sp.plan_id, sp.slug
--    having count(pu.unlock_id) = 0;
--
-- 4. No orphan unlocks referencing missing features (expect 0 rows):
--    select pu.unlock_id
--    from public.plan_unlocks pu
--    left join public.subscription_features sf on sf.feature_id = pu.feature_id
--    where sf.feature_id is null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- This is a repair/seed migration; rolling back means removing the rows it
-- created. SAFETY: only run the deletes below when the rows demonstrably
-- originated from THIS migration (e.g. immediately after applying on an
-- environment that was previously empty). In production, do NOT bulk-delete
-- before confirming no student_subscriptions / access-check logic depends on
-- the unlocks.
--
-- NOTE: FK order matters — plan_unlocks (FK RESTRICT) must be removed before
--       the features they reference.
--
-- -- 2a. Remove unlocks created by this migration — scoped to the 8
-- --     canonical features so unrelated unlocks are never touched:
-- delete from public.plan_unlocks
-- where plan_id in (
--   select plan_id from public.subscription_plans where is_active = true
-- )
-- and feature_id in (
--   select feature_id from public.subscription_features
--   where feature_key in (
--     'live_classes_access', 'recorded_classes_access', 'mock_tests_access',
--     'pyq_papers_access', 'notes_access', 'assignments_access',
--     'analytics_access', 'downloads_access'
--   )
-- );
--
-- -- 2b. Remove the 8 canonical features IF inserted by this migration
-- --     (safe only while no remaining plan_unlocks rows reference them):
-- delete from public.subscription_features
-- where feature_key in (
--   'live_classes_access', 'recorded_classes_access', 'mock_tests_access',
--   'pyq_papers_access', 'notes_access', 'assignments_access',
--   'analytics_access', 'downloads_access'
-- );

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 088 Repair Missing Subscription Features & Plan Unlocks
-- ════════════════════════════════════════════════════════════════════════════
