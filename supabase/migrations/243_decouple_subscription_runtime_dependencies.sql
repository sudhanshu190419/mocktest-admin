-- ============================================================================
-- Migration: 243 — Decouple Subscription Runtime Dependencies
--
-- Repositories:
--   - C:\Projects\MockTestApp\supabase\migrations\243_decouple_subscription_runtime_dependencies.sql
--   - C:\Projects\mocktest-admin\supabase\migrations\243_decouple_subscription_runtime_dependencies.sql
--
-- Objective:
--   Removes active runtime dependencies on subscription infrastructure across:
--     1. public.get_home_screen_bootstrap()
--     2. public.get_student_batch_subjects()
--     3. public.delete_user_account_data()
--     4. public.complete_google_play_purchase()
--
-- Invariants Preserved:
--   - NO tables or columns dropped.
--   - NO data deleted, backfilled, or repaired.
--   - NO shared constraints or enum values dropped.
--   - get_home_screen_bootstrap() returns EXACTLY 10 top-level keys matching production.
--   - get_student_batch_subjects() enforces strict installment arrears & schedule checks.
--   - delete_user_account_data() excises ONLY the 6 subscription cleanup statements.
--   - complete_google_play_purchase() explicitly rejects subscription purchases
--     while preserving original production profile ownership (<>) and order-item validation.
--   - Full payment courses, PYQ packages, and installment agreements remain 100% operational.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: get_home_screen_bootstrap
-- ────────────────────────────────────────────────────────────────────────────
-- Uses actual production definition (Migration 077 baseline).
-- Removes only the student_subscriptions fallback query when determining v_has_purchased.
-- Preserves EXACTLY 10 top-level keys:
--   1. success
--   2. profile
--   3. student_id
--   4. stream_id
--   5. unread_notifications_count
--   6. hero_banners
--   7. enrolled_courses
--   8. trending_courses
--   9. featured_pyqs
--   10. demo_class

CREATE OR REPLACE FUNCTION public.get_home_screen_bootstrap(
  p_stream_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id             UUID;
  v_student_id          UUID;
  v_stream_id           UUID;
  v_profile             JSONB;
  v_unread_count        INTEGER := 0;
  v_hero_banners        JSONB := '[]'::JSONB;
  v_enrolled_courses    JSONB := '[]'::JSONB;
  v_trending_courses    JSONB := '[]'::JSONB;
  v_featured_pyqs       JSONB := '[]'::JSONB;
  v_demo_class          JSONB := 'null'::JSONB;
  v_has_purchased       BOOLEAN := false;
  v_institute_id        UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: active session required'
    );
  END IF;

  -- 1. Resolve student_details.student_id & profile
  SELECT student_id INTO v_student_id
  FROM public.student_details
  WHERE profile_id = v_user_id
  LIMIT 1;

  SELECT p.institute_id,
         jsonb_build_object(
           'profile_id', p.profile_id,
           'name', p.name,
           'role', p.role,
           'institute_id', p.institute_id,
           'phone', p.phone,
           'avatar_url', p.avatar_url,
           'student_id', v_student_id
         )
  INTO v_institute_id, v_profile
  FROM public.profiles p
  WHERE p.profile_id = v_user_id
  LIMIT 1;

  -- Stream resolution: preference p_stream_id > profiles.selected_stream_id > student_details.selected_stream_id
  v_stream_id := p_stream_id;
  IF v_stream_id IS NULL THEN
    SELECT p.selected_stream_id INTO v_stream_id
    FROM public.profiles p
    WHERE p.profile_id = v_user_id;
  END IF;
  IF v_stream_id IS NULL AND v_student_id IS NOT NULL THEN
    SELECT sd.selected_stream_id INTO v_stream_id
    FROM public.student_details sd
    WHERE sd.student_id = v_student_id;
  END IF;

  -- 2. Unread notification count
  SELECT COUNT(*)::INTEGER INTO v_unread_count
  FROM public.notification_recipients
  WHERE profile_id = v_user_id AND is_read = false;

  -- 3. Hero banners (approved free preview content)
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
  ) INTO v_hero_banners
  FROM (
    SELECT content_id, title, description, thumbnail_bucket, thumbnail_path,
           content_type, status, is_free_preview, published_at, created_at, updated_at
    FROM public.content
    WHERE is_free_preview = true AND status = 'approved'
    ORDER BY published_at DESC NULLS LAST
    LIMIT 5
  ) c;

  -- 4. Enrolled courses (Direct enrollments matching production)
  IF v_student_id IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'enrollment_id', ce.enrollment_id,
          'course_id', cr.course_id,
          'title', cr.title,
          'short_description', cr.short_description,
          'thumbnail_bucket', cr.thumbnail_bucket,
          'thumbnail_path', cr.thumbnail_path,
          'enrolled_at', ce.enrolled_at,
          'status', cr.status
        )
      ), '[]'::JSONB
    ) INTO v_enrolled_courses
    FROM public.course_enrollments ce
    JOIN public.courses cr ON ce.course_id = cr.course_id
    WHERE ce.student_id = v_student_id
      AND ce.is_active = true
      AND cr.deleted_at IS NULL;
  END IF;

  -- 5. Trending courses (scoped to stream)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'course_id', tc.course_id,
        'title', tc.title,
        'short_description', tc.short_description,
        'description', tc.description,
        'thumbnail_bucket', tc.thumbnail_bucket,
        'thumbnail_path', tc.thumbnail_path,
        'language', tc.language,
        'difficulty_level', tc.difficulty_level,
        'duration', tc.duration,
        'original_price', tc.original_price,
        'discounted_price', tc.discounted_price,
        'featured', tc.featured,
        'trending', tc.trending,
        'status', tc.status,
        'published_at', tc.published_at,
        'stream', jsonb_build_object('name', s.name)
      )
    ), '[]'::JSONB
  ) INTO v_trending_courses
  FROM (
    SELECT c.course_id, c.title, c.short_description, c.description,
           c.thumbnail_bucket, c.thumbnail_path, c.language, c.difficulty_level,
           c.duration, c.original_price, c.discounted_price, c.featured,
           c.trending, c.status, c.published_at, c.stream_id
    FROM public.courses c
    WHERE c.status = 'published'
      AND c.deleted_at IS NULL
      AND c.trending = true
      AND (v_stream_id IS NULL OR c.stream_id = v_stream_id)
    ORDER BY c.featured DESC, c.published_at DESC NULLS LAST
    LIMIT 8
  ) tc
  LEFT JOIN public.streams s ON tc.stream_id = s.stream_id;

  -- 6. Featured PYQ Packages (scoped to stream)
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
        'stream', jsonb_build_object('name', s.name)
      )
    ), '[]'::JSONB
  ) INTO v_featured_pyqs
  FROM (
    SELECT p.package_id, p.stream_id, p.name, p.description,
           p.price, p.currency, p.thumbnail_path, p.year_from, p.year_to,
           p.total_papers, p.is_active, p.published_at
    FROM public.pyq_packages p
    WHERE p.is_active = true
      AND (v_stream_id IS NULL OR p.stream_id = v_stream_id)
    ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
    LIMIT 6
  ) pyq
  LEFT JOIN public.streams s ON pyq.stream_id = s.stream_id;

  -- 7. Demo Class (only for users who have NOT purchased/enrolled in any course)
  -- Subscription fallback query removed; relies on confirmed orders and active enrollments.
  IF jsonb_array_length(v_enrolled_courses) > 0 THEN
    v_has_purchased := true;
  ELSIF v_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.orders
      WHERE profile_id = v_user_id AND status = 'confirmed'
      LIMIT 1
    ) INTO v_has_purchased;

    IF NOT v_has_purchased AND v_student_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.course_enrollments
        WHERE student_id = v_student_id AND is_active = true
        LIMIT 1
      ) INTO v_has_purchased;
    END IF;
  ELSE
    v_has_purchased := false;
  END IF;

  IF NOT v_has_purchased AND v_stream_id IS NOT NULL THEN
    SELECT jsonb_build_object(
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
    ) INTO v_demo_class
    FROM public.demo_classes dc
    WHERE dc.stream_id = v_stream_id
      AND dc.status = 'published'
      AND (v_institute_id IS NULL OR dc.institute_id = v_institute_id)
    ORDER BY dc.created_at DESC
    LIMIT 1;
  END IF;

  -- Exactly 10 top-level keys returned matching production contract
  RETURN jsonb_build_object(
    'success', true,
    'profile', v_profile,
    'student_id', v_student_id,
    'stream_id', v_stream_id,
    'unread_notifications_count', v_unread_count,
    'hero_banners', v_hero_banners,
    'enrolled_courses', v_enrolled_courses,
    'trending_courses', v_trending_courses,
    'featured_pyqs', v_featured_pyqs,
    'demo_class', v_demo_class
  );
