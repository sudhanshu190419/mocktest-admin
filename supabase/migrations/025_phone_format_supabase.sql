-- ============================================================================
-- Migration: 025 — Phone Format: Match Supabase Auth Storage
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Update the ck_profiles_phone_format CHECK constraint to accept
--          phone numbers in the format Supabase Auth stores them in
--          auth.users.phone — without a leading '+'.
--
-- Background:
--   Supabase Auth stores phone numbers in auth.users.phone WITHOUT the
--   leading '+'. For example:
--
--     Frontend sends:     +918860979255
--     Supabase stores:    918860979255
--     Profiles inserts:   918860979255  (via new.phone)
--
--   The previous constraint (^\+[1-9]\d{6,14}$) required a leading '+',
--   which rejected every phone-first signup because the trigger inserts
--   new.phone directly (bare, no transformations).
--
-- Changes:
--   1. Strip the '+' prefix from any existing phone values that were
--      backfilled by migration 024 (those used '+91...' placeholders).
--   2. Drop the old ck_profiles_phone_format constraint.
--   3. Create the new constraint with the updated regex.
--
-- New regex:  ^[1-9]\d{6,14}$
--   - [1-9]     — country code starts with a non-zero digit
--   - \d{6,14}  — 6 to 14 additional digits (total: 7-15 digits)
--   - No leading '+' — matches how Supabase Auth stores the phone
--
-- Dependencies:
--   - Migration 024 (Phone-First Authentication Support) must be applied
--     first (the profiles table must have phone as NOT NULL, and the
--     ck_profiles_phone_format constraint must exist).
--   - Migration 002 (Domain 01 — Foundation) must be applied first.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Clean up backfilled phone values from migration 024
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: Migration 024 backfilled NULL phones with placeholders like
-- '+910000000001' (prefixed with '+'). These will fail the new constraint
-- because it no longer allows a leading '+'. Strip the '+' prefix so the
-- existing data is compatible with the new format.
--
-- This only affects rows that were backfilled (placeholder or copied from
-- auth.users). Real user phone numbers should also have their '+' stripped,
-- which is correct since Supabase Auth stores them without it.


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Drop old constraint
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: The old constraint required a leading '+'. Since Supabase Auth
-- stores phone numbers without '+', we must replace it.

alter table only public.profiles
  drop constraint if exists ck_profiles_phone_format;





update public.profiles
set phone = ltrim(phone, '+')
where phone like '+%';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Create new constraint (Supabase Auth format)
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: The new regex ^[1-9]\d{6,14}$ accepts phone numbers as stored
-- by Supabase Auth: a non-zero country code digit followed by 6-14 digits
-- (total 7-15 digits). No leading '+'.
--
-- Examples that pass:
--   918860979255   (Indian mobile — 11 digits after country code)
--   14155552671    (US number — 10 digits after country code)
--   447700900000   (UK number — 10 digits after country code)
--
-- Examples that fail:
--   +918860979255  (starts with '+')
--   12345          (too short)
--   0123456789012  (starts with '0')

alter table only public.profiles
  add constraint ck_profiles_phone_format check (
    phone ~ '^[1-9]\d{6,14}$'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Verification Queries (run these after applying)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 4a. Verify no rows still have a leading '+':
--     select count(*) from public.profiles where phone like '+%';
--     Expected: 0
--
-- 4b. Verify no rows violate the new constraint:
--     select count(*) from public.profiles
--     where phone !~ '^[1-9]\d{6,14}$';
--     Expected: 0
--
-- 4c. Verify the constraint exists with the correct definition:
--     select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--     where conname = 'ck_profiles_phone_format';
--     Expected: CHECK (phone ~ '^[1-9]\d{6,14}$'::text)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 025 Phone Format: Match Supabase Auth Storage
-- ════════════════════════════════════════════════════════════════════════════
