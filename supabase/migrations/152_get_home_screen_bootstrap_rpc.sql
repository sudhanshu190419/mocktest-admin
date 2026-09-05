-- ============================================================================
-- Migration: 077 — Add composite get_home_screen_bootstrap RPC
--
-- Background:
--   During high-concurrency app launches (e.g. 500 simultaneous students),
--   the mobile application fired 8-12 parallel HTTP REST queries per client
--   into PostgREST (profile, unread count, banners, enrolled courses, trending
--   courses, PYQ packages, demo classes, etc.). This caused PostgREST connection
--   pool starvation (PGRST003) and 10+ second client timeouts.
--
-- Solution:
--   Consolidate all initial Home Screen data requirements into a single atomic
--   PostgreSQL function `get_home_screen_bootstrap` that executes in ~10-20ms
--   and returns the entire bundle in a single HTTP POST request.
-- ============================================================================

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

  -- Stream resolution: preference p_stream_id > student_details.stream_id
  v_stream_id := p_stream_id;
  IF v_stream_id IS NULL AND v_student_id IS NOT NULL THEN
    SELECT sd.stream_id INTO v_stream_id
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

  -- 4. Enrolled courses
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
          'status', ce.status
        )
      ), '[]'::JSONB
    ) INTO v_enrolled_courses
    FROM public.course_enrollments ce
    JOIN public.courses cr ON ce.course_id = cr.course_id
    WHERE ce.student_id = v_student_id
      AND ce.status = 'active'
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

  -- 7. Demo Class (if user has no confirmed orders)
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE profile_id = v_user_id AND status = 'confirmed'
    LIMIT 1
  ) INTO v_has_purchased;

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

GRANT EXECUTE ON FUNCTION public.get_home_screen_bootstrap(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_home_screen_bootstrap(UUID) TO anon;
