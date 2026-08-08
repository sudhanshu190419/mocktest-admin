-- ============================================================================
-- Migration: 089 — Course-Scoped Subscription Schema — PHASE 1 (foundation)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ⚠️ THIS FILE IS PHASE 1 OF A TWO-PHASE ROLLOUT. It supersedes the earlier
--    monolithic draft of migration 089 (stream-inference backfill), which was
--    NEVER deployed (uncommitted working tree). The course-scoped subscription
--    schema is split into two deployable migrations so a live database is
--    never blocked by impossible validation ordering:
--
--      PHASE 1 (this migration, 089) — deployable immediately:
--        • add subscription_plans.course_id as a NULLABLE column
--        • add the FK to courses (on delete/update restrict)
--        • NO NOT NULL, NO fail-fast validation, NO backfills, NO trigger,
--          NO unique indexes, NO changes to student_subscriptions or
--          order_items.
--        The database remains fully usable while an operator manually
--        assigns course_id to every existing subscription plan (see
--        SECTION 2 — report — and the operator worksheet in VALIDATION).
--
--      PHASE 2 (migration 090) — apply ONLY after every plan has a course_id:
--        • fail-fast validation that course_id is fully populated
--        • SET course_id NOT NULL
--        • uniqueness redesign (drop institute-level, add course-level)
--        • student_subscriptions.course_id + backfill + consistency trigger
--          + per-course partial unique index
--        • order_items backfill + item_type CHECK relaxation
--        • supporting indexes, comments, validation, rollback
--
-- Finalized business rules (Phase 11G, approved):
--   • A subscription plan belongs to exactly ONE course (subscription_plans.
--     course_id is the single source of truth).
--   • A course owns its own billing plans: Monthly, Quarterly, Half-Yearly,
--     Yearly. One-Time is a SEPARATE, existing product — the one-time course
--     purchase (item_type = 'course' via complete-course-purchase) — and is
--     NOT represented as a subscription plan. Subscription-based lifetime
--     plans are out of scope for this product and are intentionally NOT
--     introduced or documented here.
--   • Purchasing a subscription unlocks ONLY the purchased course.
--   • Streams are organization-only (NEET/JEE/CUET category). They must NEVER
--     be used for access control and must NEVER be used to infer a course.
--   • Multiple courses may exist inside one stream, each with independent
--     plans.
--   • Existing Phase 11A–11F behaviour (payments, renewals, lifecycle,
--     notifications, access control) must continue to work unchanged.
--
-- Depends on: Migration 012 (Domain 11 — subscription_plans)
--             Migration 032 (Domain 16 — courses)
-- Reference: Phase 11G.1/11G.2/11G.3 (approved final) | 084/086/088 style
--            Phase 2 of this rollout = migration 090
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — subscription_plans.course_id (add nullable column + FK)
-- ════════════════════════════════════════════════════════════════════════════
-- Added NULL first (Phase 1 of two). Phase 2 (090) verifies every plan is
-- assigned, then sets NOT NULL. The FK follows the fk_<table>_<target>
-- naming family and is safe to create while the column is nullable.

alter table public.subscription_plans
  add column if not exists course_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname = 'fk_subscription_plans_course'
  ) then
    alter table public.subscription_plans
      add constraint fk_subscription_plans_course
      foreign key (course_id) references public.courses (course_id)
      on delete restrict
      on update restrict;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Operator assignment (REPORT ONLY — this migration never aborts)
