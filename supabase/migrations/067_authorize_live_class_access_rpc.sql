-- ============================================================================
-- Migration: 067 — Authorize Live Class Access & Secure Live Chat RPCs
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds:
--   1. public.authorize_live_class_access(p_user_id uuid, p_class_id uuid, p_room_name text)
--      SECURITY DEFINER RPC function that verifies whether an authenticated user
--      (Teacher, Admin, or Student) is authorized to access the given live class / LiveKit room.
--   2. Updates public.get_or_create_conversation(p_class_id uuid) to ensure
--      students are verified as enrolled in an assigned batch for p_class_id.
--
-- Architecture:
--   • SECURITY DEFINER runs as database owner, safely resolving multi-table joins
--     across profiles, teacher_details, student_details, batches, batch_students,
--     live_classes, live_class_batch, and batch_subject_live_classes.
--   • Protects against cross-institute, cross-batch, wrong-teacher, and role-escalation attacks.
--   • Supports backward compatibility by resolving via p_class_id or fallback p_room_name.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — authorize_live_class_access RPC Function
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.authorize_live_class_access(
  p_user_id uuid,
  p_class_id uuid default null,
  p_room_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_role         text;
  v_user_institute_id uuid;
  v_teacher_id        uuid;
  v_student_id        uuid;
  v_class_row         record;
  v_is_enrolled       boolean := false;
  v_is_authorized     boolean := false;
  v_can_publish       boolean := false;
  v_role              text;
  v_reason            text := 'Authorized';
begin
  -- 1. Validate user identifier
  if p_user_id is null then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Unauthorized: missing user identifier',
      'code', 'UNAUTHENTICATED'
    );
  end if;

  -- 2. Fetch user profile
  select p.role, p.institute_id
    into v_user_role, v_user_institute_id
    from public.profiles p
   where p.profile_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Profile not found for authenticated user',
      'code', 'USER_NOT_FOUND'
    );
  end if;

  -- 3. Resolve the target live_classes record
  if p_class_id is not null then
    select lc.class_id, lc.institute_id, lc.teacher_id, lc.room_name, lc.status, lc.title, lc.scheduled_at, lc.duration_min
      into v_class_row
      from public.live_classes lc
     where lc.class_id = p_class_id;
  elsif p_room_name is not null and trim(p_room_name) != '' then
    select lc.class_id, lc.institute_id, lc.teacher_id, lc.room_name, lc.status, lc.title, lc.scheduled_at, lc.duration_min
      into v_class_row
      from public.live_classes lc
     where lc.room_name = trim(p_room_name);
  else
    return jsonb_build_object(
      'authorized', false,
      'error', 'Missing classId or roomName',
      'code', 'INVALID_PARAMETERS'
    );
  end if;

  if v_class_row.class_id is null then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Live class not found',
      'code', 'CLASS_NOT_FOUND'
    );
  end if;

  -- 4. Enforce strict cross-institute isolation
  if v_class_row.institute_id is not null and v_user_institute_id is not null and v_class_row.institute_id != v_user_institute_id then
    return jsonb_build_object(
      'authorized', false,
      'error', 'Cross-institute access denied',
      'code', 'CROSS_INSTITUTE_DENIED'
    );
  end if;

  -- 5. Lifecycle status check (cannot join cancelled classes)
  if v_class_row.status = 'cancelled' then
    return jsonb_build_object(
      'authorized', false,
      'error', 'This live class has been cancelled.',
      'code', 'CLASS_CANCELLED'
    );
  end if;

  -- 6. Role-based authorization & permission granting
  if v_user_role in ('teacher', 'faculty') then
    -- Resolve teacher_id
    select td.teacher_id into v_teacher_id
      from public.teacher_details td
     where td.profile_id = p_user_id;

    if v_teacher_id is not null and v_class_row.teacher_id = v_teacher_id then
      v_is_authorized := true;
      v_can_publish := true;
      v_role := 'teacher';
    else
      return jsonb_build_object(
        'authorized', false,
        'error', 'Teacher is not assigned to conduct this class.',
        'code', 'TEACHER_NOT_ASSIGNED'
      );
    end if;

  elsif v_user_role in ('admin', 'super_admin') then
    -- Admins in the same institute have full publisher / moderator access
    v_is_authorized := true;
    v_can_publish := true;
    v_role := 'admin';

  else
    -- Student role (or default learner)
    select sd.student_id into v_student_id
      from public.student_details sd
     where sd.profile_id = p_user_id;

    if v_student_id is null then
      return jsonb_build_object(
        'authorized', false,
        'error', 'Student details not found.',
        'code', 'STUDENT_NOT_FOUND'
      );
    end if;

    -- Check if student belongs to any batch assigned to this class
    select exists (
      select 1
        from public.batch_students bs
       where bs.student_id = v_student_id
         and bs.status = 'active'
         and (
           -- Path A: Direct batch mapping via live_class_batch
           exists (
             select 1
               from public.live_class_batch lcb
              where lcb.class_id = v_class_row.class_id
                and lcb.batch_id = bs.batch_id
           )
           or
           -- Path B: Subject batch mapping via batch_subjects -> batch_subject_live_classes
           exists (
             select 1
               from public.batch_subjects bsub
               join public.batch_subject_live_classes bslc on bslc.batch_subject_id = bsub.batch_subject_id
              where bslc.class_id = v_class_row.class_id
                and bsub.batch_id = bs.batch_id
           )
         )
    ) into v_is_enrolled;

    if v_is_enrolled then
      v_is_authorized := true;
      v_can_publish := false;
      v_role := 'student';
    else
      return jsonb_build_object(
        'authorized', false,
        'error', 'Student is not enrolled in any batch assigned to this class.',
        'code', 'BATCH_NOT_ENROLLED'
      );
    end if;
  end if;

  -- 7. Return verified authorization grant
  return jsonb_build_object(
    'authorized', true,
    'classId', v_class_row.class_id,
    'roomName', coalesce(v_class_row.room_name, 'room-' || v_class_row.class_id::text),
    'role', v_role,
    'canPublish', v_can_publish,
    'title', v_class_row.title,
    'status', v_class_row.status,
    'reason', v_reason
  );
