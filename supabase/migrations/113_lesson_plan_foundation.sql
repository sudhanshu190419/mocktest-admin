-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 113 — LESSON PLAN FOUNDATION (Phase 1, topic/lesson planning)
-- ════════════════════════════════════════════════════════════════════════════
-- Approved architecture (see analysis report, sections 21/22):
--
--   timetable_slots   = WHEN the recurring class happens (recurring rule)
--   lesson_plans      = WHAT is planned for a specific occurrence date
--   live_classes      = WHAT actually exists as the class occurrence
--                       (carries the materialized chapter_id / topic_id)
--
-- The academic hierarchy (subjects → chapters → topics, migration 003) is
-- REUSED — no new topic/chapter system. No live_classes.subject_id is added
-- (deployed DB has none). Migrations 108–112 are NOT modified — this file is
-- purely additive and re-creates only public.materialize_timetable_classes()
-- (same signature as 109) to copy planned chapter/topic into occurrences.
--
-- Contents:
--   1. live_classes.topic_id (additive column + FK)
--   2. lesson_plans table (unique per slot + occurrence_date)
--   3. Topic→chapter integrity trigger (lesson_plans + live_classes)
--   4. RLS (admins CRUD own institute, teachers read own slots, students none)
--   5. Plan-aware materialize_timetable_classes (CREATE OR REPLACE of 109)
--   6. upsert_lesson_plan() / delete_lesson_plan() RPCs + grants
--
-- DEPLOYMENT STATUS: NOT DEPLOYED — do not apply until approved.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — live_classes.topic_id (additive provenance of taught unit)
-- ════════════════════════════════════════════════════════════════════════════
-- The actual taught unit of a class occurrence. NULL means "no topic planned
-- yet" — classes remain fully valid without one. Coexists with the existing
-- live_classes.chapter_id (chapter = anchor, topic = optional refinement).
-- Materialization and the lesson-plan RPCs populate it; completed classes are
-- never rewritten (historical record).

alter table public.live_classes
  add column if not exists topic_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_live_classes_topic'
  ) then
    alter table public.live_classes
      add constraint fk_live_classes_topic
        foreign key (topic_id) references public.topics (topic_id)
        on delete restrict
        on update restrict;
  end if;
end $$;

comment on column public.live_classes.topic_id is
  'The actual topic taught in this occurrence (optional refinement of the '
  'existing chapter_id). NULL = no topic assigned yet. Populated by '
  'materialization from lesson_plans and by the lesson-plan RPCs. Historical '
  '(completed) classes are never rewritten.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Table: lesson_plans (the planning layer)
-- ════════════════════════════════════════════════════════════════════════════
-- One row = the planned chapter/topic for ONE occurrence date of ONE
-- recurring slot. Keyed by (timetable_slot_id, occurrence_date) — unique — so
-- a yearly plan can cover the slot's full validity period while live_classes
-- only exists for the rolling ~60-day materialization window. Keying by DATE
-- (not time) means slot time edits never invalidate plans.
--
-- Only recurring timetable classes use lesson_plans. Teacher-created one-off
-- classes carry chapter/topic directly on live_classes.

