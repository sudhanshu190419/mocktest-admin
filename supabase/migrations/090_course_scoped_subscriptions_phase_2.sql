-- ============================================================================
-- Migration: 090 — Course-Scoped Subscription Schema — PHASE 2 (finalize)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ⚠️ THIS FILE IS PHASE 2 OF A TWO-PHASE ROLLOUT (continues migration 089):
--
--      PHASE 1 (migration 089, already applied) — added
--        subscription_plans.course_id as a NULLABLE column + FK. An operator
--        then manually assigned course_id to every existing subscription plan
--        (never inferred from stream_id — a stream is a category that may
--        contain many courses).
--
--      PHASE 2 (THIS migration, 090) — completes the course-scoped schema and
--        ABORTS (fail-fast, same philosophy as migration 086) on any data
--        that cannot be safely finalized:
--        • fail-fast validation that every subscription_plans.course_id is
--          populated (Phase 1 column may still be partially NULL)
--        • SET subscription_plans.course_id NOT NULL
--        • uniqueness redesign on subscription_plans (drop institute-level,
--          add course-level)
--        • student_subscriptions.course_id: add, backfill from plan,
--          NOT NULL, FK, consistency trigger, per-course partial unique index
--        • order_items: backfill course_id for subscription_plan lines, then
--          relax the item_type CHECK
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
-- Schema changes in this migration:
--   1. subscription_plans.course_id   uuid NOT NULL (FK → courses, added in
--      089). Backfill is MANUAL and FAIL-FAST: if any plan lacks course_id
--      the migration ABORTS — it never guesses, never looks at stream_id, and
--      never assumes one course per stream. Operators pre-assign course_id
--      (via the admin plan-management UI or a reviewed UPDATE script) after
--      migration 089 and before running this one.
--   2. Uniqueness redesign on subscription_plans — both institute-level
--      uniqueness constraints are REMOVED and replaced with course-level
--      ones, because institute-wide uniqueness is wrong for course-scoped
--      plans (two courses may legitimately both have a "Monthly" plan and a
--      "monthly" slug):
--        • DROP uq_subscription_plans_institute_name  (institute_id, name)
--        • DROP uq_subscription_plans_institute_slug  (institute_id, slug)
--        • ADD  uq_subscription_plans_course_billing_cycle (course_id,
--          billing_cycle) — one plan per billing cycle per course (the
--          authoritative billing invariant)
--        • ADD  uq_subscription_plans_course_slug (course_id, slug) — slugs
--          unique within a course (URL / identifier integrity)
--      NOTE ON OLD SEEDS: 023/085 use ON CONFLICT (institute_id, slug) DO
--      NOTHING. On a FRESH install they run BEFORE 090 (while the
--      institute-level constraint still exists), so they are unaffected.
--      They are never re-run after 090 because Supabase tracks applied
--      migrations. Do NOT keep the institute-level constraint "just for the
--      seeds" — correctness of the course-scoped model takes precedence.
--      ⚠️ OPERATOR NOTE: after 090 is applied, migrations 023/085 are NOT
--      re-runnable (their ON CONFLICT (institute_id, slug) target no longer
--      exists). Never re-apply them manually (partial restores, staging
--      clones, db reset re-runs) — they are applied-once artifacts; a fresh
--      install is the only supported path that runs them.
--   3. student_subscriptions.course_id uuid NOT NULL (FK → courses),
--      denormalized from the plan (approved Option B): stored so the
--      per-course unique index, access checks and RLS can filter on a real
--      column (PostgreSQL cannot index a joined column). Backfilled from
--      plan.course_id — the authoritative source, not an inference.
--   4. Trigger trg_student_subscriptions_validate_course: guarantees
--      student_subscriptions.course_id === subscription_plans.course_id.
--      Performance design: it validates on INSERT (new rows must always be
--      checked) and on UPDATE ONLY when plan_id or course_id actually
--      changed — the hot status-transition path (lifecycle job) updates only
--      status and therefore performs ZERO extra work (no SELECT, no
--      validation) on unrelated updates.
--   5. Partial UNIQUE index (student_id, course_id) WHERE status IN
--      ('active','grace') — one active subscription per course, atomically.
--      The plan-level guard (migration 086) is KEPT (not redundant while a
--      course can hold multiple plans).
--   6. order_items.course_id is treated as IMMUTABLE BILLING HISTORY: it is
--      a snapshot of "what product was purchased" (which course's plan was
--      on this order line), written once at order creation and NEVER updated
--      afterwards. It is not current entitlement state — entitlement lives
--      in course_enrollments / student_subscriptions. Existing Phase 11A–11F
--      subscription lines (course_id NULL) are backfilled ONCE from their
--      plan in this migration so the item_type CHECK can be relaxed.
--
-- ⚠️ OPERATOR NOTE (locking): this migration runs non-CONCURRENTLY index
-- builds and bulk UPDATE backfills (sections 4, 6, 9, 10), which take
-- ACCESS EXCLUSIVE / row locks. Apply during a maintenance window on
-- live databases with large student_subscriptions / order_items volumes.
-- Supabase runs each migration inside one transaction, so a failure
-- rolls back the entire file.
--
-- Fail-fast guards (same philosophy as migration 086):
--   • any subscription_plans row without course_id → ABORT (manual
--     assignment required — never inferred)
--   • any (course_id, billing_cycle) pair already duplicated → ABORT
--   • any (course_id, slug) pair already duplicated → ABORT
--   • any subscription whose plan has no course_id → ABORT
--   • any order_items subscription_plan line that cannot resolve a course_id
--     → ABORT before the CHECK is replaced
--   • any (student_id, course_id) pair already holding multiple active/grace
--     rows → ABORT before the unique index is created
--
-- NOTE (RAISE syntax): the PL/pgSQL RAISE format string must be a plain
-- literal — the `||` concatenation operator is not allowed there. The
-- unassigned list in SECTION 1 is therefore passed as a `%` argument; the
-- embedded newlines live inside the list value, not in the format string.
--
-- Depends on: Migration 089 (Phase 1 — course_id column + FK, operator
--             assignment complete)
--             Migration 012 (Domain 11 — subscription_plans,
--             student_subscriptions, plan_id FKs, enums)
--             Migration 032 (Domain 16 — courses)
--             Migration 043 (order_items.course_id + item_type CHECK)
--             Migration 086 (plan-level active/grace guard — kept)
-- Reference: Phase 11G.1/11G.2/11G.3 (approved final) | 084/086/088 style
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Fail-fast: every plan must already have a course_id
-- ════════════════════════════════════════════════════════════════════════════
-- There is NO backfill inference. The finalized architecture explicitly
-- rejects deriving course from stream_id (a stream may contain many courses;
-- guessing could assign the wrong course, corrupting access). Every plan must
-- be assigned a course by an operator BEFORE this migration runs (after
-- migration 089), using the admin plan-management UI or a reviewed UPDATE
-- script such as:
--
--   update public.subscription_plans
--      set course_id = <course_uuid>
--    where plan_id  = <plan_uuid>;
--
-- If any plan is unassigned, the migration aborts with a clear, actionable
-- message. Re-run after assignment.

