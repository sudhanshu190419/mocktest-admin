-- ============================================================================
-- Migration: 042 — Add 'course' to item_type Enum
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Standalone enum value addition. This MUST be a separate migration because
-- PostgreSQL does not allow ALTER TYPE ... ADD VALUE to be executed in a
-- transaction block that also references the new enum value (error 55P04).
--
-- The ALTER TYPE commits immediately. Any schema changes that reference
-- item_type = 'course' (columns, constraints, indexes) must be in a
-- subsequent migration (see migration 043).
--
-- Depends on:
--   Migration 008 — Domain 07 Commerce (defines item_type enum)
--
-- @module migrations/042
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Add 'course' to item_type Enum
-- ════════════════════════════════════════════════════════════════════════════
-- Uses ALTER TYPE ... ADD VALUE IF NOT EXISTS (PostgreSQL 14+). This runs as
-- a standalone SQL statement because ADD VALUE cannot be executed inside a
-- transaction block. The IF NOT EXISTS clause makes this idempotent.

ALTER TYPE item_type ADD VALUE IF NOT EXISTS 'course';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 042 Add 'course' to item_type Enum
-- ════════════════════════════════════════════════════════════════════════════
