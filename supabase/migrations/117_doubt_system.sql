-- ============================================================================
-- Migration: 117 — Doubt System (Phase 7A)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Scope: ENHANCES the existing Domain 14 Doubt System (migration 015/021).
--        Does NOT create a parallel doubt/message system.
--
-- Key decisions (verified against the live repository):
--   • NO institute_id column on student_doubts — institute is ALREADY fully
--     derivable via student_doubts.student_id → student_details.institute_id
--     (NOT NULL). Cross-institute isolation is enforced in RLS + RPCs via
--     joins, never by trusting a client-supplied institute_id.
--   • doubt_replies remains the conversation/message history (no replacement).
--   • All writes go through SECURITY DEFINER RPCs (migration-115 pattern).
--
-- Changes:
--   1. notification_event_type additions (doubt_*)
--   2. ALTER student_doubts: additive nullable columns (batch_subject_id,
--      topic_id, assigned_to, assigned_at, first_response_at, resolved_at,
--      reopened_count) — no existing column changed
--   3. doubt_attachments table (attachments for doubts + replies)
--   4. New indexes (status/assigned/batch_subject/attachments + pg_trgm search)
--   5. Helper functions (doubt_visible_to_me, doubt_eligible_teacher_ids,
--      doubt_notify) — internal, not client-executable
--   6. SECURITY DEFINER RPCs: submit_student_doubt · reply_to_doubt ·
--      accept_doubt_answer · resolve_doubt · reopen_doubt · assign_doubt ·
--      archive_doubt · attach_doubt_file
--   7. Trigger updates: auto-resolve now stamps resolved_at; new
--      first-response trigger (sets first_response_at + open→in_progress)
--   8. RLS hardening (migration-021 amendments):
--        • DROP the "any authenticated user can create doubt_replies" policy
--        • teacher SELECT on student_doubts: institute-scoped + batch_subject
--          routing (batch_subject_teachers) OR subject specialization
--        • admin policies: institute-scoped (get_my_institute_id)
--        • doubt_attachments: SELECT only (writes via RPC)
--   9. Storage bucket "doubt-attachments" (private, 25 MB, jpeg/png/webp/pdf)
--      + storage.objects policies (SELECT via doubt visibility, INSERT via
--      doubt ownership) — no DELETE/UPDATE in V1
--  10. Grants/revokes
--
-- Reference: Phase 7A implementation report | Domain 14 schema v1.0
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Notification event type additions
-- ════════════════════════════════════════════════════════════════════════════
-- Add the minimal genuinely-required doubt events to the existing
-- notification_event_type enum (pattern from migrations 054/055/115).
-- doubt_reassigned is intentionally NOT added — assignment and reassignment
-- both emit 'doubt_assigned' (assign_doubt handles both; see RPC docs).
do $$
begin
  alter type public.notification_event_type add value if not exists 'doubt_submitted';
  alter type public.notification_event_type add value if not exists 'doubt_assigned';
  alter type public.notification_event_type add value if not exists 'doubt_answered';
  alter type public.notification_event_type add value if not exists 'doubt_follow_up';
  alter type public.notification_event_type add value if not exists 'doubt_resolved';
  alter type public.notification_event_type add value if not exists 'doubt_reopened';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — ALTER student_doubts (additive only)
-- ════════════════════════════════════════════════════════════════════════════
-- All columns are NULLABLE (or have defaults) so existing rows are unaffected.
-- No institute_id column is added — see header decision.

alter table public.student_doubts
  -- Academic routing context (Domain 17): batch_subject this doubt belongs to.
  -- Enables routing via batch_subject_teachers (role_in_batch includes
  -- 'doubt_solver'). Institute is derivable through batch_subjects.institute_id
  -- AND through student_details — both verified NOT NULL chains.
  add column if not exists batch_subject_id uuid null,

  -- Deeper syllabus context for search (client requirement: search previous
  -- doubts "related to a topic"). FK to topics.
  add column if not exists topic_id uuid null,

  -- Manual teacher assignment (V1 routing). References teacher_details so it
  -- matches get_my_teacher_id() and batch_subject_teachers.teacher_id.
  add column if not exists assigned_to uuid null,
  add column if not exists assigned_at timestamptz null,

  -- SLA / response-time fields.
  add column if not exists first_response_at timestamptz null,
  add column if not exists resolved_at timestamptz null,

  -- Reopen guard (student self-reopen cap enforced in RPCs).
  add column if not exists reopened_count smallint not null default 0;

-- Foreign keys for the new columns
alter table public.student_doubts
  add constraint fk_student_doubts_batch_subject
    foreign key (batch_subject_id) references public.batch_subjects (batch_subject_id)
    on delete restrict
    on update restrict,
  add constraint fk_student_doubts_topic
    foreign key (topic_id) references public.topics (topic_id)
    on delete restrict
    on update restrict,
  add constraint fk_student_doubts_assigned_to
    foreign key (assigned_to) references public.teacher_details (teacher_id)
    on delete set null
    on update restrict;

-- CHECK constraints for the new columns.
-- NOTE: the resolved_at backfill MUST run before ck_student_doubts_resolved_at
-- is added — migration 015 allowed status='resolved' rows with resolved_by
-- but the resolved_at column did not exist, so pre-117 resolved doubts have
-- resolved_at NULL and would violate the new constraint (aborting the
-- migration). Backfilling resolved_at = created_at makes the constraint valid
-- on existing data while remaining correct going forward.
update public.student_doubts
   set resolved_at = coalesce(resolved_at, created_at)
 where status = 'resolved'
   and resolved_at is null;

