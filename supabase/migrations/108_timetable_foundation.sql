-- ============================================================================
-- Migration: 108 — Timetable Database Foundation (Phase 1)
--
-- PostgreSQL 16 | Supabase Compatible | Idempotent where required
--
-- ## Purpose
--
-- Establishes the database foundation for the institute-owned timetable:
--
--   ADMIN
--     ↓
--   TIMETABLE SLOT          (recurring rule — public.timetable_slots)
--     ↓
--   ACTUAL CLASS OCCURRENCE (materialized into EXISTING public.live_classes)
--     ↓
--   TEACHER CALENDAR → START CLASS → EXISTING LiveKit + Recording
--
-- New tables:
--   • public.timetable_slots     — recurring weekly teaching rule
--   • public.teacher_leaves      — non-recurring teacher unavailability
--   • public.institute_holidays  — institute-wide no-class dates
--
-- Existing table changes (additive only):
--   • public.institutes          — + timezone column (default Asia/Kolkata)
--   • public.live_classes        — + nullable timetable_slot_id (provenance)
--
-- NO new class/occurrence table. The existing live_classes table IS the
-- occurrence entity. Manually-created live classes (timetable_slot_id NULL)
-- remain fully supported and coexist with generated ones.
--
-- ## Authoritative conflict protection
--
-- Slot creation/update is enforced by SECURITY DEFINER RPCs
-- (create_timetable_slot / update_timetable_slot) running inside a single
-- transaction with pg_advisory_xact_lock serialization. The timetable_slots
-- table has NO direct INSERT/UPDATE/DELETE policies — every write must go
-- through the RPCs, so conflicts can never be bypassed via PostgREST.
--
-- ## Timezone
--
-- Slot times are wall-clock `time` values interpreted in the institute's
-- timezone (institutes.timezone, default 'Asia/Kolkata'). Materialization
-- converts `(date + start_time) AT TIME ZONE <institute tz>` into the
-- UTC timestamptz stored in live_classes.scheduled_at.
--
-- Depends on: migration 002 (institutes, teacher_details, profiles, enums,
--             set_updated_at), 003 (batches, subjects), 021 (RLS helpers:
--             get_my_institute_id, get_my_teacher_id, is_admin),
--             066 (batch_subjects), 067 (batch_subject_teachers),
--             070 (batch_subject_live_classes), 074 (is_super_admin,
--             is_academic_admin).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Enums
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_type where typname = 'timetable_slot_status') then
    create type timetable_slot_status as enum ('active', 'paused', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'teacher_leave_status') then
    create type teacher_leave_status as enum ('active', 'cancelled');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — institutes.timezone (additive)
-- ════════════════════════════════════════════════════════════════════════════
-- The existing schema has no institute timezone field. This additive column
-- defaults to Asia/Kolkata (the institute operates in India) and lets each
-- institute define its own IANA timezone later without another migration.

alter table public.institutes
  add column if not exists timezone varchar(100) not null default 'Asia/Kolkata';

comment on column public.institutes.timezone is
  'IANA timezone name used to interpret timetable slot wall-clock times. '
  'Defaults to Asia/Kolkata. Materialization converts local slot time to UTC '
  'timestamptz via: (date + start_time) AT TIME ZONE institutes.timezone.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Table: timetable_slots (the recurring rule)
-- ════════════════════════════════════════════════════════════════════════════
-- One row = one recurring weekly teaching rule, e.g. "Physics / JEE Batch A /
-- Teacher Rahul / Monday 10:00–11:00 / valid 1 Apr 2026 → 31 Mar 2027".
-- A row does NOT represent one class — occurrences are materialized into
-- live_classes by public.materialize_timetable_classes().
--
-- day_of_week uses PostgreSQL isodow: 1 = Monday … 7 = Sunday.
--
-- Teacher + Batch + Subject identity:
--   • teacher_id       → teacher_details (the assigned teacher)
--   • batch_subject_id → batch_subjects (encodes batch_id + subject_id
--                         together, so invalid batch/subject combos are
--                         impossible by construction)

