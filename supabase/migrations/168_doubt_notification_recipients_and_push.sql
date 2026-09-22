-- ============================================================================
-- Migration: 168 - Student Doubt Notification Recipients and Routing
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Description:
--   1. Enhances resolve_doubt to notify the student who asked the doubt
--      in addition to assigned teacher acknowledgement.
--   2. Enhances reopen_doubt to notify the student whose doubt was reopened
--      in addition to the assigned teacher.
--   3. Enhances reply_to_doubt so that student follow-ups on doubts where
--      assigned_to is NULL fan out to eligible teachers via
--      doubt_eligible_teacher_ids() instead of failing silently.
--   4. Enhances submit_student_doubt to return recipient profile IDs
--      so callers can immediately dispatch FCM push notifications.
--   5. Preserves all existing lifecycle rules from Migration 166:
--      OPEN -> view only; IN_PROGRESS -> follow-up; RESOLVED -> view history.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. submit_student_doubt
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- ── Authorization ──────────────────────────────────────────────────────────
  if auth.role() <> 'authenticated' or public.get_my_student_id() is null then
    raise exception 'Only students can submit doubts.';
  end if;
  v_student   := public.get_my_student_id();
  v_institute := public.get_my_institute_id();

  -- ── Input validation ───────────────────────────────────────────────────────
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

  -- ── Insert doubt ───────────────────────────────────────────────────────────
  insert into public.student_doubts (
    student_id, subject_id, chapter_id, topic_id,
    batch_subject_id, title, description,
    related_resource_type, related_resource_id,
    status
  )
  values (
    v_student, p_subject_id, p_chapter_id, p_topic_id,
    v_batch_subject_id, p_title, p_description,
    p_related_resource_type, p_related_resource_id,
    'open'::public.doubt_status_type
  )
  returning doubt_id into v_doubt_id;

  -- ── Teacher routing ────────────────────────────────────────────────────────
  select count(*), coalesce(array_agg(bst.teacher_id), '{}'::uuid[])
    into v_teacher_count, v_teacher_ids
  from public.batch_subject_teachers bst
  where bst.batch_subject_id = v_batch_subject_id;

  if v_teacher_count = 1 then
    v_assigned_teacher := v_teacher_ids[1];

    update public.student_doubts
       set assigned_to = v_assigned_teacher,
           assigned_at = now()
     where doubt_id = v_doubt_id;

    select td.profile_id into v_teacher_profile
    from public.teacher_details td
    where td.teacher_id = v_assigned_teacher;

    if v_teacher_profile is not null then
      v_notify_ids := array[v_teacher_profile];
      perform public.doubt_notify(
        v_institute, 'doubt_assigned'::public.notification_event_type,
        'A doubt has been assigned to you',
        'A student submitted a doubt in your subject and it has been assigned to you.',
        v_notify_ids, 'student_doubt', v_doubt_id
      );
    end if;
  elsif v_teacher_count > 1 then
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
    select coalesce(array_agg(ar.profile_id), '{}'::uuid[]) into v_admin_ids
    from public.admin_roles ar
    where ar.institute_id = v_institute
      and ar.admin_role in ('academic_admin'::public.admin_role, 'super_admin'::public.admin_role)
      and ar.access_status = 'approved'::public.admin_access_status;

    v_notify_ids := v_admin_ids;
    perform public.doubt_notify(
      v_institute, 'doubt_unassigned'::public.notification_event_type,
      'Unassigned doubt requires teacher assignment',
      'A student submitted a doubt with no teacher assigned to the batch subject.',
      v_notify_ids, 'student_doubt', v_doubt_id
    );
  end if;

  -- ── Audit ──────────────────────────────────────────────────────────────────
  perform public.write_audit_log(
    'create'::public.audit_action_type, 'student_doubt', v_doubt_id,
    null,
    jsonb_build_object(
      'subject_id', p_subject_id, 'chapter_id', p_chapter_id,
      'topic_id', p_topic_id, 'batch_subject_id', v_batch_subject_id,
      'title', p_title, 'status', 'open',
      'assigned_to', v_assigned_teacher
    ),
    jsonb_build_object('context', 'submit_student_doubt', 'version', '168')
  );

  return jsonb_build_object(
    'success', true,
    'doubt_id', v_doubt_id,
    'status', 'open',
    'institute_id', v_institute,
    'assigned_to', v_assigned_teacher,
    'recipient_profile_ids', coalesce(v_notify_ids, '{}'::uuid[])
  );
end;
$$;

