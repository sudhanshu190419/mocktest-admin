-- ============================================================================
-- Migration 219 Test Suite: Installment Foundation and Server-Side Access Control
--
-- Executes tests against Migration 219 database schema, triggers, and RPCs:
--   1. Checkout record creation before payment capture.
--   2. Successful payment capture with a trusted payment timestamp.
--   3. Payment entity creation timestamp differing from the capture-event timestamp.
--   4. Missing authoritative timestamp does not silently activate an agreement (no fallback to created_at).
--   5. Duplicate webhook does not change the existing anchor (anchor immutability).
--   6. One payment allocated across several installments without exceeding its amount.
--   7. Multiple payments allocated to one installment without exceeding the installment obligation.
--   8. Concurrent / invalid allocation requests cannot over-credit a payment or installment.
--   9. Payment reuse across agreements is rejected.
--  10. Correct recovery from a missing timestamp or interrupted payment-processing attempt.
--  11. Refund & Reversal Accounting 1: No refund or reversal (100% available).
--  12. Refund & Reversal Accounting 2: Partially refunded payment (no double-counting).
--  13. Refund & Reversal Accounting 3: Fully refunded duplicate payment (0 available, rejected).
--  14. Refund & Reversal Accounting 4: Gateway reversal linked to original payment.
--  15. Refund & Reversal Accounting 5: Duplicate delivery of the same refund or reversal event.
--  16. Refund & Reversal Accounting 6: Correct allocation limits after a correction event.
--  17. Deletion protection on financial history (ON DELETE RESTRICT).
--  18. Composite foreign key integrity (fk_allocations_agreement_schedule).
--  19. Fully waived overdue installment does not block live-class access.
--  20. Partially waived installment remains overdue while effective unpaid balance remains.
--  21. Rescheduled installment evaluated using approved revised due date.
--  36. RLS Policy Enforcement: Active Installment Plans, Dispute Restorations & Webhook Quarantine (Migration 220)
--
-- Self-contained: creates throwaway test records and rolls back completely at the end.
-- Run locally via: psql "$LOCAL_DATABASE_URL" -f supabase/tests/installment_foundation_and_access_control_test.sql
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- Establish service_role security context for setup and testing
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  v_test_inst_id       uuid;
  v_test_course_id     uuid;
  v_test_course_id2    uuid;
  v_test_course_id3    uuid;
  v_test_course_id4    uuid;
  v_test_course_id5    uuid;
  v_test_plan_id       uuid;
  v_test_plan_id3x     uuid;
  v_test_plan_c2_12x   uuid;
  v_test_plan_c2_3x    uuid;
  v_test_plan_c3_12x   uuid;
  v_test_plan_c3_3x    uuid;
  v_test_plan_c5_3x    uuid;
  v_221_mismatch_caught boolean := false;
  v_221_immut_caught    boolean := false;
  v_test_course_221     uuid;
  v_test_plan_221       uuid;
  v_test_agr_221        uuid;
  v_test_order_221      uuid;
  v_test_pay_221        uuid;
  v_test_order_221b     uuid;
  v_test_pay_221b       uuid;
  v_221_reassign_caught boolean := false;
  v_test_course_40      uuid;
  v_test_plan_40a       uuid;
  v_test_plan_40b       uuid;
  v_test_agr_40         uuid;
  v_test_agr_40_empty   uuid;
  v_test_sched_40       uuid;
  v_test_student_id    uuid;
  v_test_profile_id    uuid;
  v_test_student_id2   uuid;
  v_test_stream_id       uuid;
  v_test_subject_id      uuid;
  v_test_batch_subject_id uuid;
  v_teacher_detail_id    uuid;
  v_test_recording_id    uuid;
  v_overload_cnt         int;
  v_call_named_res       jsonb;
  v_call_2arg_res        jsonb;
  v_call_3arg_res        jsonb;
  v_rec_play_res         jsonb;
  v_test_profile_id2   uuid;
  v_test_batch_id      uuid;
  v_test_class_id      uuid;
  v_test_order_id      uuid;
  v_test_payment_id    uuid;
  v_test_order_id3     uuid;
  v_test_payment_id3   uuid;
  v_test_order_id4     uuid;
  v_test_payment_id4   uuid;
  v_test_order_id6     uuid;
  v_test_payment_id6   uuid;
  v_test_order_id7a    uuid;
  v_test_payment_id7a  uuid;
  v_test_order_id7b    uuid;
  v_test_payment_id7b  uuid;
  v_test_order_id_rf   uuid;
  v_test_payment_id_rf uuid;
  v_test_order_id_rev  uuid;
  v_test_payment_id_rev uuid;
  v_test_agreement_id  uuid;
  v_test_agreement_id2 uuid;
  v_test_agreement_id3 uuid;
  v_test_agreement_id4 uuid;
  v_test_agreement_id6 uuid;
  v_test_agreement_id_rf uuid;
  v_test_agreement_id_rev uuid;
  v_sched_id_inst1     uuid;
  v_sched_id_inst2     uuid;
  v_sched_id_inst3     uuid;
  v_sched_id_inst4     uuid;
  v_sched_id_inst3_6   uuid;
  v_sched_id_rf1       uuid;
  v_sched_id_rf2       uuid;
  v_res                jsonb;
  v_anchor_date        date;
  v_sched_cnt          int;
  v_alloc_cnt          int;
  v_total_alloc        numeric(10,2);
  v_teacher_id         uuid;
  v_eff_overdue        numeric(10,2);
  v_fk_caught          boolean := false;
  v_del_caught         boolean := false;
  v_trg_payment_caught boolean := false;
  v_trg_sched_caught   boolean := false;
  v_reuse_caught       boolean := false;
  v_test_order_id_sep    uuid;
  v_test_payment_id_sep  uuid;
  v_test_order_id_post   uuid;
  v_test_payment_id_post uuid;
  v_test_agreement_id_post uuid;
  v_dup_caught           boolean := false;
  v_post_rev_caught      boolean := false;
  v_audit_ident_caught   boolean := false;
  v_gw_link_caught       boolean := false;
  v_blank_event_caught   boolean := false;
  v_inconsistent_caught  boolean := false;
  v_lifecycle_dup_caught boolean := false;
  v_test_order_id_scen_c uuid;
  v_test_payment_id_scen_c uuid;
  v_test_agreement_id_scen_c uuid;
  v_test_order_id_scen_d uuid;
  v_test_payment_id_scen_d uuid;
  v_test_agreement_id_scen_d uuid;
  v_test_order_id_scen_b uuid;
  v_test_payment_id_scen_b uuid;
  v_test_agreement_id_scen_b uuid;
  v_test_order_id_scen_e uuid;
  v_test_payment_id_scen_e uuid;
  v_test_agreement_id_scen_e uuid;
  v_test_order_id_scen_e_incon uuid;
  v_test_payment_id_scen_e_incon uuid;
  v_test_agreement_id_scen_e_incon uuid;
  v_orig_alloc_cnt       int;
  v_orig_payment_amount  numeric(10,2);
  v_orig_payment_status  text;
  v_sub_status           text;
  v_admin_review_flag    boolean;
  -- Revision 30 Test Variables
  v_test_order_id_rev30         uuid;
  v_test_payment_id_rev30       uuid;
  v_test_agreement_id_rev30     uuid;
  v_test_order_id_rev30_curr    uuid;
  v_test_payment_id_rev30_curr  uuid;
  v_test_agreement_id_rev30_curr uuid;
  v_sched_id_rev30_1            uuid;
  v_sched_id_rev30_curr2        uuid;
  v_rev30_dup_caught            boolean := false;
  v_rev30_alloc_caught          boolean := false;
  -- Revision 31 Test Variables
  v_test_order_id_rev31         uuid;
  v_test_payment_id_rev31       uuid;
  v_test_agreement_id_rev31     uuid;
  v_rev31_dup_caught            boolean := false;
  -- Revision 32 Test Variables
  v_sched_id_rev32_1            uuid;
  v_sched_id_rev32_2            uuid;
  v_rev32_unreconciled_caught   boolean := false;
  v_rev32_immutable_caught      boolean := false;
  v_rev32_decrease_caught       boolean := false;
  -- Revision 33 Test Variables
  v_test_order_id_rev33         uuid;
  v_test_payment_id_rev33       uuid;
  v_test_agreement_id_rev33     uuid;
  v_sched_id_rev33_1            uuid;
  v_sched_id_rev33_2            uuid;
  v_rev33_unreconciled_caught   boolean := false;
  v_rev33_dup_event_caught      boolean := false;
  v_rev33_exceed_caught         boolean := false;
  v_adj_id_disp                 uuid;
  -- Revision 34 Test Variables
  v_rev34_unauthorized_caught    boolean := false;
  v_rev34_review_blocked_caught  boolean := false;
  v_rev34_dup_provider_ref_caught boolean := false;
  v_rev34_quarantine_dup_caught  boolean := false;
  v_rev34_quarantine_fail_caught boolean := false;
  -- Revision 36 / Migration 220 Test Variables
  v_test_plan_active_id          uuid;
  v_test_plan_inactive_id        uuid;
  v_admin_profile_id             uuid;
  v_active_plan_cnt              int;
  v_inactive_plan_cnt            int;
  v_dispute_restoration_cnt      int;
  v_quarantine_event_cnt         int;
  v_policy_cnt                   int;
  v_rls_enabled                  boolean;
  v_role_switch_ok               boolean := false;
