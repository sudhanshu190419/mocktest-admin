-- ============================================================================
-- Migration: 027 — Update handle_new_user() to initialise account_status
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Redefine the `handle_new_user()` trigger function so that new
--          profile rows receive the correct `account_status` based on role.
--
--   Role       → account_status
--   --------------------------------
--   teacher    → 'pending'
--   admin      → 'approved'
--   student    → 'approved'
--
-- Without this change, every new profile gets 'approved' from the column's
-- DEFAULT, even teachers who should start in a pending state awaiting admin
-- approval.
--
-- Changes:
--   1. Add `account_status` to the INSERT column list
--   2. Use a CASE expression to compute the value from v_role
--
-- Everything else about the function is unchanged — institute resolution,
-- phone/email handling, name fallback chain, and idempotency via
-- ON CONFLICT DO NOTHING.
--
-- Dependencies:
--   - Migration 026 (account_status enum + column) must be applied first
--   - Migration 024 (current handle_new_user definition) must be applied
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Redefine handle_new_user() trigger function
-- ════════════════════════════════════════════════════════════════════════════
-- Only one change: the INSERT now includes `account_status` with a CASE
-- expression.

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

  -- Default role to student if not explicitly provided
  v_role := coalesce(
    (new.raw_user_meta_data ->> 'role')::public.user_role,
    'student'::public.user_role
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
    account_status                            -- NEW: account lifecycle status
  ) values (
    new.id,
    new.email,
    new.phone,  -- ONLY new.phone — no coalesce, no fallback, no transformation
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
    case                                      -- NEW: compute status from role
      when v_role = 'teacher' then 'pending'::public.account_status
      else 'approved'::public.account_status
    end
  )
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Verification Queries
-- ════════════════════════════════════════════════════════════════════════════
-- Run these after applying the migration to confirm the function is correct.

-- 2a. Confirm the function body contains account_status logic:
--     select proname, prosrc
--     from pg_proc
--     where proname = 'handle_new_user';

-- 2b. After a new teacher registration, confirm pending is set:
--     select profile_id, name, role, account_status
--     from public.profiles
--     where account_status = 'pending';

-- 2c. After a new student or admin registration, confirm approved is set:
--     select profile_id, name, role, account_status
--     from public.profiles
--     where role in ('student', 'admin') and account_status = 'approved';
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 027 Update handle_new_user() to initialise account_status
-- ════════════════════════════════════════════════════════════════════════════
