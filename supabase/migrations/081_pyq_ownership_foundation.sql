-- ============================================================================
-- Migration: 081 — PYQ Ownership Foundation (Phase 9A)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready | Idempotent
--
-- ## Purpose
--
-- Prepare the database foundation for the PYQ ownership model (Google-Drive
-- style):
--
--   • Super Admin owns PYQ **packages** (create / edit / publish / archive /
--     soft delete / restore-future). Packages remain institute-owned via
--     `institute_id` — NO `created_by` column is added to pyq_packages.
--   • Teachers own PYQ **papers** (create papers inside packages / edit own /
--     delete-archive own / manage question mappings for own papers).
--
-- This migration ONLY prepares the database foundation (columns, a best-
-- effort ownership backfill, and an index). No service, hook, page, edge
-- function, or business logic is changed (those land in Phase 9B+).
--
-- ## What this migration delivers
--
--   1. Adds `created_by` and `updated_by` to `pyq_papers` (UUID, FK to
--      profiles.profile_id) so papers can be attributed to their creating
--      teacher. `pyq_packages` intentionally gets NO ownership column —
--      packages are institute-owned; audit logs provide actor attribution.
--   2. Backfills `pyq_papers.created_by` from the only reliable historical
--      owner source: `pyq_mock_mappings.created_by` (1:1 per paper via
--      uq_pyq_mock_mappings_paper_id). Papers with no reliable source keep
--      NULL — documented behaviour below. `updated_by` is intentionally NOT
--      backfilled: we cannot know the true last updater of legacy rows, and
--      fabricating update attribution would violate its documented semantics
--      (NULL until a paper is actually edited after this migration).
--   3. Documents that the soft-delete columns (deleted_at / deleted_by /
--      delete_reason) plus their FKs and partial indexes ALREADY exist on
--      pyq_packages and pyq_papers from migration 080 — they are NOT
--      duplicated here. Enterprise soft-delete alignment is therefore
--      already satisfied.
--   4. Adds `idx_pyq_papers_created_by` so ownership-based lookups and
--      Phase 9B "my papers" queries stay indexed.
--
-- ## What this migration does NOT do
--
--   • Does NOT add created_by to pyq_packages          (institute-owned)
--   • Does NOT add a new permission / role
--   • Does NOT make ANY RLS changes — no policy is created, dropped, or
--     modified. The ownership RLS model (package mutations → Super Admin
--     only; paper mutations → created_by = auth.uid() OR Super Admin
--     override) is deliberately deferred to Phase 9B, AFTER the services
--     and UI are updated, so no existing flow is affected by this migration.
--   • Does NOT build admin package pages / teacher paper pages / sidebar
--   • Does NOT implement package CRUD / paper CRUD / restore / recycle bin
--     / permanent delete
--   • Does NOT re-add soft-delete columns (migration 080 already added them).
--
-- ## Backfill behaviour
--
-- `pyq_papers.created_by` is populated from `pyq_mock_mappings.created_by`
-- where a reliable source exists. Rows that stay NULL are legacy /
-- institute-owned papers — no teacher can be attributed reliably from
-- existing data. Once Phase 9B lands its RLS policies, those NULL rows can
-- only be mutated by Super Admin until a teacher claims them (9B may add an
-- explicit claim/assign flow or backfill-on-write).
--
-- ## Depends on
--
--   Migration 002 — public.profiles (profile_id PK, user_id)
--   Migration 007 — public.pyq_papers / pyq_mock_mappings / pyq_packages
--   Migration 080 — soft-delete columns on pyq_packages & pyq_papers
--
-- ## Idempotency
--
--   • ADD COLUMN IF NOT EXISTS
--   • DROP CONSTRAINT IF EXISTS before re-adding
--   • CREATE INDEX IF NOT EXISTS
--   • Backfill guarded by `AND p.created_by IS NULL` (safe to re-run)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — pyq_papers Ownership Columns (created_by / updated_by)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds teacher-ownership attribution to papers. Both columns are nullable
-- with no default; NULL = legacy/institute-owned paper (see SECTION 2).
-- FK style matches fk_pyq_mock_mappings_created_by (migration 007):
-- ON DELETE SET NULL preserves the paper when the actor profile is removed;
-- ON UPDATE RESTRICT. DROP CONSTRAINT IF EXISTS before ADD keeps this
-- migration idempotent.

alter table public.pyq_papers
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

alter table public.pyq_papers
  drop constraint if exists fk_pyq_papers_created_by;
