-- ============================================================================
-- Migration: 139 — Backfill Mock Tests Total Marks
--
-- Description:
--   Synchronizes public.mock_tests.total_marks with the sum of marks from
--   assigned questions in public.mock_test_questions.
--   Only updates tests where assigned questions exist and total marks > 0.
-- ============================================================================

-- Backfill total_marks for existing mock tests from mock_test_questions
update public.mock_tests mt
set total_marks = sub.sum_marks
from (
  select
    test_id,
    sum(marks) as sum_marks
  from public.mock_test_questions
  group by test_id
  having sum(marks) > 0
) sub
where mt.test_id = sub.test_id
  and mt.total_marks != sub.sum_marks;

comment on column public.mock_tests.total_marks is
  'Sum of all question marks. Synchronized on question mutations and frozen at publish time.';
