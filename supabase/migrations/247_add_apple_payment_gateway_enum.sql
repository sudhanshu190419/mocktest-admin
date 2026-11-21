-- ============================================================================
-- Migration 247: Add 'apple' to payment_gateway Enum
-- ============================================================================
--
-- PURPOSE:
--   Registers 'apple' as a valid payment_gateway enum value for Apple In-App
--   Purchases (StoreKit 2).
--
-- POSTGRESQL ENUM TRANSACTION SAFETY:
--   In PostgreSQL (including Supabase), ALTER TYPE ... ADD VALUE cannot be used
--   in the same transaction block as expressions, casts, or functions referencing
--   the new value ('apple'::public.payment_gateway).
--   Therefore, this migration is strictly isolated so the enum change commits
--   independently before Migration 248 references it.
--
-- IDEMPOTENCY:
--   Safe to re-run. Checks pg_enum before altering.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'public.payment_gateway'::regtype
      AND enumlabel = 'apple'
  ) THEN
    ALTER TYPE public.payment_gateway ADD VALUE 'apple';
  END IF;
END $$;

