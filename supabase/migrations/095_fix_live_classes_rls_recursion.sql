-- ============================================================================
-- Migration: 095 — Fix RLS Recursion on live_classes (Phase 11J.4)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE (audited)
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher INSERT/DELETE into public.batch_subject_live_classes failed with:
--
--     ERROR: infinite recursion detected in policy for relation
--            "batch_subject_live_classes"     (SQLSTATE 42P17)
--
-- The cycle (policy-expression level — all helper functions are SECURITY
-- DEFINER and do NOT recurse; the cycle is purely inline subqueries):
--
--   INSERT INTO batch_subject_live_classes            [teacher, 071]
--     WITH CHECK "Teachers can insert into batch_subject_live_classes"
--       │   exists( select 1 from public.live_classes lc … )
--       ▼   (scan of live_classes with RLS applies ALL to-authenticated
--           policies, INCLUDING the student policy)
--   RLS on live_classes
--     └─ "Students can read live_classes for accessible batch subjects" [094]
--          │   using( exists(
--          │     select 1 from public.batch_subject_live_classes bslc … ) )
--          ▼   (scan of batch_subject_live_classes with RLS → re-entry)
--   RLS on batch_subject_live_classes  ← ALREADY on the evaluation stack
--          ▼
--   SQLSTATE 42P17: infinite recursion detected in policy for relation
--   "batch_subject_live_classes"
--
--   Stack:  batch_subject_live_classes → live_classes → batch_subject_live_classes
--
-- The policy that CLOSES the loop is 094's inline subquery against
-- batch_subject_live_classes inside the live_classes student SELECT policy.
-- It applies to every authenticated user (no is_student() guard), so it is
-- evaluated even when a TEACHER scans live_classes from 071's WITH CHECK.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FIX
-- ════════════════════════════════════════════════════════════════════════════
-- Move 094's inline subquery into a SECURITY DEFINER helper at CLASS
-- granularity (the natural extension of the 091→093 helper ladder:
-- course → batch_subject → class). The internal scan of
-- batch_subject_live_classes now runs inside the SECURITY DEFINER body, so
-- RLS is bypassed and the relation never re-enters the policy stack.
--
--   live_classes.class_id
--       ↓ can_student_access_live_class()          [SECURITY DEFINER]
--       ↓ batch_subject_live_classes               (RLS bypassed)
--       ↓ can_student_access_live_batch_subject()  (093, ANY-course, live tier)
--
-- Authorization semantics are IDENTICAL to the 094 inline subquery it
-- replaces: the class is readable when ANY of its linked batch subjects is
-- authorized by can_student_access_live_batch_subject(). Zero behavior
-- change — only the recursion is broken.
--
-- The teacher INSERT/DELETE policies (071) are intentionally UNTOUCHED:
-- their inline scan of live_classes is now safe because no live_classes
-- policy scans back into batch_subject_live_classes.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SCOPE
-- ════════════════════════════════════════════════════════════════════════════
-- This migration does ONLY:
--   1. create public.can_student_access_live_class(uuid)  (SECURITY DEFINER)
--   2. drop + recreate the live_classes student SELECT policy on the helper
--   3. validation queries + rollback
--
-- It does NOT touch: other policies, tables, grants, Edge Functions,
-- application code, or the recordings policy (094 — same inline-subquery
-- pattern, but currently NOT recursive because 073 defines no DML policy
-- that scans recordings; it is a latent sibling, intentionally out of
-- scope here per the approved change list).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Class-level entitlement wrapper (SECURITY DEFINER)
-- ════════════════════════════════════════════════════════════════════════════
-- TRUE when ANY batch_subject_live_classes link of the given class is
-- authorized by can_student_access_live_batch_subject() (093 — active batch
-- assignment + ACTIVE/GRACE live-tier subscription for ANY linked course).
-- The internal scan of batch_subject_live_classes runs as the function
-- owner with RLS bypassed → breaks the 42P17 cycle.
--
-- Fail closed: NULL or unknown class_id → no junction rows → FALSE;
-- non-students (no student_details row) → get_student_batch_ids()/helpers
-- resolve NULL → FALSE.
create or replace function public.can_student_access_live_class(
    p_class_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.batch_subject_live_classes bslc
    where bslc.class_id = p_class_id
      and public.can_student_access_live_batch_subject(bslc.batch_subject_id)
  );
$$;

comment on function public.can_student_access_live_class(uuid) is
  'Phase 11J.4: TRUE when the current authenticated student is entitled to a '
  'live class — ANY batch_subject_live_classes link of the class is '
  'authorized by can_student_access_live_batch_subject() (active batch '
  'assignment AND live-tier subscription for a linked course). SECURITY '
  'DEFINER so the internal junction scan bypasses RLS, breaking the 42P17 '
  'recursion cycle between 071 INSERT/DELETE and the live_classes student '
  'policy. Fail-closed for unknown/NULL class_id and non-students. Live-tier '
  'only (never content-only).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Rewrite the live_classes student SELECT policy onto the helper