do $$
declare
  v_unmapped_plans text;
begin
  select coalesce(string_agg(
           format('%s (plan_id %s)', name, plan_id), E'\n  - '), '')
    into v_unmapped_plans
    from public.subscription_plans
   where course_id is null;

  if v_unmapped_plans <> '' then
    raise exception
      'Migration 090 aborted: the following subscription_plans rows have NULL '
      'course_id and cannot be course-scoped. Assign course_id to every plan '
      '(admin plan-management UI or a reviewed UPDATE script — see migration '
      '089, VALIDATION operator worksheet) and re-run. Unassigned plans: %',
      v_unmapped_plans;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — subscription_plans.course_id → NOT NULL
-- ════════════════════════════════════════════════════════════════════════════
-- Safe only after SECTION 1 verified zero NULLs.

alter table public.subscription_plans
  alter column course_id set not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Uniqueness redesign on subscription_plans
-- ════════════════════════════════════════════════════════════════════════════
-- Both institute-level uniqueness constraints are removed: with course-scoped
-- plans, different courses may each own a plan named "Monthly" with slug
-- "monthly". Uniqueness therefore scopes to the course.
-- Defense-in-depth: the fail-fast preflight checks (3a/3b) run BEFORE the
-- institute-level constraints are dropped (3c/3d), so even manual
-- statement-by-statement application never removes the old uniqueness
-- before the new invariants are proven satisfiable.