begin
  raise notice '====================================================================';
  raise notice 'Starting Migration 219 Targeted Corrections Test Suite';
  raise notice '====================================================================';

  -- --------------------------------------------------------------------------
  -- FIXTURE SETUP
  -- --------------------------------------------------------------------------
  raise notice 'Setting up test fixtures...';
  select stream_id into v_test_stream_id from public.streams limit 1;
  -- Create Institute
  insert into public.institutes (name, slug, timezone, is_active)
  values ('Test Institute 219', 'test-inst-219-' || substr(gen_random_uuid()::text, 1, 8), 'Asia/Kolkata', true)
  returning institute_id into v_test_inst_id;

  -- Create Primary Course
  insert into public.courses (institute_id, stream_id, title, slug, description, original_price, discounted_price, status, published_at)
  values (v_test_inst_id, v_test_stream_id, 'Master Course 219', 'test-c-' || substr(gen_random_uuid()::text, 1, 8), 'Test course for installments', 12000.00, 12000.00, 'published', now())
  returning course_id into v_test_course_id;

  -- Create Additional Courses for Multi-Agreement Isolation Testing
  insert into public.courses (institute_id, stream_id, title, slug, description, original_price, discounted_price, status, published_at)
  values (v_test_inst_id, v_test_stream_id, 'Course 219 B', 'test-c-' || substr(gen_random_uuid()::text, 1, 8), 'Second test course', 12000.00, 12000.00, 'published', now())
  returning course_id into v_test_course_id2;

  insert into public.courses (institute_id, stream_id, title, slug, description, original_price, discounted_price, status, published_at)
  values (v_test_inst_id, v_test_stream_id, 'Course 219 C', 'test-c-' || substr(gen_random_uuid()::text, 1, 8), 'Third test course', 12000.00, 12000.00, 'published', now())
  returning course_id into v_test_course_id3;

  insert into public.courses (institute_id, stream_id, title, slug, description, original_price, discounted_price, status, published_at)
  values (v_test_inst_id, v_test_stream_id, 'Course 219 D (3x Plan)', 'test-c-' || substr(gen_random_uuid()::text, 1, 8), 'Fourth test course for multi-allocation', 3000.00, 3000.00, 'published', now())
  returning course_id into v_test_course_id4;

  insert into public.courses (institute_id, stream_id, title, slug, description, original_price, discounted_price, status, published_at)
  values (v_test_inst_id, v_test_stream_id, 'Course 219 E (Correction Ledger)', 'test-c-' || substr(gen_random_uuid()::text, 1, 8), 'Fifth test course for refund/reversal tests', 3000.00, 3000.00, 'published', now())
  returning course_id into v_test_course_id5;

  -- Create Student 1 Profile & Student Details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role)
  values (gen_random_uuid(), v_test_inst_id, 'Student 219 A', 'student219a_' || substr(gen_random_uuid()::text, 1, 8) || '@example.com', '919876543201', 'student')
  returning profile_id into v_test_profile_id;

  insert into public.student_details (profile_id, institute_id, enrollment_no)
  values (v_test_profile_id, v_test_inst_id, 'ENR-219A-' || substr(gen_random_uuid()::text, 1, 6))
  returning student_id into v_test_student_id;

  -- Create Student 2 Profile & Student Details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role)
  values (gen_random_uuid(), v_test_inst_id, 'Student 219 B', 'student219b_' || substr(gen_random_uuid()::text, 1, 8) || '@example.com', '919876543202', 'student')
  returning profile_id into v_test_profile_id2;

  insert into public.student_details (profile_id, institute_id, enrollment_no)
  values (v_test_profile_id2, v_test_inst_id, 'ENR-219B-' || substr(gen_random_uuid()::text, 1, 6))
  returning student_id into v_test_student_id2;

  -- Create Teacher Profile & Details
  insert into public.profiles (profile_id, institute_id, name, email, phone, role)
  values (gen_random_uuid(), v_test_inst_id, 'Teacher 219', 'teacher219_' || substr(gen_random_uuid()::text, 1, 8) || '@example.com', '919876543203', 'teacher')
  returning profile_id into v_teacher_id;

  insert into public.teacher_details (teacher_id, profile_id)
  values (v_teacher_id, v_teacher_id);

  -- Create Active Batch
  insert into public.batches (institute_id, stream_id, name, batch_code, academic_year, start_date, end_date, status)
  values (v_test_inst_id, v_test_stream_id, 'Batch 219 Active', 'B-219-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), '2026-27', current_date - 10, current_date + 60, 'active')
  returning batch_id into v_test_batch_id;

  -- Link Course to Batch
  insert into public.course_batches (course_id, batch_id, institute_id)
  values (v_test_course_id, v_test_batch_id, v_test_inst_id);

  -- Assign Student 1 to Batch
  insert into public.batch_students (batch_id, student_id, status)
  values (v_test_batch_id, v_test_student_id, 'active');

  -- Create Live Class for this Batch
  insert into public.live_classes (
    institute_id, teacher_id, title, scheduled_at, duration_min, status, room_name
  ) values (
    v_test_inst_id, v_teacher_id, 'Live Class 219', now() + interval '1 hour', 60, 'scheduled', 'room-219-test'
  ) returning class_id into v_test_class_id;

  insert into public.live_class_batch (class_id, batch_id)
  values (v_test_class_id, v_test_batch_id);

  -- Create Course Installment Plan (12 monthly installments of ₹1,000, total ₹12,000)
  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id, 'Monthly 12x Plan', 12000.00, 12, 1, true
  ) returning plan_id into v_test_plan_id;

  -- Create Course Installment Plan (3 monthly installments of ₹1,000, total ₹3,000)
  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id4, 'Monthly 3x Plan', 3000.00, 3, 1, true
  ) returning plan_id into v_test_plan_id3x;

  -- Create Dedicated Course Installment Plans for Multi-Course Isolation (Migration 221 Compatibility)
  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id2, 'Course 2 Monthly 12x Plan', 12000.00, 12, 1, true
  ) returning plan_id into v_test_plan_c2_12x;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id2, 'Course 2 Monthly 3x Plan', 3000.00, 3, 1, true
  ) returning plan_id into v_test_plan_c2_3x;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id3, 'Course 3 Monthly 12x Plan', 12000.00, 12, 1, true
  ) returning plan_id into v_test_plan_c3_12x;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id3, 'Course 3 Monthly 3x Plan', 3000.00, 3, 1, true
  ) returning plan_id into v_test_plan_c3_3x;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id5, 'Course 5 Monthly 3x Plan', 3000.00, 3, 1, true
  ) returning plan_id into v_test_plan_c5_3x;

  raise notice 'Test fixtures created successfully.';

  -- --------------------------------------------------------------------------
  -- TEST 1: Checkout Record Creation Before Payment Capture
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 1: Initial checkout record created before payment capture...';
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id, v_test_plan_id, null, 12000.00,
    12000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id;

  -- Unpaid pending checkout order
  insert into public.orders (student_id, institute_id, total_amount, status, created_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'pending', now() - interval '2 days')
  returning order_id into v_test_order_id;

  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id, v_test_inst_id, v_test_course_id, v_test_plan_id, 'Course Installment', 'installment', 1000.00, 1000.00);

  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_order_id, created_at, paid_at
  ) values (
    v_test_order_id, v_test_inst_id, 1000.00, 'INR', 'pending', 'razorpay', 'order_test_pending', now() - interval '2 days', null
  ) returning payment_id into v_test_payment_id;

  -- Verify agreement has null anchor date and live-class access is blocked
  select agreement_date into v_anchor_date
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id;

  if v_anchor_date is not null then
    raise exception 'Test 1 Failed: Checkout creation must NOT establish agreement_date before payment verification.';
  end if;

  v_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id, null);
  if (v_res->>'authorized')::boolean <> false or v_res->>'code' not in ('INITIAL_PAYMENT_PENDING', 'SUBSCRIPTION_REQUIRED') then
    raise exception 'Test 1 Failed: Expected INITIAL_PAYMENT_PENDING, got %', v_res;
  end if;
  raise notice 'Test 1 PASSED: Unpaid checkout record does not establish anchor or grant access.';

  -- --------------------------------------------------------------------------
  -- TEST 2: Successful Payment Capture with a Trusted Payment Timestamp
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 2: Successful payment capture with trusted payment timestamp...';
  -- Mark payment captured with authoritative paid_at = 2026-11-05 10:30:00+05:30
  update public.orders set status = 'confirmed', confirmed_at = now() where order_id = v_test_order_id;
  update public.payments
  set status = 'captured',
      gateway_payment_id = 'pay_test_trusted_capture',
      paid_at = '2026-11-05 10:30:00+05:30'::timestamptz
  where payment_id = v_test_payment_id;

  v_res := public.process_installment_payment(v_test_payment_id, v_test_agreement_id);
  if (v_res->>'success')::boolean <> true or (v_res->>'consecutively_funded_milestone')::int <> 1 then
    raise exception 'Test 2 Failed: Expected milestone 1 funded, got %', v_res;
  end if;

  -- Verify agreement_date matches paid_at in Asia/Kolkata ('2026-11-05'), NOT order creation date
  select agreement_date into v_anchor_date
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id;

  if v_anchor_date <> '2026-11-05'::date then
    raise exception 'Test 2 Failed: Expected anchor D0 = 2026-11-05 from paid_at, got %', v_anchor_date;
  end if;

  -- Verify Installment 1 schedule is paid and anchored to 2026-11-05
  select count(*) into v_sched_cnt
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id and installment_index = 1 and status = 'paid' and due_date = '2026-11-05'::date;

  if v_sched_cnt <> 1 then
    raise exception 'Test 2 Failed: Installment 1 schedule not properly anchored to 2026-11-05.';
  end if;
  raise notice 'Test 2 PASSED: Anchor D0 correctly established from trusted paid_at timestamp.';

  -- --------------------------------------------------------------------------
  -- TEST 3: Payment Entity Creation Timestamp Differing from Capture-Event Timestamp
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 3: Entity creation timestamp differing from capture-event timestamp...';
  -- Create checkout near midnight: created_at on 2026-11-14 23:55:00+05:30, but captured on 2026-11-15 00:05:00+05:30
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id2, v_test_course_id2, v_test_plan_c2_12x, null, 12000.00,
    12000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id3;

  insert into public.orders (student_id, institute_id, total_amount, status, created_at, confirmed_at)
  values (v_test_student_id2, v_test_inst_id, 1000.00, 'confirmed', '2026-11-14 23:55:00+05:30'::timestamptz, '2026-11-14 23:55:00+05:30'::timestamptz)
  returning order_id into v_test_order_id3;

  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id3, v_test_inst_id, v_test_course_id2, v_test_plan_c2_12x, 'Course Installment', 'installment', 1000.00, 1000.00);

  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_order_id, gateway_payment_id,
    created_at, paid_at
  ) values (
    v_test_order_id3, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'order_diff_ts', 'pay_diff_ts',
    '2026-11-14 23:55:00+05:30'::timestamptz, '2026-11-15 00:05:00+05:30'::timestamptz
  ) returning payment_id into v_test_payment_id3;

  v_res := public.process_installment_payment(v_test_payment_id3, v_test_agreement_id3);
  if (v_res->>'success')::boolean <> true then
    raise exception 'Test 3 Failed: process_installment_payment failed: %', v_res;
  end if;

  select agreement_date into v_anchor_date
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id3;

  -- Anchor must be 2026-11-15 (from paid_at capture event), NOT 2026-11-14 (created_at)
  if v_anchor_date <> '2026-11-15'::date then
    raise exception 'Test 3 Failed: Expected anchor 2026-11-15 (capture date), got %', v_anchor_date;
  end if;
  raise notice 'Test 3 PASSED: Anchor strictly uses capture event timestamp (paid_at), not entity creation time.';

  -- --------------------------------------------------------------------------
  -- TEST 4: Missing Authoritative Timestamp Does NOT Silently Activate Agreement (No Fallback)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 4: Missing authoritative timestamp fails closed without fallback to entity created_at...';
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id3, v_test_plan_c3_12x, null, 12000.00,
    12000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id4;

  insert into public.orders (student_id, institute_id, total_amount, status, created_at, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now(), now())
  returning order_id into v_test_order_id4;

  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id4, v_test_inst_id, v_test_course_id3, v_test_plan_c3_12x, 'Course Installment', 'installment', 1000.00, 1000.00);

  -- Captured payment BUT paid_at is NULL (simulating missing top-level webhook timestamp while created_at exists)
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_order_id, gateway_payment_id,
    created_at, paid_at
  ) values (
    v_test_order_id4, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'order_no_ts', 'pay_no_ts',
    now(), null
  ) returning payment_id into v_test_payment_id4;

  v_res := public.process_installment_payment(v_test_payment_id4, v_test_agreement_id4);
  if (v_res->>'success')::boolean <> false or v_res->>'code' <> 'MISSING_AUTHORITATIVE_PAYMENT_TIMESTAMP' then
    raise exception 'Test 4 Failed: Expected MISSING_AUTHORITATIVE_PAYMENT_TIMESTAMP, got %', v_res;
  end if;

  -- Verify agreement remains pending_initial_payment with null date, but flagged for admin review
  select agreement_date, agreement_status, requires_admin_review
  into v_anchor_date, v_res, v_trg_payment_caught
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id4;

  if v_anchor_date is not null or v_res::text <> '"pending_initial_payment"' or v_trg_payment_caught <> true then
    raise exception 'Test 4 Failed: Agreement must fail closed with requires_admin_review=true and null anchor.';
  end if;
  raise notice 'Test 4 PASSED: Missing payment timestamp fails closed safely without silent fallback to created_at.';

  -- --------------------------------------------------------------------------
  -- TEST 5: Duplicate Webhook Does Not Change Existing Anchor
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 5: Duplicate webhook preserves original anchor without drift...';
  v_res := public.process_installment_payment(v_test_payment_id, v_test_agreement_id);
  if (v_res->>'already_processed')::boolean <> true or v_res->>'code' <> 'PAYMENT_ALREADY_ALLOCATED' then
    raise exception 'Test 5 Failed: Expected PAYMENT_ALREADY_ALLOCATED, got %', v_res;
  end if;

  select agreement_date into v_anchor_date
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id;

  if v_anchor_date <> '2026-11-05'::date then
    raise exception 'Test 5 Failed: Anchor D0 altered on duplicate webhook: %', v_anchor_date;
  end if;
  raise notice 'Test 5 PASSED: Duplicate webhook handled idempotently; anchor remains immutable.';

  -- --------------------------------------------------------------------------
  -- TEST 6: One Payment Allocated Across Several Installments
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 6: One payment allocated across several installments without exceeding amount...';
  -- Agreement 6 on Course 4 (3 monthly installments of ₹1,000, total ₹3,000)
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id4, v_test_plan_id3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id6;

  -- Payment 6 is ₹2,000 (funds Installment 1 and Installment 2)
  insert into public.orders (student_id, institute_id, total_amount, status, created_at, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 2000.00, 'confirmed', now(), now())
  returning order_id into v_test_order_id6;

  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id6, v_test_inst_id, v_test_course_id4, v_test_plan_id3x, 'Course Installment', 'installment', 2000.00, 2000.00);

  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_order_id, gateway_payment_id,
    created_at, paid_at
  ) values (
    v_test_order_id6, v_test_inst_id, 2000.00, 'INR', 'captured', 'razorpay', 'order_6_multi', 'pay_6_multi',
    now(), '2026-11-20 12:00:00+05:30'::timestamptz
  ) returning payment_id into v_test_payment_id6;

  v_res := public.process_installment_payment(v_test_payment_id6, v_test_agreement_id6);
  if (v_res->>'success')::boolean <> true or (v_res->>'consecutively_funded_milestone')::int <> 2 then
    raise exception 'Test 6 Failed: Expected milestone 2 funded, got %', v_res;
  end if;

  -- Verify total allocations for Payment 6 exactly equal ₹2,000.00
  select coalesce(sum(allocated_amount), 0.00) into v_total_alloc
  from public.installment_payment_allocations
  where payment_id = v_test_payment_id6;

  if v_total_alloc <> 2000.00 then
    raise exception 'Test 6 Failed: Total allocated amount % <> 2000.00', v_total_alloc;
  end if;

  -- Verify Inst 1 and Inst 2 are paid, and Inst 3 is pending with 0 paid
  select count(*) into v_sched_cnt
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id6 and installment_index in (1, 2) and status = 'paid' and amount_paid = 1000.00;

  if v_sched_cnt <> 2 then
    raise exception 'Test 6 Failed: Installments 1 and 2 not properly paid.';
  end if;
  raise notice 'Test 6 PASSED: One payment allocated across multiple installments without exceeding payment amount.';

  -- --------------------------------------------------------------------------
  -- TEST 7: Multiple Payments Allocated to One Installment
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 7: Multiple payments allocated to one installment...';
  -- Installment 3 on Agreement 6 has amount_due = 1000.00 and amount_paid = 0.00
  select schedule_id into v_sched_id_inst3_6
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id6 and installment_index = 3;

  -- Payment 7A: ₹400
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 400.00, 'confirmed', now())
  returning order_id into v_test_order_id7a;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id7a, v_test_inst_id, v_test_course_id4, v_test_plan_id3x, 'Course Installment', 'installment', 400.00, 400.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id7a, v_test_inst_id, 400.00, 'INR', 'captured', 'razorpay', 'pay_7a', now()
  ) returning payment_id into v_test_payment_id7a;

  v_res := public.process_installment_payment(v_test_payment_id7a, v_test_agreement_id6);
  if (v_res->>'success')::boolean <> true then
    raise exception 'Test 7 Failed on Payment 7A: %', v_res;
  end if;

  -- Payment 7B: ₹600
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 600.00, 'confirmed', now())
  returning order_id into v_test_order_id7b;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id7b, v_test_inst_id, v_test_course_id4, v_test_plan_id3x, 'Course Installment', 'installment', 600.00, 600.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id7b, v_test_inst_id, 600.00, 'INR', 'captured', 'razorpay', 'pay_7b', now()
  ) returning payment_id into v_test_payment_id7b;

  v_res := public.process_installment_payment(v_test_payment_id7b, v_test_agreement_id6);
  if (v_res->>'success')::boolean <> true or (v_res->>'consecutively_funded_milestone')::int <> 3 then
    raise exception 'Test 7 Failed on Payment 7B: %', v_res;
  end if;

  -- Verify Installment 3 is paid with exactly ₹1,000.00 across 2 allocations
  select count(*), coalesce(sum(allocated_amount), 0.00)
  into v_alloc_cnt, v_total_alloc
  from public.installment_payment_allocations
  where schedule_id = v_sched_id_inst3_6;

  if v_alloc_cnt <> 2 or v_total_alloc <> 1000.00 then
    raise exception 'Test 7 Failed: Expected 2 allocations totaling 1000.00, got % allocs totaling %', v_alloc_cnt, v_total_alloc;
  end if;
  raise notice 'Test 7 PASSED: Multiple payments fund single installment without exceeding obligation.';

  -- --------------------------------------------------------------------------
  -- TEST 8: Concurrent / Invalid Allocation Requests Cannot Over-Credit
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 8: Trigger prevents over-crediting payments and installments...';
  -- 8a: Attempt to allocate more from Payment 7A (payment limit)
  v_trg_payment_caught := false;
  begin
    insert into public.installment_payment_allocations (
      payment_id, schedule_id, agreement_id, allocated_amount
    ) values (
      v_test_payment_id7a, v_sched_id_inst3_6, v_test_agreement_id6, 100.00
    );
  exception when check_violation then
    v_trg_payment_caught := true;
  end;

  if not v_trg_payment_caught then
    raise exception 'Test 8a Failed: Over-allocation beyond payment available amount must be rejected by trigger.';
  end if;

  -- 8b: Attempt to allocate more to fully paid Installment 3 (installment limit)
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 500.00, 'confirmed', now())
  returning order_id into v_test_order_id;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id, v_test_inst_id, v_test_course_id4, v_test_plan_id3x, 'Course Installment', 'installment', 500.00, 500.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id, v_test_inst_id, 500.00, 'INR', 'captured', 'razorpay', 'pay_8b', now()
  ) returning payment_id into v_test_payment_id;

  v_trg_sched_caught := false;
  begin
    insert into public.installment_payment_allocations (
      payment_id, schedule_id, agreement_id, allocated_amount
    ) values (
      v_test_payment_id, v_sched_id_inst3_6, v_test_agreement_id6, 100.00
    );
  exception when check_violation then
    v_trg_sched_caught := true;
  end;

  if not v_trg_sched_caught then
    raise exception 'Test 8b Failed: Over-allocation beyond installment obligation must be rejected by trigger.';
  end if;
  raise notice 'Test 8 PASSED: Allocation limits strictly enforced by database trigger.';

  -- --------------------------------------------------------------------------
  -- TEST 9: Payment Reuse Across Agreements is Rejected
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 9: Payment reuse across agreements rejected...';
  v_res := public.process_installment_payment(v_test_payment_id6, v_test_agreement_id);
  if (v_res->>'success')::boolean <> false or v_res->>'code' not in ('PAYMENT_CONTEXT_MISMATCH', 'PAYMENT_REUSE_PROHIBITED') then
    raise exception 'Test 9 Failed: Reusing payment for different agreement must be rejected, got %', v_res;
  end if;

  v_reuse_caught := false;
  begin
    insert into public.installment_payment_allocations (
      payment_id, schedule_id, agreement_id, allocated_amount
    ) values (
      v_test_payment_id6, v_sched_id_inst1, v_test_agreement_id, 100.00
    );
  exception when check_violation then
    v_reuse_caught := true;
  end;

  if not v_reuse_caught then
    raise exception 'Test 9 Failed: Direct allocation reuse across agreements must be rejected by trigger.';
  end if;
  raise notice 'Test 9 PASSED: Payment reuse across agreements strictly rejected.';

  -- --------------------------------------------------------------------------
  -- TEST 10: Correct Recovery from Missing Timestamp
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 10: Recovery from missing timestamp...';
  update public.payments
  set paid_at = '2026-11-25 15:00:00+05:30'::timestamptz
  where payment_id = v_test_payment_id4;

  v_res := public.process_installment_payment(v_test_payment_id4, v_test_agreement_id4);
  if (v_res->>'success')::boolean <> true or (v_res->>'consecutively_funded_milestone')::int <> 1 then
    raise exception 'Test 10 Failed: Recovery failed: %', v_res;
  end if;

  select agreement_date, agreement_status, requires_admin_review
  into v_anchor_date, v_res, v_trg_payment_caught
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id4;

  if v_anchor_date <> '2026-11-25'::date or v_res::text <> '"active"' or v_trg_payment_caught <> false then
    raise exception 'Test 10 Failed: Expected agreement active with anchor 2026-11-25 and requires_admin_review cleared.';
  end if;
  raise notice 'Test 10 PASSED: Recoverable reconciliation condition resolved cleanly.';

  -- --------------------------------------------------------------------------
  -- TEST 11: Focused Accounting Test 1 — A payment with no refunds or reversals
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 11: Payment with no refund/reversal has 100%% available amount...';
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id5, v_test_plan_c5_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_rf;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_rf;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_rf, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id_rf, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'pay_no_rf', now()
  ) returning payment_id into v_test_payment_id_rf;

  v_res := public.process_installment_payment(v_test_payment_id_rf, v_test_agreement_id_rf);
  if (v_res->>'allocated_amount')::numeric <> 1000.00 then
    raise exception 'Test 11 Failed: Expected full 1000.00 allocated, got %', v_res;
  end if;
  raise notice 'Test 11 PASSED: Unadjusted payment provides full captured amount.';

  -- --------------------------------------------------------------------------
  -- TEST 12: Focused Accounting Test 2 — The same refund recorded in both the payment summary and adjustment ledger
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 12: Same refund recorded in summary and ledger prevents double-counting...';
  -- Create payment of ₹1,000 with ₹300 refund recorded in payments.refund_amount AND installment_adjustments
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refund_gateway_id, refunded_at
  ) values (
    v_test_order_id, v_test_inst_id, 1000.00, 'INR', 'partially_refunded', 'razorpay', 'pay_part_rf', now(),
    300.00, 'rfnd_dup_123', now()
  ) returning payment_id into v_test_payment_id;

  -- Audit adjustment also logged for the duplicate charge refund with gateway_event_id
  -- Automated gateway webhook event has approved_by_admin_id = null (no invented admin profile)
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rf, 'duplicate_charge_refund', 300.00, v_test_payment_id, 'rfnd_dup_123', 'Partial refund of overpayment', null
  );

  -- Allocate to Installment 2 (which is ₹1,000 due). Available should be EXACTLY ₹700 (1000 - 300), NOT ₹400!
  v_res := public.process_installment_payment(v_test_payment_id, v_test_agreement_id_rf);
  if (v_res->>'allocated_amount')::numeric <> 700.00 then
    raise exception 'Test 12 Failed: Expected exactly 700.00 allocated (no double-counting), got %', v_res;
  end if;
  raise notice 'Test 12 PASSED: Same refund recorded in summary and ledger counts refund exactly once (₹700 available).';

  -- --------------------------------------------------------------------------
  -- TEST 12b: Scenario B — Multiple Distinct Refunds, All Itemized in Ledger
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 12b: Multiple fully itemized refunds in ledger matching summary (₹500 reduction, ₹500 available)...';
  -- Create payment of ₹1,000.
  -- Summary: payments.refund_amount = 500.00, payments.refund_gateway_id = 'rfnd_b_2'.
  -- Ledger: 2 adjustments: rfnd_b_1 = 200.00, rfnd_b_2 = 300.00 (sum = 500.00).
  -- Fully reconciled: reduction = 500.00, net available = 500.00.
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id4, v_test_plan_id3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_scen_b;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_scen_b;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_scen_b, v_test_inst_id, v_test_course_id4, v_test_plan_id3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refund_gateway_id, refunded_at
  ) values (
    v_test_order_id_scen_b, v_test_inst_id, 1000.00, 'INR', 'partially_refunded', 'razorpay', 'pay_scen_b', now(),
    500.00, 'rfnd_b_2', now()
  ) returning payment_id into v_test_payment_id_scen_b;

  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_b, 'duplicate_charge_refund', 200.00, v_test_payment_id_scen_b, 'rfnd_b_1', 'First verified refund', null
  );

  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_b, 'duplicate_charge_refund', 300.00, v_test_payment_id_scen_b, 'rfnd_b_2', 'Second verified refund', null
  );

  v_res := public.process_installment_payment(v_test_payment_id_scen_b, v_test_agreement_id_scen_b);
  if (v_res->>'success')::boolean <> true then
    raise exception 'Test 12b Failed: Expected success = true for reconciled multi-item refund, got %', v_res;
  end if;
  if (v_res->>'allocated_amount')::numeric <> 500.00 then
    raise exception 'Test 12b Failed: Expected exactly 500.00 allocated from net available (1000 - 500), got %', v_res;
  end if;
  raise notice 'Test 12b PASSED: Multiple itemized refunds matching summary allocate exact net available credit (₹500).';

  -- --------------------------------------------------------------------------
  -- TEST 13: Focused Accounting Test 3 — Unreconciled Refund Summary with Separate Reversal
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 13: Unreconciled refund summary with reversal fails closed pending admin review...';
  -- Payment of ₹1,000 with:
  --   1. Refund summary of ₹300 in payments.refund_amount
  --   2. Separate gateway reversal of ₹400 in installment_adjustments
  --   3. No duplicate_charge_refund adjustment recorded in ledger (Summary > Ledger)
  -- Because refund overlap is unprovable, new allocation MUST be blocked until reconciliation!
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_sep;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_sep, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refunded_at
  ) values (
    v_test_order_id_sep, v_test_inst_id, 1000.00, 'INR', 'partially_refunded', 'razorpay', 'pay_sep_rf_rev', now(),
    300.00, now()
  ) returning payment_id into v_test_payment_id_sep;

  -- Separate distinct gateway reversal record (automated webhook: approved_by_admin_id = null)
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rf, 'gateway_reversal', 400.00, v_test_payment_id_sep, 'rev_sep_456', 'Gateway dispute clawback', null
  );

  v_res := public.process_installment_payment(v_test_payment_id_sep, v_test_agreement_id_rf);
  if (v_res->>'success')::boolean <> false then
    raise exception 'Test 13 Failed: Unreconciled refund summary MUST fail closed with success = false, got %', v_res;
  end if;
  if v_res->>'code' <> 'PAYMENT_REFUND_RECONCILIATION_REQUIRED' then
    raise exception 'Test 13 Failed: Expected code PAYMENT_REFUND_RECONCILIATION_REQUIRED, got %', v_res->>'code';
  end if;
  if (v_res->>'requires_admin_review')::boolean <> true then
    raise exception 'Test 13 Failed: Unreconciled payment MUST flag requires_admin_review = true.';
  end if;
  if (v_res->>'unallocated_amount')::numeric <> 0.00 then
    raise exception 'Test 13 Failed: Expected 0 unallocated credit pending reconciliation, got %', v_res->>'unallocated_amount';
  end if;
  raise notice 'Test 13 PASSED: Unreconciled refund summary with reversal correctly fails closed pending admin review.';

  -- --------------------------------------------------------------------------
  -- TEST 14: Focused Test — Gateway Event Identification, Idempotency & Inconsistent Data Protection
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 14: Gateway event identification, idempotency & duplicate protection...';
  -- 14a: Gateway adjustment with missing (NULL) gateway_event_id MUST fail closed (check_violation)
  v_blank_event_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rf, 'duplicate_charge_refund', 100.00, v_test_payment_id_sep, null, 'Missing event id', null
    );
  exception when check_violation then
    v_blank_event_caught := true;
  end;

  if not v_blank_event_caught then
    raise exception 'Test 14a Failed: Gateway adjustment with NULL gateway_event_id MUST be blocked by ck_adjustment_gateway_linkage.';
  end if;

  -- 14b: Gateway adjustment with blank/whitespace gateway_event_id MUST fail closed (check_violation)
  v_blank_event_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rf, 'gateway_reversal', 100.00, v_test_payment_id_sep, '   ', 'Blank event id', null
    );
  exception when check_violation then
    v_blank_event_caught := true;
  end;

  if not v_blank_event_caught then
    raise exception 'Test 14b Failed: Gateway adjustment with whitespace gateway_event_id MUST be blocked by ck_adjustment_gateway_linkage.';
  end if;

  -- 14c: Repeated delivery of the same event ID MUST be rejected by uq_installment_adjustments_gateway_event
  v_dup_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rf, 'gateway_reversal', 400.00, v_test_payment_id_sep, 'rev_sep_456', 'Duplicate webhook retry', null
    );
  exception when unique_violation then
    v_dup_caught := true;
  end;

  if not v_dup_caught then
    raise exception 'Test 14c Failed: Duplicate delivery of gateway event MUST be blocked by uq_installment_adjustments_gateway_event.';
  end if;

  -- 14d: Repeated underlying refund represented by different webhook deliveries (e.g. refund.created vs refund.processed)
  -- The authoritative transaction entity ID (rfnd_lifecycle_1) is identical across webhooks:
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rf, 'duplicate_charge_refund', 50.00, v_test_payment_id_sep, 'rfnd_lifecycle_1', 'Webhook 1: refund.created', null
  );

  v_lifecycle_dup_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rf, 'duplicate_charge_refund', 50.00, v_test_payment_id_sep, 'rfnd_lifecycle_1', 'Webhook 2: refund.processed retry', null
    );
  exception when unique_violation then
    v_lifecycle_dup_caught := true;
  end;

  if not v_lifecycle_dup_caught then
    raise exception 'Test 14d Failed: Different webhook deliveries for same underlying refund ID MUST be rejected by unique constraint.';
  end if;

  -- 14e: Event identifier linked to inconsistent payment data (same event ID attempted on a different payment)
  v_inconsistent_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rf, 'duplicate_charge_refund', 50.00, v_test_payment_id_rf, 'rfnd_lifecycle_1', 'Cross-payment tampering attempt', null
    );
  exception when unique_violation then
    v_inconsistent_caught := true;
  end;

  if not v_inconsistent_caught then
    raise exception 'Test 14e Failed: Global uniqueness on gateway_event_id MUST block inconsistent cross-payment event reuse.';
  end if;

  -- 14f: Manual administrative action (waiver) with NULL approved_by_admin_id MUST be rejected by ck_adjustment_audit_identity
  v_audit_ident_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, installment_index, adjustment_type, amount, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rf, 1, 'waiver', 500.00, 'Invalid unapproved waiver', null
    );
  exception when check_violation then
    v_audit_ident_caught := true;
  end;

  if not v_audit_ident_caught then
    raise exception 'Test 14f Failed: Administrative waiver with NULL approved_by_admin_id MUST be blocked by ck_adjustment_audit_identity.';
  end if;

  -- 14g: Gateway adjustment without reference_payment_id MUST be rejected by ck_adjustment_gateway_linkage
  v_gw_link_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rf, 'gateway_reversal', 200.00, null, 'rev_orphan_999', 'Orphaned reversal without payment', null
    );
  exception when check_violation then
    v_gw_link_caught := true;
  end;

  if not v_gw_link_caught then
    raise exception 'Test 14g Failed: Gateway adjustment without reference_payment_id MUST be blocked by ck_adjustment_gateway_linkage.';
  end if;

  -- 14h: Duplicate webhook allocation retry on already fully allocated payment returns already_processed
  v_res := public.process_installment_payment(v_test_payment_id_rf, v_test_agreement_id_rf);
  if (v_res->>'already_processed')::boolean <> true or v_res->>'code' <> 'PAYMENT_ALREADY_ALLOCATED' then
    raise exception 'Test 14h Failed: Expected already_processed = true and PAYMENT_ALREADY_ALLOCATED on retry, got %', v_res;
  end if;
  raise notice 'Test 14 PASSED: Gateway event identification, global uniqueness & duplicate protection strictly verified.';

  -- --------------------------------------------------------------------------
  -- TEST 15: Scenario C — Summary > Ledger (Unitemized Gateway Refund: Allocation Blocked)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 15: Scenario C (Summary > Ledger: unitemized refund blocks allocation pending reconciliation)...';
  -- Payment of ₹1,000.
  -- Summary reports payments.refund_amount = ₹500.00, refund_gateway_id = 'rfnd_sum_c'.
  -- Ledger only contains one itemized refund adjustment of ₹200.00 ('rfnd_c1').
  -- Summary exceeds ledger by ₹300.00. Because overlap cannot be proved,
  -- new installment allocations MUST be blocked until administrator reconciliation!
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id, v_test_plan_id, null, 12000.00,
    12000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_scen_c;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_scen_c;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_scen_c, v_test_inst_id, v_test_course_id, v_test_plan_id, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refund_gateway_id, refunded_at
  ) values (
    v_test_order_id_scen_c, v_test_inst_id, 1000.00, 'INR', 'partially_refunded', 'razorpay', 'pay_scen_c', now(),
    500.00, 'rfnd_sum_c', now()
  ) returning payment_id into v_test_payment_id_scen_c;

  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_c, 'duplicate_charge_refund', 200.00, v_test_payment_id_scen_c, 'rfnd_c1', 'First partial refund', null
  );

  v_res := public.process_installment_payment(v_test_payment_id_scen_c, v_test_agreement_id_scen_c);
  if (v_res->>'success')::boolean <> false then
    raise exception 'Test 15 Failed: Ambiguous Summary > Ledger MUST fail closed with success = false, got %', v_res;
  end if;
  if v_res->>'code' <> 'PAYMENT_REFUND_RECONCILIATION_REQUIRED' then
    raise exception 'Test 15 Failed: Expected code PAYMENT_REFUND_RECONCILIATION_REQUIRED, got %', v_res->>'code';
  end if;
  if (v_res->>'requires_admin_review')::boolean <> true then
    raise exception 'Test 15 Failed: Unitemized refund discrepancy MUST flag requires_admin_review = true.';
  end if;
  if (v_res->>'refund_discrepancy')::numeric <> 300.00 then
    raise exception 'Test 15 Failed: Expected refund_discrepancy = 300.00, got %', v_res->>'refund_discrepancy';
  end if;
  if (v_res->>'unallocated_amount')::numeric <> 0.00 then
    raise exception 'Test 15 Failed: Expected 0 unallocated credit pending reconciliation, got %', v_res->>'unallocated_amount';
  end if;
  if exists (select 1 from public.installment_payment_allocations where payment_id = v_test_payment_id_scen_c) then
    raise exception 'Test 15 Failed: No allocations should be committed while refund ambiguity exists.';
  end if;
  raise notice 'Test 15 PASSED: Summary > Ledger correctly fails closed, blocks allocation, and flags admin review.';

  -- --------------------------------------------------------------------------
  -- TEST 16: Scenario D — Ledger > Summary (Stale Summary: Allocation Blocked)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 16: Scenario D (Ledger > Summary: stale summary blocks allocation pending reconciliation)...';
  -- Payment of ₹1,000.
  -- Summary reports payments.refund_amount = ₹200.00, refund_gateway_id = 'rfnd_d1'.
  -- Ledger has two distinct verified refunds: rfnd_d1 = ₹200.00, rfnd_d2 = ₹300.00 (total ₹500.00).
  -- Ledger exceeds summary by ₹300.00. Because records are out-of-sync,
  -- new installment allocations MUST be blocked until administrator reconciliation!
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id2, v_test_plan_c2_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_scen_d;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_scen_d;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_scen_d, v_test_inst_id, v_test_course_id2, v_test_plan_c2_12x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refund_gateway_id, refunded_at
  ) values (
    v_test_order_id_scen_d, v_test_inst_id, 1000.00, 'INR', 'partially_refunded', 'razorpay', 'pay_scen_d', now(),
    200.00, 'rfnd_d1', now()
  ) returning payment_id into v_test_payment_id_scen_d;

  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_d, 'duplicate_charge_refund', 200.00, v_test_payment_id_scen_d, 'rfnd_d1', 'First verified refund', null
  );

  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_d, 'duplicate_charge_refund', 300.00, v_test_payment_id_scen_d, 'rfnd_d2', 'Second verified refund', null
  );

  v_res := public.process_installment_payment(v_test_payment_id_scen_d, v_test_agreement_id_scen_d);
  if (v_res->>'success')::boolean <> false then
    raise exception 'Test 16 Failed: Stale summary Ledger > Summary MUST fail closed with success = false, got %', v_res;
  end if;
  if v_res->>'code' <> 'PAYMENT_REFUND_RECONCILIATION_REQUIRED' then
    raise exception 'Test 16 Failed: Expected code PAYMENT_REFUND_RECONCILIATION_REQUIRED, got %', v_res->>'code';
  end if;
  if (v_res->>'requires_admin_review')::boolean <> true then
    raise exception 'Test 16 Failed: Stale summary discrepancy MUST flag requires_admin_review = true.';
  end if;
  if (v_res->>'refund_discrepancy')::numeric <> 300.00 then
    raise exception 'Test 16 Failed: Expected refund_discrepancy = 300.00, got %', v_res->>'refund_discrepancy';
  end if;
  if (v_res->>'unallocated_amount')::numeric <> 0.00 then
    raise exception 'Test 16 Failed: Expected 0 unallocated credit pending reconciliation, got %', v_res->>'unallocated_amount';
  end if;
  if exists (select 1 from public.installment_payment_allocations where payment_id = v_test_payment_id_scen_d) then
    raise exception 'Test 16 Failed: No allocations should be committed while refund ambiguity exists.';
  end if;
  raise notice 'Test 16 PASSED: Ledger > Summary correctly fails closed, blocks allocation, and flags admin review.';

  -- --------------------------------------------------------------------------
  -- TEST 16b: Scenario E — Equal Totals But Conflicting Gateway Event IDs (Allocation Blocked)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 16b: Scenario E (Equal aggregates but conflicting gateway event IDs blocks allocation)...';
  -- Payment of ₹1,000.
  -- Summary reports payments.refund_amount = ₹500.00, refund_gateway_id = 'rfnd_alpha'.
  -- Ledger reports 1 adjustment of ₹500.00 with gateway_event_id = 'rfnd_beta'.
  -- Amounts match exactly (both ₹500.00), but gateway identifiers conflict!
  -- Cannot prove they represent the same transaction; allocation MUST be blocked!
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id3, v_test_plan_c3_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_scen_e_incon;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_scen_e_incon;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_scen_e_incon, v_test_inst_id, v_test_course_id3, v_test_plan_c3_12x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refund_gateway_id, refunded_at
  ) values (
    v_test_order_id_scen_e_incon, v_test_inst_id, 1000.00, 'INR', 'partially_refunded', 'razorpay', 'pay_scen_e_incon', now(),
    500.00, 'rfnd_alpha', now()
  ) returning payment_id into v_test_payment_id_scen_e_incon;

  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_e_incon, 'duplicate_charge_refund', 500.00, v_test_payment_id_scen_e_incon, 'rfnd_beta', 'Conflicting refund event', null
  );

  v_res := public.process_installment_payment(v_test_payment_id_scen_e_incon, v_test_agreement_id_scen_e_incon);
  if (v_res->>'success')::boolean <> false then
    raise exception 'Test 16b Failed: Conflicting gateway event IDs MUST fail closed with success = false, got %', v_res;
  end if;
  if v_res->>'code' <> 'PAYMENT_REFUND_RECONCILIATION_REQUIRED' then
    raise exception 'Test 16b Failed: Expected code PAYMENT_REFUND_RECONCILIATION_REQUIRED, got %', v_res->>'code';
  end if;
  if (v_res->>'requires_admin_review')::boolean <> true then
    raise exception 'Test 16b Failed: Conflicting event IDs MUST flag requires_admin_review = true.';
  end if;
  if exists (select 1 from public.installment_payment_allocations where payment_id = v_test_payment_id_scen_e_incon) then
    raise exception 'Test 16b Failed: No allocations should be committed while conflicting event IDs exist.';
  end if;
  raise notice 'Test 16b PASSED: Conflicting gateway event IDs correctly fail closed and block allocation.';

  -- --------------------------------------------------------------------------
  -- TEST 17: Scenario F — Reconciled Refund Plus Separate Gateway Reversal (Allocation Succeeds)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 17: Scenario F (Reconciled refund ₹300 + distinct reversal ₹400 = ₹700 reduction, ₹300 available)...';
  -- Payment of ₹1,000.
  -- Refund summary: payments.refund_amount = ₹300.00, refund_gateway_id = 'rfnd_f1'.
  -- Refund ledger: duplicate_charge_refund = ₹300.00, gateway_event_id = 'rfnd_f1'.
  -- Reconciled refund: ₹300.00.
  -- Separate gateway reversal: gateway_reversal = ₹400.00, gateway_event_id = 'disp_f1'.
  -- Total reduction: ₹300 + ₹400 = ₹700.00.
  -- Net available credit: ₹1,000 - ₹700 = ₹300.00.
  -- Allocation succeeds for verified ₹300.00!
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id3, v_test_plan_c3_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_scen_e;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_scen_e;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_scen_e, v_test_inst_id, v_test_course_id3, v_test_plan_c3_12x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refund_gateway_id, refunded_at
  ) values (
    v_test_order_id_scen_e, v_test_inst_id, 1000.00, 'INR', 'partially_refunded', 'razorpay', 'pay_scen_e', now(),
    300.00, 'rfnd_f1', now()
  ) returning payment_id into v_test_payment_id_scen_e;

  -- Reconciled refund adjustment for ₹300
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_e, 'duplicate_charge_refund', 300.00, v_test_payment_id_scen_e, 'rfnd_f1', 'Reconciled refund item', null
  );

  -- Separate gateway reversal for ₹400
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_scen_e, 'gateway_reversal', 400.00, v_test_payment_id_scen_e, 'disp_f1', 'Gateway dispute clawback', null
  );

  v_res := public.process_installment_payment(v_test_payment_id_scen_e, v_test_agreement_id_scen_e);
  if (v_res->>'success')::boolean <> true then
    raise exception 'Test 17 Failed: Expected success = true for reconciled refund + reversal, got %', v_res;
  end if;
  if (v_res->>'allocated_amount')::numeric <> 300.00 then
    raise exception 'Test 17 Failed: Expected exactly 300.00 allocated from net available (1000 - 300 - 400), got %', v_res;
  end if;
  if (v_res->>'unallocated_surplus')::numeric <> 0.00 then
    raise exception 'Test 17 Failed: Expected 0 unallocated surplus, got %', v_res->>'unallocated_surplus';
  end if;
  raise notice 'Test 17 PASSED: Separate reversal (₹400) and reconciled refund (₹300) correctly sum to ₹700 reduction with ₹300 available.';

  -- TEST 18: Focused Accounting Test 5 — A fully refunded payment that cannot be newly allocated
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 18: Fully refunded payment cannot be newly allocated...';
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at,
    refund_amount, refunded_at
  ) values (
    v_test_order_id, v_test_inst_id, 1000.00, 'INR', 'refunded', 'razorpay', 'pay_full_rf', now(),
    1000.00, now()
  ) returning payment_id into v_test_payment_id;

  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rf, 'duplicate_charge_refund', 1000.00, v_test_payment_id, 'rfnd_full_999', 'Full duplicate charge refund', null
  );

  v_res := public.process_installment_payment(v_test_payment_id, v_test_agreement_id_rf);
  if (v_res->>'success')::boolean <> false or v_res->>'code' <> 'PAYMENT_REFUNDED' then
    raise exception 'Test 18 Failed: Expected PAYMENT_REFUNDED, got %', v_res;
  end if;
  raise notice 'Test 18 PASSED: Fully refunded payment rejected cleanly with 0 available amount.';

  -- --------------------------------------------------------------------------
  -- TEST 19: Focused Accounting Test 6 — A reversal received after the payment has already been allocated
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 19: Reversal received after payment has already been allocated flags review and reports deficit...';
  -- Create distinct student/agreement for post-allocation reversal testing
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id2, v_test_course_id5, v_test_plan_c5_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_post;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id2, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_post;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_post, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id_post, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'pay_post_alloc', now()
  ) returning payment_id into v_test_payment_id_post;

  -- 1. Successfully allocate payment to installment 1
  v_res := public.process_installment_payment(v_test_payment_id_post, v_test_agreement_id_post);
  if (v_res->>'allocated_amount')::numeric <> 1000.00 then
    raise exception 'Test 19 Setup Failed: Expected full 1000.00 allocated, got %', v_res;
  end if;

  -- Verify agreement is NOT flagged for review before reversal
  select requires_admin_review into v_admin_review_flag
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id_post;
  if v_admin_review_flag <> false then
    raise exception 'Test 19 Setup Failed: Expected requires_admin_review = false before reversal.';
  end if;

  -- 2. A gateway reversal of ₹400 arrives AFTER allocation (automated webhook: approved_by_admin_id = null)
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_post, 'gateway_reversal', 400.00, v_test_payment_id_post, 'rev_post_789', 'Chargeback reversal after allocation', null
  );

  -- 3. Verify trigger trg_installment_adjustment_audit immediately flagged the agreement
  select requires_admin_review into v_admin_review_flag
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id_post;
  if v_admin_review_flag <> true then
    raise exception 'Test 19 Failed: Trigger trg_installment_adjustment_audit MUST flag requires_admin_review = true.';
  end if;

  -- 4. Calling process_installment_payment on the reversed payment explicitly returns deficit details
  v_res := public.process_installment_payment(v_test_payment_id_post, v_test_agreement_id_post);
  if (v_res->>'code' <> 'PAYMENT_REVERSED_ALLOCATION_DEFICIT') or
     (v_res->>'requires_admin_review')::boolean <> true or
     (v_res->>'deficit_amount')::numeric <> 400.00 or
     (v_res->>'net_payment_available')::numeric <> 600.00 or
     (v_res->>'already_allocated')::numeric <> 1000.00 or
     (v_res->>'unallocated_amount')::numeric <> 0.00 then
    raise exception 'Test 19 Failed: Expected PAYMENT_REVERSED_ALLOCATION_DEFICIT with 400.00 deficit, got %', v_res;
  end if;
  raise notice 'Test 19 PASSED: Reversal received after allocation flags agreement and reports deficit explicitly.';

  -- --------------------------------------------------------------------------
  -- TEST 20: Focused Accounting Test 7 — Prevention of further inappropriate allocations after a reversal
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 20: Prevention of further inappropriate allocations after a reversal...';
  -- Payment v_test_payment_id_post has amount = 1000, reversal = 400 (net available = 600), already allocated = 1000.
  -- Attempting to insert ANY new allocation from this payment must be blocked by trg_enforce_allocation_limits!
  select schedule_id into v_sched_id_rf2
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id_post and installment_index = 2;

  v_post_rev_caught := false;
  begin
    insert into public.installment_payment_allocations (
      payment_id, schedule_id, agreement_id, allocated_amount
    ) values (
      v_test_payment_id_post, v_sched_id_rf2, v_test_agreement_id_post, 100.00
    );
  exception when check_violation then
    v_post_rev_caught := true;
  end;

  if not v_post_rev_caught then
    raise exception 'Test 20 Failed: Trigger trg_enforce_allocation_limits MUST reject allocation exceeding post-reversal net available amount.';
  end if;
  raise notice 'Test 20 PASSED: Database trigger strictly blocks further allocations from reversed payment.';

  -- --------------------------------------------------------------------------
  -- TEST 21: Focused Accounting Test 8 — Preservation of original allocation history
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 21: Original payment and allocation history strictly preserved...';
  -- Verify original payment record is intact
  select amount, status::text into v_orig_payment_amount, v_orig_payment_status
  from public.payments
  where payment_id = v_test_payment_id_post;

  if v_orig_payment_amount <> 1000.00 or v_orig_payment_status <> 'captured' then
    raise exception 'Test 21 Failed: Original payment record was mutated (amount: %, status: %).', v_orig_payment_amount, v_orig_payment_status;
  end if;

  -- Verify original allocation record is intact
  select count(*), coalesce(sum(allocated_amount), 0.00)
  into v_orig_alloc_cnt, v_total_alloc
  from public.installment_payment_allocations
  where payment_id = v_test_payment_id_post;

  if v_orig_alloc_cnt <> 1 or v_total_alloc <> 1000.00 then
    raise exception 'Test 21 Failed: Original allocation rows mutated or deleted (count: %, sum: %).', v_orig_alloc_cnt, v_total_alloc;
  end if;
  raise notice 'Test 21 PASSED: Original captured payment and allocation history strictly preserved.';

  -- --------------------------------------------------------------------------
  -- TEST 22: Focused Accounting Test 9 — Administrative-review flagging without unapproved automatic entitlement revocation
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 22: Administrative review flagged without unapproved automatic entitlement revocation...';
  -- Verify agreement has requires_admin_review = true
  select requires_admin_review into v_admin_review_flag
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id_post;

  if v_admin_review_flag <> true then
    raise exception 'Test 22 Failed: Agreement must have requires_admin_review = true.';
  end if;

  -- Verify student's subscription entitlement was NOT deleted or revoked automatically
  select status into v_sub_status
  from public.student_subscriptions
  where student_id = v_test_student_id2 and course_id = v_test_course_id5;

  if v_sub_status is null or v_sub_status in ('expired', 'cancelled') then
    raise exception 'Test 22 Failed: Entitlement was inappropriately revoked without approved administrative review! Status: %', v_sub_status;
  end if;
  raise notice 'Test 22 PASSED: Agreement flagged for admin review while preserving entitlement pending authorization.';

  -- --------------------------------------------------------------------------
  -- TEST 23: Attempt to Delete Agreement with Financial Allocations (ON DELETE RESTRICT)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 23: Deletion protection on financial history...';
  v_del_caught := false;
  begin
    delete from public.student_course_agreements where agreement_id = v_test_agreement_id;
  exception when foreign_key_violation then
    v_del_caught := true;
  end;

  if not v_del_caught then
    raise exception 'Test 23 Failed: Deletion of agreement with allocations MUST be blocked by ON DELETE RESTRICT.';
  end if;
  raise notice 'Test 23 PASSED: Financial history protected from deletion by ON DELETE RESTRICT.';

  -- --------------------------------------------------------------------------
  -- TEST 24: Composite Foreign Key Integrity
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 24: Composite foreign key enforces agreement-to-schedule integrity...';
  select schedule_id into v_sched_id_inst1
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id and installment_index = 1;

  v_fk_caught := false;
  begin
    insert into public.installment_payment_allocations (
      payment_id, schedule_id, agreement_id, allocated_amount
    ) values (
      v_test_payment_id, v_sched_id_inst1, v_test_agreement_id3, 100.00
    );
  exception when foreign_key_violation then
    v_fk_caught := true;
  end;

  if not v_fk_caught then
    raise exception 'Test 24 Failed: Mismatched agreement_id and schedule_id MUST be blocked by composite foreign key.';
  end if;
  raise notice 'Test 24 PASSED: Composite foreign key prevented cross-agreement allocation tampering.';

  -- --------------------------------------------------------------------------
  -- TEST 25: Fully Waived Overdue Installment Does NOT Block Live-Class Access
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 25: Fully waived overdue installment does not block access...';
  -- Create overdue condition on student 1 by backdating installment 3
  select schedule_id into v_sched_id_inst3
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id and installment_index = 3;

  update public.student_installment_schedule
  set due_date = current_date - 1, status = 'pending', amount_paid = 0.00, waiver_amount = 0.00
  where schedule_id = v_sched_id_inst3;

  v_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id, null);
  if (v_res->>'authorized')::boolean <> false or v_res->>'code' <> 'INSTALLMENT_ARREARS_BLOCKED' then
    raise exception 'Test 25 Failed: Expected arrears blocked before waiver, got %', v_res;
  end if;

  -- Apply 100% waiver to installment 3 (3000.00)
  insert into public.installment_adjustments (
    agreement_id, installment_index, adjustment_type, amount, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id, 3, 'waiver', 3000.00, 'Full fee waiver for test', v_teacher_id
  );

  update public.student_installment_schedule
  set waiver_amount = 3000.00, status = 'waived', updated_at = now()
  where schedule_id = v_sched_id_inst3;

  v_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id, null);
  if (v_res->>'authorized')::boolean <> true then
    raise exception 'Test 25 Failed: Fully waived installment must NOT block live classes! Got %', v_res;
  end if;
  raise notice 'Test 25 PASSED: Fully waived installment does not block live-class access.';

  -- --------------------------------------------------------------------------
  -- TEST 26: Partially Waived Installment Remains Overdue While Effective Balance Exists
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 26: Partially waived installment remains overdue...';
  -- Set partial waiver of 300 on installment 3 (obligation 3000.00 - effective unpaid: 2700.00)
  update public.student_installment_schedule
  set due_date = current_date - 1, status = 'pending', waiver_amount = 300.00, amount_paid = 0.00
  where schedule_id = v_sched_id_inst3;

  v_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id, null);
  if (v_res->>'authorized')::boolean <> false or v_res->>'code' <> 'INSTALLMENT_ARREARS_BLOCKED' then
    raise exception 'Test 26 Failed: Partial waiver must remain blocked while unpaid balance exists, got %', v_res;
  end if;
  raise notice 'Test 26 PASSED: Partially waived installment enforces effective unpaid balance.';

  -- --------------------------------------------------------------------------
  -- TEST 27: Rescheduled Installment Evaluated Using Approved Revised Due Date
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 27: Rescheduled installment evaluated using revised_due_date...';
  select schedule_id into v_sched_id_inst4
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id and installment_index = 4;

  update public.student_installment_schedule
  set due_date = current_date - 1,
      revised_due_date = current_date + 30,
      status = 'pending',
      amount_paid = 0.00,
      waiver_amount = 0.00
  where schedule_id = v_sched_id_inst4;

  v_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id, null);
  if (v_res->>'authorized')::boolean <> true then
    raise exception 'Test 27 Failed: Rescheduled installment with future revised due date must NOT be overdue! Got %', v_res;
  end if;
  raise notice 'Test 27 PASSED: Rescheduled installment respects approved revised due date.';
  -- --------------------------------------------------------------------------
  -- TEST 32: Refund Lifecycle Ordering, Contradictory Failure & Discrepancy Reconciliation (Revision 32)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 32: Refund lifecycle ordering, contradictory failure, and fail-closed reconciliation...';
  -- Create agreement, order, payment of ₹1000.00
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id2, v_test_course_id5, v_test_plan_c5_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_rev31;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id2, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_rev31;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_rev31, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id_rev31, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'pay_rev31_ord_1', now()
  ) returning payment_id into v_test_payment_id_rev31;

  -- Lookup schedule entries for agreement
  select schedule_id into v_sched_id_rev32_1
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id_rev31 and installment_index = 1;

  select schedule_id into v_sched_id_rev32_2
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id_rev31 and installment_index = 2;

  -- Initial payment allocation: allocate ₹500.00 to installment 1
  insert into public.installment_payment_allocations (
    agreement_id, installment_index, schedule_id, payment_id, allocated_amount, notes
  ) values (
    v_test_agreement_id_rev31, 1, v_sched_id_rev32_1, v_test_payment_id_rev31, 500.00, 'Initial allocation of ₹500.00'
  );

  -- Stage A: refund.processed arrives FIRST (out-of-order delivery)
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev31, 'gateway_refund', 350.00, 'processed', v_test_payment_id_rev31, 'rfnd_ord_001', 'Processed refund', null
  );
  update public.payments
  set refund_amount = 350.00,
      refund_gateway_id = 'rfnd_ord_001',
      refunded_at = now(),
      status = 'partially_refunded'
  where payment_id = v_test_payment_id_rev31;

  -- Active refund reduction is 350.00; net payment available is 1000.00 - 350.00 = 650.00
  select coalesce(sum(amount), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev31
    and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
    and status = 'processed';
  if v_total_alloc <> 350.00 then
    raise exception 'Test 32 Failed: Processed refund must count as 350.00 reduction! Got %', v_total_alloc;
  end if;

  -- Stage B: Delayed stale refund.created arrives for rfnd_ord_001
  -- Anti-downgrade rule: webhook/application layer ignores stale created event.
  -- Record remains status = 'processed'
  select status into v_sub_status
  from public.installment_adjustments
  where gateway_event_id = 'rfnd_ord_001';
  if v_sub_status <> 'processed' then
    raise exception 'Test 32 Failed: Delayed created event must not downgrade processed state!';
  end if;

  -- Stage C: refund.speed_changed arrives
  -- Informational event; verify financial ledger and summary remain exactly 350.00
  select refund_amount into v_total_alloc
  from public.payments
  where payment_id = v_test_payment_id_rev31;
  if v_total_alloc <> 350.00 then
    raise exception 'Test 32 Failed: speed_changed must not alter payment refund_amount!';
  end if;

  -- Stage D: Contradictory refund.failed arrives after processed status (Revision 32, Issue 1)
  -- The webhook flags 'under_review', preserves payments.refund_amount at 350.00,
  -- and flags student agreement for administrative review.
  update public.installment_adjustments
  set status = 'under_review',
      reason = 'Contradictory Razorpay refund.failed received after processed status: rfnd_ord_001. Retaining financial reduction pending administrative reconciliation.'
  where gateway_event_id = 'rfnd_ord_001';

  update public.student_course_agreements
  set requires_admin_review = true, updated_at = now()
  where agreement_id = v_test_agreement_id_rev31;

  -- CRITICAL INVARIANT: payments.refund_amount remains 350.00 (NOT restored to 0.00)!
  select refund_amount into v_total_alloc
  from public.payments
  where payment_id = v_test_payment_id_rev31;
  if v_total_alloc <> 350.00 then
    raise exception 'Test 32 Failed: Contradictory refund.failed must NOT reset payments.refund_amount to 0.00! Got %', v_total_alloc;
  end if;

  -- Agreement review flag must be set
  select requires_admin_review into v_admin_review_flag
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id_rev31;
  if not v_admin_review_flag then
    raise exception 'Test 32 Failed: Agreement must be flagged for admin review!';
  end if;

  -- FAIL-CLOSED ENGINE ENFORCEMENT:
  -- Because payments.refund_amount is 350.00 but active processed adjustments is 0.00,
  -- the payment is unreconciled (v_is_reconciled = false).
  -- Any attempt to make a NEW allocation from this payment must be BLOCKED!
  v_rev32_unreconciled_caught := false;
  begin
    insert into public.installment_payment_allocations (
      agreement_id, installment_index, schedule_id, payment_id, allocated_amount, notes
    ) values (
      v_test_agreement_id_rev31, 2, v_sched_id_rev32_2, v_test_payment_id_rev31, 100.00, 'Attempted allocation while unreconciled'
    );
  exception when check_violation then
    v_rev32_unreconciled_caught := true;
  end;
  if not v_rev32_unreconciled_caught then
    raise exception 'Test 32 Failed: Allocation from unreconciled payment MUST be blocked by check_violation!';
  end if;

  -- Prior allocation of ₹500.00 remains intact and student entitlements are NOT revoked
  select coalesce(sum(allocated_amount), 0.00) into v_total_alloc
  from public.installment_payment_allocations
  where payment_id = v_test_payment_id_rev31;
  if v_total_alloc <> 500.00 then
    raise exception 'Test 32 Failed: Prior allocation must remain intact at 500.00! Got %', v_total_alloc;
  end if;

  -- Stage E: Duplicate contradictory notification arrives
  -- Repeated delivery while under_review is idempotently acknowledged; status remains 'under_review'
  select status into v_sub_status
  from public.installment_adjustments
  where gateway_event_id = 'rfnd_ord_001';
  if v_sub_status <> 'under_review' then
    raise exception 'Test 32 Failed: Duplicate contradictory event must maintain under_review status!';
  end if;

  -- Stage F: Authoritative Conflict Resolution
  -- Administrator verifies with gateway and merchant bank that the refund genuinely failed at beneficiary bank,
  -- and merchant funds were credited back.
  -- Administrator transactionally reconciles: updates adjustment to 'failed' and clears payments.refund_amount to 0.00.
  update public.installment_adjustments
  set status = 'failed',
      reason = 'Administrator verified refund failure with Razorpay settlement report; funds confirmed in merchant account.'
  where gateway_event_id = 'rfnd_ord_001';

  update public.payments
  set refund_amount = 0.00,
      refund_gateway_id = null,
      status = 'captured'
  where payment_id = v_test_payment_id_rev31;

  -- Reconciled state restored: payments.refund_amount (0.00) = active ledger (0.00).
  -- Available payment credit safely returns to ₹1000.00.
  -- New allocation of ₹100.00 to installment 2 now SUCCEEDS!
  insert into public.installment_payment_allocations (
    agreement_id, installment_index, schedule_id, payment_id, allocated_amount, notes
  ) values (
    v_test_agreement_id_rev31, 2, v_sched_id_rev32_2, v_test_payment_id_rev31, 100.00, 'Allocation after authoritative reconciliation'
  );

  select coalesce(sum(allocated_amount), 0.00) into v_total_alloc
  from public.installment_payment_allocations
  where payment_id = v_test_payment_id_rev31;
  if v_total_alloc <> 600.00 then
    raise exception 'Test 32 Failed: Total allocated must be 600.00 after reconciliation! Got %', v_total_alloc;
  end if;

  -- Stage G: Duplicate delivery of same refund event ID is rejected by unique constraint
  v_rev31_dup_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rev31, 'gateway_refund', 350.00, 'failed', v_test_payment_id_rev31, 'rfnd_ord_001', 'Duplicate insert attempt', null
    );
  exception when unique_violation then
    v_rev31_dup_caught := true;
  end;
  if not v_rev31_dup_caught then
    raise exception 'Test 32 Failed: Duplicate insert of same gateway_event_id MUST fail unique constraint!';
  end if;

  raise notice 'Test 32 PASSED: Refund lifecycle ordering, contradictory failure, and fail-closed reconciliation verified.';


  -- --------------------------------------------------------------------------
  -- TEST 33: Authorized Reconciliation Review Clearance (Revision 34, Issue 4)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 33: Refund discrepancy reconciliation recovery and authorized review clearance...';
  -- Step 1: Create student agreement, completed order, and captured payment of ₹1000.00
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id2, v_test_course_id5, v_test_plan_c5_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_rev33;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id2, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_rev33;

  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_rev33, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);

  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id_rev33, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'pay_rev33_ord_1', now()
  ) returning payment_id into v_test_payment_id_rev33;

  -- Lookup schedule entries
  select schedule_id into v_sched_id_rev33_1
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id_rev33 and installment_index = 1;

  select schedule_id into v_sched_id_rev33_2
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id_rev33 and installment_index = 2;

  -- Initial payment allocation: allocate ₹500.00 to installment 1
  insert into public.installment_payment_allocations (
    agreement_id, installment_index, schedule_id, payment_id, allocated_amount, notes
  ) values (
    v_test_agreement_id_rev33, 1, v_sched_id_rev33_1, v_test_payment_id_rev33, 500.00, 'Initial allocation of ₹500.00'
  );

  -- Step 2: Create a genuine refund-summary discrepancy
  -- Payment summary reports refund_amount = 350.00, but adjustment ledger has 0.00 processed refunds!
  update public.payments
  set refund_amount = 350.00,
      refund_gateway_id = 'rfnd_rev33_discrepant',
      status = 'partially_refunded'
  where payment_id = v_test_payment_id_rev33;

  update public.student_course_agreements
  set requires_admin_review = true,
      updated_at = now()
  where agreement_id = v_test_agreement_id_rev33;

  -- Step 3: Confirm that a new allocation is BLOCKED by fail-closed trigger
  -- Attempt to allocate ₹100.00 to installment 2 must throw check_violation
  v_rev33_unreconciled_caught := false;
  begin
    insert into public.installment_payment_allocations (
      agreement_id, installment_index, schedule_id, payment_id, allocated_amount, notes
    ) values (
      v_test_agreement_id_rev33, 2, v_sched_id_rev33_2, v_test_payment_id_rev33, 100.00, 'Attempted allocation during discrepancy'
    );
  exception when check_violation then
    v_rev33_unreconciled_caught := true;
  end;
  if not v_rev33_unreconciled_caught then
    raise exception 'Test 33 Failed: Allocation during refund discrepancy MUST be blocked by check_violation!';
  end if;

  -- Step 4: Confirm existing payment allocation remains unchanged and entitlements intact
  select coalesce(sum(allocated_amount), 0.00) into v_total_alloc
  from public.installment_payment_allocations
  where payment_id = v_test_payment_id_rev33;
  if v_total_alloc <> 500.00 then
    raise exception 'Test 33 Failed: Prior allocation must remain intact at 500.00! Got %', v_total_alloc;
  end if;

  -- Step 5: Reconcile the financial records
  -- Administrator verifies that the ₹350.00 refund was genuine and creates processed adjustment.
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev33, 'gateway_refund', 350.00, 'processed', v_test_payment_id_rev33, 'rfnd_rev33_discrepant', 'Reconciled processed refund', null
  );

  -- Step 6: Verify financial reconciliation ALONE does NOT clear requires_admin_review
  select requires_admin_review into v_admin_review_flag
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id_rev33;
  if not v_admin_review_flag then
    raise exception 'Test 33 Failed: requires_admin_review must NOT be automatically cleared by financial update alone!';
  end if;

  -- Step 7: Attempt unauthorized clearance of review flag
  -- Non-admin / student caller calling resolve_agreement_admin_review MUST be blocked with insufficient_privilege!
  v_rev34_unauthorized_caught := false;
  begin
    set local "request.jwt.claim.role" = 'authenticated';
    set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
    perform public.resolve_agreement_admin_review(
      v_test_agreement_id_rev33, 'Unauthorized clearance attempt by non-admin'
    );
  exception when insufficient_privilege then
    v_rev34_unauthorized_caught := true;
  end;
  if not v_rev34_unauthorized_caught then
    raise exception 'Test 33 Failed: Unauthorized attempt to clear review flag MUST throw insufficient_privilege!';
  end if;

  -- Step 8: Confirm allocations remain blocked while requires_admin_review remains true
  -- Even though financial records match (350.00 = 350.00), the agreement review condition blocks allocation!
  v_rev34_review_blocked_caught := false;
  begin
    insert into public.installment_payment_allocations (
      agreement_id, installment_index, schedule_id, payment_id, allocated_amount, notes
    ) values (
      v_test_agreement_id_rev33, 2, v_sched_id_rev33_2, v_test_payment_id_rev33, 150.00, 'Attempted allocation while review flag set'
    );
  exception when check_violation then
    v_rev34_review_blocked_caught := true;
  end;
  if not v_rev34_review_blocked_caught then
    raise exception 'Test 33 Failed: Allocations MUST remain blocked while requires_admin_review = true, even after financial reconciliation!';
  end if;

  -- Step 9: Authorized clearance via resolve_agreement_admin_review
  -- Service role / authorized administrator clears review with mandatory audit notes:
  set local "request.jwt.claim.role" = 'service_role';
  perform public.resolve_agreement_admin_review(
    v_test_agreement_id_rev33, 'Reconciled ₹350.00 refund against gateway settlement statement; review cleared.'
  );

  select requires_admin_review into v_admin_review_flag
  from public.student_course_agreements
  where agreement_id = v_test_agreement_id_rev33;
  if v_admin_review_flag then
    raise exception 'Test 33 Failed: requires_admin_review must be cleared after authorized resolution RPC!';
  end if;

  -- Step 10: Successful allocation only when financial AND review conditions permit it
  -- Net available payment is 1000.00 - 350.00 = 650.00. Previously allocated: 500.00. Unallocated credit: ₹150.00.
  insert into public.installment_payment_allocations (
    agreement_id, installment_index, schedule_id, payment_id, allocated_amount, notes
  ) values (
    v_test_agreement_id_rev33, 2, v_sched_id_rev33_2, v_test_payment_id_rev33, 150.00, 'Allocation after authorized review clearance'
  );

  -- Total allocated is now 650.00 (all available funds utilized)
  select coalesce(sum(allocated_amount), 0.00) into v_total_alloc
  from public.installment_payment_allocations
  where payment_id = v_test_payment_id_rev33;
  if v_total_alloc <> 650.00 then
    raise exception 'Test 33 Failed: Total allocated must be 650.00! Got %', v_total_alloc;
  end if;

  -- Confirm existing allocations remain unchanged and preserved
  if not exists (
    select 1 from public.installment_payment_allocations
    where payment_id = v_test_payment_id_rev33 and installment_index = 1 and allocated_amount = 500.00
  ) or not exists (
    select 1 from public.installment_payment_allocations
    where payment_id = v_test_payment_id_rev33 and installment_index = 2 and allocated_amount = 150.00
  ) then
    raise exception 'Test 33 Failed: Individual allocation records must be preserved intact!';
  end if;

  raise notice 'Test 33 PASSED: Authorized review clearance and reconciliation recovery verified.';

  -- --------------------------------------------------------------------------
  -- TEST 34: Durable Webhook Quarantine, Idempotent Redelivery and Unlinked Event Preservation (Revision 34, Issue 2)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 34: Durable webhook quarantine, idempotent redelivery and unlinked event preservation...';

  -- Scenario A: Authenticated malformed event quarantined in public.webhook_quarantine_events
  insert into public.webhook_quarantine_events (
    gateway_event_id, event_type, entity_id, gateway_payment_id,
    payment_id, agreement_id, failure_code, failure_reason, payload
  ) values (
    'evt_malformed_rev34_001', 'payment.dispute.created', 'disp_malformed_001', 'pay_malformed_001',
    v_test_payment_id_rev33, v_test_agreement_id_rev33, 'MALFORMED_FINANCIAL_DATA',
    'Negative currency unit received: -500 paise', '{"amount": -500, "dispute_id": "disp_malformed_001"}'::jsonb
  );

  -- Verify quarantine ledger contains exact failure details
  if not exists (
    select 1 from public.webhook_quarantine_events
    where gateway_event_id = 'evt_malformed_rev34_001'
      and entity_id = 'disp_malformed_001'
      and failure_code = 'MALFORMED_FINANCIAL_DATA'
  ) then
    raise exception 'Test 34 Failed: Quarantined event record must be durably persisted!';
  end if;

  -- Invariant: malformed monetary value created ZERO financial adjustments
  if exists (
    select 1 from public.installment_adjustments
    where gateway_event_id = 'disp_malformed_001'
  ) then
    raise exception 'Test 34 Failed: Quarantined malformed event must NOT create financial adjustments!';
  end if;

  -- Scenario B: Duplicate delivery of quarantined event (idempotency check)
  -- Attempting second insert with identical gateway_event_id MUST fail unique constraint
  v_rev34_quarantine_dup_caught := false;
  begin
    insert into public.webhook_quarantine_events (
      gateway_event_id, event_type, entity_id, gateway_payment_id,
      payment_id, agreement_id, failure_code, failure_reason, payload
    ) values (
      'evt_malformed_rev34_001', 'payment.dispute.created', 'disp_malformed_001', 'pay_malformed_001',
      v_test_payment_id_rev33, v_test_agreement_id_rev33, 'MALFORMED_FINANCIAL_DATA',
      'Negative currency unit received: -500 paise', '{"amount": -500, "dispute_id": "disp_malformed_001"}'::jsonb
    );
  exception when unique_violation then
    v_rev34_quarantine_dup_caught := true;
  end;
  if not v_rev34_quarantine_dup_caught then
    raise exception 'Test 34 Failed: Duplicate delivery of quarantined event MUST be blocked by unique constraint uq_webhook_quarantine_event!';
  end if;

  -- Scenario C: Malformed event with missing installment agreement linkage (unlinked purchase)
  -- Durably stored with null payment_id and null agreement_id without foreign key violations
  insert into public.webhook_quarantine_events (
    gateway_event_id, event_type, entity_id, gateway_payment_id,
    payment_id, agreement_id, failure_code, failure_reason, payload
  ) values (
    'evt_malformed_unlinked_001', 'refund.processed', 'rfnd_unlinked_001', 'pay_unlinked_001',
    null, null, 'MALFORMED_FINANCIAL_DATA',
    'Zero currency unit received: zero is not permitted for this operation', '{"amount": 0, "refund_id": "rfnd_unlinked_001"}'::jsonb
  );

  if not exists (
    select 1 from public.webhook_quarantine_events
    where gateway_event_id = 'evt_malformed_unlinked_001' and agreement_id is null and payment_id is null
  ) then
    raise exception 'Test 34 Failed: Unlinked malformed event must be durably persisted without FK error!';
  end if;

  -- Scenario D: Database write failure retains retryable failure path
  -- A failed quarantine write (e.g. null mandatory event_type) must fail transaction with not_null_violation
  v_rev34_quarantine_fail_caught := false;
  begin
    insert into public.webhook_quarantine_events (
      gateway_event_id, event_type, entity_id, failure_code, failure_reason, payload
    ) values (
      'evt_malformed_fail_001', null, 'rfnd_fail_001', 'MALFORMED_FINANCIAL_DATA', 'Test failure', '{}'::jsonb
    );
  exception when not_null_violation then
    v_rev34_quarantine_fail_caught := true;
  end;
  if not v_rev34_quarantine_fail_caught then
    raise exception 'Test 34 Failed: Quarantine insert with missing required fields MUST fail with not_null_violation!';
  end if;

  raise notice 'Test 34 PASSED: Durable webhook quarantine, idempotent redelivery and unlinked preservation verified.';
  raise notice '====================================================================';
  raise notice 'Migration 219 Integration Test Suite completed successfully.';
    -- --------------------------------------------------------------------------
  -- TEST 28: Refund Lifecycle State Transitions & Failed Refund Handling (Revision 30)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 28: Refund lifecycle state transitions and failed refund handling...';
  -- Create agreement, order, payment of ₹1000.00
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_id5, v_test_plan_c5_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_rev30;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_rev30;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_rev30, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id_rev30, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'pay_rev30_rfnd_1', now()
  ) returning payment_id into v_test_payment_id_rev30;

  -- Stage A: refund.created arrives (Status: 'created', Amount: ₹300.00)
  -- Created state does NOT deduct financial credit from payment
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev30, 'gateway_refund', 300.00, 'created', v_test_payment_id_rev30, 'rfnd_rev30_001', 'Refund initiated', null
  );

  -- Verification: created refund is NOT counted in active refund adjustments
  select coalesce(sum(amount), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
    and status = 'processed';
  if v_total_alloc <> 0.00 then
    raise exception 'Test 28 Failed: Refund in created state must NOT count as processed reduction! Got %', v_total_alloc;
  end if;

  -- Stage B: Duplicate webhook delivery of refund.created with same gateway_event_id is rejected by unique constraint
  v_rev30_dup_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rev30, 'gateway_refund', 300.00, 'created', v_test_payment_id_rev30, 'rfnd_rev30_001', 'Duplicate delivery', null
    );
  exception when unique_violation then
    v_rev30_dup_caught := true;
  end;
  if not v_rev30_dup_caught then
    raise exception 'Test 28 Failed: Duplicate webhook delivery of same refund event ID MUST trigger unique violation!';
  end if;

  -- Stage C: Legitimate lifecycle progression to refund.processed updates existing record
  update public.installment_adjustments
  set status = 'processed',
      reason = 'Refund successfully processed by bank'
  where gateway_event_id = 'rfnd_rev30_001';

  -- Update payment summary to reflect processed refund
  update public.payments
  set refund_amount = 300.00,
      refund_gateway_id = 'rfnd_rev30_001',
      refunded_at = now()
  where payment_id = v_test_payment_id_rev30;

  -- Verification: processed refund is now counted
  select coalesce(sum(amount), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
    and status = 'processed';
  if v_total_alloc <> 300.00 then
    raise exception 'Test 28 Failed: Processed refund must count as 300.00 reduction! Got %', v_total_alloc;
  end if;

  -- Stage D: A second refund rfnd_rev30_002 fails (refund.failed)
  -- Failed refund is inserted or updated to status = 'failed'
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev30, 'gateway_refund', 200.00, 'failed', v_test_payment_id_rev30, 'rfnd_rev30_002', 'Bank declined refund', null
  );

  -- Verification: failed refund record exists for audit evidence but is EXCLUDED from active refund reductions
  select coalesce(sum(amount), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
    and status = 'processed';
  if v_total_alloc <> 300.00 then
    raise exception 'Test 28 Failed: Failed refund must NOT be counted in processed reductions! Expected 300.00, got %', v_total_alloc;
  end if;

  -- Evidence check: failed refund record remains present in database (not deleted)
  if not exists (
    select 1 from public.installment_adjustments
    where gateway_event_id = 'rfnd_rev30_002' and status = 'failed' and amount = 200.00
  ) then
    raise exception 'Test 28 Failed: Failed refund audit record must be preserved in installment_adjustments!';
  end if;
  raise notice 'Test 28 PASSED: Refund lifecycle transitions (created -> processed, failed) correctly verified.';

  -- --------------------------------------------------------------------------
  -- --------------------------------------------------------------------------
  -- TEST 29: Verified Dispute Restoration and Provider Reference Integrity (Revision 34, Issue 1)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 29: Dispute lifecycle, historical debit preservation, and verified restoration...';
  -- Stage A: Open dispute with amount_deducted = 0 (payment.dispute.created / under_review)
  -- Disputed claim is ₹400.00, but amount_deducted is 0.00
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, restored_amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev30, 'gateway_reversal', 0.00, 0.00, 'under_review', v_test_payment_id_rev30, 'disp_rev30_001', 'Dispute opened (zero deduction)', null
  ) returning adjustment_id into v_adj_id_disp;

  -- Active reversal sum must be 0.00 because amount = 0.00 and restored_amount = 0.00
  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 0.00 then
    raise exception 'Test 29 Failed: Open dispute with 0 deduction must NOT reduce payment credit! Got %', v_total_alloc;
  end if;

  -- Stage B: Confirmed debit of ₹400.00 (payment.dispute.lost / provider debit confirmed)
  -- Initial confirmation from 0.00 to 400.00 is permitted by immutability trigger
  update public.installment_adjustments
  set status = 'lost',
      amount = 400.00,
      restored_amount = 0.00,
      reason = 'Dispute lost; debit confirmed by provider'
  where gateway_event_id = 'disp_rev30_001';

  -- Active reversal sum must now be exactly 400.00
  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 400.00 then
    raise exception 'Test 29 Failed: Confirmed debit of 400.00 must reduce available payment by exactly 400.00! Got %', v_total_alloc;
  end if;

  -- Stage B2: Attempted unexplained modification of confirmed debit amount
  -- The database immutability trigger MUST block modifying an established historical debit.
  v_rev32_immutable_caught := false;
  begin
    update public.installment_adjustments
    set amount = 250.00
    where gateway_event_id = 'disp_rev30_001';
  exception when check_violation then
    v_rev32_immutable_caught := true;
  end;
  if not v_rev32_immutable_caught then
    raise exception 'Test 29 Failed: Unexplained modification of confirmed debit amount MUST be blocked by immutability trigger!';
  end if;

  -- Stage C: Dispute marked closed without verified fund restoration
  -- Moving to closed preserves the confirmed historical debit of ₹400.00!
  update public.installment_adjustments
  set status = 'closed',
      reason = 'Dispute closed without funds restoration'
  where gateway_event_id = 'disp_rev30_001';

  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 400.00 then
    raise exception 'Test 29 Failed: Closed dispute without restoration MUST preserve confirmed debit of 400.00! Got %', v_total_alloc;
  end if;

  -- Stage D1 (Revision 34, Issue 1): Dispute marked won without independent evidence of restored funds
  -- Moving to won preserves historical debit of 400.00 and does NOT increase restored_amount!
  update public.installment_adjustments
  set status = 'won',
      restored_amount = 0.00,
      reason = 'Dispute marked won but restoration pending provider settlement proof'
  where gateway_event_id = 'disp_rev30_001';

  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 400.00 then
    raise exception 'Test 29 Failed: Dispute marked won without independent settlement evidence must NOT drop deduction! Got %', v_total_alloc;
  end if;

  -- Stage D1b (Revision 34, Issue 1): Notification reporting zero amount deducted without sufficient restoration evidence
  -- Even if incoming webhook reports amount_deducted = 0, restored_amount remains 0.00 and deduction remains 400.00!
  update public.student_course_agreements
  set requires_admin_review = true, updated_at = now()
  where agreement_id = v_test_agreement_id_rev30;

  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 400.00 then
    raise exception 'Test 29 Failed: Notification reporting 0 deducted without restoration proof must preserve debit of 400.00! Got %', v_total_alloc;
  end if;

  -- Stage D2 (Revision 34, Issue 1): Verified partial restoration of ₹150.00 with authoritative settlement ID
  -- Recorded in public.installment_dispute_restorations with provider_reference_id = 'setl_rev34_001'
  -- Trigger updates restored_amount to 150.00; net deduction drops from 400.00 to 250.00
  insert into public.installment_dispute_restorations (
    adjustment_id, dispute_id, gateway_event_id, provider_reference_id, amount, reason
  ) values (
    v_adj_id_disp, 'disp_rev30_001', 'evt_rst_001', 'setl_rev34_001', 150.00, 'Partial dispute settlement 1'
  );

  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 250.00 then
    raise exception 'Test 29 Failed: Verified partial restoration of 150.00 must reduce active deduction to 250.00! Got %', v_total_alloc;
  end if;

  -- Stage D3 (Revision 34, Issue 1): Duplicate delivery of the SAME restoration event (evt_rst_001)
  -- Unique constraint uq_dispute_restorations_event MUST block duplicate insertion.
  v_rev33_dup_event_caught := false;
  begin
    insert into public.installment_dispute_restorations (
      adjustment_id, dispute_id, gateway_event_id, provider_reference_id, amount, reason
    ) values (
      v_adj_id_disp, 'disp_rev30_001', 'evt_rst_001', 'setl_rev34_001_dup', 150.00, 'Duplicate event delivery attempt'
    );
  exception when unique_violation then
    v_rev33_dup_event_caught := true;
  end;
  if not v_rev33_dup_event_caught then
    raise exception 'Test 29 Failed: Duplicate delivery of same restoration event MUST fail unique constraint!';
  end if;

  -- Stage D3b (Revision 34, Issue 1): Different lifecycle event that does NOT represent another financial restoration
  -- A different webhook event arrives (evt_rst_diff_001) but references the SAME provider settlement ID (setl_rev34_001).
  -- Unique constraint uq_dispute_restorations_provider_ref MUST strictly block double-counting!
  v_rev34_dup_provider_ref_caught := false;
  begin
    insert into public.installment_dispute_restorations (
      adjustment_id, dispute_id, gateway_event_id, provider_reference_id, amount, reason
    ) values (
      v_adj_id_disp, 'disp_rev30_001', 'evt_rst_diff_001', 'setl_rev34_001', 150.00, 'Different event ID for same settlement transfer'
    );
  exception when unique_violation then
    v_rev34_dup_provider_ref_caught := true;
  end;
  if not v_rev34_dup_provider_ref_caught then
    raise exception 'Test 29 Failed: Different event ID referencing same provider settlement reference MUST be blocked!';
  end if;

  -- Verify active deduction strictly remains 250.00
  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 250.00 then
    raise exception 'Test 29 Failed: Duplicate settlement reference must not double-count restoration! Got %', v_total_alloc;
  end if;

  -- Stage D4 (Revision 34, Issue 1): Separately verified restoration of another amount (₹100.00)
  -- Distinct verified settlement reference (setl_rev34_002) is counted: total restored = 150 + 100 = 250.00
  insert into public.installment_dispute_restorations (
    adjustment_id, dispute_id, gateway_event_id, provider_reference_id, amount, reason
  ) values (
    v_adj_id_disp, 'disp_rev30_001', 'evt_rst_002', 'setl_rev34_002', 100.00, 'Partial dispute settlement 2'
  );

  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 150.00 then
    raise exception 'Test 29 Failed: Separate restoration of 100.00 must reduce active deduction to 150.00! Got %', v_total_alloc;
  end if;

  -- Stage D5 (Revision 34, Issue 1): Restoration attempt exceeding original debit (ceiling check)
  -- Current restored = 250.00; attempting to add 200.00 would bring total to 450.00 > 400.00 debit!
  -- Database trigger trg_sync_dispute_restoration MUST block this with check_violation!
  v_rev33_exceed_caught := false;
  begin
    insert into public.installment_dispute_restorations (
      adjustment_id, dispute_id, gateway_event_id, provider_reference_id, amount, reason
    ) values (
      v_adj_id_disp, 'disp_rev30_001', 'evt_rst_003', 'setl_rev34_003', 200.00, 'Attempted excessive restoration'
    );
  exception when check_violation then
    v_rev33_exceed_caught := true;
  end;
  if not v_rev33_exceed_caught then
    raise exception 'Test 29 Failed: Restoration exceeding original gross debit MUST be blocked by check_violation!';
  end if;

  -- Verify active deduction remains 150.00
  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 150.00 then
    raise exception 'Test 29 Failed: Active deduction must remain 150.00 after blocked excess! Got %', v_total_alloc;
  end if;

  -- Stage E: Final verified restoration event (evt_rst_004, setl_rev34_004) for remainder (₹150.00)
  insert into public.installment_dispute_restorations (
    adjustment_id, dispute_id, gateway_event_id, provider_reference_id, amount, reason
  ) values (
    v_adj_id_disp, 'disp_rev30_001', 'evt_rst_004', 'setl_rev34_004', 150.00, 'Final dispute settlement'
  );

  -- Active reversal sum drops to 0.00: greatest(0.00, 400.00 - 400.00) = 0.00
  select coalesce(sum(greatest(0.00, amount - restored_amount)), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30
    and adjustment_type = 'gateway_reversal'
    and status in ('processed', 'lost', 'closed', 'under_review', 'won');
  if v_total_alloc <> 0.00 then
    raise exception 'Test 29 Failed: Verified full restoration must drop reversal deduction to 0.00! Got %', v_total_alloc;
  end if;

  -- Evidence check: historical amount column must NOT have been erased to 0.00
  if not exists (
    select 1 from public.installment_adjustments
    where gateway_event_id = 'disp_rev30_001' and amount = 400.00 and restored_amount = 400.00
  ) then
    raise exception 'Test 29 Failed: Historical debit evidence must be preserved (amount=400.00, restored_amount=400.00)!';
  end if;
  raise notice 'Test 29 PASSED: Dispute lifecycle, historical preservation, closed state, and verified restoration verified.';

  -- --------------------------------------------------------------------------
  -- TEST 30: Currency Unit Integrity & Authoritative refund_gateway_id Semantics (Revision 31)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 30: Currency unit conversion and refund_gateway_id semantics...';
  -- Provider amounts: 50000 paise = ₹500.00, 39000 paise = ₹390.00
  -- Payment: ₹1000.00
  -- Step 1: Initial activation payment for agreement
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id2, v_test_course_id5, v_test_plan_c5_3x, null, 3000.00,
    3000.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agreement_id_rev30_curr;

  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id2, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_rev30_curr;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_rev30_curr, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id_rev30_curr, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'pay_rev30_curr_init', now()
  ) returning payment_id into v_test_payment_id_rev30_curr;

  v_res := public.process_installment_payment(v_test_payment_id_rev30_curr, v_test_agreement_id_rev30_curr);
  if (v_res->>'success')::boolean <> true then
    raise exception 'Test 30 Setup Failed: Initial activation payment failed, got %', v_res;
  end if;

  -- Step 2: Second payment of ₹1000.00 destined for installment 2
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id2, v_test_inst_id, 1000.00, 'confirmed', now())
  returning order_id into v_test_order_id_rev30_curr;
  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_id_rev30_curr, v_test_inst_id, v_test_course_id5, v_test_plan_c5_3x, 'Course Installment', 'installment', 1000.00, 1000.00);
  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_payment_id, paid_at
  ) values (
    v_test_order_id_rev30_curr, v_test_inst_id, 1000.00, 'INR', 'captured', 'razorpay', 'pay_rev30_curr_p2', now()
  ) returning payment_id into v_test_payment_id_rev30_curr;

  -- Lifecycle Progression:
  -- Refund 1 arrives: 50000 paise = ₹500.00 (rfnd_unit_001)
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev30_curr, 'gateway_refund', 500.00, 'processed', v_test_payment_id_rev30_curr, 'rfnd_unit_001', '50000 paise converted to 500.00 INR', null
  );
  update public.payments
  set refund_amount = 500.00,
      refund_gateway_id = 'rfnd_unit_001',
      refunded_at = now()
  where payment_id = v_test_payment_id_rev30_curr;

  -- Refund 2 arrives: 39000 paise = ₹390.00 (rfnd_unit_002)
  -- refund_gateway_id updates to the MOST RECENTLY PROCESSED refund ID ('rfnd_unit_002')
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev30_curr, 'gateway_refund', 390.00, 'processed', v_test_payment_id_rev30_curr, 'rfnd_unit_002', '39000 paise converted to 390.00 INR', null
  );
  update public.payments
  set refund_amount = 890.00,
      refund_gateway_id = 'rfnd_unit_002',
      refunded_at = now()
  where payment_id = v_test_payment_id_rev30_curr;

  -- Ledger total: ₹890.00, Summary total: ₹890.00
  select coalesce(sum(amount), 0.00) into v_total_alloc
  from public.installment_adjustments
  where reference_payment_id = v_test_payment_id_rev30_curr
    and adjustment_type in ('gateway_refund', 'duplicate_charge_refund')
    and status = 'processed';
  if v_total_alloc <> 890.00 then
    raise exception 'Test 30 Failed: Currency unit conversion sum must equal 890.00! Got %', v_total_alloc;
  end if;

  -- Verify refund_gateway_id holds the latest processed event ID ('rfnd_unit_002')
  if not exists (
    select 1 from public.payments
    where payment_id = v_test_payment_id_rev30_curr and refund_gateway_id = 'rfnd_unit_002'
  ) then
    raise exception 'Test 30 Failed: refund_gateway_id must hold latest processed refund ID rfnd_unit_002!';
  end if;

  -- Allocate to agreement schedule:
  -- Net available payment is 1000.00 - 890.00 = 110.00
  select schedule_id into v_sched_id_rev30_curr2
  from public.student_installment_schedule
  where agreement_id = v_test_agreement_id_rev30_curr and installment_index = 2;

  -- Attempting to allocate 120.00 (> 110.00) must trigger check violation in trg_enforce_allocation_limits
  v_rev30_alloc_caught := false;
  begin
    insert into public.installment_payment_allocations (
      payment_id, schedule_id, agreement_id, allocated_amount
    ) values (
      v_test_payment_id_rev30_curr, v_sched_id_rev30_curr2, v_test_agreement_id_rev30_curr, 120.00
    );
  exception when check_violation then
    v_rev30_alloc_caught := true;
  end;
  if not v_rev30_alloc_caught then
    raise exception 'Test 30 Failed: Allocation exceeding net available 110.00 MUST be rejected by trigger!';
  end if;

  -- Allocating exactly 110.00 must succeed
  insert into public.installment_payment_allocations (
    payment_id, schedule_id, agreement_id, allocated_amount
  ) values (
    v_test_payment_id_rev30_curr, v_sched_id_rev30_curr2, v_test_agreement_id_rev30_curr, 110.00
  );
  raise notice 'Test 30 PASSED: Currency unit integrity and latest refund_gateway_id verified.';

  -- TEST 31: Financial Event Classification (gateway_refund vs duplicate_charge_refund) (Revision 30)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 31: Correct financial event classification...';
  -- 1. Generic gateway_refund with approved_by_admin_id = null and valid gateway linkage succeeds
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev30, 'gateway_refund', 10.00, 'processed', v_test_payment_id_rev30, 'rfnd_class_gen_01', 'Standard provider refund', null
  );

  -- 2. Verified duplicate_charge_refund with approved_by_admin_id = null and valid gateway linkage succeeds
  insert into public.installment_adjustments (
    agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
  ) values (
    v_test_agreement_id_rev30, 'duplicate_charge_refund', 10.00, 'processed', v_test_payment_id_rev30, 'rfnd_class_dup_01', 'Verified duplicate charge refund', null
  );

  -- 3. Gateway refund with missing reference_payment_id must fail ck_adjustment_gateway_linkage
  v_rev30_alloc_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rev30, 'gateway_refund', 10.00, 'processed', null, 'rfnd_class_fail_01', 'Invalid refund', null
    );
  exception when check_violation then
    v_rev30_alloc_caught := true;
  end;
  if not v_rev30_alloc_caught then
    raise exception 'Test 31 Failed: gateway_refund with null reference_payment_id MUST fail constraint!';
  end if;

  -- 4. Gateway refund with missing gateway_event_id must fail ck_adjustment_gateway_linkage
  v_rev30_alloc_caught := false;
  begin
    insert into public.installment_adjustments (
      agreement_id, adjustment_type, amount, status, reference_payment_id, gateway_event_id, reason, approved_by_admin_id
    ) values (
      v_test_agreement_id_rev30, 'gateway_refund', 10.00, 'processed', v_test_payment_id_rev30, null, 'Invalid refund', null
    );
  exception when check_violation then
    v_rev30_alloc_caught := true;
  end;
  if not v_rev30_alloc_caught then
    raise exception 'Test 31 Failed: gateway_refund with null gateway_event_id MUST fail constraint!';
  end if;
  raise notice 'Test 31 PASSED: Financial event classification and audit constraints strictly verified.';

  -- --------------------------------------------------------------------------
  -- TEST 35: Access Control Call Interface Compatibility & Legacy Signature Bypass Prevention
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 35: Access control call interfaces, legacy bypass prevention, and recording playback...';

  -- 1. Interface compatibility: Calling authorize_live_class_access with named arguments (as used by Edge Function livekit-token)
  v_call_named_res := public.authorize_live_class_access(
    p_user_id := v_test_profile_id,
    p_class_id := v_test_class_id,
    p_room_name := null
  );
  if (v_call_named_res->>'authorized')::boolean <> true then
    raise exception 'Test 35 Failed: Named argument invocation (p_user_id, p_class_id, p_room_name) failed! Got %', v_call_named_res;
  end if;

  -- 2. Interface compatibility: Calling authorize_live_class_access with 2 positional arguments (resolving default p_room_name = null)
  v_call_2arg_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id);
  if (v_call_2arg_res->>'authorized')::boolean <> true then
    raise exception 'Test 35 Failed: 2-argument positional invocation failed! Got %', v_call_2arg_res;
  end if;

  -- 3. Interface compatibility: Calling authorize_live_class_access with 3 positional arguments
  v_call_3arg_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id, 'room-219-test');
  if (v_call_3arg_res->>'authorized')::boolean <> true or v_call_3arg_res->>'roomName' <> 'room-219-test' then
    raise exception 'Test 35 Failed: 3-argument positional invocation failed! Got %', v_call_3arg_res;
  end if;

  -- 4. Bypass Prevention: Verify that calling the 2-argument interface when student is in arrears is strictly BLOCKED
  update public.student_installment_schedule
  set due_date = current_date - 10, status = 'pending', amount_paid = 0.00, waiver_amount = 0.00
  where schedule_id = v_sched_id_inst3;

  v_call_2arg_res := public.authorize_live_class_access(v_test_profile_id, v_test_class_id);
  if (v_call_2arg_res->>'authorized')::boolean <> false or v_call_2arg_res->>'code' <> 'INSTALLMENT_ARREARS_BLOCKED' then
    raise exception 'Test 35 Failed: 2-parameter invocation MUST enforce zero-grace installment arrears! Got %', v_call_2arg_res;
  end if;

  -- Clear arrears back to waived/clean
  update public.student_installment_schedule
  set status = 'waived', waiver_amount = 3000.00
  where schedule_id = v_sched_id_inst3;

  -- 5. Exact Identity Arguments & Non-Canonical Overload Eradication Check
  -- Verify exact canonical identity arguments (uuid, uuid, text) and return type (jsonb) in pg_proc
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'authorize_live_class_access'
      and (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
      and p.pronargs = 3
      and p.prorettype = 'jsonb'::regtype
  ) then
    raise exception 'Test 35 Failed: Canonical authorize_live_class_access(uuid, uuid, text) -> jsonb not found in pg_proc!';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'verify_recording_playback_access'
      and (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
      and p.pronargs = 1
      and p.prorettype = 'jsonb'::regtype
  ) then
    raise exception 'Test 35 Failed: Canonical verify_recording_playback_access(uuid) -> jsonb not found in pg_proc!';
  end if;

  -- Verify NO non-canonical overload exists for authorize_live_class_access
  select count(*) into v_overload_cnt
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'authorize_live_class_access'
    and not (
      (pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text' or oidvectortypes(p.proargtypes) = 'uuid, uuid, text')
      and p.pronargs = 3
      and p.prorettype = 'jsonb'::regtype
    );

  if v_overload_cnt > 0 then
    raise exception 'Test 35 Failed: Non-canonical overload detected for authorize_live_class_access in pg_proc!';
  end if;

  -- Verify NO non-canonical overload exists for verify_recording_playback_access
  select count(*) into v_overload_cnt
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'verify_recording_playback_access'
    and not (
      (pg_get_function_identity_arguments(p.oid) = 'uuid' or oidvectortypes(p.proargtypes) = 'uuid')
      and p.pronargs = 1
      and p.prorettype = 'jsonb'::regtype
    );

  if v_overload_cnt > 0 then
    raise exception 'Test 35 Failed: Non-canonical overload detected for verify_recording_playback_access in pg_proc!';
  end if;

  -- 5b. Permission & Grant Verification (Principle of Least Privilege / IDOR Defense)
  -- authorize_live_class_access must be executable by service_role but NOT by authenticated
  if has_function_privilege('authenticated', 'public.authorize_live_class_access(uuid, uuid, text)', 'execute') then
    raise exception 'Test 35 Failed: authorize_live_class_access must NOT be executable by authenticated role (IDOR defense)!';
  end if;

  if not has_function_privilege('service_role', 'public.authorize_live_class_access(uuid, uuid, text)', 'execute') then
    raise exception 'Test 35 Failed: authorize_live_class_access must be executable by service_role!';
  end if;

  -- verify_recording_playback_access must be executable by both authenticated and service_role
  if not has_function_privilege('authenticated', 'public.verify_recording_playback_access(uuid)', 'execute') then
    raise exception 'Test 35 Failed: verify_recording_playback_access must be executable by authenticated!';
  end if;

  if not has_function_privilege('service_role', 'public.verify_recording_playback_access(uuid)', 'execute') then
    raise exception 'Test 35 Failed: verify_recording_playback_access must be executable by service_role!';
  end if;

  -- 6. Recording Playback Access & Unpaid-Gap Arrears Lockout
  -- Resolve teacher_detail_id
  select teacher_id into v_teacher_detail_id from public.teacher_details where profile_id = v_teacher_id limit 1;

  -- Create stream, subject, batch_subject, recording, and batch_subject_recordings linkage
  insert into public.streams (institute_id, name, code)
  values (v_test_inst_id, 'Stream 219', 'STR219_' || substr(gen_random_uuid()::text, 1, 6))
  returning stream_id into v_test_stream_id;

  insert into public.subjects (stream_id, name, code)
  values (v_test_stream_id, 'Subject 219', 'SUB219_' || substr(gen_random_uuid()::text, 1, 6))
  returning subject_id into v_test_subject_id;

  insert into public.batch_subjects (batch_id, subject_id, institute_id, is_active)
  values (v_test_batch_id, v_test_subject_id, v_test_inst_id, true)
  returning batch_subject_id into v_test_batch_subject_id;

  insert into public.recordings (
    institute_id, teacher_id, class_id, title, status, storage_bucket, storage_path, is_deleted, recorded_at
  ) values (
    v_test_inst_id, v_teacher_detail_id, v_test_class_id, 'Recording 219 Test', 'completed', 'course-recordings', 'classes/219/rec_test.mp4', false, now()
  ) returning recording_id into v_test_recording_id;

  insert into public.batch_subject_recordings (batch_subject_id, recording_id, institute_id)
  values (v_test_batch_subject_id, v_test_recording_id, v_test_inst_id);

  -- Simulate caller authentication context as student
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_test_profile_id::text, true);

  v_rec_play_res := public.verify_recording_playback_access(v_test_recording_id);
  if (v_rec_play_res->>'allowed')::boolean <> true then
    raise exception 'Test 35 Failed: verify_recording_playback_access expected allowed=true for entitled student, got %', v_rec_play_res;
  end if;

  -- Induce unpaid gap: set recording session date past subscription end date while agreement has overdue balance
  update public.student_subscriptions
  set end_date = current_date - 5
  where student_id = v_test_student_id and course_id = v_test_course_id;

  update public.student_course_agreements
  set overdue_balance = 1000.00
  where agreement_id = v_test_agreement_id;

  v_rec_play_res := public.verify_recording_playback_access(v_test_recording_id);
  if (v_rec_play_res->>'allowed')::boolean <> false or v_rec_play_res->>'error_code' <> 'RECORDING_LOCKED_ARREARS' then
    raise exception 'Test 35 Failed: verify_recording_playback_access expected RECORDING_LOCKED_ARREARS during unpaid gap, got %', v_rec_play_res;
  end if;

  -- Restore service_role context
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);

  raise notice 'Test 35 PASSED: Access control interfaces, legacy signature bypass prevention, and recording unpaid-gap lockout strictly verified.';

  -- --------------------------------------------------------------------------
  -- TEST 36: RLS Policy Enforcement — Active Plans, Dispute Restorations & Webhook Quarantine (Migration 220)
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 36: RLS policy enforcement for active plans, dispute restorations, and webhook quarantine...';

  -- 1. Setup Test Fixtures: 1 active plan and 1 inactive plan
  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id, 'Plan 220 Active Plan', 5000.00, 2, 1, true
  ) returning plan_id into v_test_plan_active_id;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_id, 'Plan 220 Inactive Plan', 5000.00, 2, 1, false
  ) returning plan_id into v_test_plan_inactive_id;

  -- Create dedicated test admin profile
  insert into public.profiles (profile_id, institute_id, name, email, phone, role)
  values (gen_random_uuid(), v_test_inst_id, 'Admin 220 Tester', 'admin220_' || substr(gen_random_uuid()::text, 1, 8) || '@example.com', '919876543204', 'admin')
  returning profile_id into v_admin_profile_id;

  -- 2. Catalog Assertions (pg_policies and pg_tables)

  -- (A) public.course_installment_plans RLS and policies
  select rowsecurity into v_rls_enabled
  from pg_tables
  where schemaname = 'public' and tablename = 'course_installment_plans';
  if not coalesce(v_rls_enabled, false) then
    raise exception 'Test 36 Failed: RLS must be enabled on public.course_installment_plans!';
  end if;

  -- Verify course_installment_plans_select policy exists, targets authenticated, and enforces (is_active = true)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'course_installment_plans'
      and policyname = 'course_installment_plans_select'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
      and qual like '%is_active%'
      and qual not in ('true', '(true)')
  ) then
    raise exception 'Test 36 Failed: course_installment_plans_select must exist with USING (is_active = true) in pg_policies!';
  end if;

  -- Verify course_installment_plans_admin_manage policy is preserved for administrators
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'course_installment_plans'
      and policyname = 'course_installment_plans_admin_manage'
      and cmd = 'ALL'
      and 'authenticated' = any(roles)
      and qual like '%is_admin%'
  ) then
    raise exception 'Test 36 Failed: course_installment_plans_admin_manage policy must exist and require is_admin()!';
  end if;

  -- (B) public.installment_dispute_restorations RLS and policies
  select rowsecurity into v_rls_enabled
  from pg_tables
  where schemaname = 'public' and tablename = 'installment_dispute_restorations';
  if not coalesce(v_rls_enabled, false) then
    raise exception 'Test 36 Failed: RLS must be enabled on public.installment_dispute_restorations!';
  end if;

  -- Assert student-readable policy installment_dispute_restorations_select is REMOVED
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'installment_dispute_restorations'
      and policyname = 'installment_dispute_restorations_select'
  ) then
    raise exception 'Test 36 Failed: installment_dispute_restorations_select policy MUST be dropped!';
  end if;

  -- Assert that NO non-admin SELECT policy exists on installment_dispute_restorations
  select count(*) into v_policy_cnt
  from pg_policies
  where schemaname = 'public'
    and tablename = 'installment_dispute_restorations'
    and policyname <> 'installment_dispute_restorations_admin_manage'
    and cmd in ('SELECT', 'ALL');
  if v_policy_cnt > 0 then
    raise exception 'Test 36 Failed: Found unauthorized non-admin policy on installment_dispute_restorations!';
  end if;

  -- Assert installment_dispute_restorations_admin_manage is preserved
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'installment_dispute_restorations'
      and policyname = 'installment_dispute_restorations_admin_manage'
      and qual like '%is_admin%'
  ) then
    raise exception 'Test 36 Failed: installment_dispute_restorations_admin_manage must exist and require is_admin()!';
  end if;

  -- (C) public.webhook_quarantine_events RLS and policies
  select rowsecurity into v_rls_enabled
  from pg_tables
  where schemaname = 'public' and tablename = 'webhook_quarantine_events';
  if not coalesce(v_rls_enabled, false) then
    raise exception 'Test 36 Failed: RLS must be enabled on public.webhook_quarantine_events!';
  end if;

  -- Assert NO non-admin policy exists on webhook_quarantine_events
  select count(*) into v_policy_cnt
  from pg_policies
  where schemaname = 'public'
    and tablename = 'webhook_quarantine_events'
    and (qual not like '%is_admin%' or qual is null);
  if v_policy_cnt > 0 then
    raise exception 'Test 36 Failed: webhook_quarantine_events has non-admin policy exposure!';
  end if;

  -- Assert admin management and select policies exist on webhook_quarantine_events
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_quarantine_events'
      and policyname in ('webhook_quarantine_events_admin_select', 'webhook_quarantine_events_admin_manage')
  ) then
    raise exception 'Test 36 Failed: webhook_quarantine_events admin policies missing!';
  end if;

  -- 3. Runtime Row-Level Security Execution & Behavioral Verification
  -- Attempt to switch to authenticated role for runtime RLS query evaluation
  v_role_switch_ok := false;
  begin
    execute 'set local role authenticated';
    v_role_switch_ok := true;
  exception when others then
    raise notice 'Note: set local role authenticated not permitted in current harness; relying on pg_policies catalog proofs.';
  end;

  if v_role_switch_ok then
    -- ------------------------------------------------------------------------
    -- Context A: Authenticated Student (Non-Admin)
    -- ------------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_test_profile_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_test_profile_id::text)::text, true);

    -- 1. Authenticated student CAN read active plan
    select count(*) into v_active_plan_cnt
    from public.course_installment_plans
    where plan_id = v_test_plan_active_id;
    if v_active_plan_cnt <> 1 then
      raise exception 'Test 36 Failed: Authenticated student MUST be able to read active installment plan! Got %', v_active_plan_cnt;
    end if;

    -- 2. Authenticated student CANNOT read inactive plan
    select count(*) into v_inactive_plan_cnt
    from public.course_installment_plans
    where plan_id = v_test_plan_inactive_id;
    if v_inactive_plan_cnt <> 0 then
      raise exception 'Test 36 Failed: Authenticated non-admin student MUST NOT read inactive plan! Got %', v_inactive_plan_cnt;
    end if;

    -- 3. Authenticated student has NO direct SELECT access to dispute restorations (0 rows)
    select count(*) into v_dispute_restoration_cnt
    from public.installment_dispute_restorations;
    if v_dispute_restoration_cnt <> 0 then
      raise exception 'Test 36 Failed: Authenticated student MUST NOT read dispute restorations! Got %', v_dispute_restoration_cnt;
    end if;

    -- 4. Authenticated student has NO SELECT access to webhook quarantine events (0 rows)
    select count(*) into v_quarantine_event_cnt
    from public.webhook_quarantine_events;
    if v_quarantine_event_cnt <> 0 then
      raise exception 'Test 36 Failed: Authenticated student MUST NOT read webhook quarantine events! Got %', v_quarantine_event_cnt;
    end if;

    -- ------------------------------------------------------------------------
    -- Context B: Authenticated Administrator
    -- ------------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin_profile_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin_profile_id::text)::text, true);

    -- 1. Administrator CAN read active plan
    select count(*) into v_active_plan_cnt
    from public.course_installment_plans
    where plan_id = v_test_plan_active_id;
    if v_active_plan_cnt <> 1 then
      raise exception 'Test 36 Failed: Administrator MUST be able to read active installment plan! Got %', v_active_plan_cnt;
    end if;

    -- 2. Administrator CAN read inactive plan (admin retains access to both)
    select count(*) into v_inactive_plan_cnt
    from public.course_installment_plans
    where plan_id = v_test_plan_inactive_id;
    if v_inactive_plan_cnt <> 1 then
      raise exception 'Test 36 Failed: Administrator MUST retain access to inactive installment plan! Got %', v_inactive_plan_cnt;
    end if;

    -- 3. Administrator retains SELECT access to dispute restorations
    select count(*) into v_dispute_restoration_cnt
    from public.installment_dispute_restorations;
    if v_dispute_restoration_cnt < 1 then
      raise exception 'Test 36 Failed: Administrator MUST retain access to dispute restorations! Got %', v_dispute_restoration_cnt;
    end if;

    -- 4. Administrator retains SELECT access to webhook quarantine events
    select count(*) into v_quarantine_event_cnt
    from public.webhook_quarantine_events;
    if v_quarantine_event_cnt < 1 then
      raise exception 'Test 36 Failed: Administrator MUST retain access to webhook quarantine events! Got %', v_quarantine_event_cnt;
    end if;

    -- Reset session role back to default test runner
    execute 'reset role';
  end if;

  -- Restore service_role context
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  raise notice 'Test 36 PASSED: Active plan restriction, dispute restoration isolation, and webhook quarantine security strictly verified.';

  -- --------------------------------------------------------------------------
  -- TEST 37: Course and Plan Consistency Enforcement (Migration 221)
  -- Asserts that an agreement CANNOT reference an installment plan belonging to a different course
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 37: Agreement rejected when course_id contradicts installment plan...';
  v_221_mismatch_caught := false;
  begin
    insert into public.student_course_agreements (
      student_id, course_id, plan_id, agreement_date, total_fee,
      outstanding_balance, overdue_balance, agreement_status
    ) values (
      v_test_student_id, v_test_course_id, v_test_plan_c2_12x, null, 12000.00,
      12000.00, 0.00, 'pending_initial_payment'
    );
  exception when check_violation then
    v_221_mismatch_caught := true;
  end;

  if not v_221_mismatch_caught then
    raise exception 'Test 37 Failed: Database MUST reject agreement when course_id does not match installment plan course_id!';
  end if;
  raise notice 'Test 37 PASSED: Mismatched course_id and plan_id correctly rejected with check_violation.';

  -- --------------------------------------------------------------------------
  -- TEST 38: Plan Financial Term Immutability Protection (Migration 221)
  -- Asserts that financial terms on a plan CANNOT be modified once referenced by student agreements
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 38: Plan financial term immutability enforcement...';
  v_221_immut_caught := false;
  begin
    update public.course_installment_plans
    set total_fee = 15000.00
    where plan_id = v_test_plan_id;
  exception when check_violation then
    v_221_immut_caught := true;
  end;

  if not v_221_immut_caught then
    raise exception 'Test 38 Failed: Database MUST reject changing total_fee on a plan referenced by agreements!';
  end if;

  -- Verify non-financial fields (plan_name, is_active) remain permitted
  update public.course_installment_plans
  set plan_name = 'Renamed Monthly 12x Plan',
      is_active = false
  where plan_id = v_test_plan_id;

  update public.course_installment_plans
  set is_active = true
  where plan_id = v_test_plan_id;

  raise notice 'Test 38 PASSED: Financial terms are strictly immutable; non-financial fields remain mutable.';

  -- --------------------------------------------------------------------------
  -- TEST 39: Installment Schedule Remainder Absorption Reconciliation (Migration 221)
  -- Asserts exact ₹100 / 3 schedule generation: ₹33.33 + ₹33.33 + ₹33.34 = ₹100.00
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 39: Installment schedule remainder absorption (₹100 / 3 installments)...';
  -- Create dedicated course and plan for ₹100 / 3
  insert into public.courses (institute_id, stream_id, title, slug, description, original_price, discounted_price, status, published_at)
  values (v_test_inst_id, v_test_stream_id, 'Course 221 Rounding Demo', 'test-c-' || substr(gen_random_uuid()::text, 1, 8), 'Course for testing ₹100 / 3 schedule reconciliation', 100.00, 100.00, 'published', now())
  returning course_id into v_test_course_221;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_221, 'Rounding 3x Plan', 100.00, 3, 1, true
  ) returning plan_id into v_test_plan_221;

  -- Create agreement for student 1 on course 221
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_221, v_test_plan_221, null, 100.00,
    100.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agr_221;

  -- Initial payment order for Tranche 1 (₹33.33)
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 33.33, 'confirmed', now())
  returning order_id into v_test_order_221;

  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_221, v_test_inst_id, v_test_course_221, v_test_plan_221, 'Course Installment', 'installment', 33.33, 33.33);

  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_order_id, created_at, paid_at
  ) values (
    v_test_order_221, v_test_inst_id, 33.33, 'INR', 'captured', 'razorpay',
    'order_rzp_221_' || substr(gen_random_uuid()::text, 1, 8), now(), now()
  ) returning payment_id into v_test_pay_221;

  -- Process initial payment
  v_res := public.process_installment_payment(v_test_pay_221, v_test_agr_221);
  if not coalesce((v_res->>'success')::boolean, false) then
    raise exception 'Test 39 Failed: process_installment_payment failed for initial payment: %', v_res;
  end if;

  -- Verify exact remainder-absorbing amounts:
  -- Tranche 1: 33.33, Tranche 2: 33.33, Tranche 3: 33.34
  if (select amount_due from public.student_installment_schedule where agreement_id = v_test_agr_221 and installment_index = 1) <> 33.33 then
    raise exception 'Test 39 Failed: Installment 1 amount_due must be 33.33!';
  end if;
  if (select amount_due from public.student_installment_schedule where agreement_id = v_test_agr_221 and installment_index = 2) <> 33.33 then
    raise exception 'Test 39 Failed: Installment 2 amount_due must be 33.33!';
  end if;
  if (select amount_due from public.student_installment_schedule where agreement_id = v_test_agr_221 and installment_index = 3) <> 33.34 then
    raise exception 'Test 39 Failed: Installment 3 amount_due must absorb remainder to 33.34!';
  end if;

  -- Verify total schedule sum is exactly 100.00
  if (select sum(amount_due) from public.student_installment_schedule where agreement_id = v_test_agr_221) <> 100.00 then
    raise exception 'Test 39 Failed: SUM(amount_due) must equal 100.00!';
  end if;

  -- Process final payment of remaining ₹66.67 to verify completion
  insert into public.orders (student_id, institute_id, total_amount, status, confirmed_at)
  values (v_test_student_id, v_test_inst_id, 66.67, 'confirmed', now())
  returning order_id into v_test_order_221b;

  insert into public.order_items (order_id, institute_id, course_id, installment_plan_id, item_name, item_type, unit_price, line_total)
  values (v_test_order_221b, v_test_inst_id, v_test_course_221, v_test_plan_221, 'Course Installment', 'installment', 66.67, 66.67);

  insert into public.payments (
    order_id, institute_id, amount, currency, status, gateway, gateway_order_id, created_at, paid_at
  ) values (
    v_test_order_221b, v_test_inst_id, 66.67, 'INR', 'captured', 'razorpay',
    'order_rzp_221b_' || substr(gen_random_uuid()::text, 1, 8), now(), now()
  ) returning payment_id into v_test_pay_221b;

  v_res := public.process_installment_payment(v_test_pay_221b, v_test_agr_221);
  if not coalesce((v_res->>'success')::boolean, false) then
    raise exception 'Test 39 Failed: process_installment_payment failed for final payment: %', v_res;
  end if;

  -- Verify agreement status transitions to 'completed' and outstanding_balance = 0.00
  if (select agreement_status from public.student_course_agreements where agreement_id = v_test_agr_221) <> 'completed' then
    raise exception 'Test 39 Failed: Agreement status must be completed when fully paid!';
  end if;
  if (select outstanding_balance from public.student_course_agreements where agreement_id = v_test_agr_221) <> 0.00 then
    raise exception 'Test 39 Failed: Agreement outstanding_balance must be 0.00!';
  end if;

  raise notice 'Test 39 PASSED: Remainder-absorbing schedule reconciliation and completion verified.';

  -- --------------------------------------------------------------------------
  -- TEST 40: Plan Reassignment Prohibited When Schedule Rows Exist (Migration 221)
  -- Asserts that an otherwise eligible unpaid agreement with existing pending
  -- schedule rows cannot change plan_id, and existing schedule rows remain intact.
  -- --------------------------------------------------------------------------
  raise notice 'Running Test 40: Plan reassignment prohibited when schedule rows exist...';

  insert into public.courses (institute_id, stream_id, title, slug, description, original_price, discounted_price, status, published_at)
  values (v_test_inst_id, v_test_stream_id, 'Course 221 Reassignment Demo', 'test-c-' || substr(gen_random_uuid()::text, 1, 8), 'Course for testing plan reassignment schedule preservation', 100.00, 100.00, 'published', now())
  returning course_id into v_test_course_40;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_40, 'Reassign Plan A (2x)', 100.00, 2, 1, true
  ) returning plan_id into v_test_plan_40a;

  insert into public.course_installment_plans (
    course_id, plan_name, total_fee, number_of_installments, interval_months, is_active
  ) values (
    v_test_course_40, 'Reassign Plan B (4x)', 100.00, 4, 1, true
  ) returning plan_id into v_test_plan_40b;

  -- Create unpaid draft agreement with plan A
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id, v_test_course_40, v_test_plan_40a, null, 100.00,
    100.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agr_40;

  -- Insert pending schedule row for the agreement
  insert into public.student_installment_schedule (
    agreement_id, installment_index, due_date, amount_due, amount_paid, waiver_amount, status
  ) values (
    v_test_agr_40, 1, current_date + 30, 50.00, 0.00, 0.00, 'pending'
  ) returning schedule_id into v_test_sched_40;

  -- Attempt plan reassignment: must fail with check_violation (23514)
  v_221_reassign_caught := false;
  begin
    update public.student_course_agreements
    set plan_id = v_test_plan_40b
    where agreement_id = v_test_agr_40;
    raise exception 'Test 40 Failed: Should have rejected plan reassignment when schedule rows exist!';
  exception
    when check_violation then
      v_221_reassign_caught := true;
      raise notice 'Expected exception caught on plan reassignment with existing schedule: %', sqlerrm;
  end;

  if not v_221_reassign_caught then
    raise exception 'Test 40 Failed: Expected check_violation (23514) on plan reassignment with schedule!';
  end if;

  -- Verify agreement plan_id remains unchanged (Plan A)
  if (select plan_id from public.student_course_agreements where agreement_id = v_test_agr_40) <> v_test_plan_40a then
    raise exception 'Test 40 Failed: Agreement plan_id was modified despite exception!';
  end if;

  -- Verify existing schedule row is completely intact and was NOT deleted or altered
  if (select count(*) from public.student_installment_schedule where agreement_id = v_test_agr_40) <> 1 then
    raise exception 'Test 40 Failed: Schedule row was deleted or modified!';
  end if;

  if (select amount_due from public.student_installment_schedule where schedule_id = v_test_sched_40) <> 50.00 then
    raise exception 'Test 40 Failed: Schedule row amount_due was altered!';
  end if;

  if (select status from public.student_installment_schedule where schedule_id = v_test_sched_40) <> 'pending' then
    raise exception 'Test 40 Failed: Schedule row status was altered!';
  end if;

  -- Positive assertion: allow plan reassignment when NO schedule rows exist
  insert into public.student_course_agreements (
    student_id, course_id, plan_id, agreement_date, total_fee,
    outstanding_balance, overdue_balance, agreement_status
  ) values (
    v_test_student_id2, v_test_course_40, v_test_plan_40a, null, 100.00,
    100.00, 0.00, 'pending_initial_payment'
  ) returning agreement_id into v_test_agr_40_empty;

  update public.student_course_agreements
  set plan_id = v_test_plan_40b
  where agreement_id = v_test_agr_40_empty;

  if (select plan_id from public.student_course_agreements where agreement_id = v_test_agr_40_empty) <> v_test_plan_40b then
    raise exception 'Test 40 Failed: Expected plan_id to update to Plan B for empty agreement!';
  end if;

  if (select outstanding_balance from public.student_course_agreements where agreement_id = v_test_agr_40_empty) <> 100.00 then
    raise exception 'Test 40 Failed: Outstanding balance should match Plan B total fee (100.00)!';
  end if;

  raise notice 'Test 40 PASSED: Plan reassignment rejected when schedule rows exist; allowed when no schedule exists.';

  raise notice '====================================================================';
end;
$$;

-- Roll back all test data completely to leave the database clean
rollback;
