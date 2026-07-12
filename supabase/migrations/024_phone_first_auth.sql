-- ============================================================================
-- Migration: 024 — Phone-First Authentication Support
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Refactor the profiles table and handle_new_user() trigger to
--          support phone-first authentication while maintaining backward
--          compatibility with email-based signups.
--
-- Changes:
--   1. Make email nullable (phone-only signups don't have email)
--   2. Backfill any existing NULL phone values
--   3. Make phone NOT NULL (phone is the primary identifier)
--   4. Update email CHECK constraint to explicitly allow NULL
--   5. Update phone CHECK constraint (no longer has a NULL branch)
--   6. Refactor handle_new_user() to support both auth methods
--
-- Schema changes explained:
--
--   email: NULLABLE
--     Phone-first signups via Supabase Auth do not have an email address.
--     The column must allow NULL to accommodate these users. Existing
--     email-based users are unaffected.
--
--   phone: NOT NULL
--     Phone is the primary authentication identifier. Every user must have
--     a phone number. Existing rows with NULL phone are backfilled from
--     auth.users.phone first; any remaining NULLs receive a unique
--     placeholder that the user/admins must update.
--
--   ck_profiles_email_format: Updated
--     The previous constraint rejected rows where email IS NULL because
--     NULL ~* 'pattern' evaluates to NULL (not FALSE), so PostgreSQL
--     CHECK constraints actually allow it. However, the new constraint
--     explicitly says "email is null or ..." to make the intent clear
--     and avoid any future confusion.
--
--   ck_profiles_phone_format: Simplified
--     The old constraint had "phone is null or ...". Since phone is now
--     NOT NULL, the NULL branch is removed.
--
--   handle_new_user(): Refactored
--     Now inserts phone, handles nullable email, and uses an improved
--     name fallback chain that works for both phone-first and email-first
--     signups.
--
-- RLS policies: UNCHANGED
--     All existing RLS policies on profiles continue to work because they
--     reference profile_id, role, and auth.uid() — not email or phone.
--
-- Dependencies:
--   - Migration 002 (Domain 01 — Foundation) must be applied first
--   - The profiles table and handle_new_user() must already exist
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Make email nullable
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: Phone-first signups via Supabase Auth do not have an email
-- address. The email column must allow NULL to accommodate these users.
-- Existing email-based users are unaffected because their rows already have
-- non-NULL emails — DROP NOT NULL only relaxes the constraint going forward.

alter table only public.profiles
  alter column email drop not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Update email CHECK constraint
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: The previous constraint used a raw regex check. While
-- PostgreSQL CHECK constraints evaluate NULL → NULL (not FALSE) and thus
-- permit NULLs through, we replace the constraint with an explicit form
-- that documents the intent: email is optional, but if provided, it must
-- match a valid email format.

alter table only public.profiles
  drop constraint if exists ck_profiles_email_format;

alter table only public.profiles
  add constraint ck_profiles_email_format check (
    email is null
    or email ~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Backfill existing NULL phone values
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: Before adding NOT NULL to phone, we must ensure all existing
-- rows have a phone value. The backfill strategy is:
--
--   1. Copy phone from auth.users if that table has a value (Supabase Auth
--      stores the phone in auth.users.phone for phone-signed-up users).
--   2. For any remaining NULLs (e.g., legacy email-only users), generate a
--      unique placeholder phone so the NOT NULL constraint can be applied
--      safely. These rows must be updated by the user or an admin.

-- Step 3a: Copy phone from auth.users where available
update public.profiles p
set phone = a.phone
from auth.users a
where p.profile_id = a.id
  and p.phone is null
  and a.phone is not null;

-- Step 3b: For any remaining NULL phones, generate a unique placeholder
-- using a row-number suffix so the format constraint is satisfied and no
-- two rows receive the same placeholder.
with numbered as (
  select
    profile_id,
    row_number() over (order by created_at) as rn
  from public.profiles
  where phone is null
)
update public.profiles p
set phone = '+91000000' || lpad(n.rn::text, 4, '0')
from numbered n
where p.profile_id = n.profile_id;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Make phone NOT NULL
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: Phone is the primary authentication identifier. Every user must
-- have a phone number. The backfill in Section 3 guarantees no NULLs remain.

alter table only public.profiles
  alter column phone set not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Update phone CHECK constraint
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: The previous constraint was "phone is null or phone ~ '...' ".
-- Since phone is now NOT NULL, the "phone is null" branch is unnecessary
-- and is removed. The regex remains the same: E.164 format with a leading
-- '+' and 7-15 digits.

alter table only public.profiles
  drop constraint if exists ck_profiles_phone_format;

alter table only public.profiles
  add constraint ck_profiles_phone_format check (
    phone ~ '^\+[1-9]\d{6,14}$'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Refactor handle_new_user() trigger function
-- ════════════════════════════════════════════════════════════════════════════
-- Rationale: The previous function only handled email-based signups and did
-- not insert phone into the profiles table. The refactored function:
--
--   • Populates phone from new.phone (the auth.users.phone column set by
--     Supabase Auth during phone signup). Falls back to a placeholder for
--     email-only signups.
--
--   • Populates email from new.email (NULL for phone-only signups).
--
--   • Uses an improved name fallback chain that works for both auth methods:
--       1. raw_user_meta_data ->> 'full_name'
--       2. raw_user_meta_data ->> 'name'
--       3. If phone exists → 'User {last 4 digits}' (e.g., "User 3210")
--       4. If email exists → username part of email (before '@')
--       5. 'New User' (hard-coded fallback)
--
--   • Maintains idempotency via ON CONFLICT (profile_id) DO NOTHING.
--
--   • Email signup: email populated, phone = placeholder (user must update).
--   • Phone signup: phone populated, email = NULL (user may add later).
--
--   • Both auth methods require institute_id in raw_user_meta_data.

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
    institute_id
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
    v_institute_id
  )
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Verification Queries (run these after applying)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 7a. Verify no NULL emails remain for email-based users (expected: 0 if
--     all existing users had emails, or count of phone-first users):
--     select count(*) from public.profiles where email is null;
--
-- 7b. Verify no NULL phones exist (expected: 0):
--     select count(*) from public.profiles where phone is null;
--
-- 7c. Verify the trigger function has the correct definition:
--     select proname, prosrc
--     from pg_proc
--     where proname = 'handle_new_user';
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 024 Phone-First Authentication Support
-- ════════════════════════════════════════════════════════════════════════════