-- 3a. Fail-fast: abort if existing data already violates the new billing
-- invariant (any (course_id, billing_cycle) pair with more than one plan).
do $$
declare
  v_violating_pairs bigint;
begin
  select count(*) into v_violating_pairs
  from (
    select course_id, billing_cycle
    from public.subscription_plans
    group by course_id, billing_cycle
    having count(*) > 1
  ) d;

  if v_violating_pairs > 0 then
    raise exception
      'Migration 090 aborted: % (course_id, billing_cycle) pair(s) already have '
      'multiple plans. A course may hold at most one plan per billing cycle. '
      'Resolve the duplicates (e.g. retire the extra plan) before applying.',
      v_violating_pairs;
  end if;
end $$;

-- 3b. Fail-fast: abort if existing data already violates the new slug
-- invariant (any (course_id, slug) pair with more than one plan).
do $$
declare
  v_violating_pairs bigint;
begin
  select count(*) into v_violating_pairs
  from (
    select course_id, slug
    from public.subscription_plans
    group by course_id, slug
    having count(*) > 1
  ) d;

  if v_violating_pairs > 0 then
    raise exception
      'Migration 090 aborted: % (course_id, slug) pair(s) already have '
      'multiple plans. Slugs must be unique within a course. Resolve the '
      'duplicates (e.g. retire the extra plan) before applying.',
      v_violating_pairs;
  end if;
end $$;

-- 3c. Drop institute-level NAME uniqueness.
alter table public.subscription_plans
  drop constraint if exists uq_subscription_plans_institute_name;

-- 3d. Drop institute-level SLUG uniqueness (replaced by course-level slug
-- uniqueness in 3f). Fresh-install seed migrations 023/085 run BEFORE this
-- migration and are unaffected; they are never re-run afterwards (Supabase
-- tracks applied migrations — see the header operator note).
alter table public.subscription_plans
  drop constraint if exists uq_subscription_plans_institute_slug;

-- 3e. Authoritative billing invariant: one plan per billing cycle per course.
-- Idempotent guard (same pattern as every other constraint in this file).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname = 'uq_subscription_plans_course_billing_cycle'
  ) then
    alter table public.subscription_plans
      add constraint uq_subscription_plans_course_billing_cycle
      unique (course_id, billing_cycle);
  end if;
end $$;

-- 3f. Slug integrity scoped to the course (URL / identifier uniqueness).
-- Idempotent guard.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname = 'uq_subscription_plans_course_slug'
  ) then
    alter table public.subscription_plans
      add constraint uq_subscription_plans_course_slug
      unique (course_id, slug);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — subscription_plans supporting index
-- ════════════════════════════════════════════════════════════════════════════
-- Plans-screen lookup ("all active plans for course X") and purchase-order
-- validation both filter by (course_id, is_active).

create index if not exists idx_subscription_plans_course_active
  on public.subscription_plans (course_id, is_active);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — student_subscriptions.course_id (add nullable)
-- ════════════════════════════════════════════════════════════════════════════
-- Approved Option B (Phase 11G.2): denormalized on the entitlement row so
-- access checks, RLS, and the per-course uniqueness index work on a stored
-- column. Populated from the plan; SECTION 8's trigger guarantees it never
-- drifts from plan.course_id.

alter table public.student_subscriptions
  add column if not exists course_id uuid null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Backfill student_subscriptions.course_id from the plan
-- ════════════════════════════════════════════════════════════════════════════
-- This is NOT an inference: it copies the authoritative plan.course_id that
-- SECTION 1 required every plan to carry. Fail-fast if anything cannot
-- resolve.

do $$
begin
  update public.student_subscriptions ss
     set course_id = sp.course_id
    from public.subscription_plans sp
   where sp.plan_id = ss.plan_id
     and ss.course_id is null;

  if exists (
    select 1
    from public.student_subscriptions ss
    left join public.subscription_plans sp on sp.plan_id = ss.plan_id
    where ss.course_id is null
       or sp.course_id is null
  ) then
    raise exception
      'Migration 090 aborted: % student_subscriptions row(s) could not resolve '
      'a course_id from their plan. Every subscription plan must have a '
      'course_id (see SECTION 1) before student_subscriptions can be '
      'course-scoped.',
      (select count(*)
       from public.student_subscriptions ss
       left join public.subscription_plans sp on sp.plan_id = ss.plan_id
       where ss.course_id is null or sp.course_id is null);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — student_subscriptions.course_id → NOT NULL + FK
