-- ============================================================================
-- Migration: 017 — Global Foreign Keys
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Add every FOREIGN KEY constraint that could not be declared in
--          its origin migration because the referenced table belonged to a
--          later domain and did not yet exist.
--
-- Strategy:
--   Each FK below was originally documented with a TODO comment in the source
--   migration. All referenced tables now exist. The migration executes safely
--   because every FK references a table created by a prior migration and the
--   existing data either already satisfies the constraint or the FK is
--   declared with ON DELETE SET NULL / RESTRICT as appropriate.
--
-- Deferred FKs resolved in this migration:
--
--   1.  Domain 06 (PYQ) — student_pyq_purchases.order_item_id
--         →  Domain 07 (Commerce) — order_items.item_id
--
--   2.  Domain 07 (Commerce) — order_items.plan_id
--         →  Domain 11 (Subscription & Access Control) — subscription_plans.plan_id
--
-- Reference: 007_domain_06_pyq.sql (TODO comments)
--            008_domain_07_commerce.sql (TODO comments)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Deferred Foreign Keys
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. student_pyq_purchases → order_items
--
-- Original migration: 007_domain_06_pyq.sql
--   — Column student_pyq_purchases.order_item_id was created as UUID NULL
--     with a TODO comment: "Add FK to order_items.item_id after Domain 07
--     (Commerce) migration has been applied."
--
-- Rationale:
--   Links a PYQ package purchase to the commerce order item that represents
--   the financial transaction. NULL is permitted because some purchases may
--   be granted by admins without an associated order (free grants, manual
--   activation).
--
-- Cascade rule: ON DELETE SET NULL
--   If the order_item is deleted (data retention purge), the purchase record
--   is preserved — the student still has access to the purchased PYQ
--   package. Only the financial attribution link is cleared.

alter table only public.student_pyq_purchases
  add constraint fk_student_pyq_purchases_order_item
  foreign key (order_item_id) references public.order_items (item_id)
  on delete set null
  on update restrict;

-- 1b. order_items → subscription_plans
--
-- Original migration: 008_domain_07_commerce.sql
--   — Column order_items.plan_id was created as UUID NULL with a
--     commented-out FK definition: "TODO: Add FK to subscription_plans.plan_id
--     after Domain 11 (Subscription & Access Control) migration."
--
-- Rationale:
--   An order item can reference either a subscription plan (plan_id) or a
--   PYQ package (package_id). Exactly one of these should be non-NULL.
--   The corresponding FK for package_id was already declared in the original
--   migration; plan_id was deferred because subscription_plans did not exist.
--
-- Cascade rule: ON DELETE RESTRICT
--   Prevents deletion of a subscription plan that has associated order items.
--   This is a financial record — the plan should be soft-deactivated (via
--   is_active = FALSE in subscription_plans), not hard-deleted. RESTRICT
--   on the FK enforces this discipline at the database level.

alter table only public.order_items
  add constraint fk_order_items_plan
  foreign key (plan_id) references public.subscription_plans (plan_id)
  on delete restrict
  on update restrict;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Verification (Optional — run after applying)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Verify all deferred FKs are now in place:
--
--   select conname, conrelid::regclass as table_name
--   from   pg_constraint
--   where  contype = 'f'
--     and  conname in (
--            'fk_student_pyq_purchases_order_item',
--            'fk_order_items_plan'
--          )
--   order by conname;
--
-- Expected output:
--
--              conname              |         table_name
--   ───────────────────────────────┼─────────────────────────────
--    fk_order_items_plan           | public.order_items
--    fk_student_pyq_purchases_order_item | public.student_pyq_purchases
--
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 017 Global Foreign Keys
-- ════════════════════════════════════════════════════════════════════════════