create table if not exists public.timetable_slots (
  -- Primary Key
  timetable_slot_id   uuid                  not null  default gen_random_uuid(),

  -- Ownership & Scoping
  institute_id        uuid                  not null,
  teacher_id          uuid                  not null,
  batch_subject_id    uuid                  not null,

  -- Recurrence (weekly)
  day_of_week         smallint              not null,  -- isodow 1..7
  start_time          time without time zone not null,
  end_time            time without time zone not null,
  valid_from          date                  not null,
  valid_until         date                  not null,

  -- Lifecycle (soft — never hard-deleted)
  status              timetable_slot_status not null  default 'active',

  -- Audit
  created_by          uuid                  null      default null,
  created_at          timestamptz           not null  default now(),
  updated_at          timestamptz           not null  default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_timetable_slots primary key (timetable_slot_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  constraint fk_timetable_slots_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_timetable_slots_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_timetable_slots_batch_subject
    foreign key (batch_subject_id) references public.batch_subjects (batch_subject_id)
    on delete restrict
    on update restrict,

  constraint fk_timetable_slots_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── CHECK Constraints ─────────────────────────────────────────────────
  constraint ck_timetable_slots_day_of_week check (day_of_week between 1 and 7),
  constraint ck_timetable_slots_time_order check (end_time > start_time),
  constraint ck_timetable_slots_validity check (valid_until >= valid_from),
  -- Max 8 hours — mirrors live_classes.ck_live_classes_duration_min (480
  -- minutes). A longer slot would pass creation here but blow up at
  -- materialization when the live_classes INSERT hits its 480-min cap.
  constraint ck_timetable_slots_duration check
    ((end_time - start_time) <= interval '8 hours')
);

comment on table public.timetable_slots is
  'Recurring weekly teaching rule owned by the institute (super/academic admin). '
  'Occurrences are materialized into live_classes. Writes are only allowed '
  'through SECURITY DEFINER RPCs (create/update/set_status) so conflicts are '
  'enforced database-side.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Table: teacher_leaves (non-recurring exception)
-- ════════════════════════════════════════════════════════════════════════════
-- A teacher is unavailable for a date/range. NOT a recurring availability
-- system — the timetable defines normal availability; leave is an exception.
-- Phase 1 is admin-controlled (teachers only read their own).

create table if not exists public.teacher_leaves (
  teacher_leave_id   uuid                not null  default gen_random_uuid(),
  institute_id       uuid                not null,
  teacher_id         uuid                not null,
  start_date         date                not null,
  end_date           date                not null,
  reason             text                null      default null,
  status             teacher_leave_status not null default 'active',
  created_by         uuid                null      default null,
  created_at         timestamptz         not null  default now(),
  updated_at         timestamptz         not null  default now(),

  constraint pk_teacher_leaves primary key (teacher_leave_id),

  constraint fk_teacher_leaves_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_leaves_teacher
    foreign key (teacher_id) references public.teacher_details (teacher_id)
    on delete restrict
    on update restrict,

  constraint fk_teacher_leaves_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint ck_teacher_leaves_date_order check (end_date >= start_date)
);

comment on table public.teacher_leaves is
  'Admin-managed teacher unavailability for a date/range. Materialization '
  'skips occurrences that fall inside an active leave.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Table: institute_holidays
-- ════════════════════════════════════════════════════════════════════════════
-- An institute-wide holiday prevents class materialization for that date.

create table if not exists public.institute_holidays (
  holiday_id     uuid          not null  default gen_random_uuid(),
  institute_id   uuid          not null,
  holiday_date   date          not null,
  name           varchar(200)  not null,
  description    text          null      default null,
  created_by     uuid          null      default null,
  created_at     timestamptz   not null  default now(),
  updated_at     timestamptz   not null  default now(),

  constraint pk_institute_holidays primary key (holiday_id),

  constraint fk_institute_holidays_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  constraint fk_institute_holidays_created_by
    foreign key (created_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  constraint uq_institute_holidays_date unique (institute_id, holiday_date),
  constraint ck_institute_holidays_name_length check (char_length(name) >= 1)
);

comment on table public.institute_holidays is
  'Institute-wide holiday dates. Materialization never creates classes on '
  'these dates for the institute.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — live_classes compatibility (additive provenance)
-- ════════════════════════════════════════════════════════════════════════════
-- timetable_slot_id links a generated occurrence back to its source rule.
-- NULL for manually-created classes — both systems coexist.

alter table public.live_classes
  add column if not exists timetable_slot_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_live_classes_timetable_slot'
  ) then
    alter table public.live_classes
      add constraint fk_live_classes_timetable_slot
        foreign key (timetable_slot_id) references public.timetable_slots (timetable_slot_id)
        on delete set null
        on update restrict;
  end if;
end $$;

comment on column public.live_classes.timetable_slot_id is
  'Provenance: the timetable slot that generated this class occurrence. '
  'NULL for manually-created classes. Soft-cancelling a slot never deletes '
  'generated classes (FK ON DELETE SET NULL — but slots are soft-cancelled '
  'anyway, never hard-deleted).';

-- Idempotency key for materialization: (slot, scheduled_at) is deterministic
-- for a given slot + occurrence date, so re-running the generator is a no-op.
-- Partial index: only generated classes participate.
create unique index if not exists uq_live_classes_timetable_occurrence
  on public.live_classes (timetable_slot_id, scheduled_at)
  where timetable_slot_id is not null;

comment on index public.uq_live_classes_timetable_occurrence is
  'Guarantees materialization idempotency: one live_class per (slot, '
  'occurrence datetime). ON CONFLICT DO NOTHING makes re-runs no-ops. '
  'Caveat for exception handling: an occurrence must be cancelled + '
  're-created (not moved in place) — editing live_classes.scheduled_at '
  'frees the original (slot, time) key so re-materialization would '
  'recreate the original-time class as a duplicate.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Indexes (justified by actual queries)
-- ════════════════════════════════════════════════════════════════════════════

-- timetable_slots
--   • admin list + status filter
create index if not exists idx_timetable_slots_institute_status
  on public.timetable_slots (institute_id, status);
--   • teacher calendar / conflict check (teacher × day)
create index if not exists idx_timetable_slots_teacher_day
  on public.timetable_slots (teacher_id, day_of_week, status);
--   • batch conflict check (batch_subject × day)
create index if not exists idx_timetable_slots_batch_subject_day
  on public.timetable_slots (batch_subject_id, day_of_week, status);

-- teacher_leaves
--   • materialization skip check (teacher × date range)
create index if not exists idx_teacher_leaves_teacher_range
  on public.teacher_leaves (teacher_id, start_date, end_date);
--   • admin list within institute
create index if not exists idx_teacher_leaves_institute_status
  on public.teacher_leaves (institute_id, status);

-- institute_holidays
--   • materialization skip check + admin list (uq_institute_holidays_date
--     already covers (institute_id, holiday_date); add date-only for
--     cross-institute date lookups used by future reports)
create index if not exists idx_institute_holidays_date
  on public.institute_holidays (holiday_date);

-- live_classes: the partial unique index in Section 6 covers slot-based
-- lookups. No additional timetable indexes — teacher/date calendar queries
-- will be served by existing live_classes indexes.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — updated_at triggers (reuse existing public.set_updated_at)
-- ════════════════════════════════════════════════════════════════════════════

create trigger trg_timetable_slots_set_updated_at
  before update on public.timetable_slots
  for each row
  execute function public.set_updated_at();

create trigger trg_teacher_leaves_set_updated_at
  before update on public.teacher_leaves
  for each row
  execute function public.set_updated_at();

create trigger trg_institute_holidays_set_updated_at
  before update on public.institute_holidays
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — RLS
-- ════════════════════════════════════════════════════════════════════════════

-- ── 9a. timetable_slots ──────────────────────────────────────────────────────
-- SELECT only. NO INSERT/UPDATE/DELETE policies: all writes go through the
-- SECURITY DEFINER RPCs (create_timetable_slot / update_timetable_slot /
-- set_timetable_slot_status) which enforce role, institute scope, teacher
-- assignment, and conflict detection in one transaction. Finance admins,
-- students, and unassigned teachers are denied (no policy).
alter table public.timetable_slots enable row level security;

drop policy if exists "Admins can read timetable slots" on public.timetable_slots;
create policy "Admins can read timetable slots"
  on public.timetable_slots
  for select
  to authenticated
  using (
    institute_id = public.get_my_institute_id()
    and (public.is_super_admin() or public.is_academic_admin())
  );

drop policy if exists "Teachers can read their timetable slots" on public.timetable_slots;
create policy "Teachers can read their timetable slots"
  on public.timetable_slots
  for select
  to authenticated
  using (teacher_id = public.get_my_teacher_id());

-- ── 9b. teacher_leaves ───────────────────────────────────────────────────────
alter table public.teacher_leaves enable row level security;

drop policy if exists "Admins have full access to teacher leaves" on public.teacher_leaves;
create policy "Admins have full access to teacher leaves"
  on public.teacher_leaves
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

drop policy if exists "Teachers can read their own leaves" on public.teacher_leaves;
create policy "Teachers can read their own leaves"
  on public.teacher_leaves
  for select
  to authenticated
  using (teacher_id = public.get_my_teacher_id());

-- ── 9c. institute_holidays ───────────────────────────────────────────────────
alter table public.institute_holidays enable row level security;

drop policy if exists "Admins have full access to institute holidays" on public.institute_holidays;
create policy "Admins have full access to institute holidays"
  on public.institute_holidays
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

-- Teachers (and students — harmless calendar data) may read their own
-- institute's holidays. This is read-only; no management access.
drop policy if exists "Authenticated users can read institute holidays" on public.institute_holidays;
create policy "Authenticated users can read institute holidays"
  on public.institute_holidays
  for select
  to authenticated
  using (institute_id = public.get_my_institute_id());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — Conflict detection helper (used by the RPCs and future UI)
-- ════════════════════════════════════════════════════════════════════════════
-- Returns every ACTIVE slot that conflicts with the candidate:
--   • teacher conflict — same teacher, same day_of_week, overlapping time
--     AND overlapping validity window
--   • batch conflict   — same batch, same day_of_week, overlapping time AND
--     overlapping validity window
-- Time overlap uses half-open [start, end) semantics: a class ending at
-- 11:00 and another starting at 11:00 do NOT conflict.
-- Validity overlap uses inclusive daterange bounds ('[]').

create or replace function public.find_timetable_slot_conflicts(
  p_institute_id    uuid,
  p_teacher_id      uuid,
  p_batch_subject_id uuid,
  p_day_of_week     smallint,
  p_start_time      time,
  p_end_time        time,
  p_valid_from      date,
  p_valid_until     date,
  p_exclude_slot_id uuid default null
)
returns table (conflict_type text, slot_id uuid, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Admin-only: this SECURITY DEFINER function accepts arbitrary IDs and
  -- bypasses RLS, so without a caller check any authenticated user could
  -- enumerate active slot UUIDs across institutes.
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only admins can check timetable slot conflicts.';
  end if;

  return query
  select 'teacher'::text,
         t.timetable_slot_id,
         'Teacher already has an active timetable slot on this day/time within an overlapping validity period.'::text
  from public.timetable_slots t
  where t.institute_id = p_institute_id
    and t.status = 'active'::public.timetable_slot_status
    and t.teacher_id = p_teacher_id
    and t.day_of_week = p_day_of_week
    and t.start_time < p_end_time
    and p_start_time < t.end_time
    and daterange(t.valid_from, t.valid_until, '[]')
        && daterange(p_valid_from, p_valid_until, '[]')
    and (p_exclude_slot_id is null or t.timetable_slot_id <> p_exclude_slot_id)

  union all

  select 'batch'::text,
         t.timetable_slot_id,
         'The batch already has an active timetable slot on this day/time within an overlapping validity period.'::text
  from public.timetable_slots t
  join public.batch_subjects bs on bs.batch_subject_id = t.batch_subject_id
  where t.institute_id = p_institute_id
    and t.status = 'active'::public.timetable_slot_status
    and bs.batch_id = (
      select b.batch_id
      from public.batch_subjects b
      where b.batch_subject_id = p_batch_subject_id
    )
    and t.day_of_week = p_day_of_week
    and t.start_time < p_end_time
    and p_start_time < t.end_time
    and daterange(t.valid_from, t.valid_until, '[]')
        && daterange(p_valid_from, p_valid_until, '[]')
    and (p_exclude_slot_id is null or t.timetable_slot_id <> p_exclude_slot_id);
end;
$$;

comment on function public.find_timetable_slot_conflicts(uuid, uuid, uuid, smallint, time, time, date, date, uuid) is
  'Returns active timetable slots conflicting with the candidate '
  '(teacher or batch). Overlap requires same day_of_week, overlapping '
  'half-open time ranges, AND overlapping inclusive validity windows.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — RPC: create_timetable_slot
-- ════════════════════════════════════════════════════════════════════════════
-- The ONLY way to create a timetable slot. SECURITY DEFINER + empty
-- search_path, with explicit role/institute/assignment checks and
-- pg_advisory_xact_lock serialization so concurrent creates cannot race.

create or replace function public.create_timetable_slot(
  p_institute_id    uuid,
  p_teacher_id      uuid,
  p_batch_subject_id uuid,
  p_day_of_week     smallint,
  p_start_time      time,
  p_end_time        time,
  p_valid_from      date,
  p_valid_until     date,
  p_created_by      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_id uuid;
  v_batch_id uuid;
begin
  -- ── Role + institute scope ───────────────────────────────────────────
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only super admins or academic admins can create timetable slots.';
  end if;

  if p_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetable slots can only be created for your own institute.';
  end if;

  -- ── Basic validation ─────────────────────────────────────────────────
  if p_day_of_week not between 1 and 7 then
    raise exception 'day_of_week must be between 1 (Monday) and 7 (Sunday).';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'end_time must be after start_time.';
  end if;
  if p_valid_until < p_valid_from then
    raise exception 'valid_until must be on or after valid_from.';
  end if;

  -- ── The batch_subject must belong to this institute ──────────────────
  if not exists (
    select 1 from public.batch_subjects bs
    where bs.batch_subject_id = p_batch_subject_id
      and bs.institute_id = p_institute_id
  ) then
    raise exception 'The selected batch-subject does not belong to this institute.';
  end if;

  select bs.batch_id into v_batch_id
  from public.batch_subjects bs
  where bs.batch_subject_id = p_batch_subject_id;

  -- ── The teacher must be assigned to the batch-subject ────────────────
  if not exists (
    select 1 from public.batch_subject_teachers bst
    where bst.batch_subject_id = p_batch_subject_id
      and bst.teacher_id = p_teacher_id
      and bst.institute_id = p_institute_id
  ) then
    raise exception 'The selected teacher is not assigned to this batch-subject.';
  end if;

  -- ── Serialize concurrent creates for the same teacher-day / batch-day ─
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_institute_id::text || ':' || p_teacher_id::text || ':' || p_day_of_week::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_institute_id::text || ':' || v_batch_id::text || ':' || p_day_of_week::text,
      0
    )
  );

  -- ── Conflict detection (authoritative, database-side) ────────────────
  if exists (
    select 1 from public.find_timetable_slot_conflicts(
      p_institute_id, p_teacher_id, p_batch_subject_id,
      p_day_of_week, p_start_time, p_end_time, p_valid_from, p_valid_until,
      null
    )
  ) then
    raise exception 'Conflicting timetable slot: same teacher or batch already has an active slot on this day/time within an overlapping validity window.';
  end if;

  -- ── Insert ───────────────────────────────────────────────────────────
  insert into public.timetable_slots (
    institute_id, teacher_id, batch_subject_id,
    day_of_week, start_time, end_time, valid_from, valid_until,
    status, created_by
  )
  values (
    p_institute_id, p_teacher_id, p_batch_subject_id,
    p_day_of_week, p_start_time, p_end_time, p_valid_from, p_valid_until,
    'active'::public.timetable_slot_status, p_created_by
  )
  returning timetable_slot_id into v_slot_id;

  return v_slot_id;
end;
$$;

comment on function public.create_timetable_slot(uuid, uuid, uuid, smallint, time, time, date, date, uuid) is
  'Creates an active timetable slot after validating admin role, institute '
  'scope, teacher→batch-subject assignment, and teacher/batch conflicts. '
  'Advisory-locked per (institute, teacher, day) and (institute, batch, day).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 12 — RPC: update_timetable_slot
-- ════════════════════════════════════════════════════════════════════════════
-- Full-field update with the same conflict checks, excluding the slot itself.

create or replace function public.update_timetable_slot(
  p_slot_id         uuid,
  p_teacher_id      uuid,
  p_batch_subject_id uuid,
  p_day_of_week     smallint,
  p_start_time      time,
  p_end_time        time,
  p_valid_from      date,
  p_valid_until     date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute_id uuid;
  v_batch_id uuid;
begin
  -- ── Role check ───────────────────────────────────────────────────────
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only super admins or academic admins can update timetable slots.';
  end if;

  -- ── Slot must exist and belong to the caller's institute ─────────────
  select institute_id into v_institute_id
  from public.timetable_slots
  where timetable_slot_id = p_slot_id;

  if v_institute_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  if v_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetable slots can only be updated within your own institute.';
  end if;

  -- ── Basic validation ─────────────────────────────────────────────────
  if p_day_of_week not between 1 and 7 then
    raise exception 'day_of_week must be between 1 (Monday) and 7 (Sunday).';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'end_time must be after start_time.';
  end if;
  if p_valid_until < p_valid_from then
    raise exception 'valid_until must be on or after valid_from.';
  end if;

  -- ── Batch-subject + teacher assignment validation ────────────────────
  if not exists (
    select 1 from public.batch_subjects bs
    where bs.batch_subject_id = p_batch_subject_id
      and bs.institute_id = v_institute_id
  ) then
    raise exception 'The selected batch-subject does not belong to this institute.';
  end if;

  select bs.batch_id into v_batch_id
  from public.batch_subjects bs
  where bs.batch_subject_id = p_batch_subject_id;

  if not exists (
    select 1 from public.batch_subject_teachers bst
    where bst.batch_subject_id = p_batch_subject_id
      and bst.teacher_id = p_teacher_id
      and bst.institute_id = v_institute_id
  ) then
    raise exception 'The selected teacher is not assigned to this batch-subject.';
  end if;

  -- ── Serialize concurrent edits ───────────────────────────────────────
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_institute_id::text || ':' || p_teacher_id::text || ':' || p_day_of_week::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_institute_id::text || ':' || v_batch_id::text || ':' || p_day_of_week::text,
      0
    )
  );

  -- ── Conflict detection (exclude this slot) ───────────────────────────
  if exists (
    select 1 from public.find_timetable_slot_conflicts(
      v_institute_id, p_teacher_id, p_batch_subject_id,
      p_day_of_week, p_start_time, p_end_time, p_valid_from, p_valid_until,
      p_slot_id
    )
  ) then
    raise exception 'Conflicting timetable slot: same teacher or batch already has an active slot on this day/time within an overlapping validity window.';
  end if;

  -- ── Update ───────────────────────────────────────────────────────────
  update public.timetable_slots
  set teacher_id = p_teacher_id,
      batch_subject_id = p_batch_subject_id,
      day_of_week = p_day_of_week,
      start_time = p_start_time,
      end_time = p_end_time,
      valid_from = p_valid_from,
      valid_until = p_valid_until
  where timetable_slot_id = p_slot_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 13 — RPC: set_timetable_slot_status (soft lifecycle)
