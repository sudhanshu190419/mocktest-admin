-- ============================================================================
-- Migration: 046 — Set Default Profile Role to 'user' in handle_new_user()
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Change the default profile role for new registrations from
--          'student' to 'user'. This is safe now because:
--
--   1. Migration 045 added 'user' to the user_role enum.
--   2. Migration 046 (this file) changes the trigger default.
--   3. The complete-course-purchase edge function already upgrades
--      'user' → 'student' upon successful course purchase.
--
-- Changes:
--   - Only the fallback default changes: 'student' → 'user'
--   - All other trigger logic is unchanged
--   - Explicit roles from raw_user_meta_data still take precedence
--   - Teacher signup still assigns 'teacher' explicitly via meta_data
--   - Existing profiles are never touched (ON CONFLICT DO NOTHING)
--
-- Dependencies:
--   - Migration 045 (user_role enum now includes 'user')
--   - Migration 027 (current handle_new_user definition)
--   - complete-course-purchase edge function (upgrades 'user' → 'student')
--
-- @module migrations/046
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Redefine handle_new_user() — default role changed from 'student' to 'user'
-- ════════════════════════════════════════════════════════════════════════════
-- Only one change: the COALESCE fallback on line 75 now reads
-- 'user'::public.user_role instead of 'student'::public.user_role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_institute_id uuid;
  v_role         public.user_role;
begin
  -- If institute_id is supplied, validate and use it.
  if nullif(new.raw_user_meta_data ->> 'institute_id', '') is not null then

    v_institute_id := (new.raw_user_meta_data ->> 'institute_id')::uuid;

    if not exists (
      select 1 from public.institutes
      where institute_id = v_institute_id
    ) then
      raise exception 'Institute % does not exist.', v_institute_id;
    end if;

  else
    -- Otherwise assign the default institute
    select institute_id
    into v_institute_id
    from public.institutes
    where is_default = true
    limit 1;

    if v_institute_id is null then
      raise exception 'No default institute configured. Please create one before allowing sign-ups.';
    end if;

  end if;

  -- Default role to user if not explicitly provided (changed from 'student' to 'user')
  v_role := coalesce(
    (new.raw_user_meta_data ->> 'role')::public.user_role,
    'user'::public.user_role
  );

  -- Debug log: inspect the exact phone value coming from auth.users
  raise log 'PHONE=%', new.phone;

  insert into public.profiles (
    profile_id,
    email,
    phone,
    name,
    role,
    institute_id,
    account_status                            -- account lifecycle status
  ) values (
    new.id,
    new.email,
    new.phone,  -- only new.phone — no coalesce, no fallback, no transformation
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      case
        when new.phone is not null then 'User ' || right(new.phone, 4)
        when new.email is not null then split_part(new.email, '@', 1)
        else null
      end,
      'New User'
    ),
    v_role,
    v_institute_id,
    case                                      -- compute status from role
      when v_role = 'teacher' then 'pending'::public.account_status
      else 'approved'::public.account_status
    end
  )
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Verification Queries (run manually to confirm the change)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Confirm the function body now defaults to 'user' (search for 'user'::):
--     select prosrc
--     from pg_proc
--     where proname = 'handle_new_user';

-- 2. After a new mobile registration, confirm role='user':
--     select profile_id, role, account_status, created_at
--     from public.profiles
--     order by created_at desc
--     limit 5;

-- 3. After a teacher signup (with role='teacher' in meta_data), confirm teacher:
--     select profile_id, role, account_status
--     from public.profiles
--     where role = 'teacher'
--     order by created_at desc
--     limit 5;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 046 Set Default Profile Role to 'user'
-- ════════════════════════════════════════════════════════════════════════════
