-- ============================================================================
-- Migration 091 / 186: Two-Slot Device Sessions (Mobile + Web Independence)
--
-- Business rule:
--   A student account has TWO independent active session slots:
--     1. Mobile Slot: exactly 1 active mobile device (android / ios)
--     2. Website Slot: exactly 1 active web browser session (web)
--
-- Rules:
--   - Mobile login revokes previous Mobile device (replaced_by_new_device).
--     Website session remains active.
--   - Website login revokes previous Website browser (replaced_by_new_device).
--     Mobile device remains active.
--   - Mobile + Website simultaneous login is fully allowed.
--   - Single-active uniqueness per (profile_id, session_slot) enforced in DB.
-- ============================================================================

-- 1. Update platform check constraint to include 'web'
alter table public.user_device_sessions
  drop constraint if exists ck_user_device_sessions_platform;

alter table public.user_device_sessions
  add constraint ck_user_device_sessions_platform
  check (platform in ('android', 'ios', 'web'));

-- 2. Add generated stored column session_slot
-- Mapping: 'web' -> 'web', 'android'/'ios'/null -> 'mobile'
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_device_sessions'
      and column_name = 'session_slot'
  ) then
    alter table public.user_device_sessions
      add column session_slot text
      generated always as (
        case when platform = 'web' then 'web' else 'mobile' end
      ) stored;
  end if;
end $$;

-- 3. Replace the global single-active partial unique index with slot-aware unique index
drop index if exists public.uq_user_device_sessions_single_active;
drop index if exists public.uq_user_device_sessions_single_active_per_slot;

create unique index uq_user_device_sessions_single_active_per_slot
  on public.user_device_sessions (profile_id, session_slot)
  where is_active;

-- 4. Update register_active_device() RPC to revoke ONLY devices in the SAME slot
create or replace function public.register_active_device(
  p_installation_id text,
  p_platform        text default null,
  p_device_name     text default null,
  p_app_version     text default null,
  p_fcm_token       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id   uuid;
  v_session_id   uuid;
  v_was_existing boolean;
  v_revoked      uuid[] := '{}';
  v_revoked_id   uuid;
  v_action       public.audit_action_type;
  v_slot         text;
begin
  -- 1. Identity comes ONLY from auth.uid()
  if auth.role() <> 'authenticated' then
    return jsonb_build_object('success', false, 'error', 'Not authenticated.');
  end if;
  v_profile_id := auth.uid();
  if v_profile_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated.');
  end if;

  -- 2. Validate installation id
  if p_installation_id is null
     or char_length(trim(p_installation_id)) < 8
     or char_length(trim(p_installation_id)) > 128 then
    return jsonb_build_object(
      'success', false,
      'error', 'A valid device installation id is required.'
    );
  end if;
  p_installation_id := trim(p_installation_id);

  -- 2b. Validate platform
  if p_platform is not null and p_platform not in ('android', 'ios', 'web') then
    return jsonb_build_object(
      'success', false,
      'error', 'Platform must be android, ios, web, or null.'
    );
  end if;

  -- Determine target slot: 'web' or 'mobile'
  v_slot := case when p_platform = 'web' then 'web' else 'mobile' end;

  -- 3. Advisory lock per profile to serialize concurrent registrations
  perform pg_advisory_xact_lock(
    hashtext('user_device_sessions::' || v_profile_id::text)
  );

  -- 4. Check if this installation was already registered
  select exists (
    select 1 from public.user_device_sessions
     where profile_id = v_profile_id
       and device_installation_id = p_installation_id
  ) into v_was_existing;

  -- 5. Revoke OTHER active installations in the SAME slot only!
  for v_revoked_id in
    update public.user_device_sessions
       set is_active      = false,
           revoked_at     = now(),
           revoked_reason = 'replaced_by_new_device'
     where profile_id     = v_profile_id
       and is_active
       and session_slot   = v_slot
       and device_installation_id <> p_installation_id
     returning session_device_id
  loop
    v_revoked := array_append(v_revoked, v_revoked_id);
  end loop;

  -- 6. Upsert this installation as the active device for its slot
  insert into public.user_device_sessions (
    profile_id,
    device_installation_id,
    fcm_token,
    platform,
    device_name,
    app_version,
    is_active,
    activated_at,
    last_seen_at
  )
  values (
    v_profile_id,
    p_installation_id,
    p_fcm_token,
    p_platform,
    p_device_name,
    p_app_version,
    true,
    now(),
    now()
  )
  on conflict (profile_id, device_installation_id)
  do update set
    fcm_token      = excluded.fcm_token,
    platform       = excluded.platform,
    device_name    = excluded.device_name,
    app_version    = excluded.app_version,
    is_active      = true,
    activated_at   = coalesce(public.user_device_sessions.activated_at, now()),
    last_seen_at   = now(),
    revoked_at     = null,
    revoked_reason = null
  returning session_device_id into v_session_id;

  -- 7. Audit log write
  v_action := case
    when v_was_existing then 'update'::public.audit_action_type
    else 'create'::public.audit_action_type
  end;

  perform public.write_audit_log(
    v_action,
    'user_device_session',
    v_session_id,
    null,
    jsonb_build_object(
      'device_installation_id', p_installation_id,
      'platform',               p_platform,
      'session_slot',           v_slot,
      'is_active',              true,
      'activated_at',           now()
    ),
    jsonb_build_object(
      'context',   'register_active_device',
      'version',   '186',
      'slot',      v_slot,
      'revoked',   v_revoked
    )
  );

  return jsonb_build_object(
    'success',                   true,
    'installedDeviceId',         v_session_id::text,
    'isNewInstall',              not v_was_existing,
    'sessionSlot',               v_slot,
    'revokedPreviousDeviceIds',  v_revoked
  );
end;
$$;

-- 5. Execution grants
grant execute on function public.register_active_device(text, text, text, text, text) to authenticated, service_role;
