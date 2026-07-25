-- ============================================================================
-- Migration: 054 — Add mock_test_assigned to notification_event_type Enum
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Standalone enum value addition. This MUST be a separate migration because
-- PostgreSQL does not allow ALTER TYPE ... ADD VALUE to be executed in a
-- transaction block that also references the new enum value (error 55P04).
--
-- The ALTER TYPE commits immediately. Any schema changes that reference
-- the new event type must be in a subsequent migration.
--
-- Depends on:
--   Migration 010 — Domain 09 Notifications (defines notification_event_type enum)
--
-- @module migrations/054
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Add mock_test_assigned to notification_event_type Enum
-- ════════════════════════════════════════════════════════════════════════════

alter type notification_event_type add value if not exists 'mock_test_assigned';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 054 Add mock_test_assigned to notification_event_type
-- ════════════════════════════════════════════════════════════════════════════