alter table public.student_doubts
  add constraint ck_student_doubts_reopened_count check (reopened_count >= 0),
  add constraint ck_student_doubts_assigned_consistency check (
    (assigned_to is not null and assigned_at is not null)
    or (assigned_to is null and assigned_at is null)
  ),
  add constraint ck_student_doubts_resolved_at check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved')
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — doubt_attachments
-- ════════════════════════════════════════════════════════════════════════════
-- Supports attachments on the original doubt (reply_id NULL) and on replies.
-- Institute is derived via doubt_id → student_doubts.student_id →
-- student_details.institute_id (same rule as the parent).
create table public.doubt_attachments (
  attachment_id uuid          not null  default gen_random_uuid(),
  doubt_id      uuid          not null,
  reply_id      uuid          null      default null,
  uploaded_by   uuid          not null,
  bucket        text          not null  default 'doubt-attachments',
  storage_path  text          not null,
  mime_type     text          not null,
  size_bytes    bigint        not null,
  created_at    timestamptz   not null  default now(),

  constraint pk_doubt_attachments primary key (attachment_id),

  constraint fk_doubt_attachments_doubt
    foreign key (doubt_id) references public.student_doubts (doubt_id)
    on delete cascade
    on update restrict,

  constraint fk_doubt_attachments_reply
    foreign key (reply_id) references public.doubt_replies (reply_id)
    on delete cascade
    on update restrict,

  constraint fk_doubt_attachments_uploader
    foreign key (uploaded_by) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  constraint uq_doubt_attachments_path unique (doubt_id, storage_path),

  constraint ck_doubt_attachments_bucket check (bucket = 'doubt-attachments'),
  constraint ck_doubt_attachments_storage_path check (char_length(storage_path) > 0),
  constraint ck_doubt_attachments_mime check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  constraint ck_doubt_attachments_size check (size_bytes >= 1 and size_bytes <= 26214400)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- Existing (migration 015): idx_doubts_subject_status, idx_doubts_student,
-- idx_doubt_replies_doubt. Only genuinely missing indexes are added below.

-- Teacher inbox: "assigned to me" (pending first, then by recency).
create index if not exists idx_doubts_assigned_status
  on public.student_doubts (assigned_to, status, created_at desc)
  where assigned_to is not null;

-- Admin / teacher pending-doubt queues (institute-scoped via RLS joins).
create index if not exists idx_doubts_status_created
  on public.student_doubts (status, created_at desc);

-- Batch-subject routing (batch_subject_teachers joins + filters).
create index if not exists idx_doubts_batch_subject_status
  on public.student_doubts (batch_subject_id, status)
  where batch_subject_id is not null;

-- Attachment lookups.
create index if not exists idx_doubt_attachments_doubt
  on public.doubt_attachments (doubt_id);

create index if not exists idx_doubt_attachments_reply
  on public.doubt_attachments (reply_id)
  where reply_id is not null;

-- V1 search: pg_trgm GIN indexes power ILIKE '%term%' on title/description
-- (no vector/embedding/AI search — not required for V1).
create extension if not exists pg_trgm;

create index if not exists idx_doubts_title_trgm
  on public.student_doubts using gin (title gin_trgm_ops);

create index if not exists idx_doubts_description_trgm
  on public.student_doubts using gin (description gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Helper functions (internal — not client-executable)
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. doubt_visible_to_me(p_doubt_id)
-- Single source of truth for doubt visibility, used by RLS policies (table +
-- storage) and by the RPCs. SECURITY DEFINER + search_path='' (project
-- convention). Returns:
--   • true  — caller is the doubt owner (student), OR an authorized teacher of
--             the same institute (batch_subject_teachers routing when the
--             doubt has batch_subject_id, else teacher_specializations on the
--             subject), OR an admin of the same institute.
--   • false — otherwise (cross-institute and anonymous access fail here).
create or replace function public.doubt_visible_to_me(p_doubt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_doubts sd
    join public.student_details sd_stu on sd_stu.student_id = sd.student_id
    where sd.doubt_id = p_doubt_id
      and (
        -- doubt owner (student)
        sd.student_id = public.get_my_student_id()
        or
        -- teacher: same institute AND (batch_subject routing OR subject spec)
        (
          public.is_teacher()
          and public.get_my_institute_id() = sd_stu.institute_id
          and (
            (
              sd.batch_subject_id is not null
              and exists (
                select 1 from public.batch_subject_teachers bst
                where bst.batch_subject_id = sd.batch_subject_id
                  and bst.teacher_id = public.get_my_teacher_id()
                  and bst.institute_id = sd_stu.institute_id
              )
            )
            or exists (
              select 1 from public.teacher_specializations ts
              where ts.teacher_id = public.get_my_teacher_id()
                and ts.subject_id = sd.subject_id
            )
          )
        )
        or
        -- admin: same institute
        (
          public.is_admin()
          and public.get_my_institute_id() = sd_stu.institute_id
        )
      )
  );
$$;

-- 4b. doubt_eligible_teacher_ids(p_doubt_id)
-- Returns profile_ids of teachers eligible to handle the doubt (used for the
-- doubt_submitted notification fan-out and for assign_doubt validation).
-- Eligibility: same institute as the doubt's student, account approved,
-- assigned to the doubt's batch_subject (when set) OR specializing in the
-- doubt's subject. role_in_batch is advisory free-text (doubt_solver, etc.)
-- and is deliberately NOT filtered on in V1.
create or replace function public.doubt_eligible_teacher_ids(p_doubt_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct td.profile_id), '{}'::uuid[])
  from public.student_doubts sd
  join public.student_details sd_stu on sd_stu.student_id = sd.student_id
  cross join public.teacher_details td
  join public.profiles tp on tp.profile_id = td.profile_id
  where sd.doubt_id = p_doubt_id
    and tp.role = 'teacher'::public.user_role
    and tp.account_status = 'approved'
    and tp.institute_id = sd_stu.institute_id
    and (
      (
        sd.batch_subject_id is not null
        and exists (
          select 1 from public.batch_subject_teachers bst
          where bst.batch_subject_id = sd.batch_subject_id
            and bst.teacher_id = td.teacher_id
            and bst.institute_id = sd_stu.institute_id
        )
      )
      or exists (
        select 1 from public.teacher_specializations ts
        where ts.teacher_id = td.teacher_id
          and ts.subject_id = sd.subject_id
      )
    );
$$;

-- 4c. doubt_notify — transactional notification fan-out (mirrors
-- migration-115 resolution_notify). Insert one notifications row + one
-- notification_recipients row per recipient, deduped via the existing unique
-- constraint. Callers invoke this inside the same transaction as the state
-- change so notifications never commit without their event.
create or replace function public.doubt_notify(
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

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — SECURITY DEFINER RPCs
-- ════════════════════════════════════════════════════════════════════════════
-- All RPCs follow the migration-115 pattern: SECURITY DEFINER,
-- set search_path = '', fully-qualified public.*, identity derived from
-- auth.uid(), institute derived from trusted relationships (never a client
-- parameter), transactional writes, audit + notifications in the same
-- transaction.

-- 5a. submit_student_doubt — student creates a doubt.
-- Supports all academic contexts:
--   A. general subject doubt       (subject_id only)
--   B. chapter/topic doubt         (+ chapter_id / topic_id)
--   C. mock-test/question doubt    (+ related_resource_type/id = mock_test/question)
--   D. live-class doubt            (+ related_resource_type/id = live_class)
--   E. material/homework doubt     (+ related_resource_type/id = content)
-- The doubt is created 'open'; eligible teachers are notified immediately
-- (doubt_submitted). No auto-assignment in V1 (admin assigns manually).
create or replace function public.submit_student_doubt(
  p_subject_id            uuid,
  p_chapter_id            uuid,
  p_topic_id              uuid,
  p_batch_subject_id      uuid,
  p_title                 text,
  p_description           text,
  p_related_resource_type public.resource_category_type default null,
  p_related_resource_id   uuid        default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student    uuid;
  v_institute  uuid;
  v_doubt_id   uuid;
  v_bs_rec     record;
  v_ch_rec     record;
  v_tp_rec     record;
  v_teacher_ids uuid[];
begin
  -- ── Authorization ──────────────────────────────────────────────────────
  if auth.role() <> 'authenticated' or public.get_my_student_id() is null then
    raise exception 'Only students can submit doubts.';
  end if;
  v_student   := public.get_my_student_id();
  v_institute := public.get_my_institute_id();

  -- ── Input validation ───────────────────────────────────────────────────
  if p_subject_id is null then
    raise exception 'A subject is required for the doubt.';
  end if;
  if char_length(coalesce(p_title, '')) < 5 or char_length(p_title) > 200 then
    raise exception 'Doubt title must be 5-200 characters.';
  end if;
  if char_length(coalesce(p_description, '')) < 1 then
    raise exception 'Doubt description is required.';
  end if;

  if not exists (
    select 1 from public.subjects s
    where s.subject_id = p_subject_id
  ) then
    raise exception 'Subject not found.';
  end if;

  -- Chapter must belong to the subject (when provided).
  if p_chapter_id is not null then
    select chapter_id into v_ch_rec from public.chapters
    where chapter_id = p_chapter_id;
    if v_ch_rec.chapter_id is null then
      raise exception 'Chapter not found.';
    end if;
    if not exists (
      select 1 from public.chapters c
      where c.chapter_id = p_chapter_id and c.subject_id = p_subject_id
    ) then
      raise exception 'Chapter does not belong to the selected subject.';
    end if;
  end if;

  -- Topic must belong to the chapter (when provided).
  if p_topic_id is not null then
    if p_chapter_id is null then
      raise exception 'Topic requires a chapter.';
    end if;
    select topic_id into v_tp_rec from public.topics
    where topic_id = p_topic_id;
    if v_tp_rec.topic_id is null then
      raise exception 'Topic not found.';
    end if;
    if not exists (
      select 1 from public.topics t
      where t.topic_id = p_topic_id and t.chapter_id = p_chapter_id
    ) then
      raise exception 'Topic does not belong to the selected chapter.';
    end if;
  end if;

  -- Batch-subject must exist, match the student's institute, belong to a
  -- batch the student is actively enrolled in, AND match the selected subject
  -- (prevents storing subject_id=Chemistry with batch_subject_id=<Physics>,
  -- which would confuse teacher routing).
  if p_batch_subject_id is not null then
    select bs.* into v_bs_rec
    from public.batch_subjects bs
    where bs.batch_subject_id = p_batch_subject_id;
    if v_bs_rec.batch_subject_id is null then
      raise exception 'Batch subject not found.';
    end if;
    if v_bs_rec.institute_id <> v_institute then
      raise exception 'Batch subject does not belong to your institute.';
    end if;
    if v_bs_rec.subject_id <> p_subject_id then
      raise exception 'The subject does not match the selected batch subject.';
    end if;
    if not exists (
      select 1 from public.batch_students bst
      where bst.batch_id = v_bs_rec.batch_id
        and bst.student_id = v_student
        and bst.status = 'active'
    ) then
      raise exception 'You are not enrolled in the batch for this subject.';
    end if;
  end if;

  -- ── Create doubt (status 'open') ───────────────────────────────────────
  insert into public.student_doubts (
    student_id, subject_id, chapter_id, topic_id, batch_subject_id,
    related_resource_type, related_resource_id,
    title, description, status
  )
  values (
    v_student, p_subject_id, p_chapter_id, p_topic_id, p_batch_subject_id,
    p_related_resource_type, p_related_resource_id,
    p_title, p_description, 'open'::public.doubt_status_type
  )
  returning doubt_id into v_doubt_id;

  -- ── Audit (same transaction) ───────────────────────────────────────────
  perform public.write_audit_log(
    'create'::public.audit_action_type, 'student_doubt', v_doubt_id,
    null,
    jsonb_build_object(
      'subject_id', p_subject_id, 'chapter_id', p_chapter_id,
      'topic_id', p_topic_id, 'batch_subject_id', p_batch_subject_id,
      'title', p_title, 'status', 'open'
    ),
    jsonb_build_object('context', 'submit_student_doubt')
  );

  -- ── Notify eligible teachers (doubt_submitted) ─────────────────────────
  v_teacher_ids := public.doubt_eligible_teacher_ids(v_doubt_id);
  perform public.doubt_notify(
    v_institute, 'doubt_submitted'::public.notification_event_type,
    'New doubt: ' || left(p_title, 60),
    'A student submitted a doubt in ' || coalesce(
      (select s.name from public.subjects s where s.subject_id = p_subject_id),
      'your subject'
    ) || '.',
    v_teacher_ids, 'student_doubt', v_doubt_id
  );

  return jsonb_build_object(
    'success', true, 'doubt_id', v_doubt_id, 'status', 'open'
  );
end;
$$;

-- 5b. reply_to_doubt — student (owner follow-up), authorized teacher
-- (answer), or admin. Sets first_response_at on the first teacher reply
-- (trigger also enforces this for any write path). Teacher reply on an 'open'
-- doubt moves it to 'in_progress'. Notifications:
--   • teacher answers → student (doubt_answered)
--   • student follow-up → assigned teacher (doubt_follow_up)
create or replace function public.reply_to_doubt(
  p_doubt_id   uuid,
  p_reply_text text,
  p_image_url  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt      record;
  v_reply_id   uuid;
  v_is_teacher boolean := false;
  v_student_id uuid;
  v_assigned_teacher_profile uuid;
  v_institute  uuid;
begin
  -- ── Authorization ──────────────────────────────────────────────────────
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;
  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;
  if char_length(coalesce(p_reply_text, '')) < 1 then
    raise exception 'Reply text is required.';
  end if;

  select sd.*, sd_stu.institute_id, sd_stu.profile_id as student_profile_id
    into v_doubt
  from public.student_doubts sd
  join public.student_details sd_stu on sd_stu.student_id = sd.student_id
  where sd.doubt_id = p_doubt_id;

  v_institute  := v_doubt.institute_id;
  v_student_id := v_doubt.student_id;

  if v_doubt.status = 'archived'::public.doubt_status_type then
    raise exception 'This doubt is archived and can no longer be modified.';
  end if;

  -- Teacher flag is derived from the profile role (mirrors policy logic);
  -- auth.uid() → profiles.role is the single trusted source. Admins are also
  -- treated as answerers so a student gets a doubt_answered notification when
  -- an academic admin resolves their doubt.
  v_is_teacher := exists (
    select 1 from public.profiles p
    where p.profile_id = auth.uid()
      and p.role in ('teacher'::public.user_role, 'admin'::public.user_role)
  );

  -- ── Insert reply ───────────────────────────────────────────────────────
  insert into public.doubt_replies (
    doubt_id, author_profile_id, reply_text, image_url
  )
  values (p_doubt_id, auth.uid(), p_reply_text, p_image_url)
  returning reply_id into v_reply_id;

  -- ── Status transition (teacher answer on open doubt) ───────────────────
  if v_is_teacher and v_doubt.status = 'open'::public.doubt_status_type then
    update public.student_doubts
       set status = 'in_progress'::public.doubt_status_type
     where doubt_id = p_doubt_id
       and status = 'open'::public.doubt_status_type;
  end if;

  -- ── Audit ──────────────────────────────────────────────────────────────
  perform public.write_audit_log(
    'update'::public.audit_action_type, 'student_doubt', p_doubt_id,
    jsonb_build_object('status', v_doubt.status),
    jsonb_build_object(
      'action', case when v_is_teacher then 'answered' else 'follow_up' end,
      'reply_id', v_reply_id
    ),
    jsonb_build_object('context', 'reply_to_doubt')
  );

  -- ── Notifications (same transaction) ───────────────────────────────────
  if v_is_teacher then
    -- Teacher answered → notify the student.
    perform public.doubt_notify(
      v_institute, 'doubt_answered'::public.notification_event_type,
      'Your doubt has been answered',
      'A teacher responded to your doubt: "' || left(p_reply_text, 80) || '"',
      array[v_doubt.student_profile_id], 'student_doubt', p_doubt_id
    );
  else
    -- Student follow-up → notify the assigned teacher (if any).
    if v_doubt.assigned_to is not null then
      select tp.profile_id into v_assigned_teacher_profile
      from public.teacher_details td
      join public.profiles tp on tp.profile_id = td.profile_id
      where td.teacher_id = v_doubt.assigned_to;

      if v_assigned_teacher_profile is not null then
        perform public.doubt_notify(
          v_institute, 'doubt_follow_up'::public.notification_event_type,
          'Student follow-up on a doubt',
          'The student replied to a doubt you are handling.',
          array[v_assigned_teacher_profile], 'student_doubt', p_doubt_id
        );
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'reply_id', v_reply_id);
end;
$$;

-- 5c. accept_doubt_answer — the student marks a reply as the accepted answer.
-- This is the sanctioned write path for the EXISTING auto-resolve trigger
-- (trgfn_doubt_auto_resolve): setting is_accepted_answer = true on the reply
-- resolves the parent doubt (status = 'resolved', resolved_by = reply author,
-- resolved_at = now() via the updated trigger). Any previously accepted
-- answer on the same doubt is cleared first (single-accepted invariant,
-- enforced at application layer per the Domain 14 design note).
create or replace function public.accept_doubt_answer(
  p_doubt_id uuid,
  p_reply_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt      record;
  v_reply      record;
begin
  -- ── Authorization ──────────────────────────────────────────────────────
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;
  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;

  -- Only the owning student (or an admin) may accept an answer.
  if not (
    public.get_my_student_id() = (
      select student_id from public.student_doubts where doubt_id = p_doubt_id
    )
    or public.is_admin()
  ) then
    raise exception 'Only the doubt owner can accept an answer.';
  end if;

  select * into v_doubt from public.student_doubts where doubt_id = p_doubt_id;
  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;
  if v_doubt.status = 'archived'::public.doubt_status_type then
    raise exception 'This doubt is archived and can no longer be modified.';
  end if;

  select * into v_reply from public.doubt_replies where reply_id = p_reply_id;
  if v_reply.reply_id is null or v_reply.doubt_id <> p_doubt_id then
    raise exception 'Reply does not belong to this doubt.';
  end if;

  -- The accepted "solution" must have been written by a teacher or admin — a
  -- student cannot accept their own follow-up to self-resolve the doubt.
  if not exists (
    select 1 from public.profiles p
    where p.profile_id = v_reply.author_profile_id
      and p.role in ('teacher'::public.user_role, 'admin'::public.user_role)
  ) then
    raise exception 'Only a teacher''s answer can be accepted as the solution.';
  end if;

  -- ── Clear previous accepted answer, then accept the chosen reply ───────
  update public.doubt_replies
     set is_accepted_answer = false
   where doubt_id = p_doubt_id
     and is_accepted_answer = true;

  update public.doubt_replies
     set is_accepted_answer = true
   where reply_id = p_reply_id;

  -- ── Audit ──────────────────────────────────────────────────────────────
  perform public.write_audit_log(
    'approve'::public.audit_action_type, 'student_doubt', p_doubt_id,
    null,
    jsonb_build_object('accepted_reply_id', p_reply_id),
    jsonb_build_object('context', 'accept_doubt_answer')
  );

  -- ── Notify the answering teacher (doubt_resolved — trigger resolves) ───
  perform public.doubt_notify(
    (select sd_stu.institute_id
       from public.student_doubts sd
       join public.student_details sd_stu on sd_stu.student_id = sd.student_id
      where sd.doubt_id = p_doubt_id),
    'doubt_resolved'::public.notification_event_type,
    'Your answer resolved a doubt',
    'The student accepted your answer and the doubt is now resolved.',
    array[v_reply.author_profile_id], 'student_doubt', p_doubt_id
  );

  return jsonb_build_object('success', true, 'status', 'resolved');
end;
$$;

-- 5d. resolve_doubt — student owner / authorized teacher / admin resolves a
-- doubt directly (no accepted answer required, e.g. teacher confirms solved).
create or replace function public.resolve_doubt(p_doubt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt record;
  v_updated integer;
  v_notify_ids uuid[];
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;
  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;

  select * into v_doubt from public.student_doubts where doubt_id = p_doubt_id;
  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;
  if v_doubt.status = 'archived'::public.doubt_status_type then
    raise exception 'This doubt is archived and can no longer be modified.';
  end if;
  if v_doubt.status = 'resolved'::public.doubt_status_type then
    return jsonb_build_object('success', true, 'status', 'resolved');
  end if;

  update public.student_doubts
     set status = 'resolved'::public.doubt_status_type,
         resolved_by = auth.uid(),
         resolved_at = now()
   where doubt_id = p_doubt_id
     and status in ('open'::public.doubt_status_type, 'in_progress'::public.doubt_status_type);
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'Doubt cannot be resolved from its current state.';
  end if;

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'student_doubt', p_doubt_id,
    jsonb_build_object('status', v_doubt.status),
    jsonb_build_object('status', 'resolved', 'resolved_by', auth.uid()),
    jsonb_build_object('context', 'resolve_doubt')
  );

  -- Notify the assigned teacher (acknowledgement).
  if v_doubt.assigned_to is not null then
    select coalesce(array_agg(tp.profile_id), '{}') into v_notify_ids
    from public.teacher_details td
    join public.profiles tp on tp.profile_id = td.profile_id
    where td.teacher_id = v_doubt.assigned_to;
    perform public.doubt_notify(
      (select sd_stu.institute_id
         from public.student_doubts sd
         join public.student_details sd_stu on sd_stu.student_id = sd.student_id
        where sd.doubt_id = p_doubt_id),
      'doubt_resolved'::public.notification_event_type,
      'Doubt resolved',
      'The doubt you were handling has been resolved.',
      v_notify_ids, 'student_doubt', p_doubt_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 'resolved');
end;
$$;

-- 5e. reopen_doubt — student owner or admin reopens a resolved doubt.
-- Reopened doubts return to 'open'; resolved fields are cleared; the reopen
-- counter increments (student self-reopen capped at 3; admin bypasses).
create or replace function public.reopen_doubt(p_doubt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt      record;
  v_is_student boolean;
  v_updated    integer;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;

  select * into v_doubt from public.student_doubts where doubt_id = p_doubt_id;
  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;
  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;
  if v_doubt.status <> 'resolved'::public.doubt_status_type then
    raise exception 'Only resolved doubts can be reopened.';
  end if;

  v_is_student := public.get_my_student_id() = v_doubt.student_id;
  if v_is_student and v_doubt.reopened_count >= 3 and not public.is_admin() then
    raise exception 'This doubt has been reopened the maximum number of times.';
  end if;

  update public.student_doubts
     set status = 'open'::public.doubt_status_type,
         resolved_by = null,
         resolved_at = null,
         reopened_count = reopened_count + 1
   where doubt_id = p_doubt_id
     and status = 'resolved'::public.doubt_status_type;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'Doubt cannot be reopened from its current state.';
  end if;

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'student_doubt', p_doubt_id,
    jsonb_build_object('status', 'resolved'),
    jsonb_build_object('status', 'open', 'reopened_count', v_doubt.reopened_count + 1),
    jsonb_build_object('context', 'reopen_doubt')
  );

  -- Notify the assigned teacher (doubt_reopened).
  if v_doubt.assigned_to is not null then
    perform public.doubt_notify(
      (select sd_stu.institute_id
         from public.student_doubts sd
         join public.student_details sd_stu on sd_stu.student_id = sd.student_id
        where sd.doubt_id = p_doubt_id),
      'doubt_reopened'::public.notification_event_type,
      'A doubt was reopened',
      'The student reopened a resolved doubt you were handling.',
      (select coalesce(array_agg(tp.profile_id), '{}'::uuid[])
         from public.teacher_details td
         join public.profiles tp on tp.profile_id = td.profile_id
        where td.teacher_id = v_doubt.assigned_to),
      'student_doubt', p_doubt_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 'open');
end;
$$;

-- 5f. assign_doubt — Academic Admin / Super Admin assigns (or reassigns) a
-- teacher to a doubt. One function covers both first assignment and
-- reassignment (audit records old/new). Does NOT modify the batch_subject
-- routing or teacher_specializations — it is a doubt-level assignment only.
create or replace function public.assign_doubt(
  p_doubt_id   uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt       record;
  v_institute   uuid;
  v_old_assigned uuid;
  v_teacher_profile uuid;
begin
  -- ── Authorization: Academic Admin or Super Admin ───────────────────────
  if auth.role() <> 'authenticated'
     or not (public.is_academic_admin() or public.is_super_admin()) then
    raise exception 'Only academic admins can assign teachers to doubts.';
  end if;

  select sd.*, sd_stu.institute_id into v_doubt
  from public.student_doubts sd
  join public.student_details sd_stu on sd_stu.student_id = sd.student_id
  where sd.doubt_id = p_doubt_id;

  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;
  v_institute := v_doubt.institute_id;

  -- Admin must belong to the doubt's institute.
  if public.get_my_institute_id() <> v_institute then
    raise exception 'You do not have access to doubts in this institute.';
  end if;
  if v_doubt.status = 'archived'::public.doubt_status_type then
    raise exception 'Archived doubts cannot be assigned.';
  end if;
  if v_doubt.status = 'resolved'::public.doubt_status_type then
    raise exception 'Resolved doubts cannot be reassigned.';
  end if;

  -- ── Validate target teacher (same institute + eligibility + active) ────
  select tp.profile_id into v_teacher_profile
  from public.teacher_details td
  join public.profiles tp on tp.profile_id = td.profile_id
  where td.teacher_id = p_teacher_id;

  if v_teacher_profile is null then
    raise exception 'Teacher not found.';
  end if;

  if not (
    select tp.account_status = 'approved'
      from public.teacher_details td
      join public.profiles tp on tp.profile_id = td.profile_id
     where td.teacher_id = p_teacher_id
  ) then
    raise exception 'The selected teacher is not active.';
  end if;

  if not (
    (v_doubt.batch_subject_id is not null
      and exists (
        select 1 from public.batch_subject_teachers bst
        where bst.batch_subject_id = v_doubt.batch_subject_id
          and bst.teacher_id = p_teacher_id
          and bst.institute_id = v_institute
      ))
    or exists (
      select 1 from public.teacher_specializations ts
      where ts.teacher_id = p_teacher_id
        and ts.subject_id = v_doubt.subject_id
    )
  ) then
    raise exception 'The selected teacher is not assigned to this subject/batch.';
  end if;

  -- ── Apply assignment ───────────────────────────────────────────────────
  v_old_assigned := v_doubt.assigned_to;
  update public.student_doubts
     set assigned_to = p_teacher_id,
         assigned_at = now(),
         status = case when status = 'open'::public.doubt_status_type
                       then 'in_progress'::public.doubt_status_type
                       else status end
   where doubt_id = p_doubt_id;

  -- ── Audit ──────────────────────────────────────────────────────────────
  perform public.write_audit_log(
    'update'::public.audit_action_type, 'student_doubt', p_doubt_id,
    jsonb_build_object('assigned_to', v_old_assigned),
    jsonb_build_object('assigned_to', p_teacher_id, 'status', 'in_progress'),
    jsonb_build_object(
      'context', case when v_old_assigned is null then 'assign_doubt' else 'reassign_doubt' end
    )
  );

  -- ── Notify the assigned teacher (doubt_assigned) ───────────────────────
  perform public.doubt_notify(
    v_institute, 'doubt_assigned'::public.notification_event_type,
    'A doubt has been assigned to you',
    'An academic admin assigned a student doubt to you.',
    array[v_teacher_profile], 'student_doubt', p_doubt_id
  );

  return jsonb_build_object(
    'success', true, 'doubt_id', p_doubt_id,
    'assigned_to', p_teacher_id,
    'reassigned', v_old_assigned is not null
  );
end;
$$;

-- 5g. archive_doubt — Academic Admin / Super Admin archives a doubt
-- (terminal state; archived doubts cannot be modified or reopened).
create or replace function public.archive_doubt(p_doubt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt     record;
  v_updated   integer;
begin
  if auth.role() <> 'authenticated'
     or not (public.is_academic_admin() or public.is_super_admin()) then
    raise exception 'Only academic admins can archive doubts.';
  end if;

  select sd.*, sd_stu.institute_id into v_doubt
  from public.student_doubts sd
  join public.student_details sd_stu on sd_stu.student_id = sd.student_id
  where sd.doubt_id = p_doubt_id;

  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;
  if public.get_my_institute_id() <> v_doubt.institute_id then
    raise exception 'You do not have access to doubts in this institute.';
  end if;

  update public.student_doubts
     set status = 'archived'::public.doubt_status_type
   where doubt_id = p_doubt_id
     and status <> 'archived'::public.doubt_status_type;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'Doubt is already archived.';
  end if;

  -- NOTE: 'update' (not 'soft_delete') is used because the audit_logs CHECK
  -- constraint (migration 011) requires new_value IS NULL for delete/
  -- soft_delete actions. Archiving is a status transition, so it is logged
  -- as an update with old → new status.
  perform public.write_audit_log(
    'update'::public.audit_action_type, 'student_doubt', p_doubt_id,
    jsonb_build_object('status', v_doubt.status),
    jsonb_build_object('status', 'archived'),
    jsonb_build_object('context', 'archive_doubt')
  );

  return jsonb_build_object('success', true, 'status', 'archived');
end;
$$;

-- 5h. attach_doubt_file — records an attachment (doubt-level or reply-level)
-- AFTER the file has been uploaded to the doubt-attachments storage bucket.
-- Authorized: doubt owner, authorized teacher, or admin (doubt_visible_to_me).
-- Validates MIME type + 25 MB size (mirrors bucket config + table CHECK).
create or replace function public.attach_doubt_file(
  p_doubt_id     uuid,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   bigint,
  p_reply_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt        record;
  v_institute    uuid;
  v_attachment_id uuid;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;
  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;

  select sd.*, sd_stu.institute_id into v_doubt
  from public.student_doubts sd
  join public.student_details sd_stu on sd_stu.student_id = sd.student_id
  where sd.doubt_id = p_doubt_id;

  v_institute := v_doubt.institute_id;
  if v_doubt.status = 'archived'::public.doubt_status_type then
    raise exception 'This doubt is archived and can no longer be modified.';
  end if;

  if p_reply_id is not null and not exists (
    select 1 from public.doubt_replies r
    where r.reply_id = p_reply_id and r.doubt_id = p_doubt_id
  ) then
    raise exception 'Reply does not belong to this doubt.';
  end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.';
  end if;
  if p_size_bytes < 1 or p_size_bytes > 26214400 then
    raise exception 'File must be between 1 byte and 25 MB.';
  end if;

  insert into public.doubt_attachments (
    doubt_id, reply_id, uploaded_by, bucket, storage_path, mime_type, size_bytes
  )
  values (
    p_doubt_id, p_reply_id, auth.uid(), 'doubt-attachments',
    p_storage_path, p_mime_type, p_size_bytes
  )
  returning attachment_id into v_attachment_id;

  perform public.write_audit_log(
    'update'::public.audit_action_type, 'student_doubt', p_doubt_id,
    null,
    jsonb_build_object('attachment_id', v_attachment_id, 'storage_path', p_storage_path),
    jsonb_build_object('context', 'attach_doubt_file')
  );

  return jsonb_build_object('success', true, 'attachment_id', v_attachment_id);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Trigger updates
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Extend the EXISTING auto-resolve trigger (Domain 14, migration 015) so
-- it also stamps resolved_at (new column). All other behavior is unchanged.
create or replace function public.trgfn_doubt_auto_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_accepted_answer = true then
    update public.student_doubts
       set status = 'resolved',
           resolved_by = new.author_profile_id,
           resolved_at = now()
     where doubt_id = new.doubt_id
       and status != 'resolved';
  end if;
  return new;
end;
$$;

-- 6b. NEW: first-response trigger — when a TEACHER (or admin) reply is
-- inserted and the doubt has no first_response_at yet, stamp it. Also moves
-- the doubt from 'open' to 'in_progress' (the doubt is now being handled).
-- Covers every write path, including any future direct RLS writes.
create or replace function public.trgfn_doubt_first_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_role public.user_role;
begin
  select role into v_author_role
  from public.profiles
  where profile_id = new.author_profile_id;

  if v_author_role in ('teacher', 'admin') then
    update public.student_doubts
       set first_response_at = coalesce(first_response_at, now()),
           status = case
             when status = 'open' then 'in_progress'::public.doubt_status_type
             else status
           end
     where doubt_id = new.doubt_id
       and status <> 'archived';
  end if;
  return new;
end;
$$;

create trigger trg_doubt_replies_first_response
  after insert on public.doubt_replies
  for each row
  execute function public.trgfn_doubt_first_response();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — RLS hardening (amendments to migration 021)
-- ════════════════════════════════════════════════════════════════════════════

-- 7a. student_doubts
-- KEEP: "Students have full access to their own doubts" (already
-- ownership-scoped — safe).
-- DROP + RECREATE (institute-scoped): teacher SELECT and admin full access.
drop policy if exists "Teachers can read doubts for subjects they specialize in"
  on public.student_doubts;

drop policy if exists "Admins have full access to student_doubts"
  on public.student_doubts;

-- Teacher SELECT — institute-scoped + batch_subject routing OR subject
-- specialization (fixes the verified cross-institute read hole).
--
-- IMPORTANT: this policy delegates to the SECURITY DEFINER helper
-- doubt_visible_to_me() instead of inlining joins to student_details /
-- batch_subject_teachers / teacher_specializations. Inlining would silently
-- return ZERO rows for every teacher: RLS applies to tables referenced inside
-- policy expressions, and migration 021 grants teachers NO read policy on
-- student_details (only students-self + admins-full). doubt_visible_to_me()
-- runs as the function owner (postgres), so its internal joins bypass RLS on
-- those reference tables — the same pattern migration 021 already uses for
-- is_admin()/is_teacher(), and the same pattern the doubt_replies and
-- doubt_attachments policies below use. No FORCE ROW LEVEL SECURITY is set on
-- student_doubts, so there is no recursion (the helper owns its reads).
create policy "Teachers can read doubts for their institute's subjects"
  on public.student_doubts
  for select
  to authenticated
  using (
    public.is_teacher()
    and public.doubt_visible_to_me(doubt_id)
  );

-- Admin full access — institute-scoped (fixes the verified cross-institute
-- admin hole).
create policy "Admins have full access to student_doubts (institute-scoped)"
  on public.student_doubts
  for all
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.student_details sd_stu
      where sd_stu.student_id = student_doubts.student_id
        and sd_stu.institute_id = public.get_my_institute_id()
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.student_details sd_stu
      where sd_stu.student_id = student_doubts.student_id
        and sd_stu.institute_id = public.get_my_institute_id()
    )
  );

-- 7b. doubt_replies
-- REPLACE the read policy: the migration-021 read policy is institute-blind
-- (teacher via teacher_specializations only, admin via bare is_admin()) and
-- leaves a cross-institute read hole. The replacement delegates to
-- doubt_visible_to_me() — owner student, same-institute authorized teacher
-- (batch_subject routing OR subject specialization), or same-institute admin.
-- ALL reply writes now go through the SECURITY DEFINER RPCs
-- (reply_to_doubt / accept_doubt_answer).
drop policy if exists "Users can read doubt_replies for accessible doubts"
  on public.doubt_replies;

create policy "Users can read doubt_replies for accessible doubts (institute-scoped)"
  on public.doubt_replies
  for select
  to authenticated
  using (public.doubt_visible_to_me(doubt_id));

drop policy if exists "Authenticated users can create doubt_replies"
  on public.doubt_replies;

drop policy if exists "Admins have full access to doubt_replies"
  on public.doubt_replies;

create policy "Admins have full access to doubt_replies (institute-scoped)"
  on public.doubt_replies
  for all
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.student_doubts sd
      join public.student_details sd_stu on sd_stu.student_id = sd.student_id
      where sd.doubt_id = doubt_replies.doubt_id
        and sd_stu.institute_id = public.get_my_institute_id()
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.student_doubts sd
      join public.student_details sd_stu on sd_stu.student_id = sd.student_id
      where sd.doubt_id = doubt_replies.doubt_id
        and sd_stu.institute_id = public.get_my_institute_id()
    )
  );

-- 7c. doubt_attachments (new table)
alter table public.doubt_attachments enable row level security;

-- SELECT: any user who can see the parent doubt.
create policy "Read doubt_attachments for accessible doubts"
  on public.doubt_attachments
  for select
  to authenticated
  using (public.doubt_visible_to_me(doubt_id));

-- No INSERT/UPDATE/DELETE policies — all writes go through
-- attach_doubt_file() (SECURITY DEFINER). Cross-institute attachment reads
-- fail because doubt_visible_to_me() is institute-scoped.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — Storage: doubt-attachments bucket
-- ════════════════════════════════════════════════════════════════════════════
-- A dedicated private bucket is justified for security/organization: a tight
-- MIME allowlist (jpeg/png/webp/pdf) + 25 MB cap, and a folder convention
-- {institute_id}/{doubt_id}/{file} that the existing student-submissions
-- bucket (assignment-oriented, broader allowlist) cannot cleanly express.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values ('doubt-attachments', 'doubt-attachments', false, 26214400, array[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
], false)
on conflict (id) do nothing;

update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    avif_autodetection = false
where id = 'doubt-attachments';

-- SELECT: authenticated users who can see the doubt (folder = {institute_id}/{doubt_id}).
drop policy if exists "doubt_attachments_select_visible" on storage.objects;
create policy "doubt_attachments_select_visible"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'doubt-attachments'
    and (storage.foldername(name))[2]::uuid is not null
    and public.doubt_visible_to_me((storage.foldername(name))[2]::uuid)
  );

-- INSERT: the doubt owner, an authorized teacher, or an admin may upload into
-- their doubt's folder. Uploader identity is checked via doubt_visible_to_me.
drop policy if exists "doubt_attachments_insert_visible" on storage.objects;
create policy "doubt_attachments_insert_visible"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'doubt-attachments'
    and (storage.foldername(name))[2]::uuid is not null
    and public.doubt_visible_to_me((storage.foldername(name))[2]::uuid)
  );

-- No UPDATE/DELETE policies in V1 (cleanup/revocation deferred to a later
-- phase). Objects are private; reads go through signed URLs issued by the
-- client after the SELECT policy passes.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — Grants / Revokes
-- ════════════════════════════════════════════════════════════════════════════

-- Public RPCs: authenticated + service_role only.
revoke execute on function public.submit_student_doubt(uuid, uuid, uuid, uuid, text, text, public.resource_category_type, uuid) from public, anon;
grant execute on function public.submit_student_doubt(uuid, uuid, uuid, uuid, text, text, public.resource_category_type, uuid) to authenticated, service_role;

revoke execute on function public.reply_to_doubt(uuid, text, text) from public, anon;
grant execute on function public.reply_to_doubt(uuid, text, text) to authenticated, service_role;

revoke execute on function public.accept_doubt_answer(uuid, uuid) from public, anon;
grant execute on function public.accept_doubt_answer(uuid, uuid) to authenticated, service_role;

revoke execute on function public.resolve_doubt(uuid) from public, anon;
grant execute on function public.resolve_doubt(uuid) to authenticated, service_role;

revoke execute on function public.reopen_doubt(uuid) from public, anon;
grant execute on function public.reopen_doubt(uuid) to authenticated, service_role;

revoke execute on function public.assign_doubt(uuid, uuid) from public, anon;
grant execute on function public.assign_doubt(uuid, uuid) to authenticated, service_role;

revoke execute on function public.archive_doubt(uuid) from public, anon;
grant execute on function public.archive_doubt(uuid) to authenticated, service_role;

revoke execute on function public.attach_doubt_file(uuid, text, text, bigint, uuid) from public, anon;
grant execute on function public.attach_doubt_file(uuid, text, text, bigint, uuid) to authenticated, service_role;

-- Internal helpers: no PUBLIC / anon / authenticated execution.
-- NOTE: doubt_visible_to_me is intentionally callable by authenticated ONLY
-- because RLS policies (table + storage) and the security-definer RPCs all
-- invoke it; it returns a boolean for the caller's own access and leaks no
-- data. doubt_eligible_teacher_ids and doubt_notify are fully internal.
revoke execute on function public.doubt_eligible_teacher_ids(uuid) from public, anon, authenticated;
revoke execute on function public.doubt_notify(uuid, public.notification_event_type, text, text, uuid[], text, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on table public.doubt_attachments is
  'Attachments for student_doubts and doubt_replies. Institute is derived via '
  'doubt_id → student_doubts.student_id → student_details.institute_id. '
  'Private bucket doubt-attachments (JPEG/PNG/WEBP/PDF, max 25 MB). Writes '
  'only through attach_doubt_file().';

comment on column public.student_doubts.batch_subject_id is
  'Optional FK to batch_subjects. Enables teacher routing via '
  'batch_subject_teachers (role_in_batch includes doubt_solver). NULL for '
  'general subject doubts. Institute derivable via batch_subjects.institute_id.';

comment on column public.student_doubts.topic_id is
  'Optional FK to topics for deeper syllabus context (search by topic). '
  'Requires chapter_id when set (validated in submit_student_doubt).';

comment on column public.student_doubts.assigned_to is
  'FK to teacher_details. The teacher manually assigned by an academic admin '
  'to handle this doubt (V1 routing). SET NULL on teacher removal.';

comment on column public.student_doubts.first_response_at is
  'Timestamp of the first teacher/admin reply. Set by trigger '
  'trgfn_doubt_first_response on every write path. NULL while unanswered.';

comment on column public.student_doubts.resolved_at is
  'Timestamp when the doubt was resolved. Set by the auto-resolve trigger, '
  'resolve_doubt(), and cleared on reopen. Enforced consistent with status '
  'by ck_student_doubts_resolved_at.';

comment on column public.student_doubts.reopened_count is
  'Number of times the doubt was reopened. Student self-reopen is capped at '
  '3 (reopen_doubt); admin bypasses.';

comment on function public.doubt_visible_to_me(uuid) is
  'Internal visibility helper (institute-scoped): doubt owner, authorized '
  'teacher (batch_subject routing or subject specialization), or admin of the '
  'same institute. Used by RLS policies and RPCs. Returns a boolean only.';

comment on function public.doubt_eligible_teacher_ids(uuid) is
  'Internal helper: profile_ids of teachers eligible to handle a doubt '
  '(same institute, approved, batch_subject assignment or subject '
  'specialization). Used for doubt_submitted fan-out and assign_doubt.';

comment on function public.doubt_notify(uuid, public.notification_event_type, text, text, uuid[], text, uuid) is
  'Internal transactional notification helper (mirrors migration-115 '
  'resolution_notify). Inserts one notifications row + deduped recipient rows '
  'in the caller''s transaction.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 117 Doubt System (Phase 7A)
-- ════════════════════════════════════════════════════════════════════════════
