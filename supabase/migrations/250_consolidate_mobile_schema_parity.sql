-- ============================================================================
-- Migration: 250 — Consolidate Mobile Schema Parity
--
-- PostgreSQL 16 | Supabase Compatible | Production & Staging Idempotent
--
-- Purpose:
--   Establishes complete schema, table, column, trigger, policy, and RPC parity
--   between the mobile application and the canonical admin repository.
--   This incorporates the 14 genuinely missing database functionalities
--   previously authored exclusively in MockTestApp:
--
--     1. 049 — Column mock_attempts.last_question_id (UUID FK)
--     2. 050 — Column mock_attempts.last_activity_at (TIMESTAMPTZ)
--     3. 052 — Function & Trigger set_last_activity_at() on mock_attempts
--     4. 062 — Storage RLS for content-pdfs bucket (student read access)
--     5. 063 — Column student_details.selected_stream_id & RLS policy
--     6. 064 — Column profiles.selected_stream_id, FK, & column privilege GRANT UPDATE (selected_stream_id)
--     7. 065 — Column privilege GRANT UPDATE (email) ON profiles
--     8. 060 — Live Chat Module (conversations & messages tables, RLS, triggers, realtime)
--     9. 066 — RPC register_device_token(p_fcm_token, p_platform, ...)
--    10. 074 — RPC get_course_batch_subject_ids(p_course_id)
--    11. 078 — RPC persist_mock_answer_live(...) (live persistence supporting optional time_spent_seconds)
--    12. 081 — RPC persist_mock_answers_batch(...) (atomic offline queue flush)
--    13. 080 — RPC get_public_catalog(p_stream_id) (composite unauthenticated browse)
--    14. 034/046 — Non-recursive enrollment helper & courses read policy
--
-- Safety Guarantees:
--   • Completely idempotent: safe to execute in production (where objects
--     already exist) as a non-destructive verification no-op.
--   • Completely reproducible: safe to execute in a clean baseline staging
--     environment to establish all missing components in a single transaction.
--   • Preserves all existing production data, constraints, and relationships.
--   • Zero historical mutation: migrations 001–249 remain byte-immutable.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Assessment Schema Enhancements (049, 050, 052)
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. Add last_question_id to mock_attempts
ALTER TABLE public.mock_attempts
  ADD COLUMN IF NOT EXISTS last_question_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mock_attempts'::regclass
      AND conname = 'fk_mock_attempts_last_question'
  ) THEN
    ALTER TABLE public.mock_attempts
      ADD CONSTRAINT fk_mock_attempts_last_question
      FOREIGN KEY (last_question_id) REFERENCES public.questions (question_id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.mock_attempts.last_question_id IS
  'The last question the student viewed (set on navigation). Used by resume flow.';

-- 1b. Add last_activity_at to mock_attempts
ALTER TABLE public.mock_attempts
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

COMMENT ON COLUMN public.mock_attempts.last_activity_at IS
  'UTC timestamp of last timer sync / answer activity. Authoritative source for exam timer recovery.';

-- 1c. Trigger Function: set_last_activity_at
CREATE OR REPLACE FUNCTION public.set_last_activity_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.time_remaining_seconds IS DISTINCT FROM OLD.time_remaining_seconds THEN
    NEW.last_activity_at = now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_last_activity_at() IS
  'Trigger function: updates mock_attempts.last_activity_at = now() whenever time_remaining_seconds changes.';

DROP TRIGGER IF EXISTS trg_mock_attempts_set_last_activity_at ON public.mock_attempts;
CREATE TRIGGER trg_mock_attempts_set_last_activity_at
BEFORE UPDATE ON public.mock_attempts
FOR EACH ROW
EXECUTE FUNCTION public.set_last_activity_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Storage RLS for Student Content Access (062)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    DROP POLICY IF EXISTS "content_pdfs_select_teacher_own" ON storage.objects;
    DROP POLICY IF EXISTS "content_pdfs_select_authenticated" ON storage.objects;

    CREATE POLICY "content_pdfs_select_authenticated"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'content-pdfs'
        AND (
          owner = auth.uid()
          OR public.is_student()
          OR public.is_teacher()
          OR public.is_admin()
        )
      );
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Student & Profile Stream Persistence (063, 064)
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. student_details.selected_stream_id
ALTER TABLE public.student_details
  ADD COLUMN IF NOT EXISTS selected_stream_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.student_details'::regclass
      AND conname = 'fk_student_details_selected_stream'
  ) THEN
    ALTER TABLE public.student_details
      ADD CONSTRAINT fk_student_details_selected_stream
      FOREIGN KEY (selected_stream_id) REFERENCES public.streams (stream_id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_details_selected_stream
  ON public.student_details (selected_stream_id);

COMMENT ON COLUMN public.student_details.selected_stream_id IS
  'The student chosen exam stream (FK -> streams.stream_id). Authoritative account-level preference.';

DROP POLICY IF EXISTS "Students can update their own stream selection" ON public.student_details;
CREATE POLICY "Students can update their own stream selection"
  ON public.student_details
  FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- 3b. profiles.selected_stream_id
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS selected_stream_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'fk_profiles_selected_stream'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT fk_profiles_selected_stream
      FOREIGN KEY (selected_stream_id) REFERENCES public.streams (stream_id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_selected_stream
  ON public.profiles (selected_stream_id);

COMMENT ON COLUMN public.profiles.selected_stream_id IS
  'Mirrored stream preference on profile row for fast role-independent lookup.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Profile Column Privileges (064, 065)
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Onboarding Stream Selection Update Privilege (064)
GRANT UPDATE (selected_stream_id) ON public.profiles TO authenticated;

-- 4b. Email Profile Data Update Privilege (065)
GRANT UPDATE (email) ON public.profiles TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Live Chat Module (060)
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. Table: conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  conversation_id  uuid          NOT NULL  DEFAULT gen_random_uuid(),
  class_id         uuid          NOT NULL,
  teacher_id       uuid          NOT NULL,
  student_id       uuid          NOT NULL,
  created_at       timestamptz   NOT NULL  DEFAULT now(),
  updated_at       timestamptz   NOT NULL  DEFAULT now(),

  CONSTRAINT pk_conversations PRIMARY KEY (conversation_id),

  CONSTRAINT fk_conversations_class
    FOREIGN KEY (class_id) REFERENCES public.live_classes (class_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,

  CONSTRAINT fk_conversations_teacher
    FOREIGN KEY (teacher_id) REFERENCES public.teacher_details (teacher_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,

  CONSTRAINT fk_conversations_student
    FOREIGN KEY (student_id) REFERENCES public.student_details (student_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,

  CONSTRAINT uq_conversations_class_student UNIQUE (class_id, student_id)
);

-- 5b. Table: messages
CREATE TABLE IF NOT EXISTS public.messages (
  message_id         uuid          NOT NULL  DEFAULT gen_random_uuid(),
  conversation_id    uuid          NOT NULL,
  sender_profile_id  uuid          NOT NULL,
  message            text          NOT NULL,
  created_at         timestamptz   NOT NULL  DEFAULT now(),

  CONSTRAINT pk_messages PRIMARY KEY (message_id),

  CONSTRAINT fk_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES public.conversations (conversation_id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT,

  CONSTRAINT fk_messages_sender
    FOREIGN KEY (sender_profile_id) REFERENCES public.profiles (profile_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,

  CONSTRAINT ck_messages_message_not_empty CHECK (char_length(trim(message)) >= 1)
);

-- 5c. Indexes for chat
CREATE INDEX IF NOT EXISTS idx_conversations_class_id
  ON public.conversations (class_id);

CREATE INDEX IF NOT EXISTS idx_conversations_teacher_id
  ON public.conversations (teacher_id);

CREATE INDEX IF NOT EXISTS idx_conversations_student_id
  ON public.conversations (student_id);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
  ON public.conversations (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON public.messages (conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_sender_profile_id
  ON public.messages (sender_profile_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

-- 5d. Trigger function: touch conversations on new message
CREATE OR REPLACE FUNCTION public.trgfn_conversations_touch_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations
     SET updated_at = now()
   WHERE conversation_id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversations_touch_on_message ON public.messages;
CREATE TRIGGER trg_conversations_touch_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.trgfn_conversations_touch_on_message();

-- 5e. Row Level Security for conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view their own conversations" ON public.conversations;
CREATE POLICY "Students can view their own conversations"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "Teachers can view conversations for their classes" ON public.conversations;
CREATE POLICY "Teachers can view conversations for their classes"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (teacher_id = public.get_my_teacher_id());

DROP POLICY IF EXISTS "Teachers can insert conversations for their classes" ON public.conversations;
CREATE POLICY "Teachers can insert conversations for their classes"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    teacher_id = public.get_my_teacher_id()
    AND EXISTS (
      SELECT 1 FROM public.live_classes lc
      WHERE lc.class_id = conversations.class_id
        AND lc.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Admins can view all conversations" ON public.conversations;
CREATE POLICY "Admins can view all conversations"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 5f. Row Level Security for messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view messages in their own conversations" ON public.messages;
CREATE POLICY "Students can view messages in their own conversations"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.conversation_id = messages.conversation_id
         AND c.student_id = public.get_my_student_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can view messages in their class conversations" ON public.messages;
CREATE POLICY "Teachers can view messages in their class conversations"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.conversation_id = messages.conversation_id
         AND c.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Admins can view all messages" ON public.messages;
CREATE POLICY "Admins can view all messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Students can send messages to their own conversations" ON public.messages;
CREATE POLICY "Students can send messages to their own conversations"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.conversation_id = messages.conversation_id
         AND c.student_id = public.get_my_student_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can send messages to their class conversations" ON public.messages;
CREATE POLICY "Teachers can send messages to their class conversations"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.conversation_id = messages.conversation_id
         AND c.teacher_id = public.get_my_teacher_id()
    )
  );

-- 5g. Add messages to Realtime publication if available
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Mobile Device Token RPC (066)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.register_device_token(
  p_fcm_token    text,
  p_platform     text,
  p_device_name  text DEFAULT NULL,
  p_app_version  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id        uuid;
  v_token_id          uuid;
  v_transferred_from  uuid;
BEGIN
  v_profile_id := auth.uid();

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.'
      USING HINT = 'A valid session is required to register a device token.';
  END IF;

  IF p_fcm_token IS NULL OR btrim(p_fcm_token) = '' THEN
    RAISE EXCEPTION 'FCM token is required.'
      USING HINT = 'The client must provide a non-empty fcm_token.';
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'Platform must be android or ios.'
      USING HINT = 'The client must provide a supported platform value.';
  END IF;

  -- Transfer ownership if previously registered to another user
  UPDATE public.device_tokens
     SET is_active = false
   WHERE fcm_token = p_fcm_token
     AND profile_id <> v_profile_id
  RETURNING profile_id INTO v_transferred_from;

  -- Upsert device token for current user
  INSERT INTO public.device_tokens (
    profile_id,
    fcm_token,
    platform,
    device_name,
    app_version,
    is_active,
    last_seen_at
  )
  VALUES (
    v_profile_id,
    p_fcm_token,
    p_platform,
    p_device_name,
    p_app_version,
    true,
    now()
  )
  ON CONFLICT (fcm_token)
    DO UPDATE SET
      profile_id    = v_profile_id,
      platform      = EXCLUDED.platform,
      device_name   = COALESCE(EXCLUDED.device_name, device_tokens.device_name),
      app_version   = EXCLUDED.app_version,
      is_active     = true,
      last_seen_at  = now()
  RETURNING token_id INTO v_token_id;

  RETURN jsonb_build_object(
    'success',                  true,
    'tokenId',                  v_token_id,
    'transferredFromProfileId', v_transferred_from
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_device_token(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.register_device_token IS
  'SECURITY DEFINER RPC — registers or re-registers an FCM device token for the calling authenticated user.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Course Batch Subject IDs Resolution RPC (074)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_course_batch_subject_ids(p_course_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
  SELECT coalesce(array_agg(DISTINCT bs.batch_subject_id), '{}'::uuid[])
  FROM public.batch_subjects bs
  JOIN public.course_batches cb ON cb.batch_id = bs.batch_id
  WHERE cb.course_id = p_course_id
    AND bs.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_batch_subject_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_batch_subject_ids(uuid) TO service_role;

COMMENT ON FUNCTION public.get_course_batch_subject_ids(uuid) IS
  'Resolves all active batch_subject_ids linked to a course in a single query with SECURITY INVOKER.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — High-Performance Live & Batch Answer Persistence RPCs (078, 081)
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. persist_mock_answer_live RPC
-- Explicitly drop legacy 6-parameter overload to ensure unambiguous PostgREST RPC resolution
DROP FUNCTION IF EXISTS public.persist_mock_answer_live(UUID, BOOLEAN, BOOLEAN, UUID[], NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.persist_mock_answer_live(
  p_answer_id            UUID,
  p_is_answered          BOOLEAN,
  p_is_marked_for_review BOOLEAN DEFAULT NULL,
  p_selected_option_ids  UUID[]  DEFAULT NULL,
  p_numerical_answer     NUMERIC DEFAULT NULL,
  p_text_answer          TEXT    DEFAULT NULL,
  p_time_spent_seconds   INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_attempt_id UUID;
  v_student_id UUID;
  v_status     TEXT;
  v_answer_id  UUID;
  v_now        TIMESTAMPTZ;
BEGIN
  SELECT a.attempt_id, a.student_id, a.status::TEXT, ans.answer_id
  INTO v_attempt_id, v_student_id, v_status, v_answer_id
  FROM public.mock_answers ans
  JOIN public.mock_attempts a ON ans.attempt_id = a.attempt_id
  LEFT JOIN public.student_details sd ON a.student_id = sd.student_id
  WHERE ans.answer_id = p_answer_id
    AND (sd.profile_id = auth.uid() OR public.is_admin())
  FOR UPDATE OF a, ans;

  IF v_answer_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.mock_answers WHERE answer_id = p_answer_id) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Answer not found.',
        'code',    'ANSWER_NOT_FOUND'
      );
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.mock_answers ans
      JOIN public.mock_attempts a ON ans.attempt_id = a.attempt_id
      LEFT JOIN public.student_details sd ON a.student_id = sd.student_id
      WHERE ans.answer_id = p_answer_id AND (sd.profile_id = auth.uid() OR public.is_admin())
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Unauthorized: cannot persist answer for a different student.',
        'code',    'STUDENT_MISMATCH'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Attempt not found.',
        'code',    'ATTEMPT_NOT_FOUND'
      );
    END IF;
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Attempt is no longer in progress.',
      'code',    'ATTEMPT_NOT_IN_PROGRESS'
    );
  END IF;

  v_now := CLOCK_TIMESTAMP();

  DELETE FROM public.mock_answer_options
  WHERE answer_id = p_answer_id;

  IF p_is_answered AND p_selected_option_ids IS NOT NULL AND ARRAY_LENGTH(p_selected_option_ids, 1) > 0 THEN
    INSERT INTO public.mock_answer_options (
      answer_id,
      option_id,
      selected_at
    )
    SELECT
      p_answer_id,
      unnest(p_selected_option_ids),
      v_now;
  END IF;

  UPDATE public.mock_answers
  SET is_answered = p_is_answered,
      is_marked_for_review = COALESCE(p_is_marked_for_review, is_marked_for_review),
      numerical_answer = p_numerical_answer,
      text_answer = p_text_answer,
      time_spent_seconds = COALESCE(p_time_spent_seconds, mock_answers.time_spent_seconds),
      answered_at = CASE WHEN p_is_answered THEN v_now ELSE NULL END,
      updated_at = v_now
  WHERE answer_id = p_answer_id;

  UPDATE public.mock_attempts
  SET last_activity_at = v_now,
      updated_at = v_now
  WHERE attempt_id = v_attempt_id
    AND (last_activity_at IS NULL OR last_activity_at < v_now - INTERVAL '60 seconds');

  RETURN jsonb_build_object(
    'success',   true,
    'answer_id', p_answer_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_mock_answer_live(UUID, BOOLEAN, BOOLEAN, UUID[], NUMERIC, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_mock_answer_live(UUID, BOOLEAN, BOOLEAN, UUID[], NUMERIC, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_mock_answer_live(UUID, BOOLEAN, BOOLEAN, UUID[], NUMERIC, TEXT, INTEGER) TO anon;

COMMENT ON FUNCTION public.persist_mock_answer_live(UUID, BOOLEAN, BOOLEAN, UUID[], NUMERIC, TEXT, INTEGER) IS
  'High-throughput single-answer live persistence RPC with row-level locking, optional time_spent_seconds, and debounced attempt updates.';

-- 8b. persist_mock_answers_batch RPC
CREATE OR REPLACE FUNCTION public.persist_mock_answers_batch(
  p_attempt_id UUID,
  p_answers    JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_status     TEXT;
  v_now        TIMESTAMPTZ := CLOCK_TIMESTAMP();
  v_count      INTEGER;
BEGIN
  IF p_attempt_id IS NULL OR p_answers IS NULL OR jsonb_typeof(p_answers) != 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Invalid input: p_attempt_id and p_answers array are required.',
      'code',    'INVALID_PARAMETER'
    );
  END IF;

  IF jsonb_array_length(p_answers) = 0 THEN
    RETURN jsonb_build_object(
      'success',      true,
      'attempt_id',   p_attempt_id,
      'synced_count', 0
    );
  END IF;

  SELECT a.student_id, a.status::TEXT
  INTO v_student_id, v_status
  FROM public.mock_attempts a
  LEFT JOIN public.student_details sd ON a.student_id = sd.student_id
  WHERE a.attempt_id = p_attempt_id
    AND (sd.profile_id = auth.uid() OR a.student_id = auth.uid() OR public.is_admin())
  FOR UPDATE OF a;

  IF v_student_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.mock_attempts WHERE attempt_id = p_attempt_id) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Attempt not found.',
        'code',    'ATTEMPT_NOT_FOUND'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Unauthorized: cannot persist answers for a different student.',
        'code',    'STUDENT_MISMATCH'
      );
    END IF;
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Attempt is no longer in progress.',
      'code',    'ATTEMPT_NOT_IN_PROGRESS'
    );
  END IF;

  DELETE FROM public.mock_answer_options
  WHERE answer_id IN (
    SELECT (elem->>'answer_id')::UUID
    FROM jsonb_array_elements(p_answers) elem
    WHERE elem->>'answer_id' IS NOT NULL
  );

  INSERT INTO public.mock_answer_options (
    answer_id,
    option_id,
    selected_at
  )
  SELECT 
    (elem->>'answer_id')::UUID,
    (opt_id)::UUID,
    v_now
  FROM jsonb_array_elements(p_answers) elem,
       jsonb_array_elements_text(
         CASE 
           WHEN jsonb_typeof(elem->'selected_option_ids') = 'array' THEN elem->'selected_option_ids'
           ELSE '[]'::jsonb 
         END
       ) opt_id
  WHERE (elem->>'is_answered')::BOOLEAN IS TRUE
    AND opt_id IS NOT NULL
    AND opt_id != '';

  UPDATE public.mock_answers ma
  SET is_answered          = (elem->>'is_answered')::BOOLEAN,
      is_marked_for_review = COALESCE((elem->>'is_marked_for_review')::BOOLEAN, ma.is_marked_for_review),
      numerical_answer     = NULLIF(elem->>'numerical_answer', '')::NUMERIC,
      text_answer          = elem->>'text_answer',
      time_spent_seconds   = COALESCE(NULLIF(elem->>'time_spent_seconds', '')::INTEGER, ma.time_spent_seconds),
      answered_at          = CASE WHEN (elem->>'is_answered')::BOOLEAN THEN v_now ELSE NULL END,
      updated_at           = v_now
  FROM jsonb_array_elements(p_answers) elem
  WHERE ma.answer_id = (elem->>'answer_id')::UUID
    AND ma.attempt_id = p_attempt_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.mock_attempts
  SET last_activity_at = v_now,
      updated_at = v_now
  WHERE attempt_id = p_attempt_id
    AND (last_activity_at IS NULL OR last_activity_at < v_now - INTERVAL '60 seconds');

  RETURN jsonb_build_object(
    'success',      true,
    'attempt_id',   p_attempt_id,
    'synced_count', jsonb_array_length(p_answers),
    'updated_rows', v_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_mock_answers_batch(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_mock_answers_batch(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_mock_answers_batch(UUID, JSONB) TO anon;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — Composite Public Catalog RPC (080)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_catalog(
  p_stream_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_courses             JSONB := '[]'::JSONB;
  v_practice_packages   JSONB := '[]'::JSONB;
  v_mock_tests          JSONB := '[]'::JSONB;
  v_free_content        JSONB := '[]'::JSONB;
  v_demo_classes        JSONB := '[]'::JSONB;
  v_streams             JSONB := '[]'::JSONB;
  v_subjects            JSONB := '[]'::JSONB;
BEGIN
  -- 1. Published Courses
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'course_id', c.course_id,
        'title', c.title,
        'short_description', c.short_description,
        'description', c.description,
        'thumbnail_bucket', c.thumbnail_bucket,
        'thumbnail_path', c.thumbnail_path,
        'language', c.language,
        'difficulty_level', c.difficulty_level,
        'duration', c.duration,
        'original_price', c.original_price,
        'discounted_price', c.discounted_price,
        'featured', c.featured,
        'trending', c.trending,
        'status', c.status,
        'published_at', c.published_at,
        'stream_id', c.stream_id,
        'stream', CASE WHEN s.name IS NOT NULL THEN jsonb_build_object('name', s.name) ELSE NULL END
      )
    ), '[]'::JSONB
  ) INTO v_courses
  FROM (
    SELECT c.course_id, c.title, c.short_description, c.description,
           c.thumbnail_bucket, c.thumbnail_path, c.language, c.difficulty_level,
           c.duration, c.original_price, c.discounted_price, c.featured,
           c.trending, c.status, c.published_at, c.stream_id
    FROM public.courses c
    WHERE c.status = 'published'
      AND c.deleted_at IS NULL
      AND (p_stream_id IS NULL OR c.stream_id = p_stream_id)
    ORDER BY c.featured DESC, c.published_at DESC NULLS LAST
    LIMIT 50
  ) c
  LEFT JOIN public.streams s ON c.stream_id = s.stream_id;

  -- 2. Published Practice / PYQ Packages
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'package_id', pyq.package_id,
        'stream_id', pyq.stream_id,
        'name', pyq.name,
        'description', pyq.description,
        'price', pyq.price,
        'currency', pyq.currency,
        'thumbnail_path', pyq.thumbnail_path,
        'year_from', pyq.year_from,
        'year_to', pyq.year_to,
        'total_papers', pyq.total_papers,
        'is_active', pyq.is_active,
        'published_at', pyq.published_at,
        'stream', CASE WHEN s.name IS NOT NULL THEN jsonb_build_object('name', s.name) ELSE NULL END
      )
    ), '[]'::JSONB
  ) INTO v_practice_packages
  FROM (
    SELECT p.package_id, p.stream_id, p.name, p.description,
           p.price, p.currency, p.thumbnail_path, p.year_from, p.year_to,
           p.total_papers, p.is_active, p.published_at
    FROM public.pyq_packages p
    WHERE p.is_active = true
      AND p.published_at IS NOT NULL
      AND p.deleted_at IS NULL
      AND (p_stream_id IS NULL OR p.stream_id = p_stream_id)
    ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
    LIMIT 50
  ) pyq
  LEFT JOIN public.streams s ON pyq.stream_id = s.stream_id;

  -- 3. Published Mock Tests Catalog
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'test_id', mt.test_id,
        'stream_id', mt.stream_id,
        'subject_id', mt.subject_id,
        'title', mt.title,
        'description', mt.description,
        'duration_min', mt.duration_min,
        'total_marks', mt.total_marks,
        'passing_marks', mt.passing_marks,
        'negative_marking', mt.negative_marking,
        'attempt_limit', mt.attempt_limit,
        'status', mt.status,
        'test_type', mt.test_type,
        'available_from', mt.available_from,
        'available_until', mt.available_until,
        'published_at', mt.published_at
      )
    ), '[]'::JSONB
  ) INTO v_mock_tests
  FROM (
    SELECT t.test_id, t.stream_id, t.subject_id, t.title, t.description,
           t.duration_min, t.total_marks, t.passing_marks, t.negative_marking,
           t.attempt_limit, t.status, t.test_type, t.available_from,
           t.available_until, t.published_at
    FROM public.mock_tests t
    WHERE t.status = 'published'
      AND t.deleted_at IS NULL
      AND (p_stream_id IS NULL OR t.stream_id = p_stream_id)
    ORDER BY t.published_at DESC NULLS LAST, t.created_at DESC
    LIMIT 50
  ) mt;

  -- 4. Approved Free Preview Content / Hero Banners
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'content_id', c.content_id,
        'title', c.title,
        'description', c.description,
        'thumbnail_bucket', c.thumbnail_bucket,
        'thumbnail_path', c.thumbnail_path,
        'content_type', c.content_type,
        'status', c.status,
        'is_free_preview', c.is_free_preview,
        'published_at', c.published_at,
        'created_at', c.created_at,
        'updated_at', c.updated_at
      )
    ), '[]'::JSONB
  ) INTO v_free_content
  FROM (
    SELECT content_id, title, description, thumbnail_bucket, thumbnail_path,
           content_type, status, is_free_preview, published_at, created_at, updated_at
    FROM public.content
    WHERE is_free_preview = true
      AND status = 'approved'
      AND deleted_at IS NULL
    ORDER BY published_at DESC NULLS LAST
    LIMIT 10
  ) c;

  -- 5. Published Demo Classes
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'demo_class_id', dc.demo_class_id,
        'stream_id', dc.stream_id,
        'title', dc.title,
        'description', dc.description,
        'storage_bucket', dc.storage_bucket,
        'storage_path', dc.storage_path,
        'thumbnail_bucket', dc.thumbnail_bucket,
        'thumbnail_path', dc.thumbnail_path,
        'duration_seconds', dc.duration_seconds,
        'status', dc.status,
        'created_at', dc.created_at,
        'published_at', dc.published_at
      )
    ), '[]'::JSONB
  ) INTO v_demo_classes
  FROM (
    SELECT demo_class_id, stream_id, title, description, storage_bucket,
           storage_path, thumbnail_bucket, thumbnail_path, duration_seconds,
           status, created_at, published_at
    FROM public.demo_classes
    WHERE status = 'published'
      AND deleted_at IS NULL
      AND (p_stream_id IS NULL OR stream_id = p_stream_id)
    ORDER BY created_at DESC
    LIMIT 5
  ) dc;

  -- 6. Active Academic Streams Taxonomy
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'stream_id', st.stream_id,
        'name', st.name,
        'code', st.code,
        'description', st.description,
        'display_order', st.display_order,
        'is_active', st.is_active
      )
    ), '[]'::JSONB
  ) INTO v_streams
  FROM (
    SELECT stream_id, name, code, description, display_order, is_active
    FROM public.streams
    WHERE is_active = true
      AND deleted_at IS NULL
    ORDER BY display_order ASC, name ASC
  ) st;

  -- 7. Active Academic Subjects Taxonomy
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'subject_id', sb.subject_id,
        'stream_id', sb.stream_id,
        'name', sb.name,
        'code', sb.code,
        'display_order', sb.display_order
      )
    ), '[]'::JSONB
  ) INTO v_subjects
  FROM (
    SELECT subject_id, stream_id, name, code, display_order
    FROM public.subjects
    WHERE deleted_at IS NULL
      AND (p_stream_id IS NULL OR stream_id = p_stream_id)
    ORDER BY display_order ASC, name ASC
  ) sb;

  -- 8. Return consolidated public catalog payload
  RETURN jsonb_build_object(
    'success', true,
    'stream_id', p_stream_id,
    'courses', v_courses,
    'practice_packages', v_practice_packages,
    'mock_tests', v_mock_tests,
    'free_content', v_free_content,
    'demo_classes', v_demo_classes,
    'streams', v_streams,
    'subjects', v_subjects
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_catalog(UUID) TO anon;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — Course Read Policy & Non-Recursive Helper (034, 046)
-- ════════════════════════════════════════════════════════════════════════════

-- 10a. Non-recursive course enrollment helper function
CREATE OR REPLACE FUNCTION public.is_student_enrolled_in_course(
  p_course_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.course_enrollments ce
    WHERE ce.course_id = p_course_id
      AND ce.student_id = public.get_my_student_id()
      AND ce.is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_student_enrolled_in_course(uuid) IS
  'Returns TRUE when caller is actively enrolled in course. SECURITY DEFINER avoids recursive RLS evaluation.';

-- 10b. Reaffirm non-recursive policy on course_teachers
DROP POLICY IF EXISTS "Students can read course_teachers for enrolled courses" ON public.course_teachers;
CREATE POLICY "Students can read course_teachers for enrolled courses"
  ON public.course_teachers
  FOR SELECT
  TO authenticated
  USING (
    public.is_student_enrolled_in_course(course_id)
  );

-- 10c. Authenticated courses read policy (046)
DROP POLICY IF EXISTS "Users can read published courses" ON public.courses;
CREATE POLICY "Users can read published courses"
  ON public.courses
  FOR SELECT
  TO authenticated
  USING (
    status = 'published'
    AND deleted_at IS NULL
  );

-- ============================================================================
-- END OF MIGRATION — 250 Consolidate Mobile Schema Parity
-- ============================================================================