-- ════════════════════════════════════════════════════════════════════════════

alter table public.student_subscriptions
  alter column course_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.student_subscriptions'::regclass
      and conname = 'fk_student_subscriptions_course'
  ) then
    alter table public.student_subscriptions
      add constraint fk_student_subscriptions_course
      foreign key (course_id) references public.courses (course_id)
      on delete restrict
      on update restrict;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — Consistency trigger (course_id === plan.course_id)
-- ════════════════════════════════════════════════════════════════════════════
-- Design (performance-reviewed):
--   • INSERT: ALWAYS validates — a new row's course_id must match its plan's
--     course_id. (Column defaults such as gen_random_uuid() for
--     subscription_id are applied BEFORE BEFORE-ROW triggers, so
--     new.subscription_id is already populated here.)
--   • UPDATE: validates ONLY when plan_id or course_id actually changed
--     (IS DISTINCT FROM). The hot status-transition path — the lifecycle job
--     updating status → active/grace/expired — changes NEITHER column, so it
--     performs ZERO extra work: no SELECT, no validation, no blocking.
-- This keeps the consistency guarantee without taxing unrelated updates.

create or replace function public.trgfn_subscription_validate_course()
returns trigger
language plpgsql
as $$
declare
  v_plan_course_id uuid;
begin
  -- INSERT: always validate (OLD is unassigned).
  if tg_op = 'INSERT' then
    select sp.course_id into v_plan_course_id
      from public.subscription_plans sp
     where sp.plan_id = new.plan_id;

    -- Plan not found (should be impossible once FK plan_id exists): let the
    -- FK constraint surface the real error instead of a misleading mismatch.
    if not found then
      return new;
    end if;

    if v_plan_course_id is distinct from new.course_id then
      raise exception
        'student_subscriptions.course_id (%) must match subscription_plans.course_id (%) '
        'for plan_id % (subscription_id %). Refusing the write to prevent '
        'course-scoping corruption.',
        new.course_id, v_plan_course_id, new.plan_id, new.subscription_id;
    end if;

    return new;
  end if;

  -- UPDATE: only re-validate when the binding inputs actually changed.
  if new.plan_id is distinct from old.plan_id
     or new.course_id is distinct from old.course_id
  then
    select sp.course_id into v_plan_course_id
      from public.subscription_plans sp
     where sp.plan_id = new.plan_id;

    -- Plan not found: let the FK constraint surface the real error.
    if not found then
      return new;
    end if;

    if v_plan_course_id is distinct from new.course_id then
      raise exception
        'student_subscriptions.course_id (%) must match subscription_plans.course_id (%) '
        'for plan_id % (subscription_id %). Refusing the write to prevent '
        'course-scoping corruption.',
        new.course_id, v_plan_course_id, new.plan_id, new.subscription_id;
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_student_subscriptions_validate_course'
      and tgrelid = 'public.student_subscriptions'::regclass
  ) then
    create trigger trg_student_subscriptions_validate_course
      before insert or update on public.student_subscriptions
      for each row
      execute function public.trgfn_subscription_validate_course();
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — Per-course active/grace guard + supporting index
-- ════════════════════════════════════════════════════════════════════════════

-- 9a. Pre-flight: abort if existing data already violates the new invariant.
-- Same fail-fast philosophy as migration 086 — never silently merge paid rows.
do $$
declare
  v_violating_pairs bigint;
begin
  select count(*) into v_violating_pairs
  from (
    select student_id, course_id
    from public.student_subscriptions
    where status in ('active', 'grace')
    group by student_id, course_id
    having count(*) > 1
  ) d;

  if v_violating_pairs > 0 then
    raise exception
      'Migration 090 aborted: % (student_id, course_id) pair(s) already have '
      'multiple ACTIVE/GRACE subscriptions. Resolve these rows manually '
      '(e.g. expire the older grant for the same course) before applying.',
      v_violating_pairs;
  end if;
end $$;

