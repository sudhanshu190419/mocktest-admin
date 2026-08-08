-- ============================================================================
-- ONE-TIME REPAIR — Backfill question_snapshot for already-published mock tests
--
-- PROBLEM
-- -------
-- Mock tests published through the OLD bare status-flip path
-- (mockTestService.publishMockTest / admin updateStatus) reached
-- status = 'published' with every mock_test_questions.question_snapshot = NULL.
-- The mobile app reads only question_snapshot, so these tests render
-- "Question content is empty or unavailable".
--
-- WHAT THIS SCRIPT DOES
-- ---------------------
--   1. REPORTS every published (and archived — restorable) mock test that has
--      at least one assigned question with a NULL question_snapshot.
--   2. BACKFILLS question_snapshot for those rows using the EXACT JSON shape
--      produced by `buildQuestionSnapshot()` in the admin web app
--      (mockTestPublishService.ts) — including the snapshotVersion, camelCase
--      keys, option images (displayOrder), and question images (imageRole).
--   3. RE-REPORTS to confirm zero remaining NULL snapshots.
--
-- SAFETY
-- ------
--   * Idempotent: only rows with question_snapshot IS NULL are touched.
--   * Does NOT modify mock_tests.status, questions, options, or RLS.
--   * Runs as a plain script — execute it in the Supabase SQL editor
--     (service-role context) or via psql. It is NOT part of the migration
--     chain (do not rename into migrations/ — it must be run manually once).
--   * After this runs, migration-100 trigger trg_mock_tests_block_publish_
--     without_snapshots will allow these tests to be edited/re-published
--     normally.
--
-- USAGE
-- -----
--   1. Preview: run SECTION 1 only.
--   2. Repair:   run SECTIONS 1 + 2 + 3 (all together is fine — section 2 is
--                idempotent, section 3 verifies).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — REPORT affected tests
-- ════════════════════════════════════════════════════════════════════════════

select
  mt.test_id,
  mt.title,
  mt.status,
  mt.published_at,
  count(*)                                             as total_questions,
  count(*) filter (where mtq.question_snapshot is null) as missing_snapshots
from public.mock_tests mt
join public.mock_test_questions mtq
  on mtq.test_id = mt.test_id
where mt.status in ('published', 'archived')
  and mtq.question_snapshot is null
group by mt.test_id, mt.title, mt.status, mt.published_at
order by mt.status, mt.title;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — BACKFILL question_snapshot
--
-- Replicates buildQuestionSnapshot() exactly:
--   snapshotVersion=1, questionId, questionText, questionType, difficulty,
--   subjectId, chapterId, marks (from questions.marks), negativeMarks,
--   options[{optionId, optionText, isCorrect, orderSequence, images[]}],
--   correctNumericalAnswer, numericalTolerance, explanationText,
--   explanationVideoUrl, images[{storageBucket, storagePath, imageRole,
--   altText, orderSequence}]
-- ════════════════════════════════════════════════════════════════════════════

update public.mock_test_questions as mtq
set question_snapshot = build.question_snapshot
from (
  select
    mtq2.test_id,
    mtq2.question_id,
    jsonb_build_object(
      'snapshotVersion', 1,
      'questionId', q.question_id,
      'questionText', q.question_text,
      'questionType', q.question_type::text,
      'difficulty', q.difficulty::text,
      'subjectId', q.subject_id,
      'chapterId', q.chapter_id,
      'marks', q.marks,
      'negativeMarks', q.negative_marks,
      'options', coalesce(
        (
          select jsonb_agg(jsonb_build_object(
            'optionId', o.option_id,
            'optionText', o.option_text,
            'isCorrect', o.is_correct,
            'orderSequence', o.order_sequence,
            'images', coalesce(
              (
                select jsonb_agg(jsonb_build_object(
                  'storageBucket', oi.storage_bucket,
                  'storagePath', oi.storage_path,
                  'altText', oi.alt_text,
                  'displayOrder', oi.display_order
                ) order by oi.display_order)
                from public.question_option_images oi
                where oi.option_id = o.option_id
              ),
              '[]'::jsonb
            )
          ) order by o.order_sequence)
          from public.question_options o
          where o.question_id = q.question_id
        ),
        '[]'::jsonb
      ),
      'correctNumericalAnswer', e.correct_numerical_answer,
      'numericalTolerance', e.numerical_tolerance,
      'explanationText', e.explanation_text,
      'explanationVideoUrl', e.explanation_video_url,
      'images', coalesce(
        (
          select jsonb_agg(jsonb_build_object(
            'storageBucket', qi.storage_bucket,
            'storagePath', qi.storage_path,
            'imageRole', qi.image_role::text,
            'altText', qi.alt_text,
            'orderSequence', qi.order_sequence
          ) order by qi.order_sequence)
          from public.question_images qi
          where qi.question_id = q.question_id
        ),
        '[]'::jsonb
      )
    ) as question_snapshot
  from public.mock_test_questions mtq2
  join public.questions q
    on q.question_id = mtq2.question_id
  left join public.question_explanations e
    on e.question_id = mtq2.question_id
  join public.mock_tests mt
    on mt.test_id = mtq2.test_id
   and mt.status in ('published', 'archived')
  where mtq2.question_snapshot is null
) as build
where mtq.test_id = build.test_id
  and mtq.question_id = build.question_id;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — VERIFY: re-run the report. Expected: zero rows.
-- ════════════════════════════════════════════════════════════════════════════

select
  mt.test_id,
  mt.title,
  mt.status,
  count(*) filter (where mtq.question_snapshot is null) as remaining_missing
from public.mock_tests mt
join public.mock_test_questions mtq
  on mtq.test_id = mt.test_id
where mt.status in ('published', 'archived')
group by mt.test_id, mt.title, mt.status
having count(*) filter (where mtq.question_snapshot is null) > 0
order by mt.status, mt.title;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF BACKFILL SCRIPT
-- ════════════════════════════════════════════════════════════════════════════
