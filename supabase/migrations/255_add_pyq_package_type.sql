-- ============================================================================
-- Migration 255: Add package_type to pyq_packages (Phase 4: PYQ & Mock Tests)
--
-- Extends the existing pyq_packages infrastructure to support standalone
-- purchasable Mock Test Packages alongside traditional PYQ Packages.
--
-- Allowed values:
--   'pyq'       - Previous Year Questions package (default)
--   'mock_test' - Standalone Mock Test package
--
-- Backward Compatibility:
--   - Non-null with default 'pyq' ensures all existing records remain PYQ packages.
--   - Existing orders, payments, webhooks, and fulfillment RPCs remain intact.
-- ============================================================================

-- 1. Add package_type column with default 'pyq'
ALTER TABLE public.pyq_packages
  ADD COLUMN IF NOT EXISTS package_type text NOT NULL DEFAULT 'pyq';

-- 2. Add CHECK constraint for allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_pyq_packages_package_type'
  ) THEN
    ALTER TABLE public.pyq_packages
      ADD CONSTRAINT ck_pyq_packages_package_type
      CHECK (package_type IN ('pyq', 'mock_test'));
  END IF;
END $$;

-- 3. Add partial index for fast catalogue and admin queries
CREATE INDEX IF NOT EXISTS idx_pyq_packages_type_active
  ON public.pyq_packages (package_type, is_active)
  WHERE deleted_at IS NULL;

-- 4. Document column purpose
COMMENT ON COLUMN public.pyq_packages.package_type IS
  'Distinguishes standard previous year question packages (pyq) from standalone purchasable mock test packages (mock_test).';

