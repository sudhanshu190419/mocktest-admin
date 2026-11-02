-- ============================================================================
-- Migration 220: Restrict Active Installment Plans and Dispute Restoration RLS
-- ============================================================================
--
-- Context:
--   Follow-up to Migration 219 (applied and verified on demo/testing database).
--
-- Security Objectives:
--   1. Restrict course_installment_plans_select:
--      Authenticated students must only be permitted to read active installment
--      plans (is_active = true).
--   2. Preserve course_installment_plans_admin_manage:
--      Administrators retain full read, write, and management access across all
--      plans (both active and inactive) through the separate permissive admin policy.
--   3. Drop installment_dispute_restorations_select:
--      Students must have NO direct SELECT access to dispute-restoration records.
--   4. Preserve installment_dispute_restorations_admin_manage:
--      Administrators retain full access to manage and review dispute restorations.
--   5. Maintain existing RLS policies on webhook_quarantine_events:
--      Quarantine records remain strictly restricted to administrators and trusted
--      service-role operations.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Restrict course_installment_plans SELECT access to active plans only
-- ----------------------------------------------------------------------------
drop policy if exists "course_installment_plans_select" on public.course_installment_plans;

create policy "course_installment_plans_select"
    on public.course_installment_plans
    for select
    to authenticated
    using (is_active = true);

-- ----------------------------------------------------------------------------
-- 2. Drop direct student SELECT access to installment_dispute_restorations
-- ----------------------------------------------------------------------------
drop policy if exists "installment_dispute_restorations_select" on public.installment_dispute_restorations;

-- ----------------------------------------------------------------------------
-- Verification Notes:
--   The following policies are explicitly preserved and remain active from Migration 219:
--     • "course_installment_plans_admin_manage" on public.course_installment_plans
--       (FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin()))
--     • "installment_dispute_restorations_admin_manage" on public.installment_dispute_restorations
--       (FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin()))
--     • "webhook_quarantine_events_admin_select" on public.webhook_quarantine_events
--       (FOR SELECT TO authenticated USING (public.is_admin()))
--     • "webhook_quarantine_events_admin_manage" on public.webhook_quarantine_events
--       (FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin()))
-- ----------------------------------------------------------------------------