-- 9b. Partial UNIQUE index — the atomic "one active subscription per course"
-- guarantee. Migration 086 (student_id, plan_id) is intentionally KEPT: with
-- multiple plans per course it is not strictly redundant.
create unique index if not exists uq_student_subscriptions_student_course_active_grace
  on public.student_subscriptions (student_id, course_id)
  where status in ('active', 'grace');

-- 9c. Supporting non-unique index for per-course access checks
-- (subscriptionAccess) and lifecycle/notification scans across ALL statuses.
create index if not exists idx_student_subs_student_course_status
  on public.student_subscriptions (student_id, course_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — order_items: backfill course_id, then relax the item_type CHECK
-- ════════════════════════════════════════════════════════════════════════════
-- SEMANTIC CONTRACT: order_items.course_id is IMMUTABLE BILLING HISTORY — a
-- one-time snapshot of "which course's plan was on this order line", written
-- at order creation and NEVER updated thereafter (no UPDATE paths, no
-- lifecycle writes). It is NOT current entitlement state; entitlement lives
-- in course_enrollments (primary) and student_subscriptions (refinement).
--
-- 10a. Backfill legacy subscription lines (Phase 11A–11F wrote plan_id but
-- never course_id) from their plan — the authoritative source. This is the
-- ONLY write this column ever receives besides order creation. Fail-fast if
-- any line cannot resolve (orphan plan), so the CHECK replacement below can
-- never abort on existing history.

do $$
begin
  update public.order_items oi
     set course_id = sp.course_id
    from public.subscription_plans sp
   where oi.item_type = 'subscription_plan'
     and oi.plan_id = sp.plan_id
     and oi.course_id is null;

  if exists (
    select 1
    from public.order_items oi
    left join public.subscription_plans sp on sp.plan_id = oi.plan_id
    where oi.item_type = 'subscription_plan'
      and (oi.course_id is null or sp.course_id is null)
  ) then
    raise exception
      'Migration 090 aborted: % order_items row(s) of type subscription_plan '
      'could not resolve a course_id from their plan. Resolve these rows '
      'before applying.',
      (select count(*)
       from public.order_items oi
       left join public.subscription_plans sp on sp.plan_id = oi.plan_id
       where oi.item_type = 'subscription_plan'
         and (oi.course_id is null or sp.course_id is null));
  end if;
end $$;

-- 10b. Replace the CHECK (drop + guarded re-add). The polymorphic guarantees
-- for the other item types are preserved exactly; subscription_plan lines now
-- require BOTH plan_id and course_id.
alter table public.order_items
  drop constraint if exists ck_order_items_item_type_consistency;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'ck_order_items_item_type_consistency'
  ) then
    alter table public.order_items
      add constraint ck_order_items_item_type_consistency
      check (
        (item_type = 'course'             and course_id is not null and plan_id is null and package_id is null)
        or
        (item_type = 'subscription_plan'  and plan_id is not null and course_id is not null and package_id is null)
        or
        (item_type = 'pyq_package'        and package_id is not null and plan_id is null and course_id is null)
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on constraint fk_subscription_plans_course
  on public.subscription_plans is
  'A subscription plan belongs to exactly one course (on delete restrict — a '
  'course cannot be deleted while plans reference it).';

comment on constraint uq_subscription_plans_course_billing_cycle
  on public.subscription_plans is
  'Authoritative billing invariant: a course holds at most one plan per '
  'billing cycle (monthly, quarterly, half_yearly, yearly). This is the '
  'structural guarantee that every course owns its own plan set.';

comment on constraint uq_subscription_plans_course_slug
  on public.subscription_plans is
  'Slugs are unique within a course (identifier/URL integrity). Different '
  'courses may reuse the same slug (e.g. both having a "monthly" plan) '
  'because plans are course-scoped.';

comment on index public.idx_subscription_plans_course_active is
  'Plans-screen and purchase-order lookup: active plans for a specific '
  'course. Filters on (course_id, is_active).';

comment on column public.student_subscriptions.course_id is
  'Denormalized course for this subscription (approved Phase 11G.2 Option B). '
  'Always equals subscription_plans.course_id for this row''s plan — enforced '
  'by trg_student_subscriptions_validate_course. Stored (not joined) so the '
  'per-course unique index, access checks, and RLS can filter on a real '
  'column (PostgreSQL cannot index a joined column).';

comment on constraint fk_student_subscriptions_course
  on public.student_subscriptions is
  'Each subscription references the course it grants (on delete restrict).';

comment on function public.trgfn_subscription_validate_course() is
  'Guarantees student_subscriptions.course_id === subscription_plans.course_id '
  'for the row''s plan. Validates on every INSERT and, on UPDATE, only when '
  'plan_id or course_id changed (IS DISTINCT FROM) — status-only updates '
  '(lifecycle transitions) perform no extra work. Raises a clear exception on '
  'mismatch, preventing manual corruption or drift between the two sources '
  'of truth.';

comment on trigger trg_student_subscriptions_validate_course
  on public.student_subscriptions is
  'BEFORE INSERT OR UPDATE consistency guard — see '
  'trgfn_subscription_validate_course().';

comment on column public.order_items.course_id is
  'IMMUTABLE BILLING HISTORY: snapshot of which course''s plan was on this '
  'order line, written at order creation (and backfilled once for legacy '
  'Phase 11A–11F lines). NEVER updated afterwards — it is NOT current '
  'entitlement state. Entitlement lives in course_enrollments (primary) and '
  'student_subscriptions (refinement).';

comment on index public.uq_student_subscriptions_student_course_active_grace is
  'Phase 11G.3: atomically guarantees at most one ACTIVE or GRACE subscription '
  'per (student_id, course_id) — the "one subscription per course" business '
  'rule. Expired/cancelled/refunded/pending rows do not conflict, so a '
  'renewal can stack a new subscription once the previous row leaves '
  'active/grace. Complements (does not replace) the plan-level guard from '
  'migration 086.';

comment on index public.idx_student_subs_student_course_status is
  'Per-course access checks (subscriptionAccess) and lifecycle scans filter '
  'by (student_id, course_id, status) across all statuses.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. course_id populated in subscription_plans (expect 0 NULLs):
--    select count(*) as total_plans,
--           count(course_id) as with_course,
--           count(*) filter (where course_id is null) as null_course_id
--    from public.subscription_plans;
--
-- 2. New course-level unique constraints exist:
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.subscription_plans'::regclass
--      and conname in ('uq_subscription_plans_course_billing_cycle',
--                      'uq_subscription_plans_course_slug')
--    order by conname;
--
-- 3. Institute-level uniqueness constraints REMOVED (expect zero rows):
--    select conname
--    from pg_constraint
--    where conrelid = 'public.subscription_plans'::regclass
--      and conname in ('uq_subscription_plans_institute_name',
--                      'uq_subscription_plans_institute_slug');
--
-- 4. course_id populated in student_subscriptions (expect 0 NULLs):
--    select count(*) as total_subs,
--           count(course_id) as with_course,
--           count(*) filter (where course_id is null) as null_course_id
--    from public.student_subscriptions;
--
-- 5. FK integrity (expect 0 orphan rows in all three queries):
--    select count(*) as orphan_plans
--    from public.subscription_plans sp
--    left join public.courses c on c.course_id = sp.course_id
--    where c.course_id is null;
--
--    select count(*) as orphan_subs
--    from public.student_subscriptions ss
--    left join public.courses c on c.course_id = ss.course_id
--    where c.course_id is null;
--
--    select count(*) as orphan_order_items
--    from public.order_items oi
--    left join public.courses c on c.course_id = oi.course_id
--    where oi.item_type = 'subscription_plan'
--      and c.course_id is null;
--
-- 6. Consistency between the two course_id sources (expect 0):
--    select count(*) as mismatched
--    from public.student_subscriptions ss
--    join public.subscription_plans sp on sp.plan_id = ss.plan_id
--    where ss.course_id is distinct from sp.course_id;
--
-- 7. Trigger exists (expect one row):
--    select tgname, tgenabled
--    from pg_trigger
--    where tgrelid = 'public.student_subscriptions'::regclass
--      and tgname = 'trg_student_subscriptions_validate_course';
--
-- 8. New unique index exists and is UNIQUE + partial (expect true | true):
--    select indexname
--    from pg_indexes
--    where schemaname = 'public'
--      and tablename  = 'student_subscriptions'
--      and indexname  = 'uq_student_subscriptions_student_course_active_grace';
--
--    select i.indisunique,
--           (i.indpred is not null) as is_partial
--    from pg_index i
--    join pg_class c     on c.oid = i.indexrelid
--    join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname = 'uq_student_subscriptions_student_course_active_grace';
--
-- 9. Existing plan-level guard 086 still present (expect one row):
--    select indexname
--    from pg_indexes
--    where schemaname = 'public'
--      and tablename  = 'student_subscriptions'
--      and indexname  = 'uq_student_subscriptions_student_plan_active_grace';
--
-- 10. order_items CHECK accepts subscription_plan + course_id:
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.order_items'::regclass
--      and conname = 'ck_order_items_item_type_consistency';
--
-- 11. The consistency trigger rejects a mismatched write (run in a
--     transaction and ROLLBACK — expected: ERROR "must match
--     subscription_plans.course_id"). Uses a deterministic wrong course UUID
--     so the probe works even when the institute has exactly one course:
--    begin;
--    insert into public.student_subscriptions (
--      student_id, plan_id, institute_id, course_id, status, start_date, end_date
--    )
--    select student_id, plan_id, institute_id,
--           '00000000-0000-0000-0000-000000000001',
--           'pending', '2000-01-01', '2000-02-01'
--    from public.student_subscriptions ss2
--    join public.subscription_plans sp2 on sp2.plan_id = ss2.plan_id
--    limit 1;
--    rollback;
--
-- 12. No duplicate active/grace per course (expect 0):
--    select count(*) as violating_pairs
--    from (
--      select student_id, course_id
--      from public.student_subscriptions
--      where status in ('active', 'grace')
--      group by student_id, course_id
--      having count(*) > 1
--    ) d;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (if this migration must be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ INHERENT LIMITATION: the uniqueness change (drop institute-level name +
-- slug, add course-level billing_cycle + slug) is NOT fully reversible.
-- Re-adding uq_subscription_plans_institute_name / _institute_slug will FAIL
-- if duplicate (institute_id, name) or (institute_id, slug) rows now exist —
-- which is exactly why they were dropped (per-course "Monthly" plans/slugs).
-- Rollback below restores everything except those two constraints; re-add
-- them manually ONLY if the data still satisfies them.
--
-- drop trigger if exists trg_student_subscriptions_validate_course
--   on public.student_subscriptions;
--
-- drop function if exists public.trgfn_subscription_validate_course();
--
-- drop index if exists public.uq_student_subscriptions_student_course_active_grace;
-- drop index if exists public.idx_student_subs_student_course_status;
-- drop index if exists public.idx_subscription_plans_course_active;
--
-- alter table public.student_subscriptions
--   drop constraint if exists fk_student_subscriptions_course;
-- alter table public.student_subscriptions
--   drop column if exists course_id;
--
-- -- order_items: the 043-era CHECK (which allowed course_id only on 'course'
-- -- lines) is NOT restored automatically because course-scoped purchase code
-- -- may already depend on the relaxed form. If a full rollback is required,
-- -- restore it manually:
-- --   alter table public.order_items
-- --     drop constraint if exists ck_order_items_item_type_consistency;
-- --   alter table public.order_items
-- --     add constraint ck_order_items_item_type_consistency
-- --     check (
-- --       (item_type = 'subscription_plan' and plan_id is not null and package_id is null and course_id is null)
-- --       or (item_type = 'pyq_package'      and package_id is not null and plan_id is null and course_id is null)
-- --       or (item_type = 'course'           and course_id is not null and plan_id is null and package_id is null)
-- --     );
--
-- alter table public.subscription_plans
--   drop constraint if exists uq_subscription_plans_course_billing_cycle;
-- alter table public.subscription_plans
--   drop constraint if exists uq_subscription_plans_course_slug;
-- -- uq_subscription_plans_institute_name / _institute_slug: NOT restored
-- -- automatically — see the inherent-limitation note above.
-- alter table public.subscription_plans
--   drop constraint if exists fk_subscription_plans_course;
-- alter table public.subscription_plans
--   alter column course_id drop not null;
-- -- Phase 1's column is intentionally NOT dropped here (migration 089 owns
-- -- that rollback); run 089's rollback afterwards if the full column removal
-- -- is required.

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 090 (Phase 2 of 2). Phase 1 = migration 089.
-- ════════════════════════════════════════════════════════════════════════════