-- ════════════════════════════════════════════════════════════════════════════
-- Replaces 094's inline EXISTS(batch_subject_live_classes …) subquery with a
-- one-line helper call. Same name, same role set, same FOR SELECT — only the
-- USING expression changes (DROP + CREATE, canonical pattern per 092/093).
drop policy if exists "Students can read live_classes for accessible batch subjects"
  on public.live_classes;

create policy "Students can read live_classes for accessible batch subjects"
  on public.live_classes
  for select
  to authenticated
  using (
    public.can_student_access_live_class(live_classes.class_id)
  );

comment on policy "Students can read live_classes for accessible batch subjects"
  on public.live_classes is
  'Phase 11J.4: a student may read a live class only when '
  'public.can_student_access_live_class(class_id) returns TRUE — ANY linked '
  'batch subject is authorized by can_student_access_live_batch_subject() '
  '(active batch_students assignment AND live-tier subscription for the '
  'linked course). Replaces 094''s inline subquery, which caused SQLSTATE '
  '42P17 (infinite recursion in policy for relation '
  'batch_subject_live_classes) on teacher INSERT/DELETE. Live classes are '
  'LIVE-tier gated (never content-only).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Validation queries (run manually against the database)
-- ════════════════════════════════════════════════════════════════════════════

-- V1. Helper exists and is SECURITY DEFINER + STABLE (expect 1 row,
--     prosecdef = t, provolatile = 's'):
--     select proname, prosecdef, provolatile
--     from pg_proc
--     where proname = 'can_student_access_live_class';

-- V2. Helper delegates to the 093 wrapper and the junction (inspect body):
--     select pg_get_functiondef(oid)
--     from pg_proc
--     where proname = 'can_student_access_live_class';

-- V3. The live_classes student policy now has a PURE helper-call qualifier
--     (no inline EXISTS / no batch_subject_live_classes reference — this is
--     what breaks the recursion). Expect the USING expression to be
--     "public.can_student_access_live_class(live_classes.class_id)":
--     select p.polname,
--            pg_get_expr(p.polqual, p.polrelid) as using_expression
--     from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--     where c.relname = 'live_classes'
--       and p.polname = 'Students can read live_classes for accessible batch subjects';

-- V4. No policy on live_classes references batch_subject_live_classes any
--     longer (expect 0 rows — the cycle-closer is gone):
--     select p.polname, pg_get_expr(p.polqual, p.polrelid)
--     from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--     where c.relname = 'live_classes'
--       and pg_get_expr(p.polqual, p.polrelid) like '%batch_subject_live_classes%';

-- V5. Teacher INSERT/DELETE policies on batch_subject_live_classes still
--     exist (untouched, expect 2 rows — the 071 policies):
--     select policyname
--     from pg_policies
--     where tablename = 'batch_subject_live_classes'
--       and (cmd = 'INSERT' or cmd = 'DELETE');

-- V6. Fail-closed smoke tests (run as any authenticated user; expect
--     false / false):
--     select public.can_student_access_live_class(null) as null_input,
--            public.can_student_access_live_class(
--              '00000000-0000-0000-0000-000000000000'
--            ) as unknown_id;

-- V7. END-TO-END regression: as a TEACHER, schedule/update a live class that
--     links batch subjects (scheduleLiveClass / updateScheduledClass). It
--     must no longer raise SQLSTATE 42P17, and as a STUDENT, the class must
--     still appear in upcoming classes only while entitled (live tier).

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Order matters: drop the helper-based policy first (it references the
-- helper), restore 094's inline policy verbatim, then drop the helper.

-- 4a. Drop the helper-based policy and restore 094's inline policy.
--     ⚠️ NOTE: the restored policy re-introduces the 42P17 recursion on
--     teacher INSERT/DELETE into batch_subject_live_classes. Rollback
--     returns the database to the pre-095 (broken) state; it exists only to
--     revert this migration, not as a permanent configuration.
--     drop policy if exists "Students can read live_classes for accessible batch subjects"
--       on public.live_classes;
--     create policy "Students can read live_classes for accessible batch subjects"
--       on public.live_classes
--       for select
--       to authenticated
--       using (
--         exists (
--           select 1
--           from public.batch_subject_live_classes bslc
--           where bslc.class_id = live_classes.class_id
--             and public.can_student_access_live_batch_subject(bslc.batch_subject_id)
--         )
--       );

-- 4b. Drop the helper (after all dependent policies are gone).
--     drop function if exists public.can_student_access_live_class(uuid);

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 095
-- ════════════════════════════════════════════════════════════════════════════
