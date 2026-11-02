-- ============================================================================
-- Migration 222: Allow Anonymous Reading of Active Installment Plans
-- ============================================================================
--
-- Context:
--   Follow-up to Migrations 219, 220, and 221.
--   Migration 220 restricted `course_installment_plans_select` strictly to
--   `authenticated` users. Consequently, unauthenticated visitors browsing the
--   public course catalog cannot view active installment plans, preventing the
--   "Pay in Installments" payment option from rendering on the course pricing card.
--
-- Objectives:
--   1. Grant table-level SELECT privilege on `public.course_installment_plans` to
--      the `anon` role (ensuring SQL privilege exists alongside RLS).
--   2. Create a dedicated RLS policy `course_installment_plans_select_anon`
--      permitting anonymous visitors to SELECT active installment plans
--      (is_active = true) only.
--   3. Strictly preserve all existing authenticated, admin, and financial policies:
--      - `course_installment_plans_select` (for authenticated students)
--      - `course_installment_plans_admin_manage` (for administrators)
--      - All student agreement, schedule, allocation, adjustment, dispute,
--        and quarantine policies and triggers from Migrations 219, 220, and 221.
--
-- Security Considerations:
--   - `public.course_installment_plans` contains only catalog terms: plan name,
--     total fee, installment count, interval, and active status.
--   - It contains NO personal student data, payment transactions, or agreements.
--   - Anonymous users receive strictly read-only access (no INSERT, UPDATE, DELETE).
--   - Inactive plans (is_active = false) remain hidden from anonymous visitors.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Ensure table-level SELECT privilege for the anonymous role
-- ----------------------------------------------------------------------------
grant select on table public.course_installment_plans to anon;

-- ----------------------------------------------------------------------------
-- 2. Allow anonymous visitors to read active installment plans
-- ----------------------------------------------------------------------------
drop policy if exists "course_installment_plans_select_anon" on public.course_installment_plans;

create policy "course_installment_plans_select_anon"
    on public.course_installment_plans
    for select
    to anon
    using (is_active = true);

-- ----------------------------------------------------------------------------
-- Verification Notes:
--   The following policies are explicitly preserved and remain active:
--     • "course_installment_plans_select" on public.course_installment_plans
--       (FOR SELECT TO authenticated USING (is_active = true))
--     • "course_installment_plans_admin_manage" on public.course_installment_plans
--       (FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin()))
--     • All RLS policies on student_course_agreements, student_installment_schedule,
--       installment_payment_allocations, installment_adjustments,
--       installment_dispute_restorations, and webhook_quarantine_events.
-- ----------------------------------------------------------------------------
