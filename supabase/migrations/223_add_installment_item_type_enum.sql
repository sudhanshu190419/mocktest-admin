-- ============================================================================
-- Migration 223: Add 'installment' value to public.item_type enum
-- ============================================================================
-- Purpose:
--   Extends the public.item_type enum with the new value 'installment' to
--   support course installment orders in public.order_items.
--
-- Transaction Note:
--   PostgreSQL requires that a newly added enum value be committed in its own
--   transaction before it can be referenced in check constraints, functions,
--   or table expressions. Migration 224 depends on this enum value being committed.
--
-- Repositories:
--   - C:\Projects\mocktest-admin\supabase\migrations\223_add_installment_item_type_enum.sql
--   - C:\Projects\MockTestApp\supabase\migrations\223_add_installment_item_type_enum.sql
-- ============================================================================

alter type public.item_type add value if not exists 'installment';

comment on type public.item_type is
  'Polymorphic product discriminator for order items: course, subscription_plan, pyq_package, installment.';
