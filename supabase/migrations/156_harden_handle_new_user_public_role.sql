-- ============================================================================
-- Migration: 156 — Harden handle_new_user() Against Client Role Escalation
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose:
--   1. Harden public account creation so that standard Auth signups ALWAYS
--      receive role = 'user' and account_status = 'approved'.
--   2. Completely ignore client-supplied `new.raw_user_meta_data ->> 'role'`
--      to prevent privilege escalation (e.g. self-assigning 'teacher' or 'admin').
--   3. Teacher accounts are exclusively created by Super Admin via the
--      `teacher-identity-create` Edge Function using the Service Role.
--
-- Changes:
--   - `v_role` is hardcoded to 'user'::public.user_role.
--   - `account_status` is hardcoded to 'approved'::public.account_status.
--   - Institute resolution, phone checks, name fallback chain, and
--     ON CONFLICT DO NOTHING idempotency are preserved.
--
-- Dependencies:
--   - Migration 045 (user_role enum includes 'user')
--   - Migration 026 / 027 (account_status enum includes 'approved')
-- ============================================================================

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
  -- 1. Institute resolution
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

  -- 2. Fixed safe role for public signups: always 'user'
  -- Explicitly ignores `raw_user_meta_data ->> 'role'` to prevent client role escalation.
  -- Privileged accounts (teacher, admin) are created exclusively via Service-Role Edge Functions.
  v_role := 'user'::public.user_role;

  -- Debug log: inspect phone value coming from auth.users
  raise log 'PHONE=%', new.phone;

  -- 3. Insert profile row
  insert into public.profiles (
    profile_id,
    email,
    phone,
    name,
    role,
    institute_id,
    account_status
  ) values (
    new.id,
    new.email,
    new.phone,
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
    'approved'::public.account_status
  )
  on conflict (profile_id) do nothing;

  return new;
end;
$$;
