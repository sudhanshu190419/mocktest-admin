-- ============================================================================
-- Migration: 047 — Add Commerce Event Types to notification_event_type Enum
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Standalone enum value addition. This MUST be a separate migration because
-- PostgreSQL does not allow ALTER TYPE ... ADD VALUE to be executed in a
-- transaction block that also references the new enum value (error 55P04).
--
-- The ALTER TYPE commits immediately. Any schema changes that reference
-- the new event types (notification triggers, service helper functions, etc.)
-- must be in a subsequent migration.
--
-- Depends on:
--   Migration 010 — Domain 09 Notifications (defines notification_event_type enum)
--
-- @module migrations/047
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Add Commerce Event Types to notification_event_type Enum
-- ════════════════════════════════════════════════════════════════════════════
-- Uses ALTER TYPE ... ADD VALUE IF NOT EXISTS (PostgreSQL 14+). This runs as
-- a standalone SQL statement because ADD VALUE cannot be executed inside a
-- transaction block. The IF NOT EXISTS clause makes this idempotent.
--
-- Each new value is added independently to:
--   1. Avoid dependency between values (each is a separate DDL command)
--   2. Allow partial success if one value already exists
--   3. Follow PostgreSQL restrictions: ADD VALUE cannot be in a subtransaction

ALTER TYPE notification_event_type ADD VALUE IF NOT EXISTS 'course_purchased';

ALTER TYPE notification_event_type ADD VALUE IF NOT EXISTS 'pyq_purchased';

ALTER TYPE notification_event_type ADD VALUE IF NOT EXISTS 'course_enrolled';

ALTER TYPE notification_event_type ADD VALUE IF NOT EXISTS 'pyq_access_granted';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 047 Add Commerce Event Types to notification_event_type Enum
-- ════════════════════════════════════════════════════════════════════════════
