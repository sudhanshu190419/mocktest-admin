-- ============================================================================
-- Migration: 115 — Teacher Leave + Class Resolution Workflow (Phase 1)
--
-- PostgreSQL 16 | Supabase Compatible | Idempotent where required
--
-- ## Purpose
--
-- Implements the occurrence-level teacher-leave + class-resolution workflow
-- WITHOUT touching the recurring timetable rule:
--
--   TEACHER
--     ↓
--   teacher_leave_requests      (request + approval workflow — REUSED, extended)
--     ↓
--   leave_request_occurrences   (NEW — one request → many slot occurrences)
--     ↓
--   class_resolution_events     (NEW — occurrence-level resolution/history)
--     ↓
--   live_classes                (the affected occurrence ONLY)
--
-- `teacher_leaves` remains the operational availability snapshot consumed by
-- the existing timetable materialization (migrations 108/109/110). Approving
-- a leave request creates/extends a `teacher_leaves` row so the materializer
-- keeps skipping those occurrences exactly as before.
--
-- ## Guarantees
--
--   • A leave/resolution NEVER mutates timetable_slots / lesson_plans.
--   • One ACTIVE resolution per occurrence (partial unique index).
--   • All writes SECURITY DEFINER + set search_path = '' + institute-bound.
--   • Emergency (< 24 h) is computed SERVER-SIDE from actual class instants;
--     the 24-hour rule is classification, never a hard block.
--   • Past/live/completed classes can never be rewritten.
--   • reconcile_timetable_slot gains an additive guard (Section 11) so it
--     never reverts an occurrence that has a resolved resolution.
--
-- ## NOT modified
--   timetable_slots · lesson_plans · materialize_timetable_classes ·
--   start_scheduled_live_class · end_live_class · watchdog · bulk_import_timetable
--
-- Depends on: 002 (institutes, profiles, teacher_details, student_details),
--             003 (batches, batch_students), 005 (live_classes, recordings),
--             006 (mock_tests), 010 (notifications, notification_recipients),
--             011 (audit_logs, write_audit_log), 014 (teacher_leave_requests),
--             021 (get_my_institute_id, get_my_teacher_id, is_teacher,
--                  is_admin), 031 (batch_mock_tests), 065/072 (recordings),
--             066/067 (batch_subjects, batch_subject_teachers),
--             070/073 (batch_subject_live_classes, batch_subject_recordings),
--             074 (is_super_admin, is_academic_admin), 108/110 (timetable).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Enums
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_type where typname = 'class_resolution_type') then
    create type public.class_resolution_type as enum (
      'substitute_teacher', 'reschedule', 'recorded_class', 'mock_test', 'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'resolution_status') then
    create type public.resolution_status as enum ('pending', 'resolved', 'cancelled');
  end if;
end $$;

-- Notification event types for the leave/resolution workflow (054/055 pattern).
-- New enum values are NOT referenced inside this migration's function bodies
-- at call time within the same transaction; they become usable immediately
-- after this migration commits, and every RPC that emits a notification is
-- invoked only at runtime (post-commit).
alter type public.notification_event_type add value if not exists 'leave_request_submitted';
alter type public.notification_event_type add value if not exists 'leave_request_emergency';
alter type public.notification_event_type add value if not exists 'leave_request_approved';
alter type public.notification_event_type add value if not exists 'leave_request_rejected';
alter type public.notification_event_type add value if not exists 'class_resolved';

-- Audit additions: NOT required — audit_action_type already contains
-- 'create', 'update', 'approve', 'reject' (migration 011).

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — teacher_leave_requests: additive columns (never replaces the
-- existing pending/approved/rejected/cancelled workflow)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.teacher_leave_requests
  add column if not exists is_emergency boolean not null default false;

alter table public.teacher_leave_requests
  add column if not exists time_until_class interval null;

alter table public.teacher_leave_requests
  add column if not exists affected_occurrences integer not null default 0;

comment on column public.teacher_leave_requests.is_emergency is
  'Server-computed: true when the earliest affected class starts less than 24 hours '
  'after submission. Classification only — never a hard block. Never trusted from the client.';
comment on column public.teacher_leave_requests.time_until_class is
  'Snapshot of the minimum (affected class scheduled_at − now) at submission time.';
comment on column public.teacher_leave_requests.affected_occurrences is
  'Number of timetable occurrences covered by this request (date range × slots).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Table: leave_request_occurrences (one request → many classes)
-- ════════════════════════════════════════════════════════════════════════════
-- Links a leave request to every concrete (slot, occurrence_date) it covers.
-- This is what allows one request to span a single class, a full day, or a
-- date range across many recurring slots without modifying timetable_slots.
-- Institute isolation is enforced via the parent teacher_leave_requests row
-- (RLS) and inside every RPC.

create table if not exists public.leave_request_occurrences (
  -- Primary Key
  leave_request_occurrence_id uuid not null default gen_random_uuid(),

  -- Ownership
  leave_request_id  uuid not null,
  timetable_slot_id uuid not null,

  -- The affected occurrence
  occurrence_date   date not null,

  -- Audit
  created_at        timestamptz not null default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_leave_request_occurrences primary key (leave_request_occurrence_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  constraint fk_leave_request_occurrences_request
    foreign key (leave_request_id) references public.teacher_leave_requests (leave_id)
    on delete cascade
    on update restrict,

  constraint fk_leave_request_occurrences_slot
    foreign key (timetable_slot_id) references public.timetable_slots (timetable_slot_id)
    on delete restrict
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- One request may cover a given slot occurrence only once.
  constraint uq_leave_request_occurrences unique (leave_request_id, timetable_slot_id, occurrence_date)
);

-- Indexes
create index if not exists idx_leave_request_occurrences_slot_occurrence
  on public.leave_request_occurrences (timetable_slot_id, occurrence_date);

comment on table public.leave_request_occurrences is
  'Concrete (timetable_slot_id, occurrence_date) pairs covered by a teacher leave request. '
  'Written only by SECURITY DEFINER RPCs. Recurring slots are never modified.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.leave_request_occurrences enable row level security;

drop policy if exists "Admins can read leave request occurrences" on public.leave_request_occurrences;
create policy "Admins can read leave request occurrences"
  on public.leave_request_occurrences
  for select
  to authenticated
  using (
    exists (
      select 1 from public.teacher_leave_requests tlr
      where tlr.leave_id = leave_request_occurrences.leave_request_id
        and tlr.institute_id = public.get_my_institute_id()
        and (public.is_super_admin() or public.is_academic_admin())
    )
  );

drop policy if exists "Teachers can read their leave request occurrences" on public.leave_request_occurrences;
create policy "Teachers can read their leave request occurrences"
  on public.leave_request_occurrences
  for select
  to authenticated
  using (
    exists (
      select 1 from public.teacher_leave_requests tlr
      where tlr.leave_id = leave_request_occurrences.leave_request_id
        and tlr.teacher_id = public.get_my_teacher_id()
    )
  );

-- No INSERT/UPDATE/DELETE policies: writes only through SECURITY DEFINER RPCs.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Table: class_resolution_events (occurrence-level resolution)
-- ════════════════════════════════════════════════════════════════════════════
-- Append-only history of what happened to ONE occurrence because of a leave.
-- The original schedule is always preserved (timetable_slot_id, occurrence_date
-- never change); a reschedule stores its new schedule in new_scheduled_at.
-- The partial unique index below is the database-level guarantee that at most
-- one active (pending/resolved) resolution exists per occurrence.

create table if not exists public.class_resolution_events (
  -- Primary Key
  resolution_id uuid not null default gen_random_uuid(),

  -- Ownership & Scoping
  institute_id     uuid not null,
  leave_request_id uuid null,

  -- Occurrence anchor (immutable — identifies the affected class)
  timetable_slot_id uuid not null,
  occurrence_date   date not null,
  class_id          uuid null,

  -- Resolution
  resolution_type  public.class_resolution_type not null default 'cancelled',
  status           public.resolution_status     not null default 'pending',

  -- Substitute / reschedule data
  prev_teacher_id  uuid null,
  new_teacher_id   uuid null,
  new_scheduled_at timestamptz null,
  new_duration_min integer      null,

  -- Recorded / mock-test replacement
  recording_id     uuid null,
  mock_test_id     uuid null,

  -- Notes + audit
  reason           text null,
  notes            text null,
  resolved_by      uuid null,
  resolved_at      timestamptz null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_class_resolution_events primary key (resolution_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  constraint fk_cre_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_cre_leave_request
    foreign key (leave_request_id) references public.teacher_leave_requests (leave_id)
    on delete set null
    on update restrict,

  constraint fk_cre_timetable_slot
    foreign key (timetable_slot_id) references public.timetable_slots (timetable_slot_id)
    on delete restrict
    on update restrict,

  constraint fk_cre_class
    foreign key (class_id) references public.live_classes (class_id)
    on delete set null
    on update restrict,

  constraint fk_cre_prev_teacher
    foreign key (prev_teacher_id) references public.teacher_details (teacher_id)
    on delete set null
    on update restrict,

  constraint fk_cre_new_teacher
    foreign key (new_teacher_id) references public.teacher_details (teacher_id)
    on delete set null
    on update restrict,

  constraint fk_cre_recording
    foreign key (recording_id) references public.recordings (recording_id)
    on delete set null
    on update restrict,

  constraint fk_cre_mock_test
    foreign key (mock_test_id) references public.mock_tests (test_id)
    on delete set null
    on update restrict,

  constraint fk_cre_resolved_by
    foreign key (resolved_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── CHECK Constraints ─────────────────────────────────────────────────
  constraint ck_cre_duration check (
    new_duration_min is null or (new_duration_min > 0 and new_duration_min <= 480)
  ),
  constraint ck_cre_resolution_state check (
    (status = 'resolved'::public.resolution_status
      and resolved_at is not null and resolved_by is not null)
    or (status in ('pending', 'cancelled') and resolved_at is null and resolved_by is null)
  )
);

-- Concurrency guarantee: ONE active resolution per occurrence.
create unique index if not exists uq_class_resolution_events_active_occurrence
  on public.class_resolution_events (timetable_slot_id, occurrence_date)
  where status <> 'cancelled'::public.resolution_status;

-- Lookup indexes
create index if not exists idx_cre_institute_status
  on public.class_resolution_events (institute_id, status);
create index if not exists idx_cre_leave_request
  on public.class_resolution_events (leave_request_id);
create index if not exists idx_cre_class
  on public.class_resolution_events (class_id);

-- updated_at trigger (set_updated_at exists from Domain 01)
drop trigger if exists trg_class_resolution_events_set_updated_at on public.class_resolution_events;
create trigger trg_class_resolution_events_set_updated_at
  before update on public.class_resolution_events
  for each row
  execute function public.set_updated_at();

comment on table public.class_resolution_events is
  'Occurrence-level class resolution for teacher leave. One active row per '
  '(timetable_slot_id, occurrence_date). Never mutates the recurring slot.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.class_resolution_events enable row level security;

drop policy if exists "Admins can read class resolution events" on public.class_resolution_events;
create policy "Admins can read class resolution events"
  on public.class_resolution_events
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and (public.is_super_admin() or public.is_academic_admin())
  );

drop policy if exists "Teachers can read their class resolution events" on public.class_resolution_events;
create policy "Teachers can read their class resolution events"
  on public.class_resolution_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.timetable_slots ts
      where ts.timetable_slot_id = class_resolution_events.timetable_slot_id
        and ts.teacher_id = public.get_my_teacher_id()
    )
    or new_teacher_id = public.get_my_teacher_id()
  );

-- No INSERT/UPDATE/DELETE policies: writes only through SECURITY DEFINER RPCs.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Internal helpers (SECURITY DEFINER; no public execute)
-- ════════════════════════════════════════════════════════════════════════════

-- Admin profile ids of an institute (leave-request notifications).
create or replace function public.resolution_admin_profiles(p_institute_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(profile_id order by profile_id), '{}'::uuid[])
  from public.profiles
  where institute_id = p_institute_id
    and role = 'admin'::public.user_role
    and is_active = true;
$$;

-- Student profile ids whose batch is linked to a live class.
create or replace function public.resolution_student_profiles(p_class_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.profile_id order by p.profile_id), '{}'::uuid[])
  from public.batch_subject_live_classes bslc
  join public.batch_subjects bs      on bs.batch_subject_id = bslc.batch_subject_id
  join public.batch_students bst     on bst.batch_id = bs.batch_id and bst.status = 'active'
  join public.student_details sd     on sd.student_id = bst.student_id
  join public.profiles p             on p.profile_id = sd.profile_id
  where bslc.class_id = p_class_id
    and p.is_active = true;
