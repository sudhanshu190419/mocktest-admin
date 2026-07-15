-- ============================================================================
-- Migration: 037 — Student Subject & Chapter Analytics RPCs
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Creates four PostgreSQL RPC functions that provide student-facing
-- Subject-wise and Chapter-wise analytics, following the exact architecture
-- established by get_student_dashboard_summary() in migration 036.
--
-- These RPCs replace the previous client-side aggregation (which loaded all
-- student results into TypeScript memory) with server-side PostgreSQL
-- aggregation. This is significantly faster and provides a single backend
-- source of truth for both the Website and the Mobile App.
--
-- ## Why RPCs instead of mock_results JSONB breakdowns?
--
-- The subject_breakdown and chapter_breakdown columns in mock_results are
-- currently ALWAYS NULL (the evaluation service does not populate them).
-- These RPCs therefore aggregate directly from mock_answers × questions
-- × mock_test_views, which is the canonical source of truth.
--
-- ## Functions created
--
--   1. get_student_subject_analytics()   → JSON array, one object per subject
--   2. get_student_chapter_analytics()   → JSON array, one object per chapter
--   3. get_student_weak_chapters()       → JSON array, weakest → strongest
--   4. get_student_strong_chapters()     → JSON array, strongest → weakest
--
-- ## Security
--
--   • SECURITY DEFINER to bypass RLS (needed to read across tables)
--   • Student identity is resolved from the session via get_my_student_id()
--   • No parameters accepted — student_id is derived from auth.uid()
--   • Caller can only see their own data
--
-- ## Performance
--
--   All queries use existing indexes:
--     idx_mock_attempts_student_id  — (student_id, started_at desc)
--     idx_mock_answers_attempt_id   — (attempt_id)
--     idx_mock_test_questions_test_order — (test_id, order_sequence)
--     questions PK                  — (question_id)
--     subjects PK                   — (subject_id)
--     chapters PK                   — (chapter_id)
--
--   No additional indexes are required.
--
-- Depends on:
--   public.get_my_student_id()  — resolves student_id from auth.uid()
--   public.mock_attempts        — student attempts with status
--   public.mock_answers         — per-question answers with timing
--   public.questions            — subject_id, chapter_id per question
--   public.mock_test_questions  — per-test question marks (canonical)
--   public.subjects             — subject names
--   public.chapters             — chapter names + subject_id
--
-- Usage (Website & Mobile App):
--   supabase.rpc('get_student_subject_analytics')
--   supabase.rpc('get_student_chapter_analytics')
--   supabase.rpc('get_student_weak_chapters')
--   supabase.rpc('get_student_strong_chapters')
--
-- @module migrations/037
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — get_student_subject_analytics()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Returns a JSON array of objects, each representing one subject's analytics.
-- Fields match the existing SubjectPerformanceSummary interface in the
-- TypeScript layer (snake_case keys are mapped to camelCase by the service).
--
-- Response shape per element:
--   subject_id                       uuid
--   subject_name                     text
--   questions_attempted              int
--   correct_count                    int
--   wrong_count                      int
--   skipped_count                    int
--   accuracy                         numeric | null
--   total_score                      numeric
--   max_score                        numeric
--   percentage                       numeric
--   average_time_per_question_seconds numeric | null

