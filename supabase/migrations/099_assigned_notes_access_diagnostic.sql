-- ============================================================================
-- Migration 099 — DIAGNOSTIC ONLY: Assigned Notes Access Tracer
--
-- PURPOSE
--   Adds a diagnostic-only RPC that reports, for a given content item
--   (and/or batch_subject), exactly which entitlement layer would deny a
--   student access. This exists to root-cause the reported bug:
--
--     "Purchased-course (permanent owner) students can open the course but
--      cannot open assigned notes ('Subscription required. Your content
--      access period has ended.')"
--
--   It reuses the EXISTING entitlement helpers verbatim
--   (is_permanent_course_owner · can_student_access_content ·
--    can_student_access_content_batch_subject) so the numbers it prints are
--   the exact values the RLS policies and client gates compute. NO business
--   logic is changed anywhere.
--
-- USAGE (called with the student's own JWT — SECURITY DEFINER so the
--        existence/linkage checks bypass RLS, exactly like the helpers):
--
--   select public.diag_assigned_notes_access(
--     p_batch_subject_id => '<batch_subject_uuid>',  -- optional
--     p_content_id       => '<content_uuid>',        -- optional
--     p_course_id        => '<course_uuid>'          -- optional override
--   );
--
-- OUTPUT (jsonb)
--   auth_uid / role / student_id / profile_id / institute_id
--   content_exists / content_status / content_type
--   batch_subject_ids / course_ids / selected_course_id
--   per_course:            [ { course_id, course_enrollment_exists,
--                              is_permanent_course_owner,
--                              can_student_access_content } ]
--   per_batch_subject:     [ { batch_subject_id, batch_id, subject_id,
--                              batch_subject_content_linked,
--                              batch_student_assignment, course_ids,
--                              can_student_access_content_batch_subject,
--                              rls_batch_subject_contents_would_pass } ]
--   student_subscriptions / course_enrollments / batch_students / course_batches
--   today
--
-- TO REMOVE
--   This function is diagnostic-only. Drop it after the investigation:
--   drop function if exists public.diag_assigned_notes_access(uuid, uuid, uuid);
-- ============================================================================

create or replace function public.diag_assigned_notes_access(
  p_batch_subject_id  uuid  default null,
  p_content_id        uuid  default null,
  p_course_id         uuid  default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_uid            uuid := auth.uid();
  v_role           text;
  v_student_id     uuid;
  v_profile_id     uuid;
  v_institute_id   uuid;
  v_bs_ids         uuid[];
  v_course_ids     uuid[];
  v_sel_course_id  uuid;
  v_content_exists boolean;
  v_content_status text;
  v_content_type   text;
begin
  -- ── 1. Identity (authoritative — from the session + profiles) ─────────
  select p.role into v_role
  from public.profiles p
  where p.profile_id = v_uid;

  select sd.student_id, sd.profile_id, sd.institute_id
    into v_student_id, v_profile_id, v_institute_id
  from public.student_details sd
  where sd.profile_id = v_uid;

  -- ── 2. Content existence (bypasses RLS — SECURITY DEFINER) ────────────
  select exists(select 1 from public.content c where c.content_id = p_content_id)
    into v_content_exists;

  select c.status, c.content_type::text
    into v_content_status, v_content_type
  from public.content c
  where c.content_id = p_content_id;

  -- ── 3. Resolve batch_subject_ids (explicit param ∪ content linkage) ───
  with bs_src as (
    select bsc.batch_subject_id
    from public.batch_subject_contents bsc
    where bsc.content_id = p_content_id
    union
    select p_batch_subject_id
    where p_batch_subject_id is not null
  )
  select coalesce(array_agg(distinct batch_subject_id), '{}'::uuid[])
    into v_bs_ids
  from bs_src;

  -- ── 4. Resolve course_ids (batch_subject→batch→course ∪ course_content) ──
  with c_src as (
    select cb.course_id
    from public.batch_subjects bs
    join public.course_batches cb on cb.batch_id = bs.batch_id
    where bs.batch_subject_id = any(v_bs_ids)
    union
    select cc.course_id
    from public.course_content cc
    where cc.content_id = p_content_id
  )
  select coalesce(array_agg(distinct course_id), '{}'::uuid[])
    into v_course_ids
  from c_src;

  -- ── 5. Choose the course the helpers are evaluated against ────────────
  if p_course_id is not null then
    v_sel_course_id := p_course_id;
  elsif cardinality(v_course_ids) > 0 then
    v_sel_course_id := v_course_ids[1];
  end if;

  -- ── 6. Build the report ───────────────────────────────────────────────
  return jsonb_build_object(
    'auth_uid',          v_uid,
    'role',              v_role,
    'student_id',        v_student_id,
    'profile_id',        v_profile_id,
    'institute_id',      v_institute_id,
    'content_id',        p_content_id,
    'content_exists',    v_content_exists,
    'content_status',    v_content_status,
    'content_type',      v_content_type,
    'today',             current_date::text,
    'batch_subject_ids', to_jsonb(v_bs_ids),
    'course_ids',        to_jsonb(v_course_ids),
    'selected_course_id', v_sel_course_id,
    'per_course', (
      select coalesce(jsonb_agg(x order by x->>'course_id'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'course_id',                c.course_id,
          'course_enrollment_exists', exists(
                                        select 1 from public.course_enrollments ce
                                        where ce.course_id = c.course_id
                                          and ce.student_id = v_student_id
                                      ),
          'is_permanent_course_owner',  public.is_permanent_course_owner(c.course_id),
          'can_student_access_content', public.can_student_access_content(c.course_id)
        ) as x
        from unnest(v_course_ids) as c(course_id)
      ) s
    ),
    'per_batch_subject', (
      select coalesce(jsonb_agg(x order by x->>'batch_subject_id'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'batch_subject_id',      bs.batch_subject_id,
          'batch_id',              bs.batch_id,
          'subject_id',            bs.subject_id,
          'institute_id',          bs.institute_id,
          'batch_subject_content_linked', exists(
                                            select 1 from public.batch_subject_contents bsc
                                            where bsc.batch_subject_id = bs.batch_subject_id
                                              and bsc.content_id = p_content_id
                                          ),
          'batch_subject_is_active', bs.is_active,
          'batch_student_assignment', bs.batch_id = any (public.get_student_batch_ids()),
          'course_ids', (
            select coalesce(jsonb_agg(cb.course_id), '[]'::jsonb)
            from public.course_batches cb
            where cb.batch_id = bs.batch_id
          ),
          'can_student_access_content_batch_subject',
                                   public.can_student_access_content_batch_subject(bs.batch_subject_id),
          'rls_batch_subject_contents_would_pass',
                                   public.can_student_access_content_batch_subject(bs.batch_subject_id)
        ) as x
        from public.batch_subjects bs
        where bs.batch_subject_id = any(v_bs_ids)
      ) s
    ),
    'student_subscriptions', (
      select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'subscription_id',         ss.subscription_id,
          'status',                  ss.status::text,
          'course_id',               ss.course_id,
          'start_date',              ss.start_date::text,
          'end_date',                ss.end_date::text,
          'grace_end_date',          ss.grace_end_date::text,
          'content_access_end_date', ss.content_access_end_date::text,
          'is_trial',                ss.is_trial,
          'created_at',              ss.created_at::text
        ) as x
        from public.student_subscriptions ss
        where ss.student_id = v_student_id
        order by ss.created_at desc
      ) s
    ),
    'course_enrollments', (
      select coalesce(jsonb_agg(x order by x->>'enrolled_at'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'course_id',       ce.course_id,
          'enrollment_type', ce.enrollment_type,
          'enrolled_at',     ce.enrolled_at::text,
          'is_active',       ce.is_active,
          'expires_at',      ce.expires_at::text,
          'revoked_at',      ce.revoked_at::text
        ) as x
        from public.course_enrollments ce
        where ce.student_id = v_student_id
        order by ce.enrolled_at desc
      ) s
    ),
    'batch_students', (
      select coalesce(jsonb_agg(x order by x->>'batch_id'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'batch_id',    bst.batch_id,
          'status',      bst.status,
          'enrolled_on', bst.enrolled_on::text
        ) as x
        from public.batch_students bst
        where bst.student_id = v_student_id
      ) s
    ),
    'course_batches', (
      select coalesce(jsonb_agg(x order by x->>'course_id'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'course_id', cb.course_id,
          'batch_id',  cb.batch_id
        ) as x
        from public.course_batches cb
        where cb.batch_id in (
          select bs.batch_id
          from public.batch_subjects bs
          where bs.batch_subject_id = any(v_bs_ids)
        )
      ) s
    )
  );
end;
$$;

comment on function public.diag_assigned_notes_access(uuid, uuid, uuid) is
  'DIAGNOSTIC ONLY — reports entitlement-helper results + row evidence for an assigned-notes access denial. No business logic. Drop after investigation.';

-- Diagnostic-only: restrict to authenticated callers (anon must not probe
-- content/batch linkage metadata).
revoke all on function public.diag_assigned_notes_access(uuid, uuid, uuid) from public;
grant execute on function public.diag_assigned_notes_access(uuid, uuid, uuid) to authenticated;
