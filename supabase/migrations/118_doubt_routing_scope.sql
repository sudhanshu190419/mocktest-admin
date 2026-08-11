-- ============================================================================
-- Migration: 118 — Doubt System Routing + Academic Scope (Phase 7D-DB)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Scope: ADDS database-authoritative academic scoping + teacher routing on
--        top of migration 117. 117 is NOT modified. This migration is fully
--        additive: no table changes, no data changes, no RLS weakening.
--
-- Decision summary (verified against the live repository):
--   • Academic scope: for NEW doubts, the student's subject must belong to a
--     batch_subject inside one of the student's ACTIVE batches
--     (batch_students.status='active' via get_student_batch_ids()).
--   • SUBSCRIPTION GATE DECISION (V1): active batch_students membership is the
--     immediate authority for doubt submission — matching migration-117's own
--     validation and the student module's batch derivation
--     (get_student_batch_ids). can_student_access_live_batch_subject() (093)
--     gates LIVE-CLASS/content tiers via course + subscription; doubt
--     submission does NOT duplicate that entitlement system in V1. This is a
--     deliberate, documented product decision — a student enrolled in a batch
--     may raise doubts for that batch's subjects without re-checking
--     course/subscription state at doubt time.
--   • Teacher routing: batch_subject_teachers for the doubt's exact
--     batch_subject is authoritative. Institute-wide teacher_specializations
--     fan-out is RETAINED for legacy doubts (batch_subject_id NULL rows) but is
--     NO LONGER the normal routing path for new doubts (118 guarantees a
--     resolved batch_subject_id on every new doubt).
--   • Single teacher  → assigned_to auto-set (actionable owner).
--   • Multiple teachers → assigned_to stays NULL (no invented primary);
--     all assigned teachers notified via existing doubt_submitted fan-out.
--   • Zero teachers    → assigned_to NULL; Academic Admins + Super Admins of
--     the institute notified via a NEW doubt_unassigned event.
--   • No primary-teacher column is invented. No new role is created.
--   • Existing doubts are NOT backfilled, NOT reassigned, NOT re-routed.
--   • RLS: the migration-021/117 student policy "full access to their own
--     doubts" is replaced by a SELECT-only policy — students must never be
--     able to UPDATE assigned_to / status / routing fields directly. All
--     student writes continue through migration-117 RPCs only.
--
-- Reference: Phase 7D-DB implementation report | Phase 7C routing analysis
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Notification event: doubt_unassigned (additive)
-- ════════════════════════════════════════════════════════════════════════════
-- A NEW event is justified: 'doubt_submitted' is teacher-facing ("new doubt in
-- your subject"); the admin fallback is an assignment-ACTION event ("this doubt
-- has NO teacher and needs one"). Reusing doubt_submitted for admins would blur
-- inbox semantics for both roles. One additive enum value; no other enum
-- values are touched.
do $$
begin
  alter type public.notification_event_type add value if not exists 'doubt_unassigned';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — submit_student_doubt() (routing + academic scope)
-- ════════════════════════════════════════════════════════════════════════════
-- Signature is IDENTICAL to migration 117 (no breaking change). Behaviour
-- added for NEW submissions:
--   1. p_batch_subject_id supplied  → strict validation (exists, active,
--      same institute, subject matches, batch in the student's active batches).
--   2. p_batch_subject_id NULL      → subject-only is allowed ONLY when it
--      resolves unambiguously inside the student's active batches:
--        • 0 matches  → reject ("subject not part of any active batch").
--        • 1 match    → auto-resolve + use that batch_subject.
--        • >1 matches → reject (ambiguous; client must send batch_subject_id).
--   3. Teacher routing on the resolved batch_subject (see header).
--   4. Chapter/topic validation unchanged from 117 (chapter⊆subject,
--      topic⊆chapter).
--   5. Return shape UNCHANGED: { success, doubt_id, status }.
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
  v_student          uuid;
  v_institute        uuid;
  v_doubt_id         uuid;
  v_bs_rec           record;
  v_ch_rec           record;
  v_tp_rec           record;
  v_batch_subject_id uuid;
  v_match_count      int;
  v_teacher_count    int;
  v_teacher_ids      uuid[];
  v_assigned_teacher uuid;
  v_teacher_profile  uuid;
  v_notify_ids       uuid[];
  v_admin_ids        uuid[];
begin
  -- ── Authorization (unchanged from 117) ────────────────────────────────────
  if auth.role() <> 'authenticated' or public.get_my_student_id() is null then
    raise exception 'Only students can submit doubts.';
  end if;
  v_student   := public.get_my_student_id();
  v_institute := public.get_my_institute_id();

  -- ── Input validation (unchanged from 117) ─────────────────────────────────
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

  -- Chapter must belong to the subject (when provided) — unchanged from 117.
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

  -- Topic must belong to the chapter (when provided) — unchanged from 117.
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

  -- ══════════════════════════════════════════════════════════════════════════
  -- Academic scope (118): resolve the AUTHORITATIVE batch_subject.
  -- ══════════════════════════════════════════════════════════════════════════
  if p_batch_subject_id is not null then
    -- Explicit batch_subject: strict validation.
    select bs.* into v_bs_rec
    from public.batch_subjects bs
    where bs.batch_subject_id = p_batch_subject_id;

    if v_bs_rec.batch_subject_id is null then
      raise exception 'Batch subject not found.';
    end if;
    if v_bs_rec.is_active = false then
      raise exception 'Batch subject is not active.';
    end if;
    if v_bs_rec.institute_id <> v_institute then
      raise exception 'Batch subject does not belong to your institute.';
    end if;
    if v_bs_rec.subject_id <> p_subject_id then
      raise exception 'The subject does not match the selected batch subject.';
    end if;
    if not (v_bs_rec.batch_id = any (public.get_student_batch_ids())) then
      raise exception 'You are not enrolled in the batch for this subject.';
    end if;
    v_batch_subject_id := p_batch_subject_id;
  else
    -- Subject-only submission: resolve unambiguously within active batches.
    -- NOTE: this deliberately counts batch_subjects (not distinct batches), so
    -- even two batch_subjects for the SAME subject inside the SAME batch are
    -- treated as ambiguous and rejected. Conservative by design: the RPC never
    -- guesses which subject context the student meant — the client must send
    -- batch_subject_id. One-line data rule; see Phase 7D-DB report.
    select count(*) into v_match_count
    from public.batch_subjects bs
    where bs.subject_id = p_subject_id
      and bs.is_active = true
      and bs.institute_id = v_institute
      and bs.batch_id = any (public.get_student_batch_ids());

    if v_match_count = 0 then
      raise exception 'The selected subject is not part of any of your active batches.';
    end if;
    if v_match_count > 1 then
      raise exception 'The selected subject belongs to multiple of your batches. Please provide the specific batch subject.';
    end if;

    select bs.batch_subject_id into v_batch_subject_id
    from public.batch_subjects bs
    where bs.subject_id = p_subject_id
      and bs.is_active = true
      and bs.institute_id = v_institute
      and bs.batch_id = any (public.get_student_batch_ids())
    limit 1;
  end if;

  -- ── Create doubt (status 'open') ───────────────────────────────────────────
  insert into public.student_doubts (
    student_id, subject_id, chapter_id, topic_id, batch_subject_id,
    related_resource_type, related_resource_id,
    title, description, status
  )
  values (
    v_student, p_subject_id, p_chapter_id, p_topic_id, v_batch_subject_id,
    p_related_resource_type, p_related_resource_id,
    p_title, p_description, 'open'::public.doubt_status_type
  )
  returning doubt_id into v_doubt_id;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Teacher routing (118) — authoritative: the resolved batch_subject.
  -- ══════════════════════════════════════════════════════════════════════════
  select count(*), coalesce(array_agg(bst.teacher_id), '{}'::uuid[])
    into v_teacher_count, v_teacher_ids
  from public.batch_subject_teachers bst
  where bst.batch_subject_id = v_batch_subject_id;

  if v_teacher_count = 1 then
    -- CASE A — exactly ONE assigned teacher → auto-assign as actionable owner.
    v_assigned_teacher := v_teacher_ids[1];

    update public.student_doubts
       set assigned_to = v_assigned_teacher,
           assigned_at = now()
     where doubt_id = v_doubt_id;

    -- Notify the single teacher (existing doubt_assigned event).
    select td.profile_id into v_teacher_profile
    from public.teacher_details td
    where td.teacher_id = v_assigned_teacher;

    if v_teacher_profile is not null then
      perform public.doubt_notify(
        v_institute, 'doubt_assigned'::public.notification_event_type,
        'A doubt has been assigned to you',
        'A student submitted a doubt in your subject and it has been assigned to you.',
        array[v_teacher_profile], 'student_doubt', v_doubt_id
      );
    end if;
  elsif v_teacher_count > 1 then
    -- CASE B — multiple assigned teachers → do NOT choose one. Keep
    -- assigned_to NULL; notify ALL assigned teachers (existing
    -- doubt_submitted fan-out via doubt_eligible_teacher_ids, which resolves
    -- through batch_subject_teachers because the doubt now has
    -- batch_subject_id). Academic Admin assigns the final owner later.
    v_notify_ids := public.doubt_eligible_teacher_ids(v_doubt_id);
    perform public.doubt_notify(
      v_institute, 'doubt_submitted'::public.notification_event_type,
      'New doubt: ' || left(p_title, 60),
      'A student submitted a doubt in ' || coalesce(
        (select s.name from public.subjects s where s.subject_id = p_subject_id),
        'your subject'
      ) || '.',
      v_notify_ids, 'student_doubt', v_doubt_id
    );
  else
    -- CASE C — ZERO assigned teachers → do NOT fall back to institute-wide
    -- specialization fan-out for new doubts. Notify approved Academic Admins +
    -- Super Admins of the institute (doubt_unassigned) so they can assign.
    select coalesce(array_agg(ar.profile_id), '{}'::uuid[]) into v_admin_ids
    from public.admin_roles ar
    where ar.institute_id = v_institute
      and ar.admin_role in ('academic_admin'::public.admin_role, 'super_admin'::public.admin_role)
      and ar.access_status = 'approved'::public.admin_access_status;

    perform public.doubt_notify(
      v_institute, 'doubt_unassigned'::public.notification_event_type,
      'Unassigned doubt requires teacher assignment',
      'A student submitted a doubt with no teacher assigned to the batch subject.',
      v_admin_ids, 'student_doubt', v_doubt_id
    );
  end if;

  -- ── Audit (same transaction; payload extended with routing context) ───────
  perform public.write_audit_log(
    'create'::public.audit_action_type, 'student_doubt', v_doubt_id,
    null,
    jsonb_build_object(
      'subject_id', p_subject_id, 'chapter_id', p_chapter_id,
      'topic_id', p_topic_id, 'batch_subject_id', v_batch_subject_id,
      'title', p_title, 'status', 'open',
      'assigned_to', v_assigned_teacher
    ),
    jsonb_build_object('context', 'submit_student_doubt', 'version', '118')
  );

  -- ── Return (shape UNCHANGED from 117) ──────────────────────────────────────
  return jsonb_build_object(
    'success', true, 'doubt_id', v_doubt_id, 'status', 'open'
  );
end;
$$;

-- Re-assert grants explicitly (CREATE OR REPLACE preserves grants, but this
-- keeps the intent documented and idempotent).
revoke execute on function public.submit_student_doubt(uuid, uuid, uuid, uuid, text, text, public.resource_category_type, uuid) from public, anon;
grant execute on function public.submit_student_doubt(uuid, uuid, uuid, uuid, text, text, public.resource_category_type, uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — RLS hardening: students are READ-ONLY on student_doubts
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 021 granted students "full access to their own doubts"
-- (for all ... with check student_id = get_my_student_id()). That policy
-- allowed a student to directly UPDATE routing/ownership fields (assigned_to,
-- assigned_at, status, resolved_by, ...) on their own rows — contradicting
-- the requirement that students must NEVER set assigned_to.
--
-- Fix: replace with a SELECT-only student policy. All student writes continue
-- exclusively through the SECURITY DEFINER RPCs (submit_student_doubt,
-- reply_to_doubt, accept_doubt_answer, resolve_doubt, reopen_doubt,
-- attach_doubt_file). Teacher + admin policies from migration 117 are
-- untouched (teacher: doubt_visible_to_me; admin: institute-scoped for all).
drop policy if exists "Students have full access to their own doubts"
  on public.student_doubts;

create policy "Students can read their own doubts"
  on public.student_doubts
  for select
  to authenticated
  using (student_id = public.get_my_student_id());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on function public.submit_student_doubt(uuid, uuid, uuid, uuid, text, text, public.resource_category_type, uuid) is
  'Student submits a doubt. Migration 118: the subject must resolve to an '
  'active batch_subject in the student''s active batches (explicit '
  'batch_subject_id validated; subject-only auto-resolves when unambiguous, '
  'rejected when 0 or >1 matches). Teacher routing uses the exact '
  'batch_subject: 1 teacher → auto-assign (doubt_assigned); >1 → NULL + '
  'doubt_submitted fan-out; 0 → Academic/Super Admin fallback '
  '(doubt_unassigned). Return shape unchanged from 117. SECURITY DEFINER; '
  'identity/institute derived from auth.uid().';

comment on column public.student_doubts.assigned_to is
  'FK to teacher_details. Set automatically by submit_student_doubt (118) when '
  'exactly one teacher is assigned to the doubt''s batch_subject, or by '
  'assign_doubt (admin). Students can never set this column directly (SELECT-'
  'only RLS). SET NULL on teacher removal.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 118 Doubt Routing + Academic Scope (Phase 7D-DB)
-- ════════════════════════════════════════════════════════════════════════════