revoke execute on function public.submit_student_doubt(uuid, uuid, uuid, uuid, text, text, public.resource_category_type, uuid) from public, anon;
grant execute on function public.submit_student_doubt(uuid, uuid, uuid, uuid, text, text, public.resource_category_type, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. reply_to_doubt
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_doubt                    record;
  v_reply_id                 uuid;
  v_is_teacher               boolean := false;
  v_student_id               uuid;
  v_assigned_teacher_profile uuid;
  v_institute                uuid;
  v_notify_ids               uuid[] := '{}'::uuid[];
begin
  -- ── Authorization ──────────────────────────────────────────────────────────
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

  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;

  v_institute  := v_doubt.institute_id;
  v_student_id := v_doubt.student_id;

  if v_doubt.status = 'archived'::public.doubt_status_type then
    raise exception 'This doubt is archived and can no longer be modified.';
  end if;

  -- Teacher/Admin role check
  v_is_teacher := exists (
    select 1 from public.profiles p
    where p.profile_id = auth.uid()
      and p.role in ('teacher'::public.user_role, 'admin'::public.user_role)
  );

  -- Student status checks: student can ONLY reply when doubt is in_progress
  if not v_is_teacher then
    if v_doubt.status = 'open'::public.doubt_status_type then
      raise exception 'Students can only reply after a teacher has responded.';
    elsif v_doubt.status = 'resolved'::public.doubt_status_type then
      raise exception 'Cannot reply to a resolved doubt.';
    elsif v_doubt.status <> 'in_progress'::public.doubt_status_type then
      raise exception 'Students can only reply when the doubt is in progress.';
    end if;
  end if;

  -- ── Insert reply ───────────────────────────────────────────────────────────
  insert into public.doubt_replies (
    doubt_id, author_profile_id, reply_text, image_url
  )
  values (p_doubt_id, auth.uid(), p_reply_text, p_image_url)
  returning reply_id into v_reply_id;

  -- ── Status transition (teacher/admin answer on open doubt) ──────────────────
  if v_is_teacher and v_doubt.status = 'open'::public.doubt_status_type then
    update public.student_doubts
       set status = 'in_progress'::public.doubt_status_type
     where doubt_id = p_doubt_id
       and status = 'open'::public.doubt_status_type;
  end if;

  -- ── Audit ──────────────────────────────────────────────────────────────────
  perform public.write_audit_log(
    'update'::public.audit_action_type, 'student_doubt', p_doubt_id,
    jsonb_build_object('status', v_doubt.status),
    jsonb_build_object(
      'action', case when v_is_teacher then 'answered' else 'follow_up' end,
      'reply_id', v_reply_id
    ),
    jsonb_build_object('context', 'reply_to_doubt')
  );

  -- ── Notifications ──────────────────────────────────────────────────────────
  if v_is_teacher then
    -- Teacher answered -> notify the student.
    if v_doubt.student_profile_id is not null then
      v_notify_ids := array[v_doubt.student_profile_id];
      perform public.doubt_notify(
        v_institute, 'doubt_answered'::public.notification_event_type,
        'Your doubt has been answered',
        'A teacher responded to your doubt: "' || left(p_reply_text, 80) || '"',
        v_notify_ids, 'student_doubt', p_doubt_id
      );
    end if;
  else
    -- Student follow-up:
    -- If assigned_to exists, notify that specific teacher.
    -- If assigned_to is NULL, fall back to doubt_eligible_teacher_ids() for the batch subject.
    if v_doubt.assigned_to is not null then
      select tp.profile_id into v_assigned_teacher_profile
      from public.teacher_details td
      join public.profiles tp on tp.profile_id = td.profile_id
      where td.teacher_id = v_doubt.assigned_to;

      if v_assigned_teacher_profile is not null then
        v_notify_ids := array[v_assigned_teacher_profile];
        perform public.doubt_notify(
          v_institute, 'doubt_follow_up'::public.notification_event_type,
          'Student follow-up on a doubt',
          'The student replied to a doubt you are handling.',
          v_notify_ids, 'student_doubt', p_doubt_id
        );
      end if;
    else
      v_notify_ids := public.doubt_eligible_teacher_ids(p_doubt_id);
      if array_length(v_notify_ids, 1) > 0 then
        perform public.doubt_notify(
          v_institute, 'doubt_follow_up'::public.notification_event_type,
          'Student follow-up on a doubt',
          'The student replied to a doubt in your subject.',
          v_notify_ids, 'student_doubt', p_doubt_id
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'reply_id', v_reply_id,
    'doubt_id', p_doubt_id,
    'institute_id', v_institute,
    'is_teacher', v_is_teacher,
    'recipient_profile_ids', coalesce(v_notify_ids, '{}'::uuid[])
  );
end;
$$;

revoke execute on function public.reply_to_doubt(uuid, text, text) from public, anon;
grant execute on function public.reply_to_doubt(uuid, text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. resolve_doubt
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.resolve_doubt(p_doubt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt             record;
  v_updated           integer;
  v_teacher_notify    uuid[] := '{}'::uuid[];
  v_student_profile   uuid;
  v_institute         uuid;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;
  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;

  -- Only Teachers and Admins can resolve
  if not (public.is_teacher() or public.is_admin()) then
    raise exception 'Only teachers or admins can resolve doubts.';
  end if;

  select sd.*, sd_stu.profile_id as student_profile_id, sd_stu.institute_id
    into v_doubt
  from public.student_doubts sd
  join public.student_details sd_stu on sd_stu.student_id = sd.student_id
  where sd.doubt_id = p_doubt_id;

  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;
  if v_doubt.status = 'archived'::public.doubt_status_type then
    raise exception 'This doubt is archived and can no longer be modified.';
  end if;
  if v_doubt.status = 'resolved'::public.doubt_status_type then
    return jsonb_build_object('success', true, 'status', 'resolved');
  end if;

  v_student_profile := v_doubt.student_profile_id;
  v_institute       := v_doubt.institute_id;

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

  -- ── 1. Notify the STUDENT who asked the doubt ──────────────────────────────
  if v_student_profile is not null then
    perform public.doubt_notify(
      v_institute,
      'doubt_resolved'::public.notification_event_type,
      'Your doubt has been resolved',
      'A teacher or administrator has resolved your doubt.',
      array[v_student_profile],
      'student_doubt',
      p_doubt_id
    );
  end if;

  -- ── 2. Notify the assigned teacher (acknowledgement) ───────────────────────
  if v_doubt.assigned_to is not null then
    select coalesce(array_agg(tp.profile_id), '{}') into v_teacher_notify
    from public.teacher_details td
    join public.profiles tp on tp.profile_id = td.profile_id
    where td.teacher_id = v_doubt.assigned_to;

    if array_length(v_teacher_notify, 1) > 0 then
      perform public.doubt_notify(
        v_institute,
        'doubt_resolved'::public.notification_event_type,
        'Doubt resolved',
        'The doubt you were handling has been resolved.',
        v_teacher_notify,
        'student_doubt',
        p_doubt_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 'resolved',
    'doubt_id', p_doubt_id,
    'institute_id', v_institute,
    'student_profile_id', v_student_profile,
    'teacher_profile_ids', coalesce(v_teacher_notify, '{}'::uuid[])
  );
end;
$$;

revoke execute on function public.resolve_doubt(uuid) from public, anon;
grant execute on function public.resolve_doubt(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. reopen_doubt
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reopen_doubt(p_doubt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt           record;
  v_updated         integer;
  v_student_profile uuid;
  v_institute       uuid;
  v_teacher_notify  uuid[] := '{}'::uuid[];
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;

  select sd.*, sd_stu.profile_id as student_profile_id, sd_stu.institute_id
    into v_doubt
  from public.student_doubts sd
  join public.student_details sd_stu on sd_stu.student_id = sd.student_id
  where sd.doubt_id = p_doubt_id;

  if v_doubt.doubt_id is null then
    raise exception 'Doubt not found.';
  end if;
  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;

  -- Students cannot reopen doubts
  if not public.is_admin() then
    raise exception 'Students cannot reopen doubts.';
  end if;

  if v_doubt.status <> 'resolved'::public.doubt_status_type then
    raise exception 'Only resolved doubts can be reopened.';
  end if;

  v_student_profile := v_doubt.student_profile_id;
  v_institute       := v_doubt.institute_id;

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

  -- ── 1. Notify the STUDENT whose doubt was reopened ─────────────────────────
  if v_student_profile is not null then
    perform public.doubt_notify(
      v_institute,
      'doubt_reopened'::public.notification_event_type,
      'Your doubt was reopened',
      'An administrator reopened your resolved doubt.',
      array[v_student_profile],
      'student_doubt',
      p_doubt_id
    );
  end if;

  -- ── 2. Notify the assigned teacher ─────────────────────────────────────────
  if v_doubt.assigned_to is not null then
    select coalesce(array_agg(tp.profile_id), '{}') into v_teacher_notify
    from public.teacher_details td
    join public.profiles tp on tp.profile_id = td.profile_id
    where td.teacher_id = v_doubt.assigned_to;

    if array_length(v_teacher_notify, 1) > 0 then
      perform public.doubt_notify(
        v_institute,
        'doubt_reopened'::public.notification_event_type,
        'A doubt was reopened',
        'An administrator reopened a resolved doubt you were handling.',
        v_teacher_notify,
        'student_doubt',
        p_doubt_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 'open',
    'doubt_id', p_doubt_id,
    'institute_id', v_institute,
    'student_profile_id', v_student_profile,
    'teacher_profile_ids', coalesce(v_teacher_notify, '{}'::uuid[])
  );
end;
$$;

revoke execute on function public.reopen_doubt(uuid) from public, anon;
grant execute on function public.reopen_doubt(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. assign_doubt
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_doubt            record;
  v_institute        uuid;
  v_old_assigned     uuid;
  v_teacher_profile  uuid;
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
    'success', true,
    'doubt_id', p_doubt_id,
    'assigned_to', p_teacher_id,
    'reassigned', v_old_assigned is not null,
    'institute_id', v_institute,
    'teacher_profile_id', v_teacher_profile
  );
end;
$$;

revoke execute on function public.assign_doubt(uuid, uuid) from public, anon;
grant execute on function public.assign_doubt(uuid, uuid) to authenticated, service_role;