create or replace function public.get_student_subject_analytics()
returns json
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_student_id uuid;
begin
  -- ── Resolve the caller's student_id from the auth session ────────────
  v_student_id := public.get_my_student_id();

  if v_student_id is null then
    return json_build_object(
      'error', 'Authenticated user is not a student or has no student_details row.'
    );
  end if;

  -- ── Aggregate subject analytics from mock_answers + questions ───────
  return (
    with
      -- Step 1: Collect all completed attempt IDs for this student
      student_attempts as (
        select a.attempt_id
        from public.mock_attempts a
        where a.student_id = v_student_id
          and a.status in ('submitted', 'timed_out')
      ),
      -- Step 2: Join answers → questions → attempt → mock_test_questions
      -- to get per-question marks (which may differ from questions.marks
      -- due to per-test overrides in mock_test_questions.marks)
      answer_details as (
        select
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          ma.marks_awarded,
          ma.time_spent_seconds,
          q.subject_id,
          mtq.marks as question_marks
        from public.mock_answers ma
        join public.mock_attempts a
          on a.attempt_id = ma.attempt_id
        join public.questions q
          on q.question_id = ma.question_id
        join public.mock_test_questions mtq
          on mtq.test_id = a.test_id
         and mtq.question_id = ma.question_id
        where a.attempt_id in (select attempt_id from student_attempts)
      ),
      -- Step 3: Aggregate by subject
      subject_agg as (
        select
          ad.subject_id,
          sub.name as subject_name,
          count(*)                                                        as total_questions,
          count(*) filter (where ad.is_answered = true)                  as questions_attempted,
          count(*) filter (where ad.is_correct = true)                   as correct_count,
          count(*) filter (where ad.is_correct = false and ad.is_answered = true) as wrong_count,
          count(*) filter (where ad.is_answered = false)                  as skipped_count,
          coalesce(sum(ad.marks_awarded) filter (where ad.is_answered = true), 0) as total_score,
          coalesce(sum(ad.question_marks) filter (where ad.is_answered = true), 0) as max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) filter (where ad.is_answered = true),
              0
            ), 2
          )                                                               as avg_time_per_question
        from answer_details ad
        join public.subjects sub
          on sub.subject_id = ad.subject_id
        group by ad.subject_id, sub.name
      )
    -- Step 4: Build the JSON array
    select json_agg(
      json_build_object(
        'subject_id',                           s.subject_id,
        'subject_name',                         s.subject_name,
        'questions_attempted',                  s.questions_attempted,
        'correct_count',                        s.correct_count,
        'wrong_count',                          s.wrong_count,
        'skipped_count',                        s.skipped_count,
        'accuracy',                             case
          when (s.correct_count + s.wrong_count) > 0
          then round(
            (s.correct_count::numeric / (s.correct_count + s.wrong_count)) * 100, 2
          )
          else null
        end,
        'total_score',                          s.total_score,
        'max_score',                            s.max_score,
        'percentage',                           case
          when s.max_score > 0
          then round((s.total_score / s.max_score) * 100, 2)
          else 0
        end,
        'average_time_per_question_seconds',    case
          when s.avg_time_per_question > 0 then s.avg_time_per_question
          else null
        end
      )
      order by s.subject_name
    )
    from subject_agg s
  );
end;
$$;

comment on function public.get_student_subject_analytics() is
  'Returns a JSON array of subject-wise analytics for the authenticated student. '
  'Each element contains subject_id, subject_name, questions_attempted, '
  'correct_count, wrong_count, skipped_count, accuracy, total_score, max_score, '
  'percentage, and average_time_per_question_seconds. The student_id is resolved '
  'from the session via get_my_student_id(). SECURITY DEFINER ensures RLS bypass '
  'for aggregated reads, but the caller can only see their own data.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — get_student_chapter_analytics()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Returns a JSON array of objects, each representing one chapter's analytics.
-- Includes subject_id and subject_name for cross-referencing with subject
-- analytics.
--
-- Response shape per element:
--   chapter_id                      uuid
--   chapter_name                    text
--   subject_id                      uuid
--   subject_name                    text
--   questions_attempted             int
--   correct_count                   int
--   wrong_count                     int
--   skipped_count                   int
--   accuracy                        numeric | null
--   total_score                     numeric
--   max_score                       numeric
--   percentage                      numeric
--   average_time_per_question_seconds numeric | null