end;
$$;

comment on function public.authorize_live_class_access is
  'SECURITY DEFINER RPC that validates student/teacher/admin authorization for a live class. '
  'Resolves authoritative room_name and publisher permissions server-side. Protects against '
  'IDOR, cross-batch, cross-institute, and role escalation attacks.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Update get_or_create_conversation RPC
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_or_create_conversation(p_class_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id  uuid;
  v_teacher_id  uuid;
  v_is_enrolled boolean := false;
  v_result      public.conversations;
begin
  -- 1. Resolve the calling user's student_id from student_details
  select sd.student_id into v_student_id
    from public.student_details sd
   where sd.profile_id = auth.uid();

  if not found then
    raise exception 'Only students can create conversations. No student_details record found for the current user.'
      using hint = 'Ensure the user has a student_details row linked to their profile.';
  end if;

  -- 2. Resolve the teacher_id for this live class
  select lc.teacher_id into v_teacher_id
    from public.live_classes lc
   where lc.class_id = p_class_id;

  if not found then
    raise exception 'Live class not found.'
      using hint = 'The provided class_id does not exist in live_classes.';
  end if;

  -- 3. Verify student is actually enrolled in an assigned batch for this class
  select exists (
    select 1
      from public.batch_students bs
     where bs.student_id = v_student_id
       and bs.status = 'active'
       and (
         exists (
           select 1
             from public.live_class_batch lcb
            where lcb.class_id = p_class_id
              and lcb.batch_id = bs.batch_id
         )
         or
         exists (
           select 1
             from public.batch_subjects bsub
             join public.batch_subject_live_classes bslc on bslc.batch_subject_id = bsub.batch_subject_id
            where bslc.class_id = p_class_id
              and bsub.batch_id = bs.batch_id
         )
       )
  ) into v_is_enrolled;

  if not v_is_enrolled then
    raise exception 'Unauthorized: Student is not enrolled in a batch assigned to this live class.'
      using hint = 'Check batch enrollment for this student.';
  end if;

  -- 4. Upsert — insert if not exists, do nothing on conflict
  insert into public.conversations (class_id, teacher_id, student_id)
  values (p_class_id, v_teacher_id, v_student_id)
  on conflict on constraint uq_conversations_class_student
    do nothing;

  -- 5. Return the conversation (either newly created or pre-existing)
  select * into v_result
    from public.conversations
   where class_id = p_class_id
     and student_id = v_student_id;

  return v_result;
end;
$$;

comment on function public.get_or_create_conversation is
  'SECURITY DEFINER RPC — resolves student -> teacher with batch enrollment verification, '
  'then upserts conversation row. Only authorized enrolled students can create a chat conversation.';
