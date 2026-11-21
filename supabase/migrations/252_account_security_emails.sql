-- ============================================================================
-- Migration 252: Phase 3 Account & Security Email Notifications
--
-- Implements database triggers and helper functions for:
--   - ACC-01: Student Welcome Email (Triggered server-side when profiles.email
--             transitions from NULL/empty to a valid email for the first time).
--
-- Security & Operational Rules:
--   1. Fires ONLY on student profiles (role = 'student').
--   2. Fires ONLY on first email addition (transition from NULL or empty to valid).
--   3. Does NOT fire on subsequent updates or email changes (ACC-02 excluded).
--   4. Idempotency key: 'welcome:' || profile_id ensures exactly-once enqueue.
--   5. Non-fatal: Email enqueue failures warn and do not abort profile updates.
--   6. SECURITY DEFINER with locked search_path ensures safe queue insertion.
-- ============================================================================

-- 1. Trigger Function: handle_profile_email_welcome_email
CREATE OR REPLACE FUNCTION public.handle_profile_email_welcome_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_email text;
    v_clean_name text;
    v_is_first_email boolean;
BEGIN
    -- Only evaluate student accounts
    IF NEW.role IS DISTINCT FROM 'student' THEN
        RETURN NEW;
    END IF;

    -- Clean email value
    v_clean_email := NULLIF(trim(NEW.email), '');

    -- If no email was provided, nothing to do
    IF v_clean_email IS NULL THEN
        RETURN NEW;
    END IF;

    -- Defensive check: ensure email matches valid format (matching ck_profiles_email_format from Migration 024)
    IF v_clean_email !~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' THEN
        RETURN NEW;
    END IF;

    -- Determine if this is the first time an email is being set:
    -- On INSERT: always first email if provided.
    -- On UPDATE: old email was NULL or empty.
    IF TG_OP = 'INSERT' THEN
        v_is_first_email := TRUE;
    ELSIF TG_OP = 'UPDATE' THEN
        v_is_first_email := (OLD.email IS NULL OR trim(OLD.email) = '');
    ELSE
        v_is_first_email := FALSE;
    END IF;

    -- Only enqueue if transitioning to a valid email for the first time
    IF v_is_first_email THEN
        v_clean_name := COALESCE(NULLIF(trim(NEW.name), ''), 'Student');

        BEGIN
            PERFORM public.enqueue_email_job(
                p_recipient_email      := v_clean_email,
                p_subject              := 'Welcome to Make Me Topper!',
                p_template_id          := 'ACC-01',
                p_payload              := jsonb_build_object(
                    'recipientName', v_clean_name,
                    'recipientEmail', v_clean_email,
                    'loginPlatform', 'Make Me Topper',
                    'supportEmail', 'support@inovoxy.com'
                ),
                p_recipient_profile_id := NEW.profile_id,
                p_recipient_name       := v_clean_name,
                p_event_type           := 'ACC-01',
                p_priority             := 'normal'::public.email_priority,
                p_idempotency_key      := 'welcome:' || NEW.profile_id::text
            );
        EXCEPTION WHEN OTHERS THEN
            -- Non-fatal: profile save / onboarding must NEVER fail if queueing errors
            RAISE WARNING '[trg_profile_email_welcome] Failed to enqueue welcome email for profile %: %',
                NEW.profile_id, SQLERRM;
        END;
    END IF;

    RETURN NEW;
END;
$$;

-- 2. Revoke and Grant Permissions on Trigger Function
REVOKE ALL ON FUNCTION public.handle_profile_email_welcome_email() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_profile_email_welcome_email() TO service_role;

-- 3. Create Trigger on public.profiles
DROP TRIGGER IF EXISTS trg_profile_email_welcome ON public.profiles;
CREATE TRIGGER trg_profile_email_welcome
    AFTER INSERT OR UPDATE OF email ON public.profiles
    FOR EACH ROW
    WHEN (NEW.email IS NOT NULL AND trim(NEW.email) <> '')
    EXECUTE FUNCTION public.handle_profile_email_welcome_email();