create table if not exists public.lesson_plans (
  -- Primary Key
  lesson_plan_id   uuid      not null  default gen_random_uuid(),

  -- Ownership & Scoping
  institute_id     uuid      not null,
  timetable_slot_id uuid     not null,

  -- Planning (per occurrence date)
  occurrence_date  date      not null,
  chapter_id       uuid      null      default null,
  topic_id         uuid      null      default null,
  notes            text      null      default null,

  -- Audit
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid      null      default null,
  updated_by       uuid      null      default null,

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_lesson_plans primary key (lesson_plan_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  constraint fk_lesson_plans_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- Plans are purely subordinate to their recurring rule. Slots are soft-
  -- cancelled (never hard-deleted, see 108), so cascade is only a safety
  -- valve for a hypothetical hard delete.
  constraint fk_lesson_plans_timetable_slot
    foreign key (timetable_slot_id) references public.timetable_slots (timetable_slot_id)
    on delete cascade
    on update restrict,

  constraint fk_lesson_plans_chapter
    foreign key (chapter_id) references public.chapters (chapter_id)
    on delete restrict
    on update restrict,

  constraint fk_lesson_plans_topic
    foreign key (topic_id) references public.topics (topic_id)
    on delete restrict
    on update restrict,

  constraint fk_lesson_plans_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint fk_lesson_plans_updated_by
    foreign key (updated_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Uniqueness ────────────────────────────────────────────────────────
  -- Exactly one plan per slot per occurrence date. This unique index is the
  -- ONLY new index this migration introduces (materialization + propagation
  -- lookups are covered by it; runtime display joins chapters/topics by PK).
  constraint uq_lesson_plans_slot_occurrence unique (timetable_slot_id, occurrence_date)
);

comment on table public.lesson_plans is
  'Yearly planning layer for recurring timetable slots: one row per '
  '(timetable_slot_id, occurrence_date) holding the planned chapter/topic. '
  'Copied into live_classes by materialization. Keyed by date so slot time '
  'edits never invalidate plans. One-off classes never use this table.';

comment on column public.lesson_plans.occurrence_date is
  'Calendar date of the planned occurrence (slot time defines the actual '
  'scheduled_at). Independent of the 60-day materialization window.';

comment on column public.lesson_plans.chapter_id is
  'Planned chapter (anchor granularity — JEE chapters such as Kinematics). '
  'Nullable: a plan may be created before the topic is chosen.';

comment on column public.lesson_plans.topic_id is
  'Planned topic (optional refinement of chapter_id). When set, the '
  'integrity trigger guarantees topics.chapter_id = chapter_id.';

-- ── updated_at trigger (project convention, see 108:328) ────────────────────
create trigger trg_lesson_plans_set_updated_at
  before update on public.lesson_plans
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Topic→chapter integrity trigger
-- ════════════════════════════════════════════════════════════════════════════
-- Guarantees on BOTH lesson_plans and live_classes:
--   • topic_id (if set) must exist and belong to chapter_id (if both set)
--   • if topic_id is set and chapter_id is NULL, chapter_id is derived from
--     the topic (topic implies chapter)
--   • chapter-only rows (topic_id NULL) are always valid
-- SECURITY DEFINER so the check reads public.topics regardless of the caller's
-- RLS on that table; set search_path = '' and fully-qualified references.
-- KNOWN LIMITATION: this trigger only fires on lesson_plans/live_classes
-- writes. public.topics.chapter_id should be treated as IMMUTABLE — if a
-- topic's chapter were ever changed in place, existing references would go
-- stale (a topics UPDATE trigger would be needed to fully close that gap).

create or replace function public.ensure_topic_matches_chapter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chapter_id uuid;
begin
  if new.topic_id is not null then
    select chapter_id into v_chapter_id
    from public.topics
    where topic_id = new.topic_id;

    if v_chapter_id is null then
      raise exception 'Topic % does not exist.', new.topic_id;
    end if;

    if new.chapter_id is not null
       and v_chapter_id is distinct from new.chapter_id then
      raise exception 'Topic % does not belong to chapter %.', new.topic_id, new.chapter_id;
    end if;

    -- Topic implies chapter: derive it when the caller only supplied a topic.
    if new.chapter_id is null then
      new.chapter_id := v_chapter_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lesson_plans_topic_chapter on public.lesson_plans;
create trigger trg_lesson_plans_topic_chapter
  before insert or update on public.lesson_plans
  for each row
  execute function public.ensure_topic_matches_chapter();

drop trigger if exists trg_live_classes_topic_chapter on public.live_classes;
create trigger trg_live_classes_topic_chapter
  before insert or update on public.live_classes
  for each row
  execute function public.ensure_topic_matches_chapter();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — RLS (mirrors timetable_slots, migration 108:353+)
-- ════════════════════════════════════════════════════════════════════════════
-- Super/Academic Admins: full access within their own institute.
-- Teachers: read-only, ONLY plans of their own slots (no CRUD — recurring
-- timetable control stays admin-only).
-- Students / finance / unassigned: denied (no policy).
-- Institute isolation: every policy is bound to institute_id (admins) or to
-- the slot owner (teachers). Institute A can never see Institute B's plans.
-- Service role bypasses RLS for materialization/edge functions.

alter table public.lesson_plans enable row level security;

drop policy if exists "Admins can read lesson plans" on public.lesson_plans;
create policy "Admins can read lesson plans"
  on public.lesson_plans
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and (public.is_super_admin() or public.is_academic_admin())
  );

drop policy if exists "Admins can manage lesson plans" on public.lesson_plans;
create policy "Admins can manage lesson plans"
  on public.lesson_plans
  for all
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and (public.is_super_admin() or public.is_academic_admin())
  )
  with check (
    institute_id = public.get_my_institute_id()
    and (public.is_super_admin() or public.is_academic_admin())
  );