create or replace function public.get_student_chapter_analytics()
returns json
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_student_id uuid;
begin
  -- ── Resolve the caller's student_id from the auth session ────────────
  v_student_id := public.get_my_student_id();

  if v_student_id is null then
    return json_build_object(
      'error', 'Authenticated user is not a student or has no student_details row.'
    );
  end if;

  -- ── Aggregate chapter analytics from mock_answers + questions ───────
  return (
    with
      student_attempts as (
        select a.attempt_id
        from public.mock_attempts a
        where a.student_id = v_student_id
          and a.status in ('submitted', 'timed_out')
      ),
      answer_details as (
        select
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          ma.marks_awarded,
          ma.time_spent_seconds,
          q.chapter_id,
          q.subject_id,
          mtq.marks as question_marks
        from public.mock_answers ma
        join public.mock_attempts a
          on a.attempt_id = ma.attempt_id
        join public.questions q
          on q.question_id = ma.question_id
        join public.mock_test_questions mtq
          on mtq.test_id = a.test_id
         and mtq.question_id = ma.question_id
        where a.attempt_id in (select attempt_id from student_attempts)
      ),
      chapter_agg as (
        select
          ad.chapter_id,
          ch.name as chapter_name,
          ad.subject_id,
          sub.name as subject_name,
          count(*)                                                        as total_questions,
          count(*) filter (where ad.is_answered = true)                  as questions_attempted,
          count(*) filter (where ad.is_correct = true)                   as correct_count,
          count(*) filter (where ad.is_correct = false and ad.is_answered = true) as wrong_count,
          count(*) filter (where ad.is_answered = false)                  as skipped_count,
          coalesce(sum(ad.marks_awarded) filter (where ad.is_answered = true), 0) as total_score,
          coalesce(sum(ad.question_marks) filter (where ad.is_answered = true), 0) as max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) filter (where ad.is_answered = true),
              0
            ), 2
          )                                                               as avg_time_per_question
        from answer_details ad
        join public.chapters ch
          on ch.chapter_id = ad.chapter_id
        join public.subjects sub
          on sub.subject_id = ad.subject_id
        group by ad.chapter_id, ch.name, ad.subject_id, sub.name
      )
    select json_agg(
      json_build_object(
        'chapter_id',                           ca.chapter_id,
        'chapter_name',                         ca.chapter_name,
        'subject_id',                           ca.subject_id,
        'subject_name',                         ca.subject_name,
        'questions_attempted',                  ca.questions_attempted,
        'correct_count',                        ca.correct_count,
        'wrong_count',                          ca.wrong_count,
        'skipped_count',                        ca.skipped_count,
        'accuracy',                             case
          when (ca.correct_count + ca.wrong_count) > 0
          then round(
            (ca.correct_count::numeric / (ca.correct_count + ca.wrong_count)) * 100, 2
          )
          else null
        end,
        'total_score',                          ca.total_score,
        'max_score',                            ca.max_score,
        'percentage',                           case
          when ca.max_score > 0
          then round((ca.total_score / ca.max_score) * 100, 2)
          else 0
        end,
        'average_time_per_question_seconds',    case
          when ca.avg_time_per_question > 0 then ca.avg_time_per_question
          else null
        end
      )
      order by ca.chapter_name
    )
    from chapter_agg ca
  );
end;
$$;

comment on function public.get_student_chapter_analytics() is
  'Returns a JSON array of chapter-wise analytics for the authenticated student. '
  'Each element contains chapter_id, chapter_name, subject_id, subject_name, '
  'questions_attempted, correct_count, wrong_count, skipped_count, accuracy, '
  'total_score, max_score, percentage, and average_time_per_question_seconds. '
  'The student_id is resolved from the session via get_my_student_id(). '
  'SECURITY DEFINER ensures RLS bypass for aggregated reads, but the caller '
  'can only see their own data.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — get_student_weak_chapters()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Returns chapters ordered from weakest to strongest based on percentage
-- score. Only includes chapters with at least 1 attempted question.
-- Uses the same business logic as the existing TypeScript implementation:
-- chapters are sorted by percentage (ascending), with the weakest first.
--
-- Response shape per element (same as chapter analytics):
--   Same fields as get_student_chapter_analytics()

