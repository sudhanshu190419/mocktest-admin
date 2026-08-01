-- ============================================================================
-- Migration: 079 — Trusted Device Fingerprint Lookup (Phase 7E)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   Support "same physical device" recognition for the Trusted Device system.
--   All browsers on the same physical machine should be treated as the same
--   trusted device. The device-challenge Edge Function now falls back to a
--   fingerprint lookup when the token lookup misses, so a new browser on an
--   already-approved machine can re-issue a fresh token without a new approval.
--
--   This migration is DATABASE ONLY and intentionally minimal:
--     • Adds a partial index (profile_id, fingerprint_hash) WHERE status = 'approved'
--       for the challenge-time fingerprint lookup (hot path).
--     • Adds a general (profile_id, fingerprint_hash) index for the
--       pending/rejected/revoked/expired/inactive fingerprint lookups
--       (status dedupe — surface the machine's existing status instead of
--       creating duplicate pending rows).
--     • Updates the fingerprint_hash column comments to reflect its new role
--       as a physical-machine identity signal.
--
--   Explicitly NOT changed (backward compatibility):
--     • No new tables
--     • No removed columns
--     • No RLS changes
--     • No enum changes
--     • No constraint changes
--     • No data migration — legacy approved devices with a NULL
--       fingerprint_hash self-bind on the next successful token login
--       (handled in the Edge Function, not here).
--
-- Idempotent: CREATE INDEX IF NOT EXISTS / COMMENT ON are re-runnable.
--
-- Reference: Documentation/Trusted_Device_Security_Architecture.md (Phase 7E)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Partial Index: approved-device fingerprint lookup (hot path)
-- ════════════════════════════════════════════════════════════════════════════
-- Challenge-time lookup: when the token lookup misses, find the profile's
-- APPROVED machine by fingerprint so a fresh token can be re-issued onto the
-- same row. Scoped to status='approved' so this index stays small and fast
-- even as the table grows with pending/rejected/revoked history.
create index if not exists idx_trusted_devices_profile_fingerprint_approved
  on public.trusted_devices (profile_id, fingerprint_hash)
  where status = 'approved'::public.trusted_device_status;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — General index: non-approved fingerprint lookups (status dedupe)
-- ════════════════════════════════════════════════════════════════════════════
-- When the token lookup misses and the fingerprint does NOT match an approved
-- device, the Edge Function still checks whether the fingerprint matches a
-- pending / rejected / revoked / expired / inactive row so it can return that
-- existing status instead of minting a duplicate pending request for the same
-- machine. This index serves those lookups across all statuses.
create index if not exists idx_trusted_devices_profile_fingerprint
  on public.trusted_devices (profile_id, fingerprint_hash);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Column Comment Updates
-- ════════════════════════════════════════════════════════════════════════════
-- fingerprint_hash is no longer a passive "signal only" field — it is now the
-- physical-machine identity used to re-issue tokens across browsers on the
-- same machine. Comments updated to reflect the new role (and its limits).
comment on column public.trusted_devices.fingerprint_hash is
  'SHA-256 of canonicalized, cross-browser-stable machine characteristics '
  '(platform + WebGL GPU renderer + screen + timezone + CPU cores). '
  'Identifies the PHYSICAL MACHINE, not the browser, so every browser on the '
  'same approved machine can re-issue a fresh token without a new approval. '
  'Browser-specific signals (deviceMemory, userAgentData, preferred '
  'languages) are deliberately excluded — they would break cross-browser '
  'matching on one machine. NULL for legacy rows until the first successful '
  'token login self-binds it. Never raw fingerprint data.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after migration)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Indexes exist:
--    select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'trusted_devices'
--    order by indexname;
--    → Expect the new:
--        idx_trusted_devices_profile_fingerprint
--        idx_trusted_devices_profile_fingerprint_approved
--      alongside the pre-existing 077/078 indexes.
--
-- 2. Partial index predicate:
--    select indexdef from pg_indexes
--    where schemaname = 'public' and tablename = 'trusted_devices'
--    and indexname = 'idx_trusted_devices_profile_fingerprint_approved';
--    → Expect "... WHERE status = 'approved'".
--
-- 3. Re-runnable (idempotency):
--    Re-running this migration must complete without error.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 079 must be reverted):
--
--   drop index if exists public.idx_trusted_devices_profile_fingerprint_approved;
--   drop index if exists public.idx_trusted_devices_profile_fingerprint;
--
--   -- Restore the original 077 comment:
--   comment on column public.trusted_devices.fingerprint_hash is
--     'Coarse fingerprint hash (UA family + OS + screen + timezone). Signal '
--     'only — never used as an identity identifier.' ;
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 079 Trusted Device Fingerprint Lookup
-- ════════════════════════════════════════════════════════════════════════════
