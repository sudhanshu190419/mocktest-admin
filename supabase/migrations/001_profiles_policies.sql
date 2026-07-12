-- ============================================================================
-- Migration: Profiles Table — RLS Policies & Auto-Create Trigger
--
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new)
-- after creating the `profiles` table with the schema below.
--
-- Table Schema (create this first if it doesn't exist):
--
--   create table public.profiles (
--     id         uuid references auth.users on delete cascade primary key,
--     email      text not null,
--     full_name  text not null default '',
--     role       text not null default 'student' check (role in ('student', 'teacher', 'admin')),
--     created_at timestamptz not null default now()
--   );
-- ============================================================================

-- ── 1. Enable Row-Level Security ────────────────────────────────────────────

alter table public.profiles enable row level security;

-- ── 2. RLS Policies ─────────────────────────────────────────────────────────

-- 2a. INSERT: Allow authenticated users to insert their own profile row.
--     The `WITH CHECK` clause ensures the user can only create a row where
--     `id` matches their own auth.uid().
--     The subquery form ((SELECT auth.uid())) is an optimization that caches
--     the uid lookup for the duration of the statement.
create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- 2b. SELECT: Allow authenticated users to read their own profile row.
--     Required by authService.fetchProfile(), getSession(), etc.
create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- 2c. UPDATE: Allow authenticated users to update their own profile row.
--     Useful for future features like profile editing.
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 2d. DELETE: Allow authenticated users to delete their own profile row.
--     Cascading delete from auth.users handles this, but explicit policy
--     is good practice.
create policy "Users can delete their own profile"
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);

-- ── 3. Database Trigger — Auto-Create Profile on Signup ────────────────────
--
-- This is the **production-recommended** approach.  When a new user is created
-- in auth.users (via email/password, social login, or admin API), this trigger
-- automatically inserts a corresponding row into public.profiles.
--
-- Benefits over client-side creation:
--   - Atomic: profile is created in the same transaction as the auth user
--   - Reliable: works even if the client disconnects before calling createProfile()
--   - SOC-compliant: no client-side code can skip or tamper with profile creation

-- 3a. Create the trigger function
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'student'
  );
  return new;
end;
$$;

-- 3b. Attach the trigger to auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ── 4. Verification Queries (run these after applying) ─────────────────────
--
-- 4a. List all policies on the profiles table:
--     select * from pg_policies where tablename = 'profiles';
--
-- 4b. Test the trigger (simulates what happens on signup):
--     -- Check the function exists:
--     select * from pg_proc where proname = 'handle_new_user';
-- ============================================================================