create or replace function public.get_student_weak_chapters()
returns json
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_student_id uuid;
begin
  -- ── Resolve the caller's student_id from the auth session ────────────
  v_student_id := public.get_my_student_id();

  if v_student_id is null then
    return json_build_object(
      'error', 'Authenticated user is not a student or has no student_details row.'
    );
  end if;

  -- ── Return chapters ordered weakest → strongest ─────────────────────
  return (
    with
      student_attempts as (
        select a.attempt_id
        from public.mock_attempts a
        where a.student_id = v_student_id
          and a.status in ('submitted', 'timed_out')
      ),
      answer_details as (
        select
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          ma.marks_awarded,
          ma.time_spent_seconds,
          q.chapter_id,
          q.subject_id,
          mtq.marks as question_marks
        from public.mock_answers ma
        join public.mock_attempts a
          on a.attempt_id = ma.attempt_id
        join public.questions q
          on q.question_id = ma.question_id
        join public.mock_test_questions mtq
          on mtq.test_id = a.test_id
         and mtq.question_id = ma.question_id
        where a.attempt_id in (select attempt_id from student_attempts)
      ),
      chapter_agg as (
        select
          ad.chapter_id,
          ch.name as chapter_name,
          ad.subject_id,
          sub.name as subject_name,
          count(*) filter (where ad.is_answered = true)                  as questions_attempted,
          count(*) filter (where ad.is_correct = true)                   as correct_count,
          count(*) filter (where ad.is_correct = false and ad.is_answered = true) as wrong_count,
          count(*) filter (where ad.is_answered = false)                  as skipped_count,
          coalesce(sum(ad.marks_awarded) filter (where ad.is_answered = true), 0) as total_score,
          coalesce(sum(ad.question_marks) filter (where ad.is_answered = true), 0) as max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) filter (where ad.is_answered = true),
              0
            ), 2
          )                                                               as avg_time_per_question
        from answer_details ad
        join public.chapters ch
          on ch.chapter_id = ad.chapter_id
        join public.subjects sub
          on sub.subject_id = ad.subject_id
        group by ad.chapter_id, ch.name, ad.subject_id, sub.name
      )
    select json_agg(
      json_build_object(
        'chapter_id',                           ca.chapter_id,
        'chapter_name',                         ca.chapter_name,
        'subject_id',                           ca.subject_id,
        'subject_name',                         ca.subject_name,
        'questions_attempted',                  ca.questions_attempted,
        'correct_count',                        ca.correct_count,
        'wrong_count',                          ca.wrong_count,
        'skipped_count',                        ca.skipped_count,
        'accuracy',                             case
          when (ca.correct_count + ca.wrong_count) > 0
          then round(
            (ca.correct_count::numeric / (ca.correct_count + ca.wrong_count)) * 100, 2
          )
          else null
        end,
        'total_score',                          ca.total_score,
        'max_score',                            ca.max_score,
        'percentage',                           case
          when ca.max_score > 0
          then round((ca.total_score / ca.max_score) * 100, 2)
          else 0
        end,
        'average_time_per_question_seconds',    case
          when ca.avg_time_per_question > 0 then ca.avg_time_per_question
          else null
        end
      )
      order by (case when ca.max_score > 0 then round((ca.total_score / ca.max_score) * 100, 2) else 0 end) asc nulls last
    )
    from chapter_agg ca
    where ca.questions_attempted > 0
  );
end;
$$;

comment on function public.get_student_weak_chapters() is
  'Returns a JSON array of chapters ordered from weakest to strongest based '
  'on total_score for the authenticated student. Only includes chapters with '
  'at least 1 attempted question. Each element has the same shape as '
  'get_student_chapter_analytics(). The student_id is resolved from the '
  'session via get_my_student_id(). SECURITY DEFINER ensures RLS bypass for '
  'aggregated reads, but the caller can only see their own data.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — get_student_strong_chapters()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Returns chapters ordered from strongest to weakest based on percentage
-- score. Only includes chapters with at least 1 attempted question.
-- Uses the same business logic as the existing TypeScript implementation:
-- chapters are sorted by percentage (descending), with the strongest first.
--
-- Response shape per element (same as chapter analytics):
--   Same fields as get_student_chapter_analytics()

