-- ============================================================================
-- Migration 133: Add result release audit action types
--
-- Adds `result_released` and `result_unreleased` to the audit_action_type
-- PostgreSQL enum so the audit service can record result release events.
--
-- ============================================================================

-- Add new enum values (safe — appending to enum never breaks existing rows)
alter type public.audit_action_type add value if not exists 'result_released';
alter type public.audit_action_type add value if not exists 'result_unreleased';