-- ════════════════════════════════════════════════════════════════════════════
-- There is NO backfill inference. The finalized architecture explicitly
-- rejects deriving course from stream_id (a stream may contain many courses;
-- guessing could assign the wrong course, corrupting access). Every plan must
-- be assigned a course by an operator BEFORE migration 090 (Phase 2) runs,
-- using the admin plan-management UI or a reviewed UPDATE script such as:
--
--   update public.subscription_plans
--      set course_id = <course_uuid>
--    where plan_id  = <plan_uuid>;
--
-- This DO block ONLY reports plans that still lack course_id (RAISE NOTICE)
-- so the migration succeeds and the database remains fully usable while
-- assignment is in progress. The VALIDATION section below includes an
-- operator worksheet query that joins each plan to its stream (plus price /
-- billing cycle) to make the mapping decision easier.
--
-- NOTE (RAISE syntax): the PL/pgSQL RAISE format string must be a plain
-- literal — the `||` concatenation operator is not allowed there. The
-- unassigned list is therefore passed as a `%` argument; the embedded
-- newlines live inside the list value, not in the format string.

do $$
declare
  v_count    integer;
  v_unmapped text;
begin
  select count(*),
         coalesce(string_agg(
           format('%s (plan_id %s, stream_id %s)', name, plan_id, stream_id),
           E'\n  - '), '')
    into v_count, v_unmapped
    from public.subscription_plans
   where course_id is null;

  if v_count > 0 then
    raise notice
      'Phase 1/2: % subscription_plan(s) still have NULL course_id. Assign '
      'course_id to every plan (admin plan-management UI or a reviewed UPDATE '
      'script) before applying migration 090 (Phase 2). Unassigned plans: %',
      v_count, v_unmapped;
  else
    raise notice
      'Phase 1/2: every subscription_plans row already has course_id — '
      'migration 090 (Phase 2) may be applied.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on column public.subscription_plans.course_id is
  'FK to courses. THE single source of truth: the course this plan is a '
  'payment option for. Plans are course-scoped (Monthly/Quarterly/Half-Yearly/'
  'Yearly — one-time is a separate course-purchase product, not a plan); a '
  'plan can never grant access to another course. Assigned explicitly by '
  'operators — never inferred from stream_id. stream_id remains a '
  'categorization-only tag (NEET/JEE/CUET) and plays no role in access. '
  'Added NULLABLE in migration 089 (Phase 1 of 2); migration 090 verifies '
  'full assignment and sets NOT NULL.';

comment on constraint fk_subscription_plans_course
  on public.subscription_plans is
  'A subscription plan belongs to exactly one course (on delete restrict — a '
  'course cannot be deleted while plans reference it).';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run after applying — Phase 1)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Column exists and is still NULLABLE (expect course_id | YES):
--    select column_name, is_nullable
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'subscription_plans'
--      and column_name  = 'course_id';
--
-- 2. FK exists:
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.subscription_plans'::regclass
--      and conname  = 'fk_subscription_plans_course';
--
-- 3. Assignment progress (0 unmapped only AFTER the operator finishes):
--    select count(*)                                          as total_plans,
--           count(course_id)                                  as assigned,
--           count(*) filter (where course_id is null)         as unmapped
--    from public.subscription_plans;
--
-- 4. Operator worksheet — every unassigned plan with its stream + billing
--    context, so each plan can be mapped to the correct course:
--    select sp.plan_id, sp.name, sp.slug, sp.billing_cycle, sp.price,
--           st.name as stream
--    from public.subscription_plans sp
--    left join public.streams st on st.stream_id = sp.stream_id
--    where sp.course_id is null
--    order by st.name nulls last, sp.name;
--
-- ⚠️ Do NOT apply migration 090 (Phase 2) until query 3 reports 0 unmapped.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (Phase 1 only — if this migration must be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- alter table public.subscription_plans
--   drop constraint if exists fk_subscription_plans_course;
--
-- alter table public.subscription_plans
--   drop column if exists course_id;
--
-- Note: once migration 090 (Phase 2) has been applied, rolling back 089 first
-- is not possible — 090 owns NOT NULL, the backfills, and the unique
-- constraints. In that case follow 090's rollback first, then this one.

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 089 (Phase 1 of 2). Phase 2 = migration 090.
-- ════════════════════════════════════════════════════════════════════════════
