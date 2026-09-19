-- Migration 166: Enforce Student Doubt Lifecycle Permissions
--
-- TARGET BUSINESS RULES:
-- 1. Student creates doubt -> status = 'open'. Student can only VIEW (cannot follow up, resolve, or reopen).
-- 2. Teacher replies to 'open' -> status = 'in_progress'. Unlocks student follow-ups.
-- 3. In 'in_progress': Student can send follow-ups. Teacher can reply and resolve.
-- 4. In 'resolved': Student can view history only (cannot follow up, resolve, or reopen).
-- 5. Resolution is strictly controlled by Teachers and Admins.
-- 6. Reopen is restricted to Admins.
-- 7. Student accept_doubt_answer is rejected.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. reply_to_doubt
-- ─────────────────────────────────────────────────────────────────────────────
-- IF caller is a student: only allowed when status = 'in_progress'.
-- Rejects student replies when status is 'open', 'resolved', or 'archived'.
-- Preserves teacher/admin first-reply to 'open' (moving to 'in_progress').
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
    perform public.doubt_notify(
      v_institute, 'doubt_answered'::public.notification_event_type,
      'Your doubt has been answered',
      'A teacher responded to your doubt: "' || left(p_reply_text, 80) || '"',
      array[v_doubt.student_profile_id], 'student_doubt', p_doubt_id
    );
  else
    -- Student follow-up -> notify the assigned teacher (if any).
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. resolve_doubt
-- ─────────────────────────────────────────────────────────────────────────────
-- Restricts resolution to Teachers and Admins only. Students receive an exception.
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

  -- Only Teachers and Admins can resolve
  if not (public.is_teacher() or public.is_admin()) then
    raise exception 'Only teachers or admins can resolve doubts.';
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

  -- Notify the assigned teacher (acknowledgement)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. reopen_doubt
-- ─────────────────────────────────────────────────────────────────────────────
-- Restricts reopening to Admins only. Students receive an exception.
create or replace function public.reopen_doubt(p_doubt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doubt      record;
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

  -- Students cannot reopen doubts
  if not public.is_admin() then
    raise exception 'Students cannot reopen doubts.';
  end if;

  if v_doubt.status <> 'resolved'::public.doubt_status_type then
    raise exception 'Only resolved doubts can be reopened.';
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

  -- Notify the assigned teacher (doubt_reopened)
  if v_doubt.assigned_to is not null then
    perform public.doubt_notify(
      (select sd_stu.institute_id
         from public.student_doubts sd
         join public.student_details sd_stu on sd_stu.student_id = sd.student_id
        where sd.doubt_id = p_doubt_id),
      'doubt_reopened'::public.notification_event_type,
      'A doubt was reopened',
      'An administrator reopened a resolved doubt you were handling.',
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. accept_doubt_answer
-- ─────────────────────────────────────────────────────────────────────────────
-- Students can no longer accept answers to self-resolve doubts.
create or replace function public.accept_doubt_answer(
  p_doubt_id uuid,
  p_reply_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required.';
  end if;

  -- Only admins may use this function (students cannot self-resolve via accept answer)
  if not public.is_admin() then
    raise exception 'Students cannot accept answers to resolve doubts.';
  end if;

  if not public.doubt_visible_to_me(p_doubt_id) then
    raise exception 'You do not have access to this doubt.';
  end if;

  -- Clear previous accepted answer, then accept the chosen reply
  update public.doubt_replies
     set is_accepted_answer = false
   where doubt_id = p_doubt_id
     and is_accepted_answer = true;

  update public.doubt_replies
     set is_accepted_answer = true
   where reply_id = p_reply_id
     and doubt_id = p_doubt_id;

  perform public.write_audit_log(
    'approve'::public.audit_action_type, 'student_doubt', p_doubt_id,
    null,
    jsonb_build_object('accepted_reply_id', p_reply_id),
    jsonb_build_object('context', 'accept_doubt_answer')
  );

  return jsonb_build_object('success', true, 'status', 'resolved');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function public.reply_to_doubt(uuid, text, text) from public, anon;
grant execute on function public.reply_to_doubt(uuid, text, text) to authenticated, service_role;

revoke execute on function public.resolve_doubt(uuid) from public, anon;
grant execute on function public.resolve_doubt(uuid) to authenticated, service_role;

revoke execute on function public.reopen_doubt(uuid) from public, anon;
grant execute on function public.reopen_doubt(uuid) to authenticated, service_role;

revoke execute on function public.accept_doubt_answer(uuid, uuid) from public, anon;
grant execute on function public.accept_doubt_answer(uuid, uuid) to authenticated, service_role;