create or replace function public.get_student_strong_chapters()
returns json
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_student_id uuid;
begin
  -- ── Resolve the caller's student_id from the auth session ────────────
  v_student_id := public.get_my_student_id();

  if v_student_id is null then
    return json_build_object(
      'error', 'Authenticated user is not a student or has no student_details row.'
    );
  end if;

  -- ── Return chapters ordered strongest → weakest ─────────────────────
  return (
    with
      student_attempts as (
        select a.attempt_id
        from public.mock_attempts a
        where a.student_id = v_student_id
          and a.status in ('submitted', 'timed_out')
      ),
      answer_details as (
        select
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          ma.marks_awarded,
          ma.time_spent_seconds,
          q.chapter_id,
          q.subject_id,
          mtq.marks as question_marks
        from public.mock_answers ma
        join public.mock_attempts a
          on a.attempt_id = ma.attempt_id
        join public.questions q
          on q.question_id = ma.question_id
        join public.mock_test_questions mtq
          on mtq.test_id = a.test_id
         and mtq.question_id = ma.question_id
        where a.attempt_id in (select attempt_id from student_attempts)
      ),
      chapter_agg as (
        select
          ad.chapter_id,
          ch.name as chapter_name,
          ad.subject_id,
          sub.name as subject_name,
          count(*) filter (where ad.is_answered = true)                  as questions_attempted,
          count(*) filter (where ad.is_correct = true)                   as correct_count,
          count(*) filter (where ad.is_correct = false and ad.is_answered = true) as wrong_count,
          count(*) filter (where ad.is_answered = false)                  as skipped_count,
          coalesce(sum(ad.marks_awarded) filter (where ad.is_answered = true), 0) as total_score,
          coalesce(sum(ad.question_marks) filter (where ad.is_answered = true), 0) as max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) filter (where ad.is_answered = true),
              0
            ), 2
          )                                                               as avg_time_per_question
        from answer_details ad
        join public.chapters ch
          on ch.chapter_id = ad.chapter_id
        join public.subjects sub
          on sub.subject_id = ad.subject_id
        group by ad.chapter_id, ch.name, ad.subject_id, sub.name
      )
    select json_agg(
      json_build_object(
        'chapter_id',                           ca.chapter_id,
        'chapter_name',                         ca.chapter_name,
        'subject_id',                           ca.subject_id,
        'subject_name',                         ca.subject_name,
        'questions_attempted',                  ca.questions_attempted,
        'correct_count',                        ca.correct_count,
        'wrong_count',                          ca.wrong_count,
        'skipped_count',                        ca.skipped_count,
        'accuracy',                             case
          when (ca.correct_count + ca.wrong_count) > 0
          then round(
            (ca.correct_count::numeric / (ca.correct_count + ca.wrong_count)) * 100, 2
          )
          else null
        end,
        'total_score',                          ca.total_score,
        'max_score',                            ca.max_score,
        'percentage',                           case
          when ca.max_score > 0
          then round((ca.total_score / ca.max_score) * 100, 2)
          else 0
        end,
        'average_time_per_question_seconds',    case
          when ca.avg_time_per_question > 0 then ca.avg_time_per_question
          else null
        end
      )
      order by (case when ca.max_score > 0 then round((ca.total_score / ca.max_score) * 100, 2) else 0 end) desc nulls last
    )
    from chapter_agg ca
    where ca.questions_attempted > 0
  );
end;
$$;

comment on function public.get_student_strong_chapters() is
  'Returns a JSON array of chapters ordered from strongest to weakest based '
  'on total_score for the authenticated student. Only includes chapters with '
  'at least 1 attempted question. Each element has the same shape as '
  'get_student_chapter_analytics(). The student_id is resolved from the '
  'session via get_my_student_id(). SECURITY DEFINER ensures RLS bypass for '
  'aggregated reads, but the caller can only see their own data.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 037 Student Subject & Chapter Analytics RPCs
-- ════════════════════════════════════════════════════════════════════════════