END;
$$;

COMMENT ON FUNCTION public.get_home_screen_bootstrap(UUID) IS
  'Returns consolidated bootstrap payload for home screen with exactly 10 top-level keys without subscription table fallback.';

GRANT EXECUTE ON FUNCTION public.get_home_screen_bootstrap(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_home_screen_bootstrap(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_home_screen_bootstrap(UUID) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: get_student_batch_subjects
-- ────────────────────────────────────────────────────────────────────────────
-- Decouples batch subject resolution from student_subscriptions.
-- Implements authoritative installment eligibility per Migrations 240–242:
--   - Direct enrollments: purchase, admin_grant, and free (active, unrevoked, unexpired).
--   - Installment lockout: an active installment enrollment CANNOT bypass arrears.
--   - Direct-enrollment guard: if an agreement exists, it must satisfy installment eligibility.
--   - Completed agreements: grant access only when outstanding_balance <= 0 and
--     all non-waived schedule rows are fully settled.
--   - Active agreements: check requires_admin_review = false, overdue_balance <= 0,
--     calculate_effective_overdue_balance() <= 0, and no unpaid installments with
--     effective due date prior to the institute-local date.
--   - Inclusive due-date rule: due date itself is an access day (< current local date).

CREATE OR REPLACE FUNCTION public.get_student_batch_subjects(
  p_batch_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  batch_subject_id uuid,
  batch_id uuid,
  is_active boolean,
  subject_id uuid,
  subject_name text,
  batch_name text,
  course_id uuid,
  course_title text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id            uuid;
  v_student_id         uuid;
  v_institute_id       uuid;
  v_institute_timezone text := 'Asia/Kolkata';
  v_current_local_date date;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Resolve student + institute
  SELECT
    sd.student_id,
    p.institute_id
  INTO
    v_student_id,
    v_institute_id
  FROM public.student_details sd
  JOIN public.profiles p
    ON p.profile_id = sd.profile_id
  WHERE sd.profile_id = v_user_id
  LIMIT 1;

  IF v_student_id IS NULL OR v_institute_id IS NULL THEN
    RETURN;
  END IF;

  -- 3. Resolve institute timezone and local calendar date
  SELECT COALESCE(i.timezone, 'Asia/Kolkata')
  INTO v_institute_timezone
  FROM public.institutes i
  WHERE i.institute_id = v_institute_id;

  v_current_local_date := (now() AT TIME ZONE COALESCE(v_institute_timezone, 'Asia/Kolkata'))::date;

  -- 4. Authorized batch subjects
  RETURN QUERY
  WITH student_active_batches AS (
    SELECT
      bs_enroll.batch_id
    FROM public.batch_students bs_enroll
    JOIN public.batches b
      ON b.batch_id = bs_enroll.batch_id
    WHERE bs_enroll.student_id = v_student_id
      AND bs_enroll.status = 'active'
      AND b.institute_id = v_institute_id
      AND b.deleted_at IS NULL
      AND (
        p_batch_ids IS NULL
        OR array_length(p_batch_ids, 1) IS NULL
        OR bs_enroll.batch_id = ANY(p_batch_ids)
      )
  ),

  student_entitled_courses AS (
    -- Branch 1: Direct Non-Installment Enrollments (purchase, admin_grant, free)
    -- Must be active, not revoked, not expired, and NOT an installment enrollment.
    -- Direct-enrollment bypass protection:
    -- If an installment agreement exists for this student and course, it MUST satisfy
    -- the authoritative installment eligibility criteria. If it fails (in arrears,
    -- admin review, pending payment, overdue balance, or unpaid past-due schedules),
    -- direct enrollment cannot be used as a bypass route.
    SELECT ce.course_id
    FROM public.course_enrollments ce
    WHERE ce.student_id = v_student_id
      AND ce.is_active = true
      AND ce.revoked_at IS NULL
      AND (ce.expires_at IS NULL OR ce.expires_at >= now())
      AND ce.enrollment_type IN ('purchase', 'admin_grant', 'free')
      AND NOT EXISTS (
        SELECT 1
        FROM public.student_course_agreements sca
        WHERE sca.student_id = v_student_id
          AND sca.course_id = ce.course_id
          AND NOT (
            COALESCE(sca.requires_admin_review, false) = false
            AND (
              -- Completed agreement fully settled
              (
                sca.agreement_status = 'completed'
                AND COALESCE(sca.outstanding_balance, 0.00) <= 0.00
                AND NOT EXISTS (
                  SELECT 1 FROM public.student_installment_schedule sis
                  WHERE sis.agreement_id = sca.agreement_id
                    AND sis.status <> 'waived'
                    AND (sis.amount_paid + sis.waiver_amount) < sis.amount_due
                )
              )
              OR
              -- Active agreement in good standing
              (
                sca.agreement_status = 'active'
                AND COALESCE(sca.overdue_balance, 0.00) <= 0.00
                AND public.calculate_effective_overdue_balance(sca.agreement_id, v_current_local_date) <= 0.00
                AND NOT EXISTS (
                  SELECT 1 FROM public.student_installment_schedule sis
                  WHERE sis.agreement_id = sca.agreement_id
                    AND sis.status <> 'waived'
                    AND COALESCE(sis.revised_due_date, sis.due_date) < v_current_local_date
                    AND (sis.amount_paid + sis.waiver_amount) < sis.amount_due
                )
              )
            )
          )
      )

    UNION

    -- Branch 2: Authorized Installment Agreements
    -- Strict evaluation adhering to Migrations 240–242:
    -- - Review must not be required (uses production COALESCE(sca.requires_admin_review, false) = false).
    -- - Completed agreements grant access only when outstanding_balance <= 0 and
    --   all non-waived schedule rows are fully paid.
    -- - Active agreements must have zero overdue balance, zero dynamic arrears,
    --   and no unpaid schedule rows before current institute-local date.
    SELECT sca.course_id
    FROM public.student_course_agreements sca
    WHERE sca.student_id = v_student_id
      AND COALESCE(sca.requires_admin_review, false) = false
      AND (
        -- Completed agreement with fully settled balance and no unpaid schedule rows
        (
          sca.agreement_status = 'completed'
          AND COALESCE(sca.outstanding_balance, 0.00) <= 0.00
          AND NOT EXISTS (
            SELECT 1 FROM public.student_installment_schedule sis
            WHERE sis.agreement_id = sca.agreement_id
              AND sis.status <> 'waived'
              AND (sis.amount_paid + sis.waiver_amount) < sis.amount_due
          )
        )
        OR
        -- Active agreement in good standing
        (
          sca.agreement_status = 'active'
          AND COALESCE(sca.overdue_balance, 0.00) <= 0.00
          AND public.calculate_effective_overdue_balance(sca.agreement_id, v_current_local_date) <= 0.00
          AND NOT EXISTS (
            SELECT 1 FROM public.student_installment_schedule sis
            WHERE sis.agreement_id = sca.agreement_id
              AND sis.status <> 'waived'
              AND COALESCE(sis.revised_due_date, sis.due_date) < v_current_local_date
              AND (sis.amount_paid + sis.waiver_amount) < sis.amount_due
          )
        )
      )
  ),

  batch_course_map AS (
    SELECT DISTINCT ON (cb.batch_id)
      cb.batch_id,
      cb.course_id,
      c.title::text AS course_title
    FROM public.course_batches cb
    JOIN student_entitled_courses sec
      ON sec.course_id = cb.course_id
    JOIN public.courses c
      ON c.course_id = cb.course_id
    WHERE cb.institute_id = v_institute_id
      AND c.institute_id = v_institute_id
      AND c.status = 'published'
      AND c.deleted_at IS NULL
    ORDER BY
      cb.batch_id,
      c.created_at ASC NULLS LAST,
      cb.course_id
  )

  SELECT
    bs.batch_subject_id,
    bs.batch_id,
    bs.is_active,
    bs.subject_id,
    COALESCE(s.name, 'General Subject')::text AS subject_name,
    COALESCE(b.name, 'Batch')::text AS batch_name,
    bcm.course_id,
    bcm.course_title::text AS course_title
  FROM public.batch_subjects bs
  JOIN student_active_batches sab
    ON sab.batch_id = bs.batch_id
  JOIN public.batches b
    ON b.batch_id = bs.batch_id
  JOIN public.subjects s
    ON s.subject_id = bs.subject_id
    AND s.deleted_at IS NULL
  LEFT JOIN batch_course_map bcm
    ON bcm.batch_id = bs.batch_id
  WHERE bs.institute_id = v_institute_id
    AND bs.is_active = true
  ORDER BY
    bs.batch_id,
    bs.sort_order ASC NULLS LAST,
    bs.created_at ASC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_student_batch_subjects(uuid[]) IS
  'Returns authorized batch subjects for active batch memberships and entitled courses. Installment access is strictly gated by arrears lockout and timezone-aware schedule evaluation without subscription table dependencies.';

REVOKE ALL ON FUNCTION public.get_student_batch_subjects(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_batch_subjects(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_batch_subjects(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_batch_subjects(uuid[]) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: delete_user_account_data
-- ────────────────────────────────────────────────────────────────────────────
-- Uses actual production definition (Migration 236 baseline).
-- Removes ONLY the 6 deletion statements targeting subscription tables:
--   - public.subscription_usage
--   - public.subscription_grace_periods
--   - public.subscription_cancellations
--   - public.subscription_renewals
--   - public.subscription_history
--   - public.student_subscriptions
-- Preserves all other cascade deletion logic, audit outbox, anonymization, and permissions.

CREATE OR REPLACE FUNCTION public.delete_user_account_data(
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id            uuid;
  v_teacher_id            uuid;
  v_role                  public.user_role;
  v_pending_storage_paths jsonb := '[]'::jsonb;
BEGIN
  -- 1. Validate Input
  IF p_target_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_profile_id cannot be null');
  END IF;

  -- 2. Inspect Target Profile
  SELECT role INTO v_role
  FROM public.profiles
  WHERE profile_id = p_target_profile_id;

  -- If profile already does not exist (idempotent retry), retrieve child IDs from durable record
  IF NOT FOUND THEN
    SELECT student_id, teacher_id, pending_storage_paths
    INTO v_student_id, v_teacher_id, v_pending_storage_paths
    FROM public.account_deletion_records
    WHERE profile_id = p_target_profile_id;

    RETURN jsonb_build_object(
      'success', true,
      'profile_id', p_target_profile_id,
      'student_id', v_student_id,
      'teacher_id', v_teacher_id,
      'pending_storage_paths', COALESCE(v_pending_storage_paths, '[]'::jsonb),
      'message', 'Profile row already deleted or does not exist.'
    );
  END IF;

  -- 3. Resolve Child Identity IDs (student_id, teacher_id)
  SELECT student_id INTO v_student_id
  FROM public.student_details
  WHERE profile_id = p_target_profile_id;

  SELECT teacher_id INTO v_teacher_id
  FROM public.teacher_details
  WHERE profile_id = p_target_profile_id;

  -- 4. Durably Snapshot Pending Storage Paths BEFORE metadata is deleted
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'bucket', t.bucket,
        'storage_path', t.storage_path
      )
    ),
    '[]'::jsonb
  )
  INTO v_pending_storage_paths
  FROM (
    SELECT DISTINCT da.bucket, da.storage_path
    FROM public.doubt_attachments da
    WHERE da.uploaded_by = p_target_profile_id
       OR (v_student_id IS NOT NULL AND da.doubt_id IN (
         SELECT sd.doubt_id
         FROM public.student_doubts sd
         WHERE sd.student_id = v_student_id
       ))
  ) t;

  -- Durably record child identifiers and pending storage paths before rows are removed
  INSERT INTO public.account_deletion_records (
    profile_id, student_id, teacher_id, user_role, status, pending_storage_paths, updated_at
  )
  VALUES (
    p_target_profile_id, v_student_id, v_teacher_id, v_role::text, 'db_in_progress', v_pending_storage_paths, now()
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET student_id = COALESCE(excluded.student_id, public.account_deletion_records.student_id),
      teacher_id = COALESCE(excluded.teacher_id, public.account_deletion_records.teacher_id),
      user_role  = COALESCE(excluded.user_role, public.account_deletion_records.user_role),
      pending_storage_paths = CASE
        WHEN public.account_deletion_records.pending_storage_paths IS NOT NULL
             AND jsonb_array_length(public.account_deletion_records.pending_storage_paths) > 0
          THEN public.account_deletion_records.pending_storage_paths
        ELSE excluded.pending_storage_paths
      END,
      status     = 'db_in_progress',
      updated_at = now();

  -- ─── 4. Anonymize Financial Records (Invoices & Orders) ────────────────────
  UPDATE public.invoices
  SET billing_name = 'Deleted User',
      billing_email = 'deleted@makemetopper.com',
      billing_address = 'REDACTED',
      billing_gstin = null
  WHERE order_id IN (
    SELECT order_id
    FROM public.orders
    WHERE profile_id = p_target_profile_id
       OR (v_student_id IS NOT NULL AND student_id = v_student_id)
  );

  UPDATE public.orders
  SET profile_id = null,
      student_id = null,
      notes = CASE
        WHEN notes IS NOT NULL THEN notes || ' [Account Deleted]'
        ELSE '[Account Deleted]'
      END
  WHERE profile_id = p_target_profile_id
     OR (v_student_id IS NOT NULL AND student_id = v_student_id);

  -- ─── 5. Student-Specific Dependent Cleanup (Strict Bottom-Up Order) ────────
  IF v_student_id IS NOT NULL THEN
    -- A. Assessment details (answers & options)
    DELETE FROM public.mock_answer_options
    WHERE answer_id IN (
      SELECT ma.answer_id
      FROM public.mock_answers ma
      JOIN public.mock_attempts mat ON ma.attempt_id = mat.attempt_id
      WHERE mat.student_id = v_student_id
    );

    DELETE FROM public.mock_answers
    WHERE attempt_id IN (
      SELECT attempt_id
      FROM public.mock_attempts
      WHERE student_id = v_student_id
    );

    -- B. Student analytics & progress history
    DELETE FROM public.progress_history
    WHERE student_id = v_student_id
       OR attempt_id IN (
         SELECT attempt_id
         FROM public.mock_attempts
         WHERE student_id = v_student_id
       );

    DELETE FROM public.chapter_performances WHERE student_id = v_student_id;
    DELETE FROM public.subject_performances WHERE student_id = v_student_id;
    DELETE FROM public.performance_reports WHERE student_id = v_student_id;

    -- C. Assessment results & attempts
    DELETE FROM public.mock_results
    WHERE student_id = v_student_id
       OR attempt_id IN (
         SELECT attempt_id
         FROM public.mock_attempts
         WHERE student_id = v_student_id
       );

    DELETE FROM public.mock_attempts WHERE student_id = v_student_id;

    -- D. Batches, Enrollments, and Attendance
    DELETE FROM public.batch_students WHERE student_id = v_student_id;
    DELETE FROM public.course_enrollments WHERE student_id = v_student_id;

    DELETE FROM public.session_participants
    WHERE (v_student_id IS NOT NULL AND student_id = v_student_id)
       OR profile_id = p_target_profile_id;

    DELETE FROM public.attendance_events WHERE student_id = v_student_id;
    DELETE FROM public.attendance WHERE student_id = v_student_id;

    -- E. PYQ purchases (subscription deletions retired)
    DELETE FROM public.student_pyq_purchases WHERE student_id = v_student_id;

    -- F. Notes, Bookmarks, Downloads, Doubts & Live Chat
    DELETE FROM public.student_personal_notes WHERE student_id = v_student_id;
    DELETE FROM public.student_bookmarks WHERE student_id = v_student_id;
    DELETE FROM public.student_downloads WHERE student_id = v_student_id;
    DELETE FROM public.student_viewing_history WHERE student_id = v_student_id;
    DELETE FROM public.student_feedback_ratings WHERE student_id = v_student_id;

    DELETE FROM public.support_ticket_messages
    WHERE sender_profile_id = p_target_profile_id
       OR ticket_id IN (
         SELECT ticket_id
         FROM public.support_tickets
         WHERE student_id = v_student_id
       );

    DELETE FROM public.support_tickets WHERE student_id = v_student_id;

    DELETE FROM public.doubt_attachments
    WHERE uploaded_by = p_target_profile_id
       OR doubt_id IN (
         SELECT doubt_id
         FROM public.student_doubts
         WHERE student_id = v_student_id
       );

    DELETE FROM public.doubt_replies
    WHERE author_profile_id = p_target_profile_id
       OR doubt_id IN (
         SELECT doubt_id
         FROM public.student_doubts
         WHERE student_id = v_student_id
       );

    DELETE FROM public.student_doubts WHERE student_id = v_student_id;

    DELETE FROM public.messages
    WHERE sender_profile_id = p_target_profile_id
       OR conversation_id IN (
         SELECT conversation_id
         FROM public.conversations
         WHERE student_id = v_student_id
       );

    DELETE FROM public.conversations WHERE student_id = v_student_id;

    -- G. Clean up Course Installment Agreements & Dependent Schedules
    UPDATE public.order_items
    SET agreement_id = null
    WHERE (v_student_id IS NOT NULL AND agreement_id IN (
      SELECT agreement_id
      FROM public.student_course_agreements
      WHERE student_id = v_student_id
    )) OR order_id IN (
      SELECT order_id
      FROM public.orders
      WHERE profile_id = p_target_profile_id
         OR (v_student_id IS NOT NULL AND student_id = v_student_id)
    );

    UPDATE public.webhook_quarantine_events
    SET agreement_id = null
    WHERE agreement_id IN (
      SELECT agreement_id
      FROM public.student_course_agreements
      WHERE student_id = v_student_id
    );

    DELETE FROM public.installment_dispute_restorations
    WHERE adjustment_id IN (
      SELECT adjustment_id
      FROM public.installment_adjustments
      WHERE agreement_id IN (
        SELECT agreement_id
        FROM public.student_course_agreements
        WHERE student_id = v_student_id
      )
    );

    DELETE FROM public.installment_adjustments
    WHERE agreement_id IN (
      SELECT agreement_id
      FROM public.student_course_agreements
      WHERE student_id = v_student_id
    );

    DELETE FROM public.installment_payment_allocations
    WHERE agreement_id IN (
      SELECT agreement_id
      FROM public.student_course_agreements
      WHERE student_id = v_student_id
    );

    DELETE FROM public.student_installment_schedule
    WHERE agreement_id IN (
      SELECT agreement_id
      FROM public.student_course_agreements
      WHERE student_id = v_student_id
    );

    DELETE FROM public.student_course_agreements WHERE student_id = v_student_id;

    -- Clean up order entitlement grants for standard checkouts
    DELETE FROM public.order_entitlement_grants WHERE student_id = v_student_id;

    -- H. Delete student_details row
    DELETE FROM public.student_details
    WHERE student_id = v_student_id
       OR profile_id = p_target_profile_id;
  END IF;

  -- ─── 6. Teacher-Specific Dependent Cleanup ─────────────────────────────────
  IF v_teacher_id IS NOT NULL THEN
    DELETE FROM public.teacher_analytics WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_availability WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_bank_details WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_documents WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_employment_records WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_experiences WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_leave_requests WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_leaves WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_qualifications WHERE teacher_id = v_teacher_id;
    DELETE FROM public.teacher_specializations WHERE teacher_id = v_teacher_id;
    DELETE FROM public.batch_teachers WHERE teacher_id = v_teacher_id;
    DELETE FROM public.batch_subject_teachers WHERE teacher_id = v_teacher_id;
    DELETE FROM public.course_teachers WHERE teacher_id = v_teacher_id;

    DELETE FROM public.messages
    WHERE conversation_id IN (
      SELECT conversation_id
      FROM public.conversations
      WHERE teacher_id = v_teacher_id
    );

    DELETE FROM public.conversations WHERE teacher_id = v_teacher_id;

    UPDATE public.mock_tests SET teacher_id = null WHERE teacher_id = v_teacher_id;
    UPDATE public.content SET teacher_id = null WHERE teacher_id = v_teacher_id;

    UPDATE public.student_doubts
    SET assigned_to = null, assigned_at = null
    WHERE assigned_to = v_teacher_id;

    UPDATE public.class_resolution_events SET new_teacher_id = null WHERE new_teacher_id = v_teacher_id;
    UPDATE public.class_resolution_events SET prev_teacher_id = null WHERE prev_teacher_id = v_teacher_id;

    DELETE FROM public.approval_requests
    WHERE teacher_id = v_teacher_id
       OR requested_by = p_target_profile_id;

    DELETE FROM public.teacher_details
    WHERE teacher_id = v_teacher_id
       OR profile_id = p_target_profile_id;
  END IF;

  -- ─── 7. Unlink Created_by / Reviewed_by in Institutional Content ───────────
  UPDATE public.trusted_devices SET approved_by = null WHERE approved_by = p_target_profile_id;
  UPDATE public.teacher_bank_details SET verified_by = null WHERE verified_by = p_target_profile_id;
  UPDATE public.teacher_documents SET verified_by = null WHERE verified_by = p_target_profile_id;
  UPDATE public.teacher_experiences SET verified_by = null WHERE verified_by = p_target_profile_id;
  UPDATE public.teacher_qualifications SET verified_by = null WHERE verified_by = p_target_profile_id;
  UPDATE public.teacher_leave_requests SET reviewed_by = null WHERE reviewed_by = p_target_profile_id;
  UPDATE public.approval_requests SET reviewed_by = null WHERE reviewed_by = p_target_profile_id;
  UPDATE public.installment_adjustments SET approved_by_admin_id = null WHERE approved_by_admin_id = p_target_profile_id;

  UPDATE public.support_tickets SET assigned_to = null WHERE assigned_to = p_target_profile_id;
  UPDATE public.notifications SET triggered_by = null WHERE triggered_by = p_target_profile_id;
  UPDATE public.notification_templates SET updated_by = null WHERE updated_by = p_target_profile_id;

  UPDATE public.content SET created_by = null WHERE created_by = p_target_profile_id;
  UPDATE public.mock_tests SET created_by = null WHERE created_by = p_target_profile_id;

  IF v_role IN ('admin', 'teacher') THEN
    UPDATE public.streams SET created_by = null WHERE created_by = p_target_profile_id;
    UPDATE public.streams SET updated_by = null WHERE updated_by = p_target_profile_id;
    UPDATE public.subjects SET created_by = null WHERE created_by = p_target_profile_id;
    UPDATE public.subjects SET updated_by = null WHERE updated_by = p_target_profile_id;
    UPDATE public.chapters SET created_by = null WHERE created_by = p_target_profile_id;
    UPDATE public.chapters SET updated_by = null WHERE updated_by = p_target_profile_id;
    UPDATE public.topics SET created_by = null WHERE created_by = p_target_profile_id;
    UPDATE public.topics SET updated_by = null WHERE updated_by = p_target_profile_id;
    UPDATE public.batches SET created_by = null WHERE created_by = p_target_profile_id;
    UPDATE public.batches SET updated_by = null WHERE updated_by = p_target_profile_id;
    UPDATE public.courses SET created_by = null WHERE created_by = p_target_profile_id;
    UPDATE public.courses SET updated_by = null WHERE updated_by = p_target_profile_id;
    UPDATE public.pyq_papers SET created_by = null WHERE created_by = p_target_profile_id;
    UPDATE public.pyq_papers SET updated_by = null WHERE updated_by = p_target_profile_id;
  END IF;

  -- ─── 8. Session, Tokens, Roles & Devices ───────────────────────────────────
  DELETE FROM public.session_participants WHERE profile_id = p_target_profile_id;
  DELETE FROM public.trusted_devices WHERE profile_id = p_target_profile_id;
  DELETE FROM public.notification_recipients WHERE profile_id = p_target_profile_id;
  DELETE FROM public.device_tokens WHERE profile_id = p_target_profile_id;
  DELETE FROM public.user_device_sessions WHERE profile_id = p_target_profile_id;
  DELETE FROM public.admin_roles WHERE profile_id = p_target_profile_id;

  -- ─── 9. Delete the User Profile ───────────────────────────────────────────
  DELETE FROM public.profiles
  WHERE profile_id = p_target_profile_id;

  UPDATE public.account_deletion_records
  SET status = 'db_completed',
      updated_at = now()
  WHERE profile_id = p_target_profile_id;

  RETURN jsonb_build_object(
    'success', true,
    'profile_id', p_target_profile_id,
    'student_id', v_student_id,
    'teacher_id', v_teacher_id,
    'pending_storage_paths', COALESCE(v_pending_storage_paths, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account_data(uuid) FROM public;
REVOKE ALL ON FUNCTION public.delete_user_account_data(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account_data(uuid) TO service_role;

COMMENT ON FUNCTION public.delete_user_account_data(uuid) IS
  'Performs atomic, cascade deletion and legal anonymization of all user-owned data without subscription table dependencies.';

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: complete_google_play_purchase
-- ────────────────────────────────────────────────────────────────────────────
-- Decouples Google Play purchase processing from subscription infrastructure.
-- Baseline: Migration 218 (authoritative production definition).
-- Functional Changes:
--   1. Explicitly rejects 'subscription_plan' purchases immediately before mutations or locking.
--   2. Removes subscription plan resolution and pricing validation.
--   3. Removes subscription renewal-cycle processing, student_subscriptions creation/updates,
--      and subscription renewals/history writes.
--   4. Preserves 100% of production course and PYQ package purchase processing:
--      - Original ownership comparisons (v_token_profile_id <> p_profile_id)
--      - Original order-item validation (existence, item_type, course_id / package_id)
--      - Original PYQ parameter and order-item handling (compatible with Edge Function)
--      - Original order notes structure (including 'planId', p_plan_id)
--      - Original advisory locking, staff protection, institute scoping, and RTDN lease verification
--      - Original 18-parameter function signature, security definer, and service_role grant.

CREATE OR REPLACE FUNCTION public.complete_google_play_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_student_id uuid,
    p_item_type text, -- 'course', 'subscription_plan', 'pyq_package'
    p_course_id uuid DEFAULT null,
    p_plan_id uuid DEFAULT null,
    p_package_id uuid DEFAULT null,
    p_item_name text DEFAULT 'Educational Product',
    p_unit_price numeric DEFAULT 0.00,
    p_effective_order_id text DEFAULT null,
    p_purchase_token text DEFAULT null,
    p_product_id text DEFAULT null,
    p_gateway_response jsonb DEFAULT null,
    p_transaction_timestamp timestamptz DEFAULT now(),
    p_subscription_end_date date DEFAULT null,
    p_is_auto_renew boolean DEFAULT true,
    p_billing_name text DEFAULT null,
    p_billing_email text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role                 text;
  v_current_rtdn_attempts       integer := null;
  v_current_rtdn_status         text := null;
  v_existing_payment_id         uuid := null;
  v_existing_order_id           uuid := null;
  v_existing_payment_profile_id uuid := null;
  v_existing_gateway_payment_id text := null;
  v_existing_gateway_order_id   text := null;
  v_has_existing_payment        boolean := false;
  v_has_authoritative_order_id  boolean := false;
  v_token_payment_id            uuid := null;
  v_token_order_id              uuid := null;
  v_token_profile_id            uuid := null;
  v_token_gateway_payment_id    text := null;
  v_token_gateway_order_id      text := null;
  v_payment_id                  uuid := null;

  v_existing_item_id            uuid := null;
  v_existing_item_type          public.item_type := null;
  v_existing_item_course_id     uuid := null;
  v_existing_item_plan_id       uuid := null;
  v_existing_item_package_id    uuid := null;

  v_order_id                    uuid := null;
  v_item_id                     uuid := null;
  v_order_notes                 jsonb;
  v_student_id                  uuid := null;
  v_profile_role                public.user_role;
  v_profile_institute_id        uuid;
  v_resolved_institute_id       uuid;
  v_effective_course_id         uuid;

  v_course_course_id            uuid := null;
  v_course_institute_id         uuid := null;

  v_package_package_id          uuid := null;
  v_package_institute_id        uuid := null;

  v_enrollment_no               varchar(50);

  v_entitlement                 text := '';
  v_entitlement_active          boolean := false;
  v_skip_payment_insert         boolean := false;
  v_year                        text;
  v_invoice_num                 text;

  v_token_lock_key              bigint := null;
  v_order_lock_key              bigint := null;
  v_first_lock_key              bigint;
  v_second_lock_key             bigint;
BEGIN
  -- 0. Security Guard: Only service_role (Edge Function backend) may execute this RPC
  v_caller_role := auth.role();
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: complete_google_play_purchase requires service_role privileges',
      'code', 'FORBIDDEN'
    );
  END IF;

  -- Explicitly reject subscription_plan requests immediately before mutations or locking
  IF p_item_type = 'subscription_plan' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Subscription purchases are retired. Please purchase individual courses or PYQ packages.',
      'code', 'SUBSCRIPTIONS_RETIRED'
    );
  END IF;

  -- 1. Global Advisory Lock: Serialize concurrent verification requests sharing purchase token or order ID
  IF p_purchase_token IS NOT NULL AND p_purchase_token <> '' THEN
    v_token_lock_key := hashtext('google_play_token:' || p_purchase_token);
  END IF;

  IF p_effective_order_id IS NOT NULL AND p_effective_order_id <> '' THEN
    v_order_lock_key := hashtext('google_play_order:' || p_effective_order_id);
  END IF;

  IF v_token_lock_key IS NOT NULL AND v_order_lock_key IS NOT NULL THEN
    IF v_token_lock_key = v_order_lock_key THEN
      PERFORM pg_advisory_xact_lock(v_token_lock_key);
    ELSE
      v_first_lock_key := least(v_token_lock_key, v_order_lock_key);
      v_second_lock_key := greatest(v_token_lock_key, v_order_lock_key);
      PERFORM pg_advisory_xact_lock(v_first_lock_key);
      PERFORM pg_advisory_xact_lock(v_second_lock_key);
    END IF;
  ELSIF v_token_lock_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(v_token_lock_key);
  ELSIF v_order_lock_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(v_order_lock_key);
  END IF;

  -- 1b. Durable RTDN Event Ledger Ownership Verification
  IF p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL AND COALESCE(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' THEN
    SELECT attempts, processing_status
    INTO v_current_rtdn_attempts, v_current_rtdn_status
    FROM public.google_play_rtdn_events
    WHERE event_id = (p_gateway_response->>'rtdn_event_id')::uuid
    FOR UPDATE;

    IF NOT FOUND OR v_current_rtdn_attempts != (p_gateway_response->>'rtdn_attempt')::integer OR v_current_rtdn_status != 'processing' THEN
      RETURN jsonb_build_object(
        'success', false,
        'action', 'abort_stale_worker',
        'error', 'STALE_LEASE_LOST: RTDN event lease ownership was lost to another worker',
        'code', 'STALE_LEASE_LOST'
      );
    END IF;
  END IF;

  -- 2. Validate Profile Existence and Lock Profile Row
  SELECT p.role, p.institute_id
  INTO v_profile_role, v_profile_institute_id
  FROM public.profiles p
  WHERE p.profile_id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User profile not found for profile_id ' || COALESCE(p_profile_id::text, 'null'),
      'code', 'PROFILE_NOT_FOUND'
    );
  END IF;

  -- 3. Staff Role Protection
  IF v_profile_role::text NOT IN ('user', 'student')
     OR EXISTS (
       SELECT 1
       FROM public.admin_roles ar
       WHERE ar.profile_id = p_profile_id
         AND ar.access_status = 'approved'::public.admin_access_status
     )
     OR EXISTS (
       SELECT 1
       FROM public.teacher_details td
       WHERE td.profile_id = p_profile_id
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Profile role ''' || v_profile_role::text || ''' is not eligible for student checkout. Staff accounts cannot be converted to students.',
      'code', 'FORBIDDEN_ROLE'
    );
  END IF;

  -- 4. Multi-Tenant Institute Validation
  IF p_institute_id IS NOT NULL AND v_profile_institute_id IS NOT NULL AND p_institute_id <> v_profile_institute_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Institute mismatch: requested institute does not match profile institute.',
      'code', 'INSTITUTE_MISMATCH'
    );
  END IF;
  v_resolved_institute_id := COALESCE(v_profile_institute_id, p_institute_id);

  -- 5. Product & Association Integrity Validation BEFORE Mutations
  v_effective_course_id := p_course_id;

  IF p_item_type = 'course' THEN
    IF v_effective_course_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_course_id is required for course purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    END IF;

    SELECT c.course_id, c.institute_id
    INTO v_course_course_id, v_course_institute_id
    FROM public.courses c
    WHERE c.course_id = v_effective_course_id;

    IF v_course_course_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Course not found for course_id ' || v_effective_course_id::text,
        'code', 'COURSE_NOT_FOUND'
      );
    END IF;

    IF v_resolved_institute_id IS NULL OR v_course_institute_id IS NULL OR v_course_institute_id <> v_resolved_institute_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Course does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    END IF;

  ELSIF p_item_type = 'pyq_package' THEN
    IF p_package_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_package_id is required for pyq_package purchase.',
        'code', 'INVALID_PURCHASE_PAYLOAD'
      );
    END IF;

    SELECT pp.package_id, pp.institute_id
    INTO v_package_package_id, v_package_institute_id
    FROM public.pyq_packages pp
    WHERE pp.package_id = p_package_id;

    IF v_package_package_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PYQ package not found for package_id ' || p_package_id::text,
        'code', 'PACKAGE_NOT_FOUND'
      );
    END IF;

    IF v_resolved_institute_id IS NULL OR v_package_institute_id IS NULL OR v_package_institute_id <> v_resolved_institute_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PYQ package does not belong to the user''s institute.',
        'code', 'INSTITUTE_MISMATCH'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid item_type ''' || COALESCE(p_item_type, 'null') || '''. Must be course or pyq_package.',
      'code', 'INVALID_ITEM_TYPE'
    );
  END IF;

  -- 6. Defensively resolve existing student_details record strictly scoped to p_profile_id
  SELECT sd.student_id INTO v_student_id
  FROM public.student_details sd
  WHERE sd.profile_id = p_profile_id;

  IF p_student_id IS NOT NULL THEN
    IF v_student_id IS NOT NULL AND v_student_id <> p_student_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Supplied student_id does not match the profile''s existing student record.',
        'code', 'STUDENT_PROFILE_MISMATCH'
      );
    ELSIF v_student_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.student_details sd WHERE sd.student_id = p_student_id AND sd.profile_id <> p_profile_id) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Supplied student_id belongs to a different user account.',
          'code', 'STUDENT_PROFILE_MISMATCH'
        );
      END IF;
    END IF;
  END IF;

  -- 7. Idempotency Check (Token & External Order ID)
  v_has_authoritative_order_id := (
    p_effective_order_id IS NOT NULL
    AND btrim(p_effective_order_id) <> ''
  );

  SELECT p.payment_id, p.order_id, o.profile_id, p.gateway_payment_id, p.gateway_order_id
  INTO v_token_payment_id, v_token_order_id, v_token_profile_id, v_token_gateway_payment_id, v_token_gateway_order_id
  FROM public.payments p
  JOIN public.orders o ON o.order_id = p.order_id
  WHERE p.gateway = 'google_play'
    AND p.status = 'captured'
    AND p_purchase_token IS NOT NULL
    AND (
      (p.gateway_response ->> 'purchaseToken') = p_purchase_token
      OR substring(o.notes FROM '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token
    )
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_token_payment_id IS NOT NULL AND v_token_profile_id <> p_profile_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
      'code', 'ACCOUNT_MISMATCH'
    );
  END IF;

  IF v_has_authoritative_order_id THEN
    SELECT p.payment_id, p.order_id, o.profile_id, p.gateway_payment_id, p.gateway_order_id
    INTO v_existing_payment_id, v_existing_order_id, v_existing_payment_profile_id, v_existing_gateway_payment_id, v_existing_gateway_order_id
    FROM public.payments p
    JOIN public.orders o ON o.order_id = p.order_id
    WHERE p.gateway = 'google_play'
      AND p.status = 'captured'
      AND (p.gateway_payment_id = p_effective_order_id OR p.gateway_order_id = p_effective_order_id)
    ORDER BY p.created_at DESC
    LIMIT 1;

    IF v_existing_payment_id IS NOT NULL AND v_existing_payment_profile_id <> p_profile_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This purchase has already been claimed by another account. Please sign in with the original account or contact support.',
        'code', 'ACCOUNT_MISMATCH'
      );
    END IF;
  END IF;

  -- One-shot idempotency for course / package purchases: token match or order ID match is authoritative
  IF v_existing_payment_id IS NULL AND v_token_payment_id IS NOT NULL THEN
    v_existing_payment_id := v_token_payment_id;
    v_existing_order_id := v_token_order_id;
    v_existing_payment_profile_id := v_token_profile_id;
  END IF;

  v_has_existing_payment := (v_existing_payment_id IS NOT NULL);

  IF v_has_existing_payment THEN
    -- Load existing order item to verify consistency
    SELECT oi.item_id, oi.item_type, oi.course_id, oi.plan_id, oi.package_id
    INTO v_existing_item_id, v_existing_item_type, v_existing_item_course_id, v_existing_item_plan_id, v_existing_item_package_id
    FROM public.order_items oi
    WHERE oi.order_id = v_existing_order_id
    LIMIT 1;

    IF v_existing_item_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Existing payment has no associated order items. Failing closed to prevent inconsistent order state.',
        'code', 'ORDER_ITEM_MISSING_FOR_CAPTURED_PAYMENT',
        'orderId', v_existing_order_id
      );
    END IF;

    IF v_existing_item_type::text <> p_item_type THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Existing order item type (' || v_existing_item_type::text || ') does not match purchase item type (' || p_item_type || ').',
        'code', 'ORDER_ITEM_MISMATCH',
        'orderId', v_existing_order_id
      );
    END IF;

    IF p_item_type = 'course' THEN
      IF v_existing_item_course_id IS DISTINCT FROM v_effective_course_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order item course_id does not match purchase course_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      END IF;
    ELSIF p_item_type = 'pyq_package' THEN
      IF v_existing_item_package_id IS DISTINCT FROM p_package_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order item package_id does not match purchase package_id.',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_existing_order_id
        );
      END IF;
    END IF;

    -- Check if entitlement is currently active for this student
    v_entitlement_active := false;
    IF v_student_id IS NOT NULL THEN
      IF p_item_type = 'course' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.course_enrollments
          WHERE course_id = v_effective_course_id
            AND student_id = v_student_id
            AND is_active = true
        ) INTO v_entitlement_active;
      ELSIF p_item_type = 'pyq_package' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.student_pyq_purchases
          WHERE package_id = p_package_id
            AND student_id = v_student_id
            AND is_active = true
        ) INTO v_entitlement_active;
      END IF;
    END IF;

    IF v_entitlement_active THEN
      IF v_profile_role::text = 'user' THEN
        UPDATE public.profiles
        SET role = 'student'::public.user_role,
            updated_at = p_transaction_timestamp
        WHERE profile_id = p_profile_id;
        v_profile_role := 'student'::public.user_role;
      END IF;

      IF p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL AND COALESCE(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' THEN
        UPDATE public.google_play_rtdn_events
        SET processing_status = 'completed',
            order_id = p_effective_order_id,
            cycle_index = COALESCE(substring(p_effective_order_id FROM '\.\.([0-9]+)')::integer, 0),
            processed_at = clock_timestamp(),
            error_message = null
        WHERE event_id = (p_gateway_response->>'rtdn_event_id')::uuid
          AND attempts = v_current_rtdn_attempts;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'verified', true,
        'outcome', 'already_recorded',
        'alreadyProcessed', true,
        'paymentId', v_existing_payment_id,
        'orderId', v_existing_order_id,
        'cycleIndex', -1,
        'rtdn_completed', (p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL),
        'message', 'Purchase already processed and entitlement active'
      );
    END IF;

    -- Entitlement is missing/inactive despite captured payment.
    -- Safely remediate: reuse existing order and item, skip duplicate payment insert,
    -- and proceed to ensure student role/details and grant the missing entitlement.
    v_order_id := v_existing_order_id;
    v_item_id := v_existing_item_id;
    v_skip_payment_insert := true;
  END IF;

  -- 8. Check for existing unfulfilled order with this purchaseToken / orderId
  IF v_order_id IS NULL THEN
    SELECT o.order_id
    INTO v_order_id
    FROM public.orders o
    WHERE o.profile_id = p_profile_id
      AND (
        (p_effective_order_id IS NOT NULL AND substring(o.notes FROM '"orderId"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_effective_order_id)
        OR (p_purchase_token IS NOT NULL AND substring(o.notes FROM '"purchaseToken"[[:space:]]*:[[:space:]]*"([^"]+)"') = p_purchase_token)
      )
    LIMIT 1;

    IF v_order_id IS NOT NULL THEN
      SELECT oi.item_id, oi.item_type, oi.course_id, oi.plan_id, oi.package_id
      INTO v_existing_item_id, v_existing_item_type, v_existing_item_course_id, v_existing_item_plan_id, v_existing_item_package_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
      LIMIT 1;

      IF v_existing_item_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order found for this purchase token but it has no associated order items. Failing closed to prevent partial order processing.',
          'code', 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
          'orderId', v_order_id
        );
      END IF;

      IF v_existing_item_type::text <> p_item_type THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Existing order item type (' || v_existing_item_type::text || ') does not match purchase item type (' || p_item_type || ').',
          'code', 'ORDER_ITEM_MISMATCH',
          'orderId', v_order_id
        );
      END IF;

      IF p_item_type = 'course' THEN
        IF v_existing_item_course_id IS DISTINCT FROM v_effective_course_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Existing order item course_id does not match purchase course_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        END IF;
      ELSIF p_item_type = 'pyq_package' THEN
        IF v_existing_item_package_id IS DISTINCT FROM p_package_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Existing order item package_id does not match purchase package_id.',
            'code', 'ORDER_ITEM_MISMATCH',
            'orderId', v_order_id
          );
        END IF;
      END IF;

      v_item_id := v_existing_item_id;
    END IF;
  END IF;

  -- 9. Atomic Role Transition: Promote role = 'user' to 'student'
  IF v_profile_role::text = 'user' THEN
    UPDATE public.profiles
    SET role = 'student'::public.user_role,
        updated_at = p_transaction_timestamp
    WHERE profile_id = p_profile_id;
    v_profile_role := 'student'::public.user_role;
  END IF;

  -- 10. Student Details Resolution & Initialization
  IF v_student_id IS NULL THEN
    BEGIN
      v_enrollment_no := public.generate_enrollment_number(v_resolved_institute_id);
    EXCEPTION WHEN OTHERS THEN
      v_enrollment_no := 'ENR-' || to_char(current_date, 'YYYY') || '-' || lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    END;

    INSERT INTO public.student_details (
      profile_id,
      institute_id,
      enrollment_no,
      enrolled_on,
      created_at,
      updated_at
    ) VALUES (
      p_profile_id,
      v_resolved_institute_id,
      v_enrollment_no,
      (p_transaction_timestamp AT TIME ZONE 'utc')::date,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    ON CONFLICT (profile_id) DO UPDATE
      SET updated_at = p_transaction_timestamp
    RETURNING student_id INTO v_student_id;
  END IF;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Failed to resolve or initialize student_details for profile %', p_profile_id;
  END IF;

  -- 11. Build structured order notes with correlation metadata
  v_order_notes := jsonb_build_object(
    'gateway', 'google_play',
    'purchaseToken', p_purchase_token,
    'orderId', p_effective_order_id,
    'productId', p_product_id,
    'itemType', p_item_type,
    'courseId', v_effective_course_id,
    'planId', p_plan_id,
    'packageId', p_package_id
  );

  -- 12. Insert Order and Order Item if new
  IF v_order_id IS NULL THEN
    INSERT INTO public.orders (
      institute_id,
      student_id,
      profile_id,
      status,
      currency,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      notes,
      placed_at,
      confirmed_at,
      created_at,
      updated_at
    ) VALUES (
      v_resolved_institute_id,
      v_student_id,
      p_profile_id,
      'confirmed',
      'INR'::public.currency_code,
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      v_order_notes,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    RETURNING order_id INTO v_order_id;

    INSERT INTO public.order_items (
      order_id,
      institute_id,
      item_type,
      course_id,
      plan_id,
      package_id,
      item_name,
      unit_price,
      quantity,
      discount_amount,
      line_total,
      created_at
    ) VALUES (
      v_order_id,
      v_resolved_institute_id,
      p_item_type::public.item_type,
      v_effective_course_id,
      p_plan_id,
      p_package_id,
      p_item_name,
      p_unit_price,
      1,
      0.00,
      p_unit_price,
      p_transaction_timestamp
    )
    RETURNING item_id INTO v_item_id;
  END IF;

  -- 13. Insert Payment record (unless skipped during remediation)
  IF NOT v_skip_payment_insert THEN
    INSERT INTO public.payments (
      order_id,
      institute_id,
      attempt_number,
      gateway,
      gateway_order_id,
      gateway_payment_id,
      gateway_response,
      amount,
      currency,
      status,
      paid_at,
      created_at,
      updated_at
    ) VALUES (
      v_order_id,
      v_resolved_institute_id,
      1,
      'google_play'::public.payment_gateway,
      p_effective_order_id,
      p_effective_order_id,
      CASE
        WHEN jsonb_typeof(p_gateway_response) = 'object' THEN
          p_gateway_response || jsonb_build_object('purchaseToken', p_purchase_token)
        ELSE
          jsonb_build_object('purchaseToken', p_purchase_token, 'verified', true)
      END,
      p_unit_price,
      'INR'::public.currency_code,
      'captured'::public.payment_status,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    RETURNING payment_id INTO v_payment_id;
  END IF;

  -- 14. Grant One-Time Entitlement
  IF p_item_type = 'course' AND v_effective_course_id IS NOT NULL THEN
    INSERT INTO public.course_enrollments (
      course_id,
      student_id,
      institute_id,
      order_item_id,
      enrollment_type,
      is_active,
      enrolled_at,
      revoked_at,
      revoked_reason
    ) VALUES (
      v_effective_course_id,
      v_student_id,
      v_resolved_institute_id,
      v_item_id,
      'purchase',
      true,
      p_transaction_timestamp,
      null,
      null
    )
    ON CONFLICT (course_id, student_id)
    DO UPDATE SET
      is_active = true,
      enrollment_type = 'purchase',
      order_item_id = COALESCE(excluded.order_item_id, course_enrollments.order_item_id),
      revoked_at = null,
      revoked_reason = null;

    v_entitlement := 'course_enrollment:' || v_effective_course_id::text;

  ELSIF p_item_type = 'pyq_package' AND p_package_id IS NOT NULL THEN
    INSERT INTO public.student_pyq_purchases (
      package_id,
      student_id,
      institute_id,
      order_item_id,
      access_type,
      is_active,
      purchased_at,
      created_at,
      updated_at
    ) VALUES (
      p_package_id,
      v_student_id,
      v_resolved_institute_id,
      v_item_id,
      'lifetime',
      true,
      p_transaction_timestamp,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    ON CONFLICT (package_id, student_id)
    DO UPDATE SET
      is_active = true,
      updated_at = p_transaction_timestamp;

    v_entitlement := 'pyq_package:' || p_package_id::text;
  END IF;

  -- 15. Snapshot draft invoice (non-blocking accounting artifact)
  BEGIN
    v_year := to_char(p_transaction_timestamp, 'YYYY');
    v_invoice_num := 'INV-' || v_year || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

    INSERT INTO public.invoices (
      order_id,
      institute_id,
      invoice_number,
      status,
      issued_at,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount,
      currency,
      billing_name,
      billing_email,
      created_at,
      updated_at
    ) VALUES (
      v_order_id,
      v_resolved_institute_id,
      v_invoice_num,
      'draft',
      p_transaction_timestamp,
      p_unit_price,
      0.00,
      0.00,
      p_unit_price,
      'INR'::public.currency_code,
      p_billing_name,
      p_billing_email,
      p_transaction_timestamp,
      p_transaction_timestamp
    )
    ON CONFLICT (order_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- RTDN Completion
  IF p_gateway_response IS NOT NULL AND (p_gateway_response->>'rtdn_event_id') IS NOT NULL AND COALESCE(p_gateway_response->>'defer_rtdn_completion', 'false') != 'true' THEN
    UPDATE public.google_play_rtdn_events
    SET processing_status = 'completed',
        order_id = p_effective_order_id,
        cycle_index = COALESCE(substring(p_effective_order_id FROM '\.\.([0-9]+)')::integer, 0),
        processed_at = clock_timestamp(),
        error_message = null
    WHERE event_id = (p_gateway_response->>'rtdn_event_id')::uuid
      AND attempts = v_current_rtdn_attempts;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'verified', true,
    'outcome', CASE WHEN v_skip_payment_insert THEN 'already_recorded' ELSE 'purchase_recorded' END,
    'alreadyProcessed', v_skip_payment_insert,
    'paymentId', COALESCE(v_payment_id, v_existing_payment_id),
    'orderId', v_order_id,
    'cycleIndex', -1,
    'entitlement', v_entitlement,
    'message', CASE
                 WHEN v_skip_payment_insert THEN 'Existing captured payment reused; entitlement repaired without a new payment'
                 ELSE 'Google Play one-time purchase processed atomically'
               END
  );
END;
$$;

COMMENT ON FUNCTION public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) IS 'Authoritative atomic handler for one-time course and PYQ Google Play purchases (subscription branch retired).';

REVOKE ALL ON FUNCTION public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_google_play_purchase(
  uuid, uuid, uuid, text, uuid, uuid, uuid, text, numeric, text, text, text, jsonb, timestamptz, date, boolean, text, text
) TO service_role;