$$;

-- Student profile ids of a batch_subject (fallback when no class row exists).
create or replace function public.resolution_batch_student_profiles(p_batch_subject_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.profile_id order by p.profile_id), '{}'::uuid[])
  from public.batch_subjects bs
  join public.batch_students bst on bst.batch_id = bs.batch_id and bst.status = 'active'
  join public.student_details sd on sd.student_id = bst.student_id
  join public.profiles p         on p.profile_id = sd.profile_id
  where bs.batch_subject_id = p_batch_subject_id
    and p.is_active = true;
$$;

-- Creates ONE notification + recipient rows. Internal; called by the RPCs.
create or replace function public.resolution_notify(
  p_institute_id  uuid,
  p_event_type    public.notification_event_type,
  p_title         text,
  p_body          text,
  p_recipient_ids uuid[],
  p_reference_type text default null,
  p_reference_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification_id uuid;
  v_profile_id uuid;
begin
  if p_recipient_ids is null or array_length(p_recipient_ids, 1) is null then
    return null;
  end if;

  insert into public.notifications (
    institute_id, title, body, channel, event_type, triggered_by,
    reference_type, reference_id, total_recipients, dispatched_at
  )
  values (
    p_institute_id, p_title, p_body, 'in_app'::public.notification_channel,
    p_event_type, auth.uid(), p_reference_type, p_reference_id,
    array_length(p_recipient_ids, 1), now()
  )
  returning notification_id into v_notification_id;

  foreach v_profile_id in array p_recipient_ids loop
    insert into public.notification_recipients (notification_id, profile_id, institute_id)
    values (v_notification_id, v_profile_id, p_institute_id)
    on conflict (notification_id, profile_id) do nothing;
  end loop;

  return v_notification_id;
end;
$$;

-- Creates the occurrence live_class (materializer conventions) when the
-- resolution must run before the recurring materializer has produced it.
-- Idempotent via uq_live_classes_timetable_occurrence.
create or replace function public.resolution_create_class(
  p_slot_id         uuid,
  p_occurrence_date date,
  p_teacher_id      uuid,
  p_scheduled_at    timestamptz,
  p_duration_min    integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute       uuid;
  v_batch_subject   uuid;
  v_subject_display text;
  v_batch_name      text;
  v_title           varchar(500);
  v_chapter_id      uuid;
  v_topic_id        uuid;
  v_class_id        uuid;
begin
  select ts.institute_id,
         ts.batch_subject_id,
         coalesce(bs.name, s.name),
         b.name
  into v_institute, v_batch_subject, v_subject_display, v_batch_name
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  join public.subjects s         on s.subject_id         = bs.subject_id
  join public.batches b          on b.batch_id           = bs.batch_id
  where ts.timetable_slot_id = p_slot_id;

  if v_institute is null then
    raise exception 'Timetable slot not found.';
  end if;

  select lp.chapter_id, lp.topic_id into v_chapter_id, v_topic_id
  from public.lesson_plans lp
  where lp.timetable_slot_id = p_slot_id
    and lp.occurrence_date = p_occurrence_date
  limit 1;

  v_title := left(
    coalesce(v_subject_display, 'Class') || ' — ' || coalesce(v_batch_name, ''),
    500
  );

  insert into public.live_classes (
    institute_id, teacher_id, chapter_id, topic_id, title,
    scheduled_at, duration_min, status, is_recorded, timetable_slot_id
  )
  values (
    v_institute, p_teacher_id, v_chapter_id, v_topic_id, v_title,
    p_scheduled_at, p_duration_min, 'scheduled'::public.live_class_status,
    true, p_slot_id
  )
  on conflict (timetable_slot_id, scheduled_at)
    where timetable_slot_id is not null
  do nothing
  returning class_id into v_class_id;

  if v_class_id is not null then
    insert into public.batch_subject_live_classes (
      batch_subject_id, class_id, institute_id
    )
    values (v_batch_subject, v_class_id, v_institute)
    on conflict (batch_subject_id, class_id) do nothing;
  end if;

  return v_class_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — RPC: submit_teacher_leave_request
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher-only. Derives every affected (slot, occurrence) from the teacher's
-- own active slots, validates no live/completed/past class is covered,
-- computes emergency SERVER-SIDE, and creates the pending request + its
-- occurrence rows + admin notifications + audit in one transaction.
-- The existing trgfn_teacher_leave_no_overlap trigger rejects overlapping
-- pending/approved requests for the same teacher.

create or replace function public.submit_teacher_leave_request(
  p_start    date,
  p_end      date,
  p_reason   text default null,
  p_category public.leave_category_type default 'casual',
  p_slot_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute  uuid;
  v_teacher    uuid;
  v_tz         text;
  v_leave_id   uuid;
  v_slot       record;
  v_occurrence date;
  v_class_at   timestamptz;
  v_effective  timestamptz;
  v_min_until  interval;
  v_emergency  boolean := false;
  v_count      integer := 0;
  v_admin_ids  uuid[];
begin
  -- ── Authorization ──────────────────────────────────────────────────────
  if auth.role() <> 'authenticated' or not public.is_teacher() then
    raise exception 'Only teachers can submit leave requests.';
  end if;

  v_teacher := public.get_my_teacher_id();
  v_institute := public.get_my_institute_id();

  if v_teacher is null then
    raise exception 'Teacher identity could not be resolved.';
  end if;

  -- ── Input validation ──────────────────────────────────────────────────
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'A valid leave date range (start <= end) is required.';
  end if;

  select timezone into v_tz from public.institutes where institute_id = v_institute;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  -- ── Candidate slots (teacher's own active slots overlapping the range) ─
  drop table if exists tmp_lr_slots;
  create temp table tmp_lr_slots (
    timetable_slot_id uuid primary key,
    day_of_week       smallint,
    start_time        time,
    end_time          time,
    valid_from        date,
    valid_until       date
  ) on commit drop;

  drop table if exists tmp_lr_occurrences;
  create temp table tmp_lr_occurrences (
    timetable_slot_id uuid not null,
    occurrence_date   date not null
  ) on commit drop;

  insert into tmp_lr_slots
  select ts.timetable_slot_id, ts.day_of_week, ts.start_time, ts.end_time,
         ts.valid_from, ts.valid_until
  from public.timetable_slots ts
  where ts.institute_id = v_institute
    and ts.teacher_id = v_teacher
    and ts.status = 'active'::public.timetable_slot_status
    and ts.valid_from <= p_end
    and ts.valid_until >= p_start;

  if p_slot_ids is not null and array_length(p_slot_ids, 1) > 0 then
    for i in 1..array_length(p_slot_ids, 1) loop
      if not exists (
        select 1 from tmp_lr_slots where timetable_slot_id = p_slot_ids[i]
      ) then
        raise exception 'Timetable slot % is not an active slot of yours in this institute.', p_slot_ids[i];
      end if;
    end loop;
    delete from tmp_lr_slots where timetable_slot_id <> all (p_slot_ids);
  end if;

  if not exists (select 1 from tmp_lr_slots) then
    raise exception 'No timetable slots found for the requested date range.';
  end if;

  -- ── Enumerate occurrences + validate class state + emergency math ─────
  for v_slot in select * from tmp_lr_slots loop
    for v_occurrence in
      select g::date
      from generate_series(
        greatest(p_start, v_slot.valid_from),
        least(p_end, v_slot.valid_until),
        interval '1 day'
      ) g
      where extract(isodow from g) = v_slot.day_of_week
    loop
      -- Reject live/completed/past classes for the occurrence
      if exists (
        select 1 from public.live_classes lc
        where lc.timetable_slot_id = v_slot.timetable_slot_id
          and (lc.scheduled_at at time zone v_tz)::date = v_occurrence
          and lc.status in ('live'::public.live_class_status,
                            'completed'::public.live_class_status)
      ) then
        raise exception 'Leave cannot cover a live or completed class on %.', v_occurrence;
      end if;

      select lc.scheduled_at into v_class_at
      from public.live_classes lc
      where lc.timetable_slot_id = v_slot.timetable_slot_id
        and (lc.scheduled_at at time zone v_tz)::date = v_occurrence
        and lc.status = 'scheduled'::public.live_class_status
      order by lc.scheduled_at desc
      limit 1;

      if v_class_at is not null and v_class_at <= clock_timestamp() then
        raise exception 'Leave cannot cover a class that has already started on %.', v_occurrence;
      end if;

      -- Effective class instant (materialized row, else computed wall-clock)
      v_effective := coalesce(
        v_class_at,
        (v_occurrence + v_slot.start_time) at time zone v_tz
      );

      if v_min_until is null or (v_effective - clock_timestamp()) < v_min_until then
        v_min_until := v_effective - clock_timestamp();
      end if;

      insert into tmp_lr_occurrences (timetable_slot_id, occurrence_date)
      values (v_slot.timetable_slot_id, v_occurrence);

      v_count := v_count + 1;
    end loop;
  end loop;

  v_emergency := v_min_until is not null and v_min_until < interval '24 hours';

  if v_count = 0 then
    raise exception 'No class occurrences fall inside the requested date range for your timetable slots.';
  end if;

  -- ── Persist request + occurrences ─────────────────────────────────────
  insert into public.teacher_leave_requests (
    teacher_id, institute_id, leave_category, start_date, end_date,
    reason, status, is_emergency, time_until_class, affected_occurrences
  )
  values (
    v_teacher, v_institute, p_category, p_start, p_end, p_reason,
    'pending'::public.leave_status_type, v_emergency, v_min_until, v_count
  )
  returning leave_id into v_leave_id;

  insert into public.leave_request_occurrences (leave_request_id, timetable_slot_id, occurrence_date)
  select v_leave_id, timetable_slot_id, occurrence_date
  from tmp_lr_occurrences;

  drop table tmp_lr_slots;
  drop table tmp_lr_occurrences;

  -- ── Notify academic admins ────────────────────────────────────────────
  v_admin_ids := public.resolution_admin_profiles(v_institute);
  perform public.resolution_notify(
    v_institute,
    case when v_emergency then 'leave_request_emergency'::public.notification_event_type
         else 'leave_request_submitted'::public.notification_event_type end,
    case when v_emergency then '🚨 Emergency leave request'
         else 'Leave request submitted' end,
    'Leave request for ' || to_char(p_start, 'DD Mon YYYY') ||
      ' to ' || to_char(p_end, 'DD Mon YYYY') || ' covering ' || v_count::text ||
      ' class(es).' || case when v_emergency then ' Class starts in under 24 hours.' else '' end,
    v_admin_ids,
    'teacher_leave_request', v_leave_id
  );

  -- ── Audit (same transaction) ──────────────────────────────────────────
  perform public.write_audit_log(
    'create'::public.audit_action_type, 'teacher_leave_request', v_leave_id,
    null,
    jsonb_build_object(
      'start', p_start, 'end', p_end, 'status', 'pending',
      'is_emergency', v_emergency, 'occurrences', v_count,
      'time_until_class', v_min_until
    ),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object(
    'success', true,
    'leave_id', v_leave_id,
    'is_emergency', v_emergency,
    'affected_occurrences', v_count,
    'time_until_class', v_min_until
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — RPC: cancel_teacher_leave_request
-- ════════════════════════════════════════════════════════════════════════════
-- Teacher may cancel ONLY their own PENDING request.

create or replace function public.cancel_teacher_leave_request(p_leave_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher   uuid;
  v_row       record;
  v_old_value jsonb;
begin
  if auth.role() <> 'authenticated' or not public.is_teacher() then
    raise exception 'Only teachers can cancel leave requests.';
  end if;

  v_teacher := public.get_my_teacher_id();

  select * into v_row
  from public.teacher_leave_requests
  where leave_id = p_leave_id
  for update;

  if not found then
    raise exception 'Leave request not found.';
  end if;

  if v_row.teacher_id <> v_teacher then
    raise exception 'You can only cancel your own leave requests.';
  end if;

  if v_row.status <> 'pending'::public.leave_status_type then
    raise exception 'Only pending leave requests can be cancelled (current status: %).', v_row.status;
  end if;

  v_old_value := jsonb_build_object(
    'status', v_row.status, 'start', v_row.start_date, 'end', v_row.end_date
  );

  update public.teacher_leave_requests
  set status = 'cancelled'::public.leave_status_type,
      updated_at = now()
  where leave_id = p_leave_id;

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'teacher_leave_request', p_leave_id,
    v_old_value, jsonb_build_object('status', 'cancelled'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object('success', true, 'leave_id', p_leave_id, 'status', 'cancelled');
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — RPC: review_teacher_leave_request
-- ════════════════════════════════════════════════════════════════════════════
-- Academic/Super admin. APPROVE → reviewed fields, teacher_leaves operational
-- record, one pending class_resolution_events row per occurrence, teacher
-- notification. REJECT → reviewed fields + teacher notification. Nothing else.

create or replace function public.review_teacher_leave_request(
  p_leave_id uuid,
  p_decision text,
  p_remarks  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        public.teacher_leave_requests%rowtype;
  v_tz         text;
  v_occurrence record;
  v_tl_id      uuid;
  v_teacher_profile uuid;
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only academic or super admins can review leave requests.';
  end if;

  select * into v_row
  from public.teacher_leave_requests
  where leave_id = p_leave_id
  for update;

  if not found then
    raise exception 'Leave request not found.';
  end if;

  if v_row.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Leave requests can only be reviewed for your own institute.';
  end if;

  if v_row.status <> 'pending'::public.leave_status_type then
    raise exception 'Only pending leave requests can be reviewed (current status: %).', v_row.status;
  end if;

  if lower(coalesce(p_decision, '')) not in ('approve', 'reject') then
    raise exception 'Decision must be ''approve'' or ''reject''.';
  end if;

  select timezone into v_tz from public.institutes where institute_id = v_row.institute_id;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  select td.profile_id into v_teacher_profile
  from public.teacher_details td
  where td.teacher_id = v_row.teacher_id;

  if lower(p_decision) = 'approve' then
    -- ── Re-verify affected occurrences (never approve live/past) ───────
    for v_occurrence in
      select lro.timetable_slot_id, lro.occurrence_date
      from public.leave_request_occurrences lro
      where lro.leave_request_id = p_leave_id
    loop
      if exists (
        select 1 from public.live_classes lc
        where lc.timetable_slot_id = v_occurrence.timetable_slot_id
          and (lc.scheduled_at at time zone v_tz)::date = v_occurrence.occurrence_date
          and lc.status in ('live'::public.live_class_status,
                            'completed'::public.live_class_status)
      ) then
        raise exception 'Occurrence % now has a live/completed class; the request cannot be approved.', v_occurrence.occurrence_date;
      end if;
      if exists (
        select 1 from public.live_classes lc
        where lc.timetable_slot_id = v_occurrence.timetable_slot_id
          and (lc.scheduled_at at time zone v_tz)::date = v_occurrence.occurrence_date
          and lc.status = 'scheduled'::public.live_class_status
          and lc.scheduled_at <= clock_timestamp()
      ) then
        raise exception 'The class on % has already started; the request cannot be approved.', v_occurrence.occurrence_date;
      end if;
    end loop;

    -- ── Mark approved (honours ck_teacher_leave_requests_review_consistency)
    update public.teacher_leave_requests
    set status = 'approved'::public.leave_status_type,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        reviewer_remarks = p_remarks,
        updated_at = now()
    where leave_id = p_leave_id;

    -- ── teacher_leaves operational record (merge/extend; materializer input)
    select tl.teacher_leave_id into v_tl_id
    from public.teacher_leaves tl
    where tl.institute_id = v_row.institute_id
      and tl.teacher_id = v_row.teacher_id
      and tl.status = 'active'::public.teacher_leave_status
      and tl.start_date <= v_row.end_date
      and tl.end_date >= v_row.start_date
    order by tl.start_date
    limit 1
    for update;

    if v_tl_id is null then
      insert into public.teacher_leaves (
        institute_id, teacher_id, start_date, end_date, reason, status, created_by
      )
      values (
        v_row.institute_id, v_row.teacher_id, v_row.start_date, v_row.end_date,
        coalesce(v_row.reason, 'Approved leave request ' || p_leave_id::text),
        'active'::public.teacher_leave_status, auth.uid()
      )
      returning teacher_leave_id into v_tl_id;
    else
      update public.teacher_leaves
      set start_date = least(start_date, v_row.start_date),
          end_date   = greatest(end_date, v_row.end_date),
          reason     = coalesce(reason, v_row.reason),
          updated_at = now()
      where teacher_leave_id = v_tl_id;
    end if;

    -- ── One PENDING resolution per affected occurrence (safe default:
    --    'cancelled' — admin may later convert it to a real resolution).
    for v_occurrence in
      select lro.timetable_slot_id, lro.occurrence_date
      from public.leave_request_occurrences lro
      where lro.leave_request_id = p_leave_id
    loop
      insert into public.class_resolution_events (
        institute_id, leave_request_id, timetable_slot_id, occurrence_date,
        class_id, resolution_type, status, prev_teacher_id
      )
      select v_row.institute_id, p_leave_id, v_occurrence.timetable_slot_id,
             v_occurrence.occurrence_date,
             lc.class_id,
             'cancelled'::public.class_resolution_type,
             'pending'::public.resolution_status,
             ts.teacher_id
      from public.timetable_slots ts
      left join public.live_classes lc
        on lc.timetable_slot_id = ts.timetable_slot_id
       and (lc.scheduled_at at time zone v_tz)::date = v_occurrence.occurrence_date
       and lc.status = 'scheduled'::public.live_class_status
      where ts.timetable_slot_id = v_occurrence.timetable_slot_id;
    end loop;

    -- ── Notify teacher ──────────────────────────────────────────────────
    if v_teacher_profile is not null then
      perform public.resolution_notify(
        v_row.institute_id,
        'leave_request_approved'::public.notification_event_type,
        'Leave approved',
        'Your leave request for ' || to_char(v_row.start_date, 'DD Mon YYYY') ||
          ' to ' || to_char(v_row.end_date, 'DD Mon YYYY') || ' was approved.',
        array[v_teacher_profile], 'teacher_leave_request', p_leave_id
      );
    end if;

    perform public.write_audit_log(
      'approve'::public.audit_action_type, 'teacher_leave_request', p_leave_id,
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'approved', 'teacher_leaves_id', v_tl_id),
      null, null, null, null, 'success', null, null
    );

    return jsonb_build_object('success', true, 'leave_id', p_leave_id, 'status', 'approved');
  end if;

  -- ── REJECT ────────────────────────────────────────────────────────────
  update public.teacher_leave_requests
  set status = 'rejected'::public.leave_status_type,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      reviewer_remarks = p_remarks,
      updated_at = now()
  where leave_id = p_leave_id;

  if v_teacher_profile is not null then
    perform public.resolution_notify(
      v_row.institute_id,
      'leave_request_rejected'::public.notification_event_type,
      'Leave request rejected',
      'Your leave request for ' || to_char(v_row.start_date, 'DD Mon YYYY') ||
        ' to ' || to_char(v_row.end_date, 'DD Mon YYYY') || ' was rejected.' ||
        case when p_remarks is not null then ' Reason: ' || p_remarks else '' end,
      array[v_teacher_profile], 'teacher_leave_request', p_leave_id
    );
  end if;

  perform public.write_audit_log(
    'reject'::public.audit_action_type, 'teacher_leave_request', p_leave_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'rejected'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object('success', true, 'leave_id', p_leave_id, 'status', 'rejected');
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — Resolution RPCs (occurrence-level; never touch timetable_slots)
-- ════════════════════════════════════════════════════════════════════════════

-- Shared validation for a candidate teacher on a specific occurrence window.
create or replace function public.resolution_validate_teacher(
  p_resolution_id uuid,
  p_teacher_id    uuid,
  p_occurrence_date date,
  p_day_of_week   smallint,
  p_start_time    time,
  p_end_time      time,
  p_exclude_class_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res        public.class_resolution_events%rowtype;
  v_batch_subject uuid;
  v_active     boolean;
  v_conflict   record;
  v_window_start timestamptz;
  v_window_end   timestamptz;
  v_res_tz     text;
begin
  select * into v_res from public.class_resolution_events
  where resolution_id = p_resolution_id;

  select coalesce(timezone, 'Asia/Kolkata') into v_res_tz
  from public.institutes where institute_id = v_res.institute_id;

  if v_res.resolution_id is null then
    raise exception 'Resolution not found.';
  end if;

  select ts.batch_subject_id into v_batch_subject
  from public.timetable_slots ts
  where ts.timetable_slot_id = v_res.timetable_slot_id;

  -- Substitute exists, active, same institute
  select p.is_active into v_active
  from public.teacher_details td
  join public.profiles p on p.profile_id = td.profile_id
  where td.teacher_id = p_teacher_id
    and p.institute_id = v_res.institute_id;

  if v_active is null then
    raise exception 'Substitute teacher not found in this institute.';
  end if;
  if v_active <> true then
    raise exception 'Substitute teacher is not active.';
  end if;

  -- Assigned via batch_subject_teachers (authoritative)
  if not exists (
    select 1 from public.batch_subject_teachers bst
    where bst.batch_subject_id = v_batch_subject
      and bst.teacher_id = p_teacher_id
      and bst.institute_id = v_res.institute_id
  ) then
    raise exception 'Teacher is not assigned to this batch subject.';
  end if;

  -- Not on leave
  if exists (
    select 1 from public.teacher_leaves tl
    where tl.institute_id = v_res.institute_id
      and tl.teacher_id = p_teacher_id
      and tl.status = 'active'::public.teacher_leave_status
      and tl.start_date <= p_occurrence_date
      and tl.end_date >= p_occurrence_date
  ) then
    raise exception 'Teacher is on leave on this date.';
  end if;

  -- No holiday
  if exists (
    select 1 from public.institute_holidays h
    where h.institute_id = v_res.institute_id
      and h.holiday_date = p_occurrence_date
  ) then
    raise exception 'The occurrence date is an institute holiday.';
  end if;

  -- Timetable conflicts (reuses the authoritative find_timetable_slot_conflicts)
  for v_conflict in
    select * from public.find_timetable_slot_conflicts(
      v_res.institute_id, p_teacher_id, v_batch_subject,
      p_day_of_week, p_start_time, p_end_time,
      p_occurrence_date, p_occurrence_date, v_res.timetable_slot_id
    )
  loop
    raise exception 'Teacher conflict (%).', v_conflict.detail;
  end loop;

  -- Live-class overlap at the window (teacher side)
  v_window_start := (p_occurrence_date + p_start_time) at time zone v_res_tz;
  v_window_end   := (p_occurrence_date + p_end_time) at time zone v_res_tz;

  if exists (
    select 1 from public.live_classes lc
    where lc.institute_id = v_res.institute_id
      and lc.teacher_id = p_teacher_id
      and lc.status in ('scheduled'::public.live_class_status,
                        'live'::public.live_class_status)
      and lc.class_id is distinct from p_exclude_class_id
      and lc.scheduled_at < v_window_end
      and v_window_start < lc.scheduled_at + (lc.duration_min * interval '1 minute')
  ) then
    raise exception 'Teacher already has a live class in this time window.';
  end if;

  -- Batch-side live-class overlap at the same window
  if exists (
    select 1
    from public.live_classes lc
    join public.batch_subject_live_classes bslc on bslc.class_id = lc.class_id
    where bslc.batch_subject_id = v_batch_subject
      and lc.institute_id = v_res.institute_id
      and lc.status in ('scheduled'::public.live_class_status,
                        'live'::public.live_class_status)
      and lc.class_id is distinct from p_exclude_class_id
      and lc.scheduled_at < v_window_end
      and v_window_start < lc.scheduled_at + (lc.duration_min * interval '1 minute')
  ) then
    raise exception 'The batch already has a live class in this time window.';
  end if;
end;
$$;

-- ── 8.1 resolve_class_with_substitute ───────────────────────────────────────
create or replace function public.resolve_class_with_substitute(
  p_resolution_id uuid,
  p_teacher_id    uuid,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res          public.class_resolution_events%rowtype;
  v_slot         record;
  v_tz           text;
  v_scheduled_at timestamptz;
  v_duration     integer;
  v_class_id     uuid;
  v_status       public.live_class_status;
  v_cancelled_reason text;
  v_students     uuid[];
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only academic or super admins can resolve classes.';
  end if;

  select * into v_res
  from public.class_resolution_events
  where resolution_id = p_resolution_id
  for update;

  if v_res.resolution_id is null then
    raise exception 'Resolution not found.';
  end if;

  if v_res.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Resolutions can only be resolved for your own institute.';
  end if;

  if v_res.status <> 'pending'::public.resolution_status then
    raise exception 'Resolution is not pending (current status: %).', v_res.status;
  end if;

  select ts.*, coalesce(bs.name, s.name) as subject_display_name, b.name as batch_name
  into v_slot
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  join public.subjects s         on s.subject_id         = bs.subject_id
  join public.batches b          on b.batch_id           = bs.batch_id
  where ts.timetable_slot_id = v_res.timetable_slot_id;

  select timezone into v_tz from public.institutes where institute_id = v_res.institute_id;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  -- Future + scheduled-state checks
  if v_res.class_id is not null then
    select lc.scheduled_at, lc.duration_min, lc.class_id,
           lc.status, lc.cancelled_reason
    into v_scheduled_at, v_duration, v_class_id, v_status, v_cancelled_reason
    from public.live_classes lc
    where lc.class_id = v_res.class_id
    for update;

    if v_scheduled_at is null then
      raise exception 'Referenced live class not found.';
    end if;
    if v_scheduled_at <= clock_timestamp() then
      raise exception 'The affected class has already started; it cannot be substituted.';
    end if;
    if v_status not in ('scheduled'::public.live_class_status,
                        'cancelled'::public.live_class_status) then
      raise exception 'The affected class is not in a scheduled state; it cannot be substituted.';
    end if;
    -- A class cancelled BY THE TIMETABLE SYSTEM (e.g. teacher-leave
    -- supersession) is re-activated for the substitute; a manually cancelled
    -- class can never be revived.
    if v_status = 'cancelled'::public.live_class_status
       and not (
         v_cancelled_reason like 'Superseded by a timetable update%'
         or v_cancelled_reason like 'This recurring timetable slot is no longer active%'
       ) then
      raise exception 'The affected class was cancelled manually and cannot be revived; create a new resolution instead.';
    end if;
  else
    v_scheduled_at := (v_res.occurrence_date + v_slot.start_time) at time zone v_tz;
    if v_scheduled_at <= clock_timestamp() then
      raise exception 'The affected occurrence has already passed.';
    end if;
    v_duration := (extract(epoch from (v_slot.end_time - v_slot.start_time)) / 60)::integer;
  end if;

  -- Candidate teacher validation (assignment/leave/holiday/conflicts)
  perform public.resolution_validate_teacher(
    p_resolution_id, p_teacher_id, v_res.occurrence_date,
    v_slot.day_of_week, v_slot.start_time, v_slot.end_time, v_res.class_id
  );

  -- Apply at occurrence level (revive a timetable-system cancellation by
  -- clearing cancelled_at/reason — satisfies ck_live_classes_cancelled_state)
  if v_res.class_id is not null then
    update public.live_classes
    set status           = 'scheduled'::public.live_class_status,
        cancelled_at     = null,
        cancelled_reason = null,
        teacher_id       = p_teacher_id,
        updated_at       = now()
    where class_id = v_res.class_id;
  else
    v_class_id := public.resolution_create_class(
      v_res.timetable_slot_id, v_res.occurrence_date, p_teacher_id,
      v_scheduled_at, v_duration
    );
    if v_class_id is null then
      raise exception 'Could not create the substitute occurrence (unexpected conflict).';
    end if;
  end if;

  update public.class_resolution_events
  set resolution_type = 'substitute_teacher'::public.class_resolution_type,
      new_teacher_id  = p_teacher_id,
      status          = 'resolved'::public.resolution_status,
      class_id        = coalesce(v_res.class_id, v_class_id),
      notes           = coalesce(p_notes, notes),
      resolved_by     = auth.uid(),
      resolved_at     = now()
  where resolution_id = p_resolution_id;

  -- Notify substitute + students (guarded: only if the substitute has a profile)
  if exists (
    select 1 from public.teacher_details where teacher_id = p_teacher_id and profile_id is not null
  ) then
    perform public.resolution_notify(
      v_res.institute_id, 'class_resolved'::public.notification_event_type,
      'Substitute assigned', 'A substitute teacher has been assigned to your class.',
      array[(select profile_id from public.teacher_details where teacher_id = p_teacher_id)],
      'class_resolution_events', p_resolution_id
    );
  end if;

  v_students := public.resolution_student_profiles(coalesce(v_res.class_id, v_class_id));
  perform public.resolution_notify(
    v_res.institute_id, 'class_resolved'::public.notification_event_type,
    'Your class will be taught by a substitute',
    'Your scheduled class has been assigned a substitute teacher.',
    v_students, 'class_resolution_events', p_resolution_id
  );

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'class_resolution_events', p_resolution_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('type', 'substitute_teacher', 'teacher_id', p_teacher_id,
                       'status', 'resolved'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object(
    'success', true, 'resolution_id', p_resolution_id,
    'type', 'substitute_teacher', 'class_id', coalesce(v_res.class_id, v_class_id)
  );
end;
$$;

-- ── 8.2 reschedule_class_occurrence ─────────────────────────────────────────
create or replace function public.reschedule_class_occurrence(
  p_resolution_id uuid,
  p_new_date      date,
  p_new_start     time,
  p_new_end       time,
  p_new_teacher   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res          public.class_resolution_events%rowtype;
  v_slot         record;
  v_tz           text;
  v_teacher      uuid;
  v_duration     integer;
  v_new_at       timestamptz;
  v_class_id     uuid;
  v_status       public.live_class_status;
  v_cancelled_reason text;
  v_students     uuid[];
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only academic or super admins can resolve classes.';
  end if;

  select * into v_res
  from public.class_resolution_events
  where resolution_id = p_resolution_id
  for update;

  if v_res.resolution_id is null then
    raise exception 'Resolution not found.';
  end if;

  if v_res.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Resolutions can only be resolved for your own institute.';
  end if;

  if v_res.status <> 'pending'::public.resolution_status then
    raise exception 'Resolution is not pending (current status: %).', v_res.status;
  end if;

  if p_new_date is null or p_new_start is null or p_new_end is null or p_new_end <= p_new_start then
    raise exception 'A valid future date with start < end is required.';
  end if;

  select ts.*, coalesce(bs.name, s.name) as subject_display_name, b.name as batch_name
  into v_slot
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  join public.subjects s         on s.subject_id         = bs.subject_id
  join public.batches b          on b.batch_id           = bs.batch_id
  where ts.timetable_slot_id = v_res.timetable_slot_id;

  select timezone into v_tz from public.institutes where institute_id = v_res.institute_id;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  v_duration := (extract(epoch from (p_new_end - p_new_start)) / 60)::integer;
  v_new_at := (p_new_date + p_new_start) at time zone v_tz;

  if v_new_at <= clock_timestamp() then
    raise exception 'The rescheduled time must be in the future.';
  end if;

  v_teacher := coalesce(p_new_teacher, v_slot.teacher_id);

  -- Target must not collide with another active resolution or class
  if exists (
    select 1 from public.class_resolution_events cre
    where cre.timetable_slot_id = v_res.timetable_slot_id
      and cre.occurrence_date = p_new_date
      and cre.status <> 'cancelled'::public.resolution_status
      and cre.resolution_id <> p_resolution_id
  ) then
    raise exception 'Another active resolution already exists for the target date.';
  end if;

  if exists (
    select 1 from public.live_classes lc
    where lc.timetable_slot_id = v_res.timetable_slot_id
      and (lc.scheduled_at at time zone v_tz)::date = p_new_date
      and lc.status <> 'cancelled'::public.live_class_status
      and lc.class_id is distinct from v_res.class_id
  ) then
    raise exception 'A class already exists for this timetable on the target date.';
  end if;

  -- Teacher validation at the NEW day/time
  perform public.resolution_validate_teacher(
    p_resolution_id, v_teacher, p_new_date,
    (extract(isodow from p_new_date))::smallint,
    p_new_start, p_new_end, v_res.class_id
  );

  -- Apply: CANCEL the original occurrence (history preserved) and CREATE the
  -- new one. Migration 108's documented caveat: never move a materialized
  -- class in place — freeing the original (slot, time) key would let the
  -- materializer recreate the original-time class later. The cancelled row is
  -- protected from revival by the resolved-resolution guard in reconcile
  -- (occurrence_date match), and the new class by class_id match.
  if v_res.class_id is not null then
    select lc.class_id, lc.status, lc.cancelled_reason
    into v_class_id, v_status, v_cancelled_reason
    from public.live_classes lc
    where lc.class_id = v_res.class_id
    for update;

    if v_class_id is null then
      raise exception 'Referenced live class not found.';
    end if;
    if v_status not in ('scheduled'::public.live_class_status,
                        'cancelled'::public.live_class_status) then
      raise exception 'The affected class is not in a scheduled state; it cannot be rescheduled.';
    end if;
    if v_status = 'cancelled'::public.live_class_status
       and not (
         v_cancelled_reason like 'Superseded by a timetable update%'
         or v_cancelled_reason like 'This recurring timetable slot is no longer active%'
       ) then
      raise exception 'The affected class was cancelled manually and cannot be revived; create a new resolution instead.';
    end if;

    update public.live_classes
    set status           = 'cancelled'::public.live_class_status,
        cancelled_at     = now(),
        cancelled_reason = 'Superseded by a timetable update — rescheduled to a new time.',
        updated_at       = now()
    where class_id = v_res.class_id
      and status = 'scheduled'::public.live_class_status;

    v_class_id := public.resolution_create_class(
      v_res.timetable_slot_id, p_new_date, v_teacher, v_new_at, v_duration
    );
    if v_class_id is null then
      raise exception 'Could not create the rescheduled occurrence (unexpected conflict).';
    end if;
  else
    v_class_id := public.resolution_create_class(
      v_res.timetable_slot_id, p_new_date, v_teacher, v_new_at, v_duration
    );
    if v_class_id is null then
      raise exception 'Could not create the rescheduled occurrence (unexpected conflict).';
    end if;
  end if;

  update public.class_resolution_events
  set resolution_type  = 'reschedule'::public.class_resolution_type,
      new_teacher_id   = v_teacher,
      new_scheduled_at = v_new_at,
      new_duration_min = v_duration,
      status           = 'resolved'::public.resolution_status,
      class_id         = v_class_id,
      resolved_by      = auth.uid(),
      resolved_at      = now()
  where resolution_id = p_resolution_id;

  -- Notify teacher + students (guarded: only if the teacher has a profile)
  if exists (
    select 1 from public.teacher_details where teacher_id = v_teacher and profile_id is not null
  ) then
    perform public.resolution_notify(
      v_res.institute_id, 'class_resolved'::public.notification_event_type,
      'Class rescheduled',
      'Your class has been moved to ' || to_char(p_new_date, 'DD Mon YYYY') ||
        ' ' || to_char(p_new_start, 'HH24:MI') || '–' || to_char(p_new_end, 'HH24:MI') || '.',
      array[(select profile_id from public.teacher_details where teacher_id = v_teacher)],
      'class_resolution_events', p_resolution_id
    );
  end if;

  v_students := public.resolution_student_profiles(v_class_id);
  perform public.resolution_notify(
    v_res.institute_id, 'class_resolved'::public.notification_event_type,
    'Your class has been rescheduled',
    'Your class has been moved to ' || to_char(p_new_date, 'DD Mon YYYY') ||
      ' ' || to_char(p_new_start, 'HH24:MI') || '–' || to_char(p_new_end, 'HH24:MI') || '.',
    v_students, 'class_resolution_events', p_resolution_id
  );

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'class_resolution_events', p_resolution_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('type', 'reschedule', 'new_scheduled_at', v_new_at,
                       'teacher_id', v_teacher, 'status', 'resolved'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object(
    'success', true, 'resolution_id', p_resolution_id, 'type', 'reschedule',
    'class_id', v_class_id, 'new_scheduled_at', v_new_at
  );
end;
$$;

-- ── 8.3 assign_recorded_class ───────────────────────────────────────────────
create or replace function public.assign_recorded_class(
  p_resolution_id uuid,
  p_recording_id  uuid,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res       public.class_resolution_events%rowtype;
  v_batch_subject uuid;
  v_students  uuid[];
  v_class_id  uuid;
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only academic or super admins can resolve classes.';
  end if;

  select * into v_res
  from public.class_resolution_events
  where resolution_id = p_resolution_id
  for update;

  if v_res.resolution_id is null then
    raise exception 'Resolution not found.';
  end if;

  if v_res.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Resolutions can only be resolved for your own institute.';
  end if;

  if v_res.status <> 'pending'::public.resolution_status then
    raise exception 'Resolution is not pending (current status: %).', v_res.status;
  end if;

  if not exists (
    select 1 from public.recordings r
    where r.recording_id = p_recording_id
      and r.institute_id = v_res.institute_id
      and r.status = 'completed'::public.recording_status
  ) then
    raise exception 'Recording not found or not ready in this institute.';
  end if;

  select ts.batch_subject_id into v_batch_subject
  from public.timetable_slots ts
  where ts.timetable_slot_id = v_res.timetable_slot_id;

  -- Link the recording to the batch subject (no recording row duplication)
  insert into public.batch_subject_recordings (
    batch_subject_id, recording_id, institute_id
  )
  values (v_batch_subject, p_recording_id, v_res.institute_id)
  on conflict (batch_subject_id, recording_id) do nothing;

  -- Cancel the live delivery of the affected class (if materialized)
  if v_res.class_id is not null then
    select class_id into v_class_id
    from public.live_classes where class_id = v_res.class_id for update;

    if v_class_id is not null and exists (
      select 1 from public.live_classes
      where class_id = v_res.class_id
        and status = 'scheduled'::public.live_class_status
    ) then
      update public.live_classes
      set status = 'cancelled'::public.live_class_status,
          cancelled_at = now(),
          cancelled_reason = 'Replaced by a recorded class.',
          is_recorded = true,
          updated_at = now()
      where class_id = v_res.class_id
        and status = 'scheduled'::public.live_class_status;
    end if;
  end if;

  update public.class_resolution_events
  set resolution_type = 'recorded_class'::public.class_resolution_type,
      recording_id    = p_recording_id,
      status          = 'resolved'::public.resolution_status,
      notes           = coalesce(p_notes, notes),
      resolved_by     = auth.uid(),
      resolved_at     = now()
  where resolution_id = p_resolution_id;

  v_students := public.resolution_batch_student_profiles(v_batch_subject);
  perform public.resolution_notify(
    v_res.institute_id, 'class_resolved'::public.notification_event_type,
    'Recorded class available',
    'Your scheduled class has been replaced by a recorded class. It will be available at the scheduled time.',
    v_students, 'class_resolution_events', p_resolution_id
  );

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'class_resolution_events', p_resolution_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('type', 'recorded_class', 'recording_id', p_recording_id,
                       'status', 'resolved'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object(
    'success', true, 'resolution_id', p_resolution_id, 'type', 'recorded_class',
    'recording_id', p_recording_id
  );
end;
$$;

-- ── 8.4 assign_mock_test_to_class ───────────────────────────────────────────
create or replace function public.assign_mock_test_to_class(
  p_resolution_id uuid,
  p_test_id       uuid,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res       public.class_resolution_events%rowtype;
  v_batch_id  uuid;
  v_batch_subject uuid;
  v_tz        text;
  v_class_at  timestamptz;
  v_duration  integer;
  v_students  uuid[];
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only academic or super admins can resolve classes.';
  end if;

  select * into v_res
  from public.class_resolution_events
  where resolution_id = p_resolution_id
  for update;

  if v_res.resolution_id is null then
    raise exception 'Resolution not found.';
  end if;

  if v_res.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Resolutions can only be resolved for your own institute.';
  end if;

  if v_res.status <> 'pending'::public.resolution_status then
    raise exception 'Resolution is not pending (current status: %).', v_res.status;
  end if;

  if not exists (
    select 1 from public.mock_tests mt
    where mt.test_id = p_test_id
      and mt.institute_id = v_res.institute_id
      and mt.status = 'published'::public.mock_test_status
  ) then
    raise exception 'Mock test not found or not published in this institute.';
  end if;

  select ts.batch_subject_id, bs.batch_id
  into v_batch_subject, v_batch_id
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  where ts.timetable_slot_id = v_res.timetable_slot_id;

  select timezone into v_tz from public.institutes where institute_id = v_res.institute_id;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  select lc.scheduled_at, lc.duration_min into v_class_at, v_duration
  from public.live_classes lc
  where lc.class_id = v_res.class_id;

  -- Assign the test to the batch with a window around the affected class
  insert into public.batch_mock_tests (
    batch_id, test_id, assigned_at, available_from, available_until, assigned_by
  )
  values (
    v_batch_id, p_test_id, now(),
    coalesce(v_class_at, now()),
    coalesce(v_class_at, now()) + coalesce(v_duration, 60) * interval '1 minute'
      + interval '1 day',
    auth.uid()
  )
  on conflict (batch_id, test_id) do nothing;

  -- Cancel live delivery of the affected class
  if v_res.class_id is not null and exists (
    select 1 from public.live_classes
    where class_id = v_res.class_id
      and status = 'scheduled'::public.live_class_status
  ) then
    update public.live_classes
    set status = 'cancelled'::public.live_class_status,
        cancelled_at = now(),
        cancelled_reason = 'Replaced by a mock test.',
        updated_at = now()
    where class_id = v_res.class_id
      and status = 'scheduled'::public.live_class_status;
  end if;

  update public.class_resolution_events
  set resolution_type = 'mock_test'::public.class_resolution_type,
      mock_test_id    = p_test_id,
      status          = 'resolved'::public.resolution_status,
      notes           = coalesce(p_notes, notes),
      resolved_by     = auth.uid(),
      resolved_at     = now()
  where resolution_id = p_resolution_id;

  v_students := public.resolution_batch_student_profiles(v_batch_subject);
  perform public.resolution_notify(
    v_res.institute_id, 'class_resolved'::public.notification_event_type,
    'Mock test assigned',
    'Your scheduled class has been replaced by a mock test.',
    v_students, 'class_resolution_events', p_resolution_id
  );

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'class_resolution_events', p_resolution_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('type', 'mock_test', 'test_id', p_test_id, 'status', 'resolved'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object(
    'success', true, 'resolution_id', p_resolution_id, 'type', 'mock_test',
    'test_id', p_test_id
  );
end;
$$;

-- ── 8.5 cancel_class_occurrence ─────────────────────────────────────────────
create or replace function public.cancel_class_occurrence(
  p_resolution_id uuid,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res       public.class_resolution_events%rowtype;
  v_students  uuid[];
  v_batch_subject uuid;
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only academic or super admins can resolve classes.';
  end if;

  select * into v_res
  from public.class_resolution_events
  where resolution_id = p_resolution_id
  for update;

  if v_res.resolution_id is null then
    raise exception 'Resolution not found.';
  end if;

  if v_res.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Resolutions can only be resolved for your own institute.';
  end if;

  if v_res.status <> 'pending'::public.resolution_status then
    raise exception 'Resolution is not pending (current status: %).', v_res.status;
  end if;

  -- Cancel the scheduled occurrence (never live/completed/history)
  if v_res.class_id is not null and exists (
    select 1 from public.live_classes
    where class_id = v_res.class_id
      and status = 'scheduled'::public.live_class_status
  ) then
    update public.live_classes
    set status = 'cancelled'::public.live_class_status,
        cancelled_at = now(),
        cancelled_reason = coalesce(p_reason, 'Cancelled — teacher unavailable.'),
        updated_at = now()
    where class_id = v_res.class_id
      and status = 'scheduled'::public.live_class_status;
  end if;

  update public.class_resolution_events
  set resolution_type = 'cancelled'::public.class_resolution_type,
      reason          = p_reason,
      status          = 'resolved'::public.resolution_status,
      resolved_by     = auth.uid(),
      resolved_at     = now()
  where resolution_id = p_resolution_id;

  select ts.batch_subject_id into v_batch_subject
  from public.timetable_slots ts
  where ts.timetable_slot_id = v_res.timetable_slot_id;

  v_students := public.resolution_batch_student_profiles(v_batch_subject);
  perform public.resolution_notify(
    v_res.institute_id, 'class_resolved'::public.notification_event_type,
    'Class cancelled',
    'Your scheduled class has been cancelled.' ||
      case when p_reason is not null then ' Reason: ' || p_reason else '' end,
    v_students, 'class_resolution_events', p_resolution_id
  );

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'class_resolution_events', p_resolution_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('type', 'cancelled', 'status', 'resolved'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object('success', true, 'resolution_id', p_resolution_id,
                            'type', 'cancelled');
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — RPC: cancel_class_resolution (supersede a PENDING resolution)
-- ════════════════════════════════════════════════════════════════════════════
-- Explicit escape hatch: an admin cancels a pending resolution before the
-- class starts. The class is NOT touched (it falls back to teacher-leave
-- handling: the teacher_leaves operational row still blocks the occurrence in
-- materialization/reconcile). History is preserved; the partial unique index
-- releases the occurrence for a fresh resolution.

create or replace function public.cancel_class_resolution(
  p_resolution_id uuid,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.class_resolution_events%rowtype;
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only academic or super admins can cancel resolutions.';
  end if;

  select * into v_res
  from public.class_resolution_events
  where resolution_id = p_resolution_id
  for update;

  if v_res.resolution_id is null then
    raise exception 'Resolution not found.';
  end if;

  if v_res.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Resolutions can only be cancelled for your own institute.';
  end if;

  if v_res.status <> 'pending'::public.resolution_status then
    raise exception 'Only pending resolutions can be cancelled. Use the resolution RPCs to change a resolved one.';
  end if;

  update public.class_resolution_events
  set status = 'cancelled'::public.resolution_status,
      notes  = coalesce(p_reason, notes),
      updated_at = now()
  where resolution_id = p_resolution_id;

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'class_resolution_events', p_resolution_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'cancelled'),
    null, null, null, null, 'success', null, null
  );

  return jsonb_build_object('success', true, 'resolution_id', p_resolution_id,
                            'status', 'cancelled');
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — Grants / revokes
-- ════════════════════════════════════════════════════════════════════════════
-- Follow the existing convention: no PUBLIC execution; authenticated users and
-- service_role may call the RPCs (role/institute checks happen INSIDE each
-- function). Internal helpers are not exposed.

revoke execute on function public.submit_teacher_leave_request(date, date, text, public.leave_category_type, uuid[]) from public, anon;
grant execute on function public.submit_teacher_leave_request(date, date, text, public.leave_category_type, uuid[]) to authenticated, service_role;

revoke execute on function public.cancel_teacher_leave_request(uuid) from public, anon;
grant execute on function public.cancel_teacher_leave_request(uuid) to authenticated, service_role;

revoke execute on function public.review_teacher_leave_request(uuid, text, text) from public, anon;
grant execute on function public.review_teacher_leave_request(uuid, text, text) to authenticated, service_role;

revoke execute on function public.resolve_class_with_substitute(uuid, uuid, text) from public, anon;
grant execute on function public.resolve_class_with_substitute(uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.reschedule_class_occurrence(uuid, date, time, time, uuid) from public, anon;
grant execute on function public.reschedule_class_occurrence(uuid, date, time, time, uuid) to authenticated, service_role;

revoke execute on function public.assign_recorded_class(uuid, uuid, text) from public, anon;
grant execute on function public.assign_recorded_class(uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.assign_mock_test_to_class(uuid, uuid, text) from public, anon;
grant execute on function public.assign_mock_test_to_class(uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.cancel_class_occurrence(uuid, text) from public, anon;
grant execute on function public.cancel_class_occurrence(uuid, text) to authenticated, service_role;

revoke execute on function public.cancel_class_resolution(uuid, text) from public, anon;
grant execute on function public.cancel_class_resolution(uuid, text) to authenticated, service_role;

-- Internal helpers: no PUBLIC / anon / authenticated execution.
revoke execute on function public.resolution_admin_profiles(uuid) from public, anon, authenticated;
revoke execute on function public.resolution_student_profiles(uuid) from public, anon, authenticated;
revoke execute on function public.resolution_batch_student_profiles(uuid) from public, anon, authenticated;
revoke execute on function public.resolution_notify(uuid, public.notification_event_type, text, text, uuid[], text, uuid) from public, anon, authenticated;
revoke execute on function public.resolution_create_class(uuid, date, uuid, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.resolution_validate_teacher(uuid, uuid, date, smallint, time, time, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — reconcile_timetable_slot protection (the ONE existing-function
-- change allowed by the approved architecture)
-- ════════════════════════════════════════════════════════════════════════════
-- Additive guard: an occurrence that has a RESOLVED class_resolution_events
-- record is left untouched by reconcile — it must never be restored to the
-- slot rule (which would overwrite a substitute/reschedule) nor cancelled as
-- stale. Everything else behaves exactly as migration 110.

create or replace function public.reconcile_timetable_slot(p_slot_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot          record;
  v_timezone      text;
  v_duration_min  integer;
  v_title         varchar(500);
  v_restored      integer := 0;
  v_cancelled     integer := 0;
  v_created       integer := 0;
begin
  -- ── Caller check (admins or service role for scheduled execution) ──────
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can reconcile timetable slots.';
  end if;

  if p_slot_id is null then
    raise exception 'A timetable slot id is required.';
  end if;

  -- ── Load slot + joined batch/subject names (same shape as 109) ─────────
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
         coalesce(bs.name, s.name) as subject_display_name,
         b.name                    as batch_name
  into v_slot
  from public.timetable_slots ts
  join public.batch_subjects bs on bs.batch_subject_id = ts.batch_subject_id
  join public.subjects s          on s.subject_id       = bs.subject_id
  join public.batches b           on b.batch_id         = bs.batch_id
  where ts.timetable_slot_id = p_slot_id;

  if v_slot.timetable_slot_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  -- ── Institute scope (SECURITY DEFINER bypasses RLS) ────────────────────
  if auth.role() <> 'service_role'
     and v_slot.institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetables can only be reconciled for your own institute.';
  end if;

  -- ── Institute timezone (default Asia/Kolkata — matches 108/109) ────────
  select timezone into v_timezone
  from public.institutes
  where institute_id = v_slot.institute_id;
  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  v_duration_min := (extract(epoch from (v_slot.end_time - v_slot.start_time)) / 60)::integer;
  v_title := left(v_slot.subject_display_name || ' — ' || v_slot.batch_name, 500);

  -- ═══════════════════════════════════════════════════════════════════════
  -- ACTIVE SLOT — restore matching rows, cancel stale rows, fill gaps
  -- ═══════════════════════════════════════════════════════════════════════
  if v_slot.status = 'active'::public.timetable_slot_status then

    -- 1) RESTORE/REFRESH future rows that still match the current rule.
    --    (unchanged from 110) + guard: skip occurrences with a RESOLVED
    --    resolution (substitute/reschedule must never be overwritten).
    update public.live_classes lc
    set status           = 'scheduled'::public.live_class_status,
        cancelled_at     = null,
        cancelled_reason = null,
        teacher_id       = v_slot.teacher_id,
        title            = v_title,
        duration_min     = v_duration_min,
        updated_at       = now()
    where lc.timetable_slot_id = p_slot_id
      and lc.status in (
            'scheduled'::public.live_class_status,
            'cancelled'::public.live_class_status
          )
      and lc.scheduled_at > now()
      and (lc.status = 'scheduled'::public.live_class_status
           or lc.cancelled_reason like 'Superseded by a timetable update%'
           or lc.cancelled_reason like 'This recurring timetable slot is no longer active%')
      and extract(isodow from (lc.scheduled_at at time zone v_timezone)::date) = v_slot.day_of_week
      and lc.scheduled_at = (
            ((lc.scheduled_at at time zone v_timezone)::date + v_slot.start_time)
            at time zone v_timezone
          )
      and (lc.scheduled_at at time zone v_timezone)::date
            between v_slot.valid_from and v_slot.valid_until
      and not exists (
        select 1 from public.institute_holidays h
        where h.institute_id = v_slot.institute_id
          and h.holiday_date = (lc.scheduled_at at time zone v_timezone)::date
      )
      and not exists (
        select 1 from public.teacher_leaves l
        where l.institute_id = v_slot.institute_id
          and l.teacher_id = v_slot.teacher_id
          and l.status = 'active'::public.teacher_leave_status
          and l.start_date <= (lc.scheduled_at at time zone v_timezone)::date
          and l.end_date   >= (lc.scheduled_at at time zone v_timezone)::date
      )
      -- ── Phase 1 guard: resolved resolutions are never reverted. ─────────
      -- Matches either by the ORIGINAL occurrence anchor (substitute) or by
      -- class_id (rescheduled classes live at a NEW date).
      and not exists (
        select 1 from public.class_resolution_events cre
        where cre.timetable_slot_id = p_slot_id
          and cre.status = 'resolved'::public.resolution_status
          and (
            cre.occurrence_date = (lc.scheduled_at at time zone v_timezone)::date
            or cre.class_id = lc.class_id
          )
      );

    get diagnostics v_restored = row_count;

    -- 2) CANCEL future scheduled rows that no longer match the current rule
    --    (unchanged from 110) + same resolved-resolution guard.
    update public.live_classes lc
    set status           = 'cancelled'::public.live_class_status,
        cancelled_at     = now(),
        cancelled_reason = 'Superseded by a timetable update — this recurring slot''s schedule changed.',
        updated_at       = now()
    where lc.timetable_slot_id = p_slot_id
      and lc.status = 'scheduled'::public.live_class_status
      and lc.scheduled_at > now()
      and not (
        extract(isodow from (lc.scheduled_at at time zone v_timezone)::date) = v_slot.day_of_week
        and lc.scheduled_at = (
              ((lc.scheduled_at at time zone v_timezone)::date + v_slot.start_time)
              at time zone v_timezone
            )
        and (lc.scheduled_at at time zone v_timezone)::date
              between v_slot.valid_from and v_slot.valid_until
        and not exists (
          select 1 from public.institute_holidays h
          where h.institute_id = v_slot.institute_id
            and h.holiday_date = (lc.scheduled_at at time zone v_timezone)::date
        )
        and not exists (
          select 1 from public.teacher_leaves l
          where l.institute_id = v_slot.institute_id
            and l.teacher_id = v_slot.teacher_id
            and l.status = 'active'::public.teacher_leave_status
            and l.start_date <= (lc.scheduled_at at time zone v_timezone)::date
            and l.end_date   >= (lc.scheduled_at at time zone v_timezone)::date
        )
        -- ── Phase 1 guard: resolved resolutions are never cancelled ──────
        and not exists (
          select 1 from public.class_resolution_events cre
          where cre.timetable_slot_id = p_slot_id
            and cre.status = 'resolved'::public.resolution_status
            and (
              cre.occurrence_date = (lc.scheduled_at at time zone v_timezone)::date
              or cre.class_id = lc.class_id
            )
        )
      );

    get diagnostics v_cancelled = row_count;

    -- 3) Re-point the junction for every kept future class to the CURRENT
    --    batch_subject (unchanged from 110).
    update public.batch_subject_live_classes j
    set batch_subject_id = v_slot.batch_subject_id,
        institute_id     = v_slot.institute_id
    from public.live_classes lc
    where lc.timetable_slot_id = p_slot_id
      and lc.class_id = j.class_id
      and lc.status = 'scheduled'::public.live_class_status
      and lc.scheduled_at > now()
      and j.batch_subject_id is distinct from v_slot.batch_subject_id
      and not exists (
        select 1 from public.batch_subject_live_classes j2
        where j2.class_id          = j.class_id
          and j2.batch_subject_id = v_slot.batch_subject_id
      );

    -- 4) FILL genuinely missing occurrences (unchanged from 110).
    v_created := public.materialize_timetable_classes(
      p_slot_id,
      current_date,
      current_date + 60
    );

  -- ═══════════════════════════════════════════════════════════════════════
  -- PAUSED / CANCELLED SLOT — cancel future scheduled occurrences only
  -- ═══════════════════════════════════════════════════════════════════════
  else
    update public.live_classes lc
    set status           = 'cancelled'::public.live_class_status,
        cancelled_at     = now(),
        cancelled_reason = 'This recurring timetable slot is no longer active.',
        updated_at       = now()
    where lc.timetable_slot_id = p_slot_id
      and lc.status = 'scheduled'::public.live_class_status
      and lc.scheduled_at > now()
      -- ── Phase 1 guard: resolved resolutions survive slot pausing ───────
      and not exists (
        select 1 from public.class_resolution_events cre
        where cre.timetable_slot_id = p_slot_id
          and cre.status = 'resolved'::public.resolution_status
          and (
            cre.occurrence_date = (lc.scheduled_at at time zone v_timezone)::date
            or cre.class_id = lc.class_id
          )
      );

    get diagnostics v_cancelled = row_count;
  end if;

  return v_restored + v_cancelled + v_created;
end;
$$;

comment on function public.reconcile_timetable_slot(uuid) is
  'Restores/cancels future scheduled occurrences of a timetable slot to match '
  'its rule (unchanged from migration 110) PLUS a Phase-1 guard: occurrences '
  'with a RESOLVED class_resolution_events record are never reverted or '
  'cancelled, preserving substitute/reschedule outcomes.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 115 Teacher Leave + Class Resolution
-- ════════════════════════════════════════════════════════════════════════════