drop policy if exists "Teachers can read their lesson plans" on public.lesson_plans;
create policy "Teachers can read their lesson plans"
  on public.lesson_plans
  for select
  to authenticated
  using (
    exists (
      select 1 from public.timetable_slots ts
      where ts.timetable_slot_id = lesson_plans.timetable_slot_id
        and ts.teacher_id = public.get_my_teacher_id()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Plan-aware materialization (CREATE OR REPLACE of 109)
-- ════════════════════════════════════════════════════════════════════════════
-- Identical to migration 109 EXCEPT: for each occurrence the function looks up
-- public.lesson_plans for (slot_id, occurrence_date) and copies the planned
-- chapter/topic into the live_classes INSERT. No plan row → NULL/NULL (class
-- remains valid without a topic). Holiday/leave skipping, institute scope,
-- ON CONFLICT idempotency, and the batch_subject_live_classes junction are
-- unchanged. reconcile_timetable_slot() (110) gap-fills through this function,
-- so reconciliation becomes plan-aware automatically.

create or replace function public.materialize_timetable_classes(
  p_slot_id   uuid,
  p_from_date date,
  p_to_date   date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot          record;
  v_timezone      text;
  v_occurrence    date;
  v_scheduled_at  timestamptz;
  v_duration_min  integer;
  v_title         varchar(500);
  v_class_id      uuid;
  v_created       integer := 0;
  v_plan_chapter  uuid;
  v_plan_topic    uuid;
begin
  -- ── Caller check (admins or service role for future cron) ────────────
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can materialize timetable classes.';
  end if;

  if p_from_date is null or p_to_date is null or p_to_date < p_from_date then
    raise exception 'A valid from/to date range is required.';
  end if;

  -- ── Load slot + joined batch/subject names ───────────────────────────
  select ts.timetable_slot_id,
         ts.institute_id,
         ts.teacher_id,
         ts.batch_subject_id,
         ts.day_of_week,
         ts.start_time,
         ts.end_time,
         ts.valid_from,
         ts.valid_until,
         ts.status,
         coalesce(bs.name, s.name)  as subject_display_name,
         b.name                     as batch_name
  into v_slot
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  join public.subjects s          on s.subject_id          = bs.subject_id
  join public.batches b           on b.batch_id            = bs.batch_id
  where ts.timetable_slot_id = p_slot_id;

  if v_slot.timetable_slot_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  -- ── Institute scope (SECURITY DEFINER bypasses RLS) ──────────────────
  if auth.role() <> 'service_role'
     and v_slot.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetables can only be materialized for your own institute.';
  end if;

  -- Only active slots generate classes.
  if v_slot.status <> 'active'::public.timetable_slot_status then
    return 0;
  end if;

  -- ── Institute timezone ───────────────────────────────────────────────
  select timezone into v_timezone
  from public.institutes
  where institute_id = v_slot.institute_id;

  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  v_duration_min := (extract(epoch from (v_slot.end_time - v_slot.start_time)) / 60)::integer;
  v_title := left(v_slot.subject_display_name || ' — ' || v_slot.batch_name, 500);

  -- ── Iterate occurrence dates in the requested window ∩ validity ──────
  for v_occurrence in
    select g::date
    from generate_series(
      greatest(p_from_date, v_slot.valid_from),
      least(p_to_date, v_slot.valid_until),
      interval '1 day'
    ) g
    where extract(isodow from g) = v_slot.day_of_week
      and not exists (
        select 1 from public.institute_holidays h
        where h.institute_id = v_slot.institute_id
          and h.holiday_date = g::date
      )
      and not exists (
        select 1 from public.teacher_leaves l
        where l.institute_id = v_slot.institute_id
          and l.teacher_id = v_slot.teacher_id
          and l.status = 'active'::public.teacher_leave_status
          and l.start_date <= g::date
          and l.end_date >= g::date
      )
  loop
    -- Wall-clock slot time in the institute's timezone → UTC timestamptz
    v_scheduled_at := (v_occurrence + v_slot.start_time) at time zone v_timezone;

    -- ── Lesson-plan lookup: WHAT is planned for this (slot, date) ──────
    -- Explicit NULL reset keeps each iteration independent even if a plan
    -- exists only for some dates. No plan row → occurrence stays topic-free.
    v_plan_chapter := null;
    v_plan_topic   := null;
    select chapter_id, topic_id
      into v_plan_chapter, v_plan_topic
    from public.lesson_plans
    where timetable_slot_id = p_slot_id
      and occurrence_date = v_occurrence;

    -- FIXED INSERT: only columns that exist on the deployed live_classes.
    -- subject_id removed — batch/subject linkage happens below via
    -- batch_subject_live_classes (identical to the app's own creation flow).
    insert into public.live_classes (
      institute_id,
      teacher_id,
      title,
      scheduled_at,
      duration_min,
      status,
      is_recorded,
      timetable_slot_id,
      chapter_id,
      topic_id
    )
    values (
      v_slot.institute_id,
      v_slot.teacher_id,
      v_title,
      v_scheduled_at,
      v_duration_min,
      'scheduled'::public.live_class_status,
      true,
      p_slot_id,
      v_plan_chapter,
      v_plan_topic
    )
    on conflict (timetable_slot_id, scheduled_at)
      where timetable_slot_id is not null
    do nothing
    returning class_id into v_class_id;

    if v_class_id is not null then
      -- Broadcast to the batch via the existing subject-scoped junction
      insert into public.batch_subject_live_classes (
        batch_subject_id, class_id, institute_id
      )
      values (
        v_slot.batch_subject_id, v_class_id, v_slot.institute_id
      )
      on conflict (batch_subject_id, class_id) do nothing;

      v_created := v_created + 1;
      v_class_id := null;
    end if;
  end loop;

  return v_created;
end;
$$;

comment on function public.materialize_timetable_classes(uuid, date, date) is
  'Idempotently generates live_classes occurrences for one active timetable '
  'slot within a date range, skipping holidays and teacher leaves. Copies the '
  'planned chapter/topic from lesson_plans when a plan exists for the '
  '(slot, occurrence_date); occurrences remain valid without a topic. Returns '
  'the number of classes created (0 on re-runs). Batch/subject linkage via '
  'batch_subject_live_classes (no live_classes.subject_id).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Lesson-plan RPCs (SECURITY DEFINER, admin/service-role only)
-- ════════════════════════════════════════════════════════════════════════════
-- upsert_lesson_plan():  idempotently create/update one plan row and, in the
--                        same transaction, propagate the chapter/topic to the
--                        matching FUTURE scheduled occurrence (status =
--                        'scheduled'). Live/completed/cancelled classes are
--                        NEVER rewritten — history stays frozen.
-- delete_lesson_plan():  delete the plan row and clear chapter/topic on the
--                        matching future scheduled occurrence only.

create or replace function public.upsert_lesson_plan(
  p_timetable_slot_id uuid,
  p_occurrence_date   date,
  p_chapter_id        uuid default null,
  p_topic_id          uuid default null,
  p_notes             text default null,
  p_created_by        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_institute_id uuid;
  v_timezone          text;
  v_updated           integer := 0;
  v_actor             uuid;
begin
  -- ── Caller check: admins or service role (never trusts a teacher/student) ─
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can manage lesson plans.';
  end if;

  if p_timetable_slot_id is null or p_occurrence_date is null then
    raise exception 'A timetable slot id and occurrence date are required.';
  end if;

  -- ── Resolve the slot + bind to the caller's own institute ────────────
  select institute_id into v_slot_institute_id
  from public.timetable_slots
  where timetable_slot_id = p_timetable_slot_id;

  if v_slot_institute_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  if auth.role() <> 'service_role'
     and v_slot_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Lesson plans can only be managed for your own institute.';
  end if;

  -- ── Topic→chapter validation (defense in depth; the trigger enforces too) ─
  if p_topic_id is not null then
    -- Derive the chapter from the topic when none was supplied (also
    -- verifies the topic exists).
    if p_chapter_id is null then
      select chapter_id into p_chapter_id
      from public.topics
      where topic_id = p_topic_id;

      if p_chapter_id is null then
        raise exception 'Topic % does not exist.', p_topic_id;
      end if;
    end if;

    -- When a chapter was supplied, the topic must exist and belong to it.
    if not exists (
      select 1 from public.topics t
      where t.topic_id = p_topic_id
        and t.chapter_id = p_chapter_id
    ) then
      if exists (select 1 from public.topics where topic_id = p_topic_id) then
        raise exception 'Topic % does not belong to the selected chapter.', p_topic_id;
      else
        raise exception 'Topic % does not exist.', p_topic_id;
      end if;
    end if;
  end if;

  v_actor := coalesce(p_created_by, auth.uid());

  -- ── Idempotent upsert keyed by (timetable_slot_id, occurrence_date) ───
  insert into public.lesson_plans (
    institute_id,
    timetable_slot_id,
    occurrence_date,
    chapter_id,
    topic_id,
    notes,
    created_by
  )
  values (
    v_slot_institute_id,
    p_timetable_slot_id,
    p_occurrence_date,
    p_chapter_id,
    p_topic_id,
    p_notes,
    v_actor
  )
  on conflict (timetable_slot_id, occurrence_date)
  do update set
    chapter_id = excluded.chapter_id,
    topic_id   = excluded.topic_id,
    notes      = excluded.notes,
    updated_by = v_actor,
    updated_at = now();

  -- ── Propagate to the matching FUTURE scheduled occurrence only ────────
  select timezone into v_timezone
  from public.institutes
  where institute_id = v_slot_institute_id;
  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  -- Only FUTURE scheduled occurrences are ever rewritten — history frozen.
  update public.live_classes
  set chapter_id = p_chapter_id,
      topic_id   = p_topic_id,
      updated_at = now()
  where timetable_slot_id = p_timetable_slot_id
    and status = 'scheduled'::public.live_class_status
    and scheduled_at > now()
    and (scheduled_at at time zone v_timezone)::date = p_occurrence_date;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'success', true,
    'planUpserted', true,
    'occurrencesUpdated', v_updated
  );
end;
$$;

create or replace function public.delete_lesson_plan(
  p_timetable_slot_id uuid,
  p_occurrence_date   date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_institute_id uuid;
  v_timezone          text;
  v_deleted           integer := 0;
  v_updated           integer := 0;
begin
  -- ── Caller check: admins or service role ─────────────────────────────
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can manage lesson plans.';
  end if;

  if p_timetable_slot_id is null or p_occurrence_date is null then
    raise exception 'A timetable slot id and occurrence date are required.';
  end if;

  -- ── Resolve the slot + bind to the caller's own institute ────────────
  select institute_id into v_slot_institute_id
  from public.timetable_slots
  where timetable_slot_id = p_timetable_slot_id;

  if v_slot_institute_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  if auth.role() <> 'service_role'
     and v_slot_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Lesson plans can only be managed for your own institute.';
  end if;

  -- ── Delete the plan row ──────────────────────────────────────────────
  delete from public.lesson_plans
  where timetable_slot_id = p_timetable_slot_id
    and occurrence_date = p_occurrence_date;

  get diagnostics v_deleted = row_count;

  -- ── Clear the materialized topic on the matching FUTURE scheduled
  --    occurrence only (history is never rewritten) ─────────────────────
  select timezone into v_timezone
  from public.institutes
  where institute_id = v_slot_institute_id;
  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  -- Only FUTURE scheduled occurrences are ever cleared — history frozen.
  update public.live_classes
  set chapter_id = null,
      topic_id   = null,
      updated_at = now()
  where timetable_slot_id = p_timetable_slot_id
    and status = 'scheduled'::public.live_class_status
    and scheduled_at > now()
    and (scheduled_at at time zone v_timezone)::date = p_occurrence_date;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'success', true,
    'planDeleted', v_deleted,
    'occurrencesCleared', v_updated
  );
end;
$$;

-- ── Privileges: deny public, grant authenticated + service_role ────────────
-- The functions themselves enforce admin role + institute scope internally
-- (matching the create_timetable_slot pattern), so authenticated teachers and
-- students can call them but always receive a raised exception.
revoke all on function public.upsert_lesson_plan(uuid, date, uuid, uuid, text, uuid) from public;
revoke all on function public.delete_lesson_plan(uuid, date) from public;

grant execute on function public.upsert_lesson_plan(uuid, date, uuid, uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.delete_lesson_plan(uuid, date)
  to authenticated, service_role;

comment on function public.upsert_lesson_plan(uuid, date, uuid, uuid, text, uuid) is
  'Admin/service-role upsert of one lesson_plan row (unique per slot + '
  'occurrence date) with atomic propagation of chapter/topic to the matching '
  'future scheduled live_class. Live/completed/cancelled classes are never '
  'rewritten. Returns {success, planUpserted, occurrencesUpdated}.';

comment on function public.delete_lesson_plan(uuid, date) is
  'Admin/service-role delete of one lesson_plan row, clearing chapter/topic '
  'on the matching future scheduled live_class only. Returns '
  '{success, planDeleted, occurrencesCleared}.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 113 Lesson Plan Foundation
-- ════════════════════════════════════════════════════════════════════════════