-- ════════════════════════════════════════════════════════════════════════════
-- active → paused | cancelled. Paused/cancelled slots never generate future
-- classes (materialization only processes active slots). Existing generated
-- live_classes are independent and remain as-is.

create or replace function public.set_timetable_slot_status(
  p_slot_id uuid,
  p_status  public.timetable_slot_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institute_id uuid;
begin
  if not (public.is_super_admin() or public.is_academic_admin()) then
    raise exception 'Only super admins or academic admins can change timetable slot status.';
  end if;

  select institute_id into v_institute_id
  from public.timetable_slots
  where timetable_slot_id = p_slot_id;

  if v_institute_id is null then
    raise exception 'Timetable slot not found.';
  end if;

  if v_institute_id is distinct from public.get_my_institute_id() then
    raise exception 'Timetable slots can only be modified within your own institute.';
  end if;

  update public.timetable_slots
  set status = p_status
  where timetable_slot_id = p_slot_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 14 — RPC: materialize_timetable_classes
-- ════════════════════════════════════════════════════════════════════════════
-- Generates actual live_classes occurrences for ONE active slot within a
-- date range. Idempotent: ON CONFLICT against uq_live_classes_timetable_occurrence
-- makes re-runs no-ops. Skips institute holidays and active teacher leaves.
-- Callable by super/academic admins or the service role (future cron).
--
-- scheduled_at = (occurrence_date + start_time) AT TIME ZONE institutes.timezone
-- duration_min = end_time - start_time (minutes)
-- status       = 'scheduled' (compatible with the existing teacher flow:
--               startScheduledClass → 'live' → recording)

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
         bs.subject_id,
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
  -- The caller role was already verified above; now bind the operation to
  -- the caller's own institute so an admin cannot materialize another
  -- institute's slot by passing its UUID. The service role is exempt
  -- because this function is intended to support future scheduled/cron
  -- execution across institutes.
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

    insert into public.live_classes (
      institute_id,
      teacher_id,
      subject_id,
      title,
      scheduled_at,
      duration_min,
      status,
      is_recorded,
      timetable_slot_id
    )
    values (
      v_slot.institute_id,
      v_slot.teacher_id,
      v_slot.subject_id,
      v_title,
      v_scheduled_at,
      v_duration_min,
      'scheduled'::public.live_class_status,
      true,
      p_slot_id
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
  'slot within a date range, skipping holidays and teacher leaves. Returns '
  'the number of classes created (0 on re-runs).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 15 — RPC: materialize_institute_timetable (convenience / future cron)
-- ════════════════════════════════════════════════════════════════════════════
-- Materializes ALL active slots of an institute within a date range.
-- Phase 1 strategy: admins call with a controlled window (e.g. next 30–60
-- days) — the long-term rule lives in timetable_slots, so the DB never
-- grows unboundedly.

create or replace function public.materialize_institute_timetable(
  p_institute_id uuid,
  p_from_date    date,
  p_to_date      date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_id uuid;
  v_total   integer := 0;
begin
  if not (
    public.is_super_admin() or public.is_academic_admin()
    or auth.role() = 'service_role'
  ) then
    raise exception 'Only admins or the service role can materialize the institute timetable.';
  end if;

  if p_institute_id is distinct from public.get_my_institute_id()
     and auth.role() <> 'service_role' then
    raise exception 'Timetables can only be materialized for your own institute.';
  end if;

  for v_slot_id in
    select ts.timetable_slot_id
    from public.timetable_slots ts
    where ts.institute_id = p_institute_id
      and ts.status = 'active'::public.timetable_slot_status
  loop
    v_total := v_total + public.materialize_timetable_classes(
      v_slot_id, p_from_date, p_to_date
    );
  end loop;

  return v_total;
end;
$$;

comment on function public.materialize_institute_timetable(uuid, date, date) is
  'Convenience wrapper that materializes all active slots of an institute '
  'within a date range. Returns the total number of classes created. '
  'Suitable for a future scheduled job (service role).';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 108 Timetable Database Foundation
-- ════════════════════════════════════════════════════════════════════════════
