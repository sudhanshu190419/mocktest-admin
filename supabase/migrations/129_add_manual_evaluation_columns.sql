-- ============================================================================
-- Migration 129: Add Manual Evaluation Columns to mock_answers
--
-- Adds columns required for manual teacher evaluation of subjective questions.
-- No existing data is modified — all new columns default to NULL.
--
-- Columns:
--   evaluation_status  — 'pending' | 'manual_evaluated' | NULL
--   awarded_marks      — teacher-awarded marks (NULL until evaluated)
--   evaluated_by       — FK to profiles (NULL until evaluated)
--   evaluated_at       — timestamp of evaluation (NULL until evaluated)
--   evaluator_feedback — teacher feedback text (NULL until evaluated)
--
-- Depends on: 006 (mock_answers), 021 (profiles via FK)
-- ============================================================================

-- ── 1. Add evaluation_status ────────────────────────────────────────────────
-- NULL = not yet evaluated (or not a subjective question)
-- 'pending' = awaiting manual evaluation
-- 'manual_evaluated' = teacher has evaluated
ALTER TABLE public.mock_answers
  ADD COLUMN IF NOT EXISTS evaluation_status text NULL DEFAULT NULL;

-- Constrain allowed values
ALTER TABLE public.mock_answers
  ADD CONSTRAINT ck_mock_answers_evaluation_status
  CHECK (evaluation_status IS NULL OR evaluation_status IN ('pending', 'manual_evaluated'));

-- ── 2. Add awarded_marks ────────────────────────────────────────────────────
-- NULL = not yet evaluated
-- >= 0 when present
ALTER TABLE public.mock_answers
  ADD COLUMN IF NOT EXISTS awarded_marks numeric NULL DEFAULT NULL;

-- Constrain non-negative when present
ALTER TABLE public.mock_answers
  ADD CONSTRAINT ck_mock_answers_awarded_marks_non_negative
  CHECK (awarded_marks IS NULL OR awarded_marks >= 0);

-- ── 3. Add evaluated_by ─────────────────────────────────────────────────────
-- FK to profiles. NULL until evaluation is performed.
ALTER TABLE public.mock_answers
  ADD COLUMN IF NOT EXISTS evaluated_by uuid NULL DEFAULT NULL
  REFERENCES public.profiles(profile_id) ON DELETE SET NULL;

-- ── 4. Add evaluated_at ─────────────────────────────────────────────────────
-- Timestamp when the evaluation was saved. NULL until evaluated.
ALTER TABLE public.mock_answers
  ADD COLUMN IF NOT EXISTS evaluated_at timestamptz NULL DEFAULT NULL;

-- ── 5. Add evaluator_feedback ───────────────────────────────────────────────
-- Free-text feedback from teacher. NULL until evaluated.
ALTER TABLE public.mock_answers
  ADD COLUMN IF NOT EXISTS evaluator_feedback text NULL DEFAULT NULL;

-- ── 6. Index on evaluation_status ───────────────────────────────────────────
-- Useful for queries like: WHERE evaluation_status = 'pending'
-- Partial index — only indexes non-NULL values (the vast majority of rows
-- will remain NULL since only subjective questions get an evaluation_status).
CREATE INDEX IF NOT EXISTS idx_mock_answers_evaluation_status
  ON public.mock_answers (evaluation_status)
  WHERE evaluation_status IS NOT NULL;
