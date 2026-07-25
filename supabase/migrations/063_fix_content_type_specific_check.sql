-- ============================================================================
-- Migration: 063 — Fix content type-specific check constraint
--
-- Removes the requirement that `page_count IS NOT NULL` when
-- `content_type = 'pdf'`, so teachers can upload PDFs without
-- specifying a page count.
--
-- Safety:
--   • Drops the old constraint, then atomically creates the new one
--     (single statement with IF EXISTS guards).
--   • Existing rows are unaffected — the new constraint will be
--     validated against all rows on creation, but since we are only
--     relaxing the PDF clause (removing the NOT NULL requirement),
--     no existing row can violate it.
-- ============================================================================

alter table public.content
  drop constraint if exists ck_content_type_specific;

alter table public.content
  add constraint ck_content_type_specific check (
    (content_type = 'video' and duration_seconds is not null)
    or (content_type = 'assignment' and duration_seconds is null)
    or (content_type = 'notes')
    or (content_type = 'pdf')
  );

-- Preserve the comment (updated to reflect the new rule)
comment on constraint ck_content_type_specific on public.content is
  'Content-type-specific column requirements: video requires duration_seconds; '
  'assignment must not have duration_seconds; notes and PDF have no additional '
  'column requirements. Enforced at the DB level for safety across all insert '
  'paths (Edge Functions, admin tools).';
