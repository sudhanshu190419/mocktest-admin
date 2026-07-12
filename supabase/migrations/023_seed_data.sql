-- ============================================================================
-- Migration: 023 — Seed Data
--
-- PostgreSQL 16 | Supabase Compatible | Development Ready
--
-- Creates deterministic demo data for local development, staging, and CI.
-- FULLY IDEMPOTENT: safe to run multiple times.
--
-- Depends on:
--   All migrations 001–022 (schema, RLS, storage configured)
--   Existing trigger on_auth_user_created (auto-creates profiles from auth.users)
--   Existing triggers trg_teacher_details_check_role, trg_student_details_check_role
--
-- Seed data:
--   ✓ 1 Demo Institute
--   ✓ 1 Platform Admin (role = admin)
--   ✓ 1 Institute Admin (role = admin)
--   ✓ 2 Teachers
--   ✓ 5 Students
--   ✓ 1 Stream (NEET)
--   ✓ 3 Subjects (Physics, Chemistry, Biology)
--   ✓ 3 Chapters per subject
--   ✓ 1 Batch (NEET 2026 Morning)
--   ✓ 1 Subscription Plan (NEET Gold — Monthly)
--   ✓ 1 PYQ Package (NEET PYQ 2020–2024)
--   ✓ 1 Mock Test (NEET Full Syllabus Mock #1) with 3 questions
--
-- Passwords: All seed users use 'password123'
--   Platform Admin: admin@demo.com
--   Institute Admin: institute@demo.com
--   Teacher 1: teacher1@demo.com
--   Teacher 2: teacher2@demo.com
--   Student 1–5: student1@demo.com through student5@demo.com
-- ============================================================================

do $$
declare
  v_institute_id uuid;
  v_platform_admin_id uuid;
  v_institute_admin_id uuid;
  v_teacher1_id uuid;
  v_teacher2_id uuid;
  v_student1_id uuid;
  v_student2_id uuid;
  v_student3_id uuid;
  v_student4_id uuid;
  v_student5_id uuid;
  v_teacher1_tid uuid;
  v_teacher2_tid uuid;
  v_student1_sid uuid;
  v_student2_sid uuid;
  v_student3_sid uuid;
  v_student4_sid uuid;
  v_student5_sid uuid;
  v_stream_id uuid;
  v_physics_id uuid;
  v_chemistry_id uuid;
  v_biology_id uuid;
  v_batch_id uuid;
  v_plan_id uuid;
  v_package_id uuid;
  v_test_id uuid;
  v_q1_id uuid;
  v_q2_id uuid;
  v_q3_id uuid;
begin

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 1: Demo Institute
  -- ════════════════════════════════════════════════════════════════════════

  insert into public.institutes (name, slug, plan_tier)
  values ('Demo Institute', 'demo-institute', 'growth')
  on conflict (slug) do nothing;

  select institute_id into v_institute_id
  from public.institutes
  where slug = 'demo-institute';

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 2: Auth Users + Profiles (auto-created via trigger)
  -- ════════════════════════════════════════════════════════════════════════
  -- Pattern: INSERT ... ON CONFLICT (email) DO NOTHING + RETURNING
  --          + fallback SELECT for idempotency on re-run

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'admin@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'admin', 'full_name', 'Platform Admin'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_platform_admin_id;

  if v_platform_admin_id is null then
    select id into v_platform_admin_id from auth.users where email = 'admin@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'institute@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'admin', 'full_name', 'Institute Admin'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_institute_admin_id;

  if v_institute_admin_id is null then
    select id into v_institute_admin_id from auth.users where email = 'institute@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'teacher1@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'teacher', 'full_name', 'Dr. Arun Sharma'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_teacher1_id;

  if v_teacher1_id is null then
    select id into v_teacher1_id from auth.users where email = 'teacher1@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'teacher2@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'teacher', 'full_name', 'Ms. Priya Patel'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_teacher2_id;

  if v_teacher2_id is null then
    select id into v_teacher2_id from auth.users where email = 'teacher2@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'student1@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'student', 'full_name', 'Rahul Verma'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_student1_id;

  if v_student1_id is null then
    select id into v_student1_id from auth.users where email = 'student1@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'student2@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'student', 'full_name', 'Sneha Kapoor'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_student2_id;

  if v_student2_id is null then
    select id into v_student2_id from auth.users where email = 'student2@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'student3@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'student', 'full_name', 'Arjun Singh'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_student3_id;

  if v_student3_id is null then
    select id into v_student3_id from auth.users where email = 'student3@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'student4@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'student', 'full_name', 'Ananya Gupta'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_student4_id;

  if v_student4_id is null then
    select id into v_student4_id from auth.users where email = 'student4@demo.com';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, aud, role
  )
  values (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
    'student5@demo.com',
    crypt('password123', gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('institute_id', v_institute_id, 'role', 'student', 'full_name', 'Vikram Joshi'),
    now(), now(), 'authenticated', 'authenticated'
  )
  on conflict (email) do nothing
  returning id into v_student5_id;

  if v_student5_id is null then
    select id into v_student5_id from auth.users where email = 'student5@demo.com';
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 3: Update profile names and phones
  -- ════════════════════════════════════════════════════════════════════════

  update public.profiles set name = 'Platform Admin',   phone = '+919000000001' where profile_id = v_platform_admin_id;
  update public.profiles set name = 'Institute Admin',  phone = '+919000000002' where profile_id = v_institute_admin_id;
  update public.profiles set name = 'Dr. Arun Sharma',  phone = '+919000000003' where profile_id = v_teacher1_id;
  update public.profiles set name = 'Ms. Priya Patel',  phone = '+919000000004' where profile_id = v_teacher2_id;
  update public.profiles set name = 'Rahul Verma',      phone = '+919000000005' where profile_id = v_student1_id;
  update public.profiles set name = 'Sneha Kapoor',     phone = '+919000000006' where profile_id = v_student2_id;
  update public.profiles set name = 'Arjun Singh',      phone = '+919000000007' where profile_id = v_student3_id;
  update public.profiles set name = 'Ananya Gupta',     phone = '+919000000008' where profile_id = v_student4_id;
  update public.profiles set name = 'Vikram Joshi',     phone = '+919000000009' where profile_id = v_student5_id;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 4: Teacher Details
  -- ════════════════════════════════════════════════════════════════════════

  insert into public.teacher_details (profile_id, specialization, qualification, bio, rating)
  values (
    v_teacher1_id, 'Physics', 'Ph.D. in Physics, IIT Delhi',
    'Senior Physics faculty with 15 years of teaching experience. Specializes in NEET and JEE Physics.',
    4.80
  )
  on conflict (profile_id) do nothing
  returning teacher_id into v_teacher1_tid;

  if v_teacher1_tid is null then
    select teacher_id into v_teacher1_tid from public.teacher_details where profile_id = v_teacher1_id;
  end if;

  insert into public.teacher_details (profile_id, specialization, qualification, bio, rating)
  values (
    v_teacher2_id, 'Chemistry, Biology', 'M.Sc. Chemistry, University of Mumbai',
    'Experienced Chemistry and Biology faculty. Known for making complex concepts simple.',
    4.65
  )
  on conflict (profile_id) do nothing
  returning teacher_id into v_teacher2_tid;

  if v_teacher2_tid is null then
    select teacher_id into v_teacher2_tid from public.teacher_details where profile_id = v_teacher2_id;
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 5: Student Details
  -- ════════════════════════════════════════════════════════════════════════

  insert into public.student_details (profile_id, institute_id, enrollment_no, dob, target_year)
  values (v_student1_id, v_institute_id, 'DEMO-2025-001', '2005-06-15', '2026')
  on conflict (profile_id) do nothing
  returning student_id into v_student1_sid;

  if v_student1_sid is null then
    select student_id into v_student1_sid from public.student_details where profile_id = v_student1_id;
  end if;

  insert into public.student_details (profile_id, institute_id, enrollment_no, dob, target_year)
  values (v_student2_id, v_institute_id, 'DEMO-2025-002', '2006-03-22', '2026')
  on conflict (profile_id) do nothing
  returning student_id into v_student2_sid;

  if v_student2_sid is null then
    select student_id into v_student2_sid from public.student_details where profile_id = v_student2_id;
  end if;

  insert into public.student_details (profile_id, institute_id, enrollment_no, dob, target_year)
  values (v_student3_id, v_institute_id, 'DEMO-2025-003', '2005-11-08', '2026')
  on conflict (profile_id) do nothing
  returning student_id into v_student3_sid;

  if v_student3_sid is null then
    select student_id into v_student3_sid from public.student_details where profile_id = v_student3_id;
  end if;

  insert into public.student_details (profile_id, institute_id, enrollment_no, dob, target_year)
  values (v_student4_id, v_institute_id, 'DEMO-2025-004', '2006-01-30', '2026')
  on conflict (profile_id) do nothing
  returning student_id into v_student4_sid;

  if v_student4_sid is null then
    select student_id into v_student4_sid from public.student_details where profile_id = v_student4_id;
  end if;

  insert into public.student_details (profile_id, institute_id, enrollment_no, dob, target_year)
  values (v_student5_id, v_institute_id, 'DEMO-2025-005', '2005-09-12', '2026')
  on conflict (profile_id) do nothing
  returning student_id into v_student5_sid;

  if v_student5_sid is null then
    select student_id into v_student5_sid from public.student_details where profile_id = v_student5_id;
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 6: Stream → Subjects → Chapters
  -- ════════════════════════════════════════════════════════════════════════

  insert into public.streams (institute_id, name, code, description, display_order)
  values (v_institute_id, 'NEET', 'NEET', 'National Eligibility cum Entrance Test for Medical', 1)
  on conflict (institute_id, code) do nothing
  returning stream_id into v_stream_id;

  if v_stream_id is null then
    select stream_id into v_stream_id from public.streams
    where institute_id = v_institute_id and code = 'NEET';
  end if;

  insert into public.subjects (stream_id, name, code, display_order)
  values (v_stream_id, 'Physics', 'PHY', 1)
  on conflict (stream_id, code) do nothing
  returning subject_id into v_physics_id;

  if v_physics_id is null then
    select subject_id into v_physics_id from public.subjects where stream_id = v_stream_id and code = 'PHY';
  end if;

  insert into public.subjects (stream_id, name, code, display_order)
  values (v_stream_id, 'Chemistry', 'CHEM', 2)
  on conflict (stream_id, code) do nothing
  returning subject_id into v_chemistry_id;

  if v_chemistry_id is null then
    select subject_id into v_chemistry_id from public.subjects where stream_id = v_stream_id and code = 'CHEM';
  end if;

  insert into public.subjects (stream_id, name, code, display_order)
  values (v_stream_id, 'Biology', 'BIO', 3)
  on conflict (stream_id, code) do nothing
  returning subject_id into v_biology_id;

  if v_biology_id is null then
    select subject_id into v_biology_id from public.subjects where stream_id = v_stream_id and code = 'BIO';
  end if;

  -- Chapters for Physics
  insert into public.chapters (subject_id, name, display_order)
  values (v_physics_id, 'Laws of Motion', 1)
  on conflict (subject_id, name) do nothing;

  insert into public.chapters (subject_id, name, display_order)
  values (v_physics_id, 'Thermodynamics', 2)
  on conflict (subject_id, name) do nothing;

  insert into public.chapters (subject_id, name, display_order)
  values (v_physics_id, 'Electrostatics', 3)
  on conflict (subject_id, name) do nothing;

  -- Chapters for Chemistry
  insert into public.chapters (subject_id, name, display_order)
  values (v_chemistry_id, 'Chemical Bonding', 1)
  on conflict (subject_id, name) do nothing;

  insert into public.chapters (subject_id, name, display_order)
  values (v_chemistry_id, 'Organic Chemistry', 2)
  on conflict (subject_id, name) do nothing;

  insert into public.chapters (subject_id, name, display_order)
  values (v_chemistry_id, 'Equilibrium', 3)
  on conflict (subject_id, name) do nothing;

  -- Chapters for Biology
  insert into public.chapters (subject_id, name, display_order)
  values (v_biology_id, 'Cell Biology', 1)
  on conflict (subject_id, name) do nothing;

  insert into public.chapters (subject_id, name, display_order)
  values (v_biology_id, 'Genetics', 2)
  on conflict (subject_id, name) do nothing;

  insert into public.chapters (subject_id, name, display_order)
  values (v_biology_id, 'Human Physiology', 3)
  on conflict (subject_id, name) do nothing;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 7: Batch
  -- ════════════════════════════════════════════════════════════════════════

  insert into public.batches (
    institute_id, stream_id, name, batch_code,
    academic_year, start_date, end_date, max_seats, status
  )
  values (
    v_institute_id, v_stream_id,
    'NEET 2026 Morning Batch', 'NEET26-MOR-A',
    '2025-26', '2025-04-01', '2026-03-31',
    60, 'active'
  )
  on conflict (institute_id, batch_code) do nothing
  returning batch_id into v_batch_id;

  if v_batch_id is null then
    select batch_id into v_batch_id from public.batches
    where institute_id = v_institute_id and batch_code = 'NEET26-MOR-A';
  end if;

  insert into public.batch_teachers (batch_id, teacher_id, role_in_batch)
  values (v_batch_id, v_teacher1_tid, 'lead_teacher')
  on conflict (batch_id, teacher_id) do nothing;

  insert into public.batch_teachers (batch_id, teacher_id, role_in_batch)
  values (v_batch_id, v_teacher2_tid, 'co_teacher')
  on conflict (batch_id, teacher_id) do nothing;

  insert into public.batch_students (batch_id, student_id)
  values (v_batch_id, v_student1_sid), (v_batch_id, v_student2_sid),
         (v_batch_id, v_student3_sid), (v_batch_id, v_student4_sid),
         (v_batch_id, v_student5_sid)
  on conflict (batch_id, student_id) do nothing;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 8: Subscription Plan
  -- ════════════════════════════════════════════════════════════════════════

  insert into public.subscription_features (feature_key, display_name, description, category, sort_order)
  values
    ('live_classes_access',    'Live Classes',      'Access to all live classes',                'live_classes',      1),
    ('recorded_classes_access','Recorded Classes',  'Access to recorded lecture library',         'recorded_classes',  2),
    ('mock_tests_access',      'Mock Tests',        'Access to all mock tests',                   'mock_tests',        3),
    ('pyq_papers_access',      'PYQ Papers',        'Access to previous year question papers',    'pyq_papers',        4),
    ('notes_access',           'Notes',             'Access to study notes',                      'notes',             5),
    ('assignments_access',     'Assignments',       'Access to assignments',                      'assignments',       6),
    ('analytics_access',       'Analytics',         'Access to performance analytics',            'analytics',         7),
    ('downloads_access',       'Downloads',         'Download content for offline access',        'downloads',         8)
  on conflict (feature_key) do nothing;

  insert into public.subscription_plans (
    institute_id, stream_id, name, slug, description,
    price, billing_cycle, duration_days, trial_days,
    is_featured, sort_order, created_by
  )
  values (
    v_institute_id, v_stream_id,
    'NEET Gold — Monthly', 'neet-gold-monthly',
    'Full access to all NEET preparation resources. Includes live classes, mock tests, PYQ papers, and detailed analytics.',
    999.00, 'monthly', 30, 3,
    true, 1, v_platform_admin_id
  )
  on conflict (institute_id, slug) do nothing
  returning plan_id into v_plan_id;

  if v_plan_id is null then
    select plan_id into v_plan_id from public.subscription_plans
    where institute_id = v_institute_id and slug = 'neet-gold-monthly';
  end if;

  insert into public.plan_unlocks (plan_id, feature_id, is_enabled)
  select v_plan_id, feature_id, true
  from public.subscription_features
  where is_active = true
  on conflict (plan_id, feature_id) do nothing;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 9: PYQ Package
  -- ════════════════════════════════════════════════════════════════════════

  -- No unique constraint on pyq_packages.name — use existence check instead
  select package_id into v_package_id from public.pyq_packages
  where institute_id = v_institute_id and name = 'NEET PYQ 2020–2024 Complete Bundle';

  if v_package_id is null then
    insert into public.pyq_packages (
      institute_id, stream_id, name, description,
      price, year_from, year_to, total_papers, is_active
    )
    values (
      v_institute_id, v_stream_id,
      'NEET PYQ 2020–2024 Complete Bundle',
      'Complete set of NEET previous year question papers from 2020 to 2024. Includes answer keys and video solutions.',
      1499.00, 2020, 2024, 5, true
    )
    returning package_id into v_package_id;
  end if;

  insert into public.pyq_package_unlocks (package_id, unlock_type)
  values (v_package_id, 'pdf'), (v_package_id, 'solutions'), (v_package_id, 'mock_test')
  on conflict (package_id, unlock_type) do nothing;

  -- ════════════════════════════════════════════════════════════════════════
  -- STEP 10: Mock Test with Questions
  -- ════════════════════════════════════════════════════════════════════════

  -- No unique constraint on mock_tests.title — use existence check instead
  select test_id into v_test_id from public.mock_tests
  where institute_id = v_institute_id and title = 'NEET Full Syllabus Mock #1' and teacher_id = v_teacher1_tid;

  if v_test_id is null then
    insert into public.mock_tests (
      institute_id, teacher_id, stream_id,
      title, description, duration_min, total_marks,
      passing_marks, status, test_type,
      available_from, available_until
    )
    values (
      v_institute_id, v_teacher1_tid, v_stream_id,
      'NEET Full Syllabus Mock #1',
      'Comprehensive full-syllabus mock test covering Physics, Chemistry, and Biology. Pattern matches the latest NEET exam.',
      180, 12, 4, 'published', 'mock',
      '2025-01-01 00:00:00+00', '2026-12-31 23:59:59+00'
    )
    returning test_id into v_test_id;
  end if;

  -- Questions
  insert into public.questions (
    institute_id, subject_id, chapter_id, created_by,
    question_type, difficulty, status, question_text, marks, negative_marks
  )
  values (
    v_institute_id, v_physics_id,
    (select chapter_id from public.chapters where subject_id = v_physics_id and name = 'Laws of Motion'),
    v_teacher1_tid, 'mcq', 'medium', 'published',
    'A block of mass 5 kg is placed on a frictionless horizontal surface. A force of 20 N is applied horizontally. What is the acceleration of the block?',
    4.00, 1.00
  )
  returning question_id into v_q1_id;

  insert into public.question_options (question_id, institute_id, option_text, is_correct, order_sequence)
  values
    (v_q1_id, v_institute_id, '2 m/s²',  false, 1),
    (v_q1_id, v_institute_id, '4 m/s²',  true,  2),
    (v_q1_id, v_institute_id, '5 m/s²',  false, 3),
    (v_q1_id, v_institute_id, '10 m/s²', false, 4)
  on conflict (question_id, order_sequence) do nothing;

  insert into public.question_explanations (question_id, institute_id, explanation_text)
  values (
    v_q1_id, v_institute_id,
    'Using Newton''s Second Law: F = ma. Therefore, a = F/m = 20 N / 5 kg = 4 m/s².'
  )
  on conflict (question_id) do nothing;

  insert into public.questions (
    institute_id, subject_id, chapter_id, created_by,
    question_type, difficulty, status, question_text, marks, negative_marks
  )
  values (
    v_institute_id, v_chemistry_id,
    (select chapter_id from public.chapters where subject_id = v_chemistry_id and name = 'Chemical Bonding'),
    v_teacher2_tid, 'mcq', 'easy', 'published',
    'Which of the following has the highest bond energy?',
    4.00, 1.00
  )
  returning question_id into v_q2_id;

  insert into public.question_options (question_id, institute_id, option_text, is_correct, order_sequence)
  values
    (v_q2_id, v_institute_id, 'N≡N', true,  1),
    (v_q2_id, v_institute_id, 'O=O', false, 2),
    (v_q2_id, v_institute_id, 'H-H', false, 3),
    (v_q2_id, v_institute_id, 'Cl-Cl',false, 4)
  on conflict (question_id, order_sequence) do nothing;

  insert into public.question_explanations (question_id, institute_id, explanation_text)
  values (
    v_q2_id, v_institute_id,
    'N≡N (dinitrogen) has the highest bond energy (945 kJ/mol) due to its triple bond. O=O has 498 kJ/mol, H-H has 436 kJ/mol, and Cl-Cl has 243 kJ/mol.'
  )
  on conflict (question_id) do nothing;

  insert into public.questions (
    institute_id, subject_id, chapter_id, created_by,
    question_type, difficulty, status, question_text, marks, negative_marks
  )
  values (
    v_institute_id, v_biology_id,
    (select chapter_id from public.chapters where subject_id = v_biology_id and name = 'Cell Biology'),
    v_teacher2_tid, 'mcq', 'medium', 'published',
    'Which organelle is responsible for ATP production in eukaryotic cells?',
    4.00, 1.00
  )
  returning question_id into v_q3_id;

  insert into public.question_options (question_id, institute_id, option_text, is_correct, order_sequence)
  values
    (v_q3_id, v_institute_id, 'Golgi apparatus',      false, 1),
    (v_q3_id, v_institute_id, 'Mitochondria',          true,  2),
    (v_q3_id, v_institute_id, 'Endoplasmic reticulum', false, 3),
    (v_q3_id, v_institute_id, 'Lysosome',              false, 4)
  on conflict (question_id, order_sequence) do nothing;

  insert into public.question_explanations (question_id, institute_id, explanation_text)
  values (
    v_q3_id, v_institute_id,
    'Mitochondria are the powerhouse of the cell. They produce ATP through oxidative phosphorylation in the electron transport chain.'
  )
  on conflict (question_id) do nothing;

  -- Link questions to mock test
  insert into public.mock_test_questions (test_id, question_id, order_sequence, marks)
  values
    (v_test_id, v_q1_id, 1, 4.00),
    (v_test_id, v_q2_id, 2, 4.00),
    (v_test_id, v_q3_id, 3, 4.00)
  on conflict (test_id, question_id) do nothing;

  -- ════════════════════════════════════════════════════════════════════════
  -- Seed Summary
  -- ════════════════════════════════════════════════════════════════════════
  raise notice '✅ Seed data complete — 9 users, 1 institute, 1 stream, 3 subjects, 9 chapters, 1 batch, 1 plan, 1 PYQ, 1 mock test';

end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 023 Seed Data
-- ════════════════════════════════════════════════════════════════════════════
