-- ============================================================================
-- Migration: 140 — Fix Duplicate Mock Test Questions Order Sequence & Add Constraint
--
-- Description:
--   1. Deterministically normalizes and re-indexes all order_sequence values in
--      public.mock_test_questions into clean contiguous sequences (1..N).
--   2. Adds UNIQUE (test_id, order_sequence) constraint to permanently block
--      duplicate display order values at the database level.
-- ============================================================================

-- Step 1: Repair any existing duplicate or gapped order_sequence rows
with ranked as (
  select
    test_id,
    question_id,
    row_number() over (
      partition by test_id
      order by order_sequence asc, added_at asc, question_id asc
    ) as new_order
  from public.mock_test_questions
)
update public.mock_test_questions mtq
set order_sequence = ranked.new_order
from ranked
where mtq.test_id = ranked.test_id
  and mtq.question_id = ranked.question_id
  and mtq.order_sequence != ranked.new_order;

-- Step 2: Add UNIQUE constraint on (test_id, order_sequence)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_mock_test_questions_test_order'
  ) then
    alter table public.mock_test_questions
      add constraint uq_mock_test_questions_test_order unique (test_id, order_sequence);
  end if;
end $$;

comment on constraint uq_mock_test_questions_test_order on public.mock_test_questions is
  'Guarantees that each question within a mock test has a unique display order_sequence.';
