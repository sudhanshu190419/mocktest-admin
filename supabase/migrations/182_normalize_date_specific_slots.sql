-- ============================================================================
-- Migration: 182 — Normalize Date-Specific Timetable Slots
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   1. Ensure all single-day timetable slots (valid_from = valid_until) have
--      is_recurring = false in public.timetable_slots.
--   2. Guarantees that any slots created before Migration 181 with is_recurring = true
--      are properly recognized as date-specific one-off slots by mobile and web clients.
-- ============================================================================

UPDATE public.timetable_slots
SET is_recurring = false,
    updated_at = now()
WHERE valid_from IS NOT NULL
  AND valid_until IS NOT NULL
  AND valid_from = valid_until
  AND is_recurring = true;