alter table public.pyq_papers
  add constraint fk_pyq_papers_created_by
  foreign key (created_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

alter table public.pyq_papers
  drop constraint if exists fk_pyq_papers_updated_by;
alter table public.pyq_papers
  add constraint fk_pyq_papers_updated_by
  foreign key (updated_by) references public.profiles (profile_id)
  on delete set null
  on update restrict;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Backfill created_by from pyq_mock_mappings
-- ════════════════════════════════════════════════════════════════════════════
-- pyq_mock_mappings.created_by is the ONLY reliable historical owner source
-- in the PYQ domain (migration 007). uq_pyq_mock_mappings_paper_id
-- guarantees at most ONE mock mapping per paper, so the join below is
-- strictly 1:1 — no fan-out, no ambiguity.
--
-- `updated_by` is intentionally NOT backfilled: we cannot know the true last
-- updater of a legacy row, and fabricating update attribution would violate
-- the column's documented semantics (NULL until actually edited). Phase 9B
-- sets updated_by on genuine write operations only.
--
-- Documented behaviour for rows that stay NULL:
--   • Such papers are legacy/institute-owned — no teacher can be attributed
--     reliably from existing data.
--   • Under the Phase 9B RLS policies only Super Admin can mutate them until
--     a teacher claims them (9B may add an explicit claim/assign flow or
--     backfill-on-write).
--   • Read access is unaffected.
--
-- The `AND p.created_by IS NULL` guard makes this idempotent and prevents a
-- re-run from overwriting ownership assigned by Phase 9B.

update public.pyq_papers p
set created_by = mm.created_by
from public.pyq_mock_mappings mm
where mm.paper_id = p.paper_id
  and mm.created_by is not null
  and p.created_by is null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Soft-Delete Alignment (already provided by Migration 080)
-- ════════════════════════════════════════════════════════════════════════════
-- Enterprise soft-delete columns were added to BOTH pyq_packages and
-- pyq_papers by migration 080 (Phase 8A):
--
--   deleted_at    timestamptz   (partial index WHERE deleted_at IS NULL)
--   deleted_by    uuid          (fk_*_deleted_by → profiles, SET NULL)
--   delete_reason text
--
-- They are therefore NOT re-created here. Phase 9C (Restore / Recycle Bin)
-- will consume them exactly as every other Phase 8 resource. No action
-- required in this migration.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- Ownership lookups (created_by = auth.uid() — the Phase 9B "my papers"
-- queries and the ownership RLS USING clause) are served by this index.
-- CREATE INDEX IF NOT EXISTS keeps it idempotent. No existing index name is
-- reused or collided with.

create index if not exists idx_pyq_papers_created_by
  on public.pyq_papers (created_by);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

comment on column public.pyq_papers.created_by is
  'FK to profiles.profile_id — the teacher who created this paper. NULL for '
  'legacy/institute-owned papers until a reliable owner is attributed. '
  'Phase 9B RLS will let owners manage their own papers; Super Admin overrides.';
comment on column public.pyq_papers.updated_by is
  'FK to profiles.profile_id — the last user who updated this paper. NULL '
  'until a paper is edited after this migration.';

comment on constraint fk_pyq_papers_created_by on public.pyq_papers is
  'created_by references profiles(profile_id). SET NULL preserves the paper '
  'when the creating teacher profile is removed; ON UPDATE RESTRICT.';
comment on constraint fk_pyq_papers_updated_by on public.pyq_papers is
  'updated_by references profiles(profile_id). SET NULL on actor removal.';

comment on index public.idx_pyq_papers_created_by is
  'Supports ownership-based lookups (created_by = auth.uid()) and Phase 9B '
  'teacher "my papers" queries and RLS.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after applying the migration)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Ownership columns added to pyq_papers (expect created_by, updated_by):
--    select column_name, data_type
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'pyq_papers'
--      and column_name in ('created_by', 'updated_by');
--
-- 2. pyq_packages has NO created_by (expect 0 rows):
--    select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'pyq_packages'
--      and column_name = 'created_by';
--
-- 3. Ownership FKs exist (expect fk_pyq_papers_created_by / _updated_by):
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.pyq_papers'::regclass
--      and conname in ('fk_pyq_papers_created_by', 'fk_pyq_papers_updated_by');
--
-- 4. Backfill outcome (expect N >= 0 rows, M = number of mock mappings):
--    select
--      (select count(*) from public.pyq_papers where created_by is not null) as owned_papers,
--      (select count(*) from public.pyq_papers where created_by is null)     as unowned_papers;
--
-- 5. Ownership index created:
--    select indexname from pg_indexes
--    where schemaname = 'public' and indexname = 'idx_pyq_papers_created_by';
--
-- 6. Soft-delete columns still present from migration 080 (expect 3 each):
--    select column_name from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('pyq_packages', 'pyq_papers')
--      and column_name in ('deleted_at', 'deleted_by', 'delete_reason')
--    order by table_name, column_name;
--
-- 7. No RLS changes made by this migration (expect the SAME policy set as
--    before applying 081 — this migration creates/drops/modifies no policy):
--    select policyname, cmd
--    from pg_policies
--    where schemaname = 'public'
--      and tablename in ('pyq_packages', 'pyq_papers')
--    order by tablename, policyname;
--    → Expect the ORIGINAL migration-021 policies only: the two FOR ALL
--      "Admins have full access to pyq_*" policies plus the member/student
--      read policies. NO "Admins can read", "Super admins can manage",
--      or "Paper owners can manage" policies yet — those land in Phase 9B.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 081 must be reverted):
--
--   -- 1. Drop the ownership index
--   drop index if exists idx_pyq_papers_created_by;
--
--   -- 2. Drop the ownership FKs and columns (backfill data is destroyed)
--   alter table public.pyq_papers drop constraint if exists fk_pyq_papers_created_by;
--   alter table public.pyq_papers drop constraint if exists fk_pyq_papers_updated_by;
--   alter table public.pyq_papers
--     drop column if exists created_by,
--     drop column if exists updated_by;
--
--   -- 3. Soft-delete columns are NOT touched by rollback — they belong to
--   --    migration 080 and must be rolled back there if ever required.
--   -- 4. No RLS policies are touched by this migration, so none need to be
--   --    restored on rollback. The ownership RLS policies land in Phase 9B
--   --    and must be rolled back there if ever required.
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 081 PYQ Ownership Foundation
-- ════════════════════════════════════════════════════════════════════════════
