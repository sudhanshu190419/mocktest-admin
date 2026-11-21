-- ============================================================================
-- Migration: 244 — Delete Subscription Demo/Test Data
--
-- Repositories:
--   - C:\Projects\MockTestApp\supabase\migrations\244_delete_subscription_demo_data.sql
--   - C:\Projects\mocktest-admin\supabase\migrations\244_delete_subscription_demo_data.sql
--
-- Objective:
--   Deletes all confirmed subscription demo/test data across:
--     1. Subscription runtime user data (student_subscriptions, history, renewals,
--        cancellations, grace periods, usage).
--     2. Subscription-related notifications and recipient delivery records.
--     3. Subscription-related orders (order_items, payments, invoices, refund
--        events, order entitlement grants, and parent orders).
--     4. Directly attributable demo course/PYQ entitlements originating from
--        deleted mixed demo orders (if any).
--     5. Legacy subscription course enrollments (enrollment_type = 'subscription').
--     6. Orphaned subscription order items with established demo attribution.
--
-- Protected Invariants & Strict Preconditions:
--   - Production baseline precondition: exactly 17 captured/failed installment
--     orders, payments, and items with 17 distinct order IDs, 17 distinct payment IDs,
--     and 17 distinct item IDs; aborts if baseline differs or has duplicates.
--   - Complete row-level JSONB snapshots (PK + to_jsonb) for all protected tables
--     before cleanup, followed by bidirectional post-cleanup verification to prove
--     zero records altered, deleted, or unexpectedly added.
--   - NO catalog tables dropped or emptied (subscription_plans, subscription_features,
--     plan_unlocks remain 100% intact with row-level snapshot verification).
--   - NO schema objects, columns, functions, triggers, enums, or cron jobs dropped.
--   - All installment agreements (student_course_agreements), plans, schedules,
--     payments, adjustments, disputes, and allocations remain 100% untouched.
--   - All unrelated course purchases, installments, PYQ package purchases, and
--     admin/free enrollments remain 100% untouched.
--   - Webhook quarantine and RTDN ledgers are strictly preserved with row-level
--     snapshot verification; transaction aborts if any ledger row would be mutated.
--   - Pre-execution safeguards automatically abort the transaction if any
--     installment order, direct agreement reference, schedule, allocation,
--     adjustment, quarantine, or installment enrollment is targeted.
--   - Order-item deletion is strictly scoped to explicitly captured target items.
-- ============================================================================

DO $$
DECLARE
  -- Pre-cleanup baseline counts for protected installment records
  v_baseline_failed_installments     INTEGER;
  v_distinct_failed_orders           INTEGER;
  v_distinct_failed_payments         INTEGER;
  v_distinct_failed_items            INTEGER;
  v_duplicate_failed_combos          INTEGER;

  v_baseline_agreements              INTEGER;
  v_baseline_schedules               INTEGER;
  v_baseline_allocations             INTEGER;
  v_baseline_installment_plans       INTEGER;
  v_baseline_adjustments             INTEGER;
  v_baseline_disputes                INTEGER;

  -- Pre-cleanup baseline counts for protected commerce & entitlement records
  v_baseline_unrelated_orders        INTEGER;
  v_baseline_unrelated_payments      INTEGER;
  v_baseline_unrelated_items         INTEGER;
  v_baseline_protected_enrollments   INTEGER;
  v_baseline_protected_pyq           INTEGER;

  -- Pre-cleanup baseline counts for catalog tables (must remain unchanged)
  v_baseline_plans                   INTEGER;
  v_baseline_features                INTEGER;
  v_baseline_plan_unlocks            INTEGER;

  -- Pre-cleanup baseline counts for webhooks and quarantine
  v_baseline_webhook_quarantine      INTEGER;
  v_baseline_rtdn_events             INTEGER;

  -- Target counts identified for deletion
  v_target_orders_count              INTEGER := 0;
  v_target_sub_only_orders_count     INTEGER := 0;
  v_target_mixed_orders_count        INTEGER := 0;
  v_target_payments_count            INTEGER := 0;
  v_target_items_count               INTEGER := 0;
  v_target_orphaned_items_count      INTEGER := 0;
  v_target_all_items_count           INTEGER := 0;
  v_target_mixed_course_items_count  INTEGER := 0;
  v_target_mixed_pyq_items_count     INTEGER := 0;
  v_target_invoices_count            INTEGER := 0;
  v_target_refund_events_count       INTEGER := 0;
  v_target_grants_count              INTEGER := 0;
  v_target_notifications_count       INTEGER := 0;
  v_target_recipients_count          INTEGER := 0;
  v_target_sub_enrollments_count     INTEGER := 0;

  -- Runtime subscription table counts before deletion
  v_count_student_subs               INTEGER := 0;
  v_count_sub_history                INTEGER := 0;
  v_count_sub_renewals               INTEGER := 0;
  v_count_sub_cancellations          INTEGER := 0;
  v_count_sub_grace                  INTEGER := 0;
  v_count_sub_usage                  INTEGER := 0;

  -- Conflict check variables (PostgreSQL-compatible replacement for min(uuid))
  v_conflict_count                   INTEGER := 0;
  v_conflict_id                      UUID;
  v_conflict_agreement_id            UUID;

  -- Post-cleanup verification counts
  v_post_student_subs                INTEGER;
  v_post_sub_history                 INTEGER;
  v_post_sub_renewals                INTEGER;
  v_post_sub_cancellations           INTEGER;
  v_post_sub_grace                   INTEGER;
  v_post_sub_usage                   INTEGER;
  v_post_sub_items                   INTEGER;
  v_post_sub_enrollments             INTEGER;
  v_post_sub_notifs                  INTEGER;
  v_post_target_notifs_remaining     INTEGER;
  v_post_target_recipients_remaining INTEGER;
  v_post_sub_grants                  INTEGER;
  v_post_invoices_remaining          INTEGER;
  v_post_refunds_remaining           INTEGER;
  v_post_orders_remaining            INTEGER;
  v_post_payments_remaining          INTEGER;
  v_post_items_remaining             INTEGER;
  v_post_sub_refs_remaining          INTEGER;
  v_post_renewal_refs_remaining      INTEGER;
  v_post_mixed_course_enrollments    INTEGER;
  v_post_mixed_pyq_purchases         INTEGER;
BEGIN
  -- ──────────────────────────────────────────────────────────────────────────
  -- SECTION 1: IDENTIFY TARGET SUBSCRIPTION RECORDS & DEFENSIVE EXCLUSIONS
  -- ──────────────────────────────────────────────────────────────────────────

  -- Step 1A: Identify candidate subscription orders across:
  --   1. Orders containing subscription line items (item_type = 'subscription_plan' OR plan_id IS NOT NULL)
  --   2. Orders referenced by student_subscriptions.order_id (initial subscription orders)
  --   3. Orders referenced by student_subscriptions.conversion_order_id (subscription conversion orders)
  --   4. Orders referenced by subscription_renewals.order_id (recurring renewal orders)
  CREATE TEMP TABLE _sub_target_orders ON COMMIT DROP AS
  SELECT DISTINCT o.order_id
  FROM public.orders o
  WHERE EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.order_id 
      AND (oi.item_type = 'subscription_plan' OR oi.plan_id IS NOT NULL)
  )
  OR EXISTS (
    SELECT 1 FROM public.student_subscriptions ss 
    WHERE ss.order_id = o.order_id
  )
  OR EXISTS (
    SELECT 1 FROM public.student_subscriptions ss 
    WHERE ss.conversion_order_id = o.order_id
  )
  OR EXISTS (
    SELECT 1 FROM public.subscription_renewals sr 
    WHERE sr.order_id = o.order_id
  );

  -- Step 1B: Preserve pure course/PYQ conversion orders that are NOT subscription transactions.
  -- An order that has NO subscription items (neither item_type = 'subscription_plan' nor plan_id IS NOT NULL)
  -- and contains course or PYQ package items was a conversion destination into a permanent course/PYQ,
  -- and must not be deleted as a subscription demo order.
  DELETE FROM _sub_target_orders sto
  WHERE NOT EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = sto.order_id 
      AND (oi.item_type = 'subscription_plan' OR oi.plan_id IS NOT NULL)
  )
  AND EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = sto.order_id 
      AND oi.item_type IN ('course', 'pyq_package')
  );

  -- Step 1C: Build target payment IDs
  CREATE TEMP TABLE _sub_target_payments ON COMMIT DROP AS
  SELECT p.payment_id, p.order_id
  FROM public.payments p
  JOIN _sub_target_orders sto ON sto.order_id = p.order_id;

  -- Step 1D: Build target order_items for target demo orders
  CREATE TEMP TABLE _sub_target_items ON COMMIT DROP AS
  SELECT oi.item_id, oi.order_id, oi.item_type, oi.plan_id, oi.course_id, oi.package_id, oi.agreement_id
  FROM public.order_items oi
  JOIN _sub_target_orders sto ON sto.order_id = oi.order_id;

  -- Step 1E: Identify orphaned subscription items without a corresponding parent order
  -- Strictly requires:
  --   1. oi.item_type = 'subscription_plan'
  --   2. oi.plan_id IS NOT NULL and references a valid row in subscription_plans
  --   3. Record is not already captured in _sub_target_items (i.e. parent order is missing or null)
  CREATE TEMP TABLE _sub_target_orphaned_items ON COMMIT DROP AS
  SELECT oi.item_id, oi.order_id, oi.item_type, oi.plan_id, oi.course_id, oi.package_id, oi.agreement_id
  FROM public.order_items oi
  WHERE oi.item_type = 'subscription_plan'
    AND oi.plan_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.subscription_plans sp WHERE sp.plan_id = oi.plan_id
    )
    AND oi.item_id NOT IN (SELECT item_id FROM _sub_target_items);

  -- Step 1F: Combine into unified explicit target order items set
  CREATE TEMP TABLE _sub_all_target_items ON COMMIT DROP AS
  SELECT item_id, order_id, item_type, plan_id, course_id, package_id, agreement_id, 'order_linked' AS target_reason
  FROM _sub_target_items
  UNION ALL
  SELECT item_id, order_id, item_type, plan_id, course_id, package_id, agreement_id, 'orphaned_subscription' AS target_reason
  FROM _sub_target_orphaned_items;

  -- Step 1G: Build target notifications (all events and reference types)
  CREATE TEMP TABLE _sub_target_notifications ON COMMIT DROP AS
  SELECT n.notification_id
  FROM public.notifications n
  WHERE n.event_type IN ('subscription_expiring', 'subscription_expired')
     OR n.reference_type IN ('subscription', 'subscription_plan')
     OR n.reference_type LIKE 'subscription_%'
     OR EXISTS (
       SELECT 1 FROM public.student_subscriptions ss 
       WHERE ss.subscription_id = n.reference_id
     );

  -- ──────────────────────────────────────────────────────────────────────────
  -- SECTION 2: CAPTURE ROW-LEVEL SNAPSHOTS & ENFORCE PRECONDITIONS
  -- ──────────────────────────────────────────────────────────────────────────

  -- Snapshot 2A: Capture exact 17 protected captured/failed installment records
  CREATE TEMP TABLE _snap_protected_installments ON COMMIT DROP AS
  SELECT 
    o.order_id,
    p.payment_id,
    oi.item_id,
    to_jsonb(o.*) AS order_row,
    to_jsonb(p.*) AS payment_row,
    to_jsonb(oi.*) AS item_row
  FROM public.orders o
  JOIN public.payments p ON p.order_id = o.order_id
  JOIN public.order_items oi ON oi.order_id = o.order_id
  WHERE p.status = 'captured'
    AND o.fulfillment_status = 'failed'
    AND oi.item_type = 'installment';

  SELECT count(*) INTO v_baseline_failed_installments FROM _snap_protected_installments;

  -- FAIL-CLOSED PRECONDITION 1: Total record count must be exactly 17
  IF v_baseline_failed_installments <> 17 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected exactly 17 captured/failed installment records in production baseline, found %! Aborting to prevent execution against unexpected state.', v_baseline_failed_installments;
  END IF;

  -- FAIL-CLOSED PRECONDITION 2: Exactly 17 distinct order IDs
  SELECT count(DISTINCT order_id) INTO v_distinct_failed_orders FROM _snap_protected_installments;
  IF v_distinct_failed_orders <> 17 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected exactly 17 distinct order IDs in captured/failed installment baseline, found %!', v_distinct_failed_orders;
  END IF;

  -- FAIL-CLOSED PRECONDITION 3: Exactly 17 distinct payment IDs
  SELECT count(DISTINCT payment_id) INTO v_distinct_failed_payments FROM _snap_protected_installments;
  IF v_distinct_failed_payments <> 17 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected exactly 17 distinct payment IDs in captured/failed installment baseline, found %!', v_distinct_failed_payments;
  END IF;

  -- FAIL-CLOSED PRECONDITION 4: Exactly 17 distinct installment item IDs
  SELECT count(DISTINCT item_id) INTO v_distinct_failed_items FROM _snap_protected_installments;
  IF v_distinct_failed_items <> 17 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected exactly 17 distinct installment item IDs in captured/failed installment baseline, found %!', v_distinct_failed_items;
  END IF;

  -- FAIL-CLOSED PRECONDITION 5: No duplicate order/payment/item combinations
  SELECT count(*) INTO v_duplicate_failed_combos
  FROM (
    SELECT order_id, count(*) FROM _snap_protected_installments GROUP BY order_id HAVING count(*) > 1
    UNION ALL
    SELECT payment_id, count(*) FROM _snap_protected_installments GROUP BY payment_id HAVING count(*) > 1
    UNION ALL
    SELECT item_id, count(*) FROM _snap_protected_installments GROUP BY item_id HAVING count(*) > 1
  ) dups;

  IF v_duplicate_failed_combos > 0 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Duplicate order, payment, or item IDs detected in captured/failed installment baseline!';
  END IF;

  -- Snapshot 2B: student_course_agreements
  CREATE TEMP TABLE _snap_agreements ON COMMIT DROP AS
  SELECT sca.agreement_id, to_jsonb(sca.*) AS row_data
  FROM public.student_course_agreements sca;
  SELECT count(*) INTO v_baseline_agreements FROM _snap_agreements;

  -- Snapshot 2C: student_installment_schedule
  CREATE TEMP TABLE _snap_schedules ON COMMIT DROP AS
  SELECT sis.schedule_id, to_jsonb(sis.*) AS row_data
  FROM public.student_installment_schedule sis;
  SELECT count(*) INTO v_baseline_schedules FROM _snap_schedules;

  -- Snapshot 2D: installment_payment_allocations
  CREATE TEMP TABLE _snap_allocations ON COMMIT DROP AS
  SELECT ipa.allocation_id, to_jsonb(ipa.*) AS row_data
  FROM public.installment_payment_allocations ipa;
  SELECT count(*) INTO v_baseline_allocations FROM _snap_allocations;

  -- Snapshot 2E: course_installment_plans
  CREATE TEMP TABLE _snap_installment_plans ON COMMIT DROP AS
  SELECT cip.plan_id, to_jsonb(cip.*) AS row_data
  FROM public.course_installment_plans cip;
  SELECT count(*) INTO v_baseline_installment_plans FROM _snap_installment_plans;

  -- Snapshot 2F: installment_adjustments
  CREATE TEMP TABLE _snap_adjustments ON COMMIT DROP AS
  SELECT ia.adjustment_id, to_jsonb(ia.*) AS row_data
  FROM public.installment_adjustments ia;
  SELECT count(*) INTO v_baseline_adjustments FROM _snap_adjustments;

  -- Snapshot 2G: installment_dispute_restorations
  CREATE TEMP TABLE _snap_disputes ON COMMIT DROP AS
  SELECT idr.restoration_id, to_jsonb(idr.*) AS row_data
  FROM public.installment_dispute_restorations idr;
  SELECT count(*) INTO v_baseline_disputes FROM _snap_disputes;

  -- Snapshot 2H: Unrelated commerce orders
  CREATE TEMP TABLE _snap_unrelated_orders ON COMMIT DROP AS
  SELECT o.order_id, to_jsonb(o.*) AS row_data
  FROM public.orders o
  WHERE o.order_id NOT IN (SELECT order_id FROM _sub_target_orders);
  SELECT count(*) INTO v_baseline_unrelated_orders FROM _snap_unrelated_orders;

  -- Snapshot 2I: Unrelated commerce payments
  CREATE TEMP TABLE _snap_unrelated_payments ON COMMIT DROP AS
  SELECT p.payment_id, to_jsonb(p.*) AS row_data
  FROM public.payments p
  WHERE p.payment_id NOT IN (SELECT payment_id FROM _sub_target_payments);
  SELECT count(*) INTO v_baseline_unrelated_payments FROM _snap_unrelated_payments;

  -- Snapshot 2J: Unrelated order items (strictly excluding _sub_all_target_items)
  CREATE TEMP TABLE _snap_unrelated_items ON COMMIT DROP AS
  SELECT oi.item_id, to_jsonb(oi.*) AS row_data
  FROM public.order_items oi
  WHERE oi.item_id NOT IN (SELECT item_id FROM _sub_all_target_items);
  SELECT count(*) INTO v_baseline_unrelated_items FROM _snap_unrelated_items;

  -- Snapshot 2K: Orphaned subscription order items with established demo attribution
  CREATE TEMP TABLE _snap_orphaned_sub_items ON COMMIT DROP AS
  SELECT oi.item_id, to_jsonb(oi.*) AS row_data
  FROM _sub_target_orphaned_items oi;
  SELECT count(*) INTO v_target_orphaned_items_count FROM _snap_orphaned_sub_items;

  -- Snapshot 2L: Protected course enrollments
  CREATE TEMP TABLE _snap_protected_enrollments ON COMMIT DROP AS
  SELECT ce.enrollment_id, to_jsonb(ce.*) AS row_data
  FROM public.course_enrollments ce
  WHERE ce.enrollment_type IN ('purchase', 'installment', 'admin_grant', 'free')
    AND NOT (ce.order_item_id IS NOT NULL AND ce.order_item_id IN (
      SELECT sti.item_id FROM _sub_target_items sti WHERE sti.item_type = 'course'
    ));
  SELECT count(*) INTO v_baseline_protected_enrollments FROM _snap_protected_enrollments;

  -- Snapshot 2M: Protected PYQ purchases
  CREATE TEMP TABLE _snap_protected_pyq ON COMMIT DROP AS
  SELECT spp.purchase_id, to_jsonb(spp.*) AS row_data
  FROM public.student_pyq_purchases spp
  WHERE NOT (spp.order_item_id IS NOT NULL AND spp.order_item_id IN (
    SELECT sti.item_id FROM _sub_target_items sti WHERE sti.item_type = 'pyq_package'
  ));
  SELECT count(*) INTO v_baseline_protected_pyq FROM _snap_protected_pyq;

  -- Snapshot 2N: Catalog tables (must remain 100% unchanged)
  CREATE TEMP TABLE _snap_plans ON COMMIT DROP AS
  SELECT sp.plan_id, to_jsonb(sp.*) AS row_data
  FROM public.subscription_plans sp;
  SELECT count(*) INTO v_baseline_plans FROM _snap_plans;

  CREATE TEMP TABLE _snap_features ON COMMIT DROP AS
  SELECT sf.feature_id, to_jsonb(sf.*) AS row_data
  FROM public.subscription_features sf;
  SELECT count(*) INTO v_baseline_features FROM _snap_features;

  CREATE TEMP TABLE _snap_plan_unlocks ON COMMIT DROP AS
  SELECT pu.plan_id, pu.feature_id, to_jsonb(pu.*) AS row_data
  FROM public.plan_unlocks pu;
  SELECT count(*) INTO v_baseline_plan_unlocks FROM _snap_plan_unlocks;

  -- Snapshot 2O: Webhook quarantine & RTDN event tables
  CREATE TEMP TABLE _snap_webhook_quarantine ON COMMIT DROP AS
  SELECT wqe.quarantine_id, to_jsonb(wqe.*) AS row_data
  FROM public.webhook_quarantine_events wqe;
  SELECT count(*) INTO v_baseline_webhook_quarantine FROM _snap_webhook_quarantine;

  CREATE TEMP TABLE _snap_rtdn_events ON COMMIT DROP AS
  SELECT rtdn.event_id, to_jsonb(rtdn.*) AS row_data
  FROM public.google_play_rtdn_events rtdn;
  SELECT count(*) INTO v_baseline_rtdn_events FROM _snap_rtdn_events;

  -- Target counts for deletion & reporting
  SELECT count(*) INTO v_target_orders_count FROM _sub_target_orders;

  SELECT count(*) INTO v_target_sub_only_orders_count
  FROM _sub_target_orders sto
  WHERE NOT EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = sto.order_id 
      AND oi.item_type <> 'subscription_plan'
      AND oi.plan_id IS NULL
  );

  v_target_mixed_orders_count := v_target_orders_count - v_target_sub_only_orders_count;
  SELECT count(*) INTO v_target_payments_count FROM _sub_target_payments;
  SELECT count(*) INTO v_target_items_count FROM _sub_target_items;
  SELECT count(*) INTO v_target_all_items_count FROM _sub_all_target_items;
  SELECT count(*) INTO v_target_mixed_course_items_count FROM _sub_target_items WHERE item_type = 'course';
  SELECT count(*) INTO v_target_mixed_pyq_items_count FROM _sub_target_items WHERE item_type = 'pyq_package';

  SELECT count(*) INTO v_target_sub_enrollments_count
  FROM public.course_enrollments
  WHERE enrollment_type = 'subscription';

  SELECT count(*) INTO v_target_notifications_count FROM _sub_target_notifications;
  SELECT count(*) INTO v_target_recipients_count 
  FROM public.notification_recipients nr
  JOIN _sub_target_notifications stn ON stn.notification_id = nr.notification_id;

  SELECT count(*) INTO v_count_student_subs FROM public.student_subscriptions;
  SELECT count(*) INTO v_count_sub_history FROM public.subscription_history;
  SELECT count(*) INTO v_count_sub_renewals FROM public.subscription_renewals;
  SELECT count(*) INTO v_count_sub_cancellations FROM public.subscription_cancellations;
  SELECT count(*) INTO v_count_sub_grace FROM public.subscription_grace_periods;
  SELECT count(*) INTO v_count_sub_usage FROM public.subscription_usage;

  SELECT count(*) INTO v_target_invoices_count 
  FROM public.invoices i 
  JOIN _sub_target_orders sto ON sto.order_id = i.order_id;

  SELECT count(*) INTO v_target_refund_events_count 
  FROM public.payment_refund_events pre 
  WHERE pre.order_id IN (SELECT order_id FROM _sub_target_orders)
     OR pre.payment_id IN (SELECT payment_id FROM _sub_target_payments);

  SELECT count(*) INTO v_target_grants_count 
  FROM public.order_entitlement_grants oeg 
  WHERE oeg.order_id IN (SELECT order_id FROM _sub_target_orders)
     OR (oeg.order_item_id IS NOT NULL AND oeg.order_item_id IN (SELECT item_id FROM _sub_all_target_items))
     OR oeg.entitlement_type = 'subscription';

  -- ──────────────────────────────────────────────────────────────────────────
  -- SECTION 3: STRICT SAFEGUARDS AGAINST INSTALLMENT & PROTECTED CONFLICTS
  -- ──────────────────────────────────────────────────────────────────────────

  -- Safeguard 3A: Abort if any target order contains an installment line item
  SELECT count(*) INTO v_conflict_count
  FROM public.order_items oi
  JOIN _sub_target_orders sto ON sto.order_id = oi.order_id
  WHERE oi.item_type = 'installment';

  IF v_conflict_count > 0 THEN
    SELECT oi.order_id INTO v_conflict_id
    FROM public.order_items oi
    JOIN _sub_target_orders sto ON sto.order_id = oi.order_id
    WHERE oi.item_type = 'installment'
    ORDER BY oi.order_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Order containing installment line item found in subscription deletion set! Order ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3B: Abort if any target order item is linked to student_course_agreements
  SELECT count(*) INTO v_conflict_count
  FROM public.order_items oi
  JOIN _sub_target_orders sto ON sto.order_id = oi.order_id
  WHERE oi.agreement_id IS NOT NULL;

  IF v_conflict_count > 0 THEN
    SELECT oi.order_id INTO v_conflict_id
    FROM public.order_items oi
    JOIN _sub_target_orders sto ON sto.order_id = oi.order_id
    WHERE oi.agreement_id IS NOT NULL
    ORDER BY oi.order_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Order linked to student_course_agreements found in subscription deletion set! Order ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3C: Abort if any target payment is referenced by installment_payment_allocations
  SELECT count(*) INTO v_conflict_count
  FROM public.installment_payment_allocations ipa
  JOIN _sub_target_payments stp ON stp.payment_id = ipa.payment_id;

  IF v_conflict_count > 0 THEN
    SELECT ipa.payment_id INTO v_conflict_id
    FROM public.installment_payment_allocations ipa
    JOIN _sub_target_payments stp ON stp.payment_id = ipa.payment_id
    ORDER BY ipa.payment_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Payment linked to installment_payment_allocations found in subscription deletion set! Payment ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3D: Abort if any target payment is referenced by student_installment_schedule
  SELECT count(*) INTO v_conflict_count
  FROM public.student_installment_schedule sis
  JOIN _sub_target_payments stp ON stp.payment_id = sis.payment_id;

  IF v_conflict_count > 0 THEN
    SELECT sis.payment_id INTO v_conflict_id
    FROM public.student_installment_schedule sis
    JOIN _sub_target_payments stp ON stp.payment_id = sis.payment_id
    ORDER BY sis.payment_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Payment linked to student_installment_schedule found in subscription deletion set! Payment ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3E: Abort if any target payment is referenced by installment_adjustments
  SELECT count(*) INTO v_conflict_count
  FROM public.installment_adjustments ia
  JOIN _sub_target_payments stp ON stp.payment_id = ia.reference_payment_id;

  IF v_conflict_count > 0 THEN
    SELECT ia.reference_payment_id INTO v_conflict_id
    FROM public.installment_adjustments ia
    JOIN _sub_target_payments stp ON stp.payment_id = ia.reference_payment_id
    ORDER BY ia.reference_payment_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Payment linked to installment_adjustments found in subscription deletion set! Payment ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3F: Abort if any of the 17 protected installment orders is targeted
  SELECT count(*) INTO v_conflict_count
  FROM _snap_protected_installments spi
  JOIN _sub_target_orders sto ON sto.order_id = spi.order_id;

  IF v_conflict_count > 0 THEN
    SELECT spi.order_id INTO v_conflict_id
    FROM _snap_protected_installments spi
    JOIN _sub_target_orders sto ON sto.order_id = spi.order_id
    ORDER BY spi.order_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Protected captured/failed installment order found in subscription deletion set! Order ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3G: Abort if any of the 17 protected installment payments is targeted
  SELECT count(*) INTO v_conflict_count
  FROM _snap_protected_installments spi
  JOIN _sub_target_payments stp ON stp.payment_id = spi.payment_id;

  IF v_conflict_count > 0 THEN
    SELECT spi.payment_id INTO v_conflict_id
    FROM _snap_protected_installments spi
    JOIN _sub_target_payments stp ON stp.payment_id = spi.payment_id
    ORDER BY spi.payment_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Protected captured/failed installment payment found in subscription deletion set! Payment ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3H: Abort if any of the 17 protected installment items is targeted
  SELECT count(*) INTO v_conflict_count
  FROM _snap_protected_installments spi
  JOIN _sub_all_target_items sati ON sati.item_id = spi.item_id;

  IF v_conflict_count > 0 THEN
    SELECT spi.item_id INTO v_conflict_id
    FROM _snap_protected_installments spi
    JOIN _sub_all_target_items sati ON sati.item_id = spi.item_id
    ORDER BY spi.item_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Protected captured/failed installment item found in subscription deletion set! Item ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3I: Abort if any target payment is referenced by webhook_quarantine_events
  SELECT count(*) INTO v_conflict_count
  FROM public.webhook_quarantine_events wqe
  JOIN _sub_target_payments stp ON stp.payment_id = wqe.payment_id;

  IF v_conflict_count > 0 THEN
    SELECT wqe.payment_id INTO v_conflict_id
    FROM public.webhook_quarantine_events wqe
    JOIN _sub_target_payments stp ON stp.payment_id = wqe.payment_id
    ORDER BY wqe.payment_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Payment linked to webhook_quarantine_events found in subscription deletion set! Payment ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3J: Abort if any targeted course item is linked to an installment course enrollment
  SELECT count(*) INTO v_conflict_count
  FROM public.course_enrollments ce
  JOIN _sub_all_target_items sati ON sati.item_id = ce.order_item_id
  WHERE ce.enrollment_type = 'installment';

  IF v_conflict_count > 0 THEN
    SELECT ce.enrollment_id INTO v_conflict_id
    FROM public.course_enrollments ce
    JOIN _sub_all_target_items sati ON sati.item_id = ce.order_item_id
    WHERE ce.enrollment_type = 'installment'
    ORDER BY ce.enrollment_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Targeted course item is linked to an installment course enrollment! Enrollment ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3K: Abort if any targeted course item belongs to a student and course with an installment agreement
  SELECT count(*) INTO v_conflict_count
  FROM public.order_items oi
  JOIN _sub_all_target_items sati ON sati.item_id = oi.item_id
  JOIN public.orders o ON o.order_id = oi.order_id
  JOIN public.student_details sd ON sd.profile_id = o.profile_id
  JOIN public.student_course_agreements sca ON sca.student_id = sd.student_id AND sca.course_id = oi.course_id
  WHERE oi.item_type = 'course';

  IF v_conflict_count > 0 THEN
    SELECT oi.item_id INTO v_conflict_id
    FROM public.order_items oi
    JOIN _sub_all_target_items sati ON sati.item_id = oi.item_id
    JOIN public.orders o ON o.order_id = oi.order_id
    JOIN public.student_details sd ON sd.profile_id = o.profile_id
    JOIN public.student_course_agreements sca ON sca.student_id = sd.student_id AND sca.course_id = oi.course_id
    WHERE oi.item_type = 'course'
    ORDER BY oi.item_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Targeted course item belongs to a student with an installment agreement for the course! Item ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3L: Direct installment agreement safeguard on student_course_agreements.order_id (if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'student_course_agreements' 
      AND column_name = 'order_id'
  ) THEN
    EXECUTE $dyn$
      SELECT count(*)
      FROM public.student_course_agreements sca
      JOIN _sub_target_orders sto ON sto.order_id = sca.order_id
    $dyn$ INTO v_conflict_count;

    IF v_conflict_count > 0 THEN
      EXECUTE $dyn$
        SELECT sca.order_id, sca.agreement_id
        FROM public.student_course_agreements sca
        JOIN _sub_target_orders sto ON sto.order_id = sca.order_id
        ORDER BY sca.order_id
        LIMIT 1
      $dyn$ INTO v_conflict_id, v_conflict_agreement_id;
      RAISE EXCEPTION 'FATAL ABORT: Order directly referenced by student_course_agreements.order_id found in subscription deletion set! Order ID: %, Agreement ID: %', v_conflict_id, v_conflict_agreement_id;
    END IF;
  END IF;

  -- Safeguard 3M: Validate captured subscription line items attribution
  -- Strictly scoped to our captured target items set (_sub_all_target_items).
  -- Confirms that every captured subscription item references a valid subscription plan,
  -- and that no captured item has an installment attribution.
  SELECT count(*) INTO v_conflict_count
  FROM _sub_all_target_items sati
  WHERE sati.item_type = 'installment'
     OR (sati.item_type = 'subscription_plan' AND (
           sati.plan_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.subscription_plans sp WHERE sp.plan_id = sati.plan_id
           )
         ));

  IF v_conflict_count > 0 THEN
    SELECT sati.item_id INTO v_conflict_id
    FROM _sub_all_target_items sati
    WHERE sati.item_type = 'installment'
       OR (sati.item_type = 'subscription_plan' AND (
             sati.plan_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.subscription_plans sp WHERE sp.plan_id = sati.plan_id
             )
           ))
    ORDER BY sati.item_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Captured subscription item has invalid plan or installment attribution! Item ID: %', v_conflict_id;
  END IF;

  -- Safeguard 3N: Validate orphaned subscription items relationships
  -- Strictly scoped to explicit orphaned deletion targets (_sub_target_orphaned_items).
  -- Aborts if any targeted orphan has agreement links, non-subscription course enrollments,
  -- PYQ package purchases, or non-subscription entitlement grants.
  SELECT count(*) INTO v_conflict_count
  FROM _sub_target_orphaned_items oi
  WHERE oi.agreement_id IS NOT NULL
     OR EXISTS (
          SELECT 1 FROM public.course_enrollments ce
          WHERE ce.order_item_id = oi.item_id AND ce.enrollment_type <> 'subscription'
        )
     OR EXISTS (
          SELECT 1 FROM public.student_pyq_purchases spp
          WHERE spp.order_item_id = oi.item_id
        )
     OR EXISTS (
          SELECT 1 FROM public.order_entitlement_grants oeg
          WHERE oeg.order_item_id = oi.item_id AND oeg.entitlement_type <> 'subscription'
        );

  IF v_conflict_count > 0 THEN
    SELECT oi.item_id INTO v_conflict_id
    FROM _sub_target_orphaned_items oi
    WHERE oi.agreement_id IS NOT NULL
       OR EXISTS (
            SELECT 1 FROM public.course_enrollments ce
            WHERE ce.order_item_id = oi.item_id AND ce.enrollment_type <> 'subscription'
          )
       OR EXISTS (
            SELECT 1 FROM public.student_pyq_purchases spp
            WHERE spp.order_item_id = oi.item_id
          )
       OR EXISTS (
            SELECT 1 FROM public.order_entitlement_grants oeg
            WHERE oeg.order_item_id = oi.item_id AND oeg.entitlement_type <> 'subscription'
          )
    ORDER BY oi.item_id
    LIMIT 1;
    RAISE EXCEPTION 'FATAL ABORT: Orphaned subscription item is linked to agreements or non-subscription entitlements! Item ID: %', v_conflict_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- SECTION 4: CHILD-BEFORE-PARENT DELETION EXECUTION
  -- ──────────────────────────────────────────────────────────────────────────

  -- Step 4A: Delete directly attributable demo course & PYQ entitlements for mixed demo orders
  DELETE FROM public.course_enrollments ce
  WHERE ce.order_item_id IN (SELECT item_id FROM _sub_target_items WHERE item_type = 'course')
    AND ce.enrollment_type <> 'installment';

  DELETE FROM public.student_pyq_purchases spp
  WHERE spp.order_item_id IN (SELECT item_id FROM _sub_target_items WHERE item_type = 'pyq_package');

  -- Step 4B: Delete legacy subscription course enrollments
  DELETE FROM public.course_enrollments ce
  WHERE ce.enrollment_type = 'subscription';

  -- Step 4C: Delete subscription notification recipients & notifications
  DELETE FROM public.notification_recipients nr
  WHERE nr.notification_id IN (SELECT notification_id FROM _sub_target_notifications);

  DELETE FROM public.notifications n
  WHERE n.notification_id IN (SELECT notification_id FROM _sub_target_notifications);

  -- Step 4D: Delete order entitlement grants
  DELETE FROM public.order_entitlement_grants oeg
  WHERE oeg.order_id IN (SELECT order_id FROM _sub_target_orders)
     OR (oeg.order_item_id IS NOT NULL AND oeg.order_item_id IN (SELECT item_id FROM _sub_all_target_items))
     OR oeg.entitlement_type = 'subscription';

  -- Step 4E: Delete child subscription runtime tables
  DELETE FROM public.subscription_usage;
  DELETE FROM public.subscription_grace_periods;
  DELETE FROM public.subscription_cancellations;
  DELETE FROM public.subscription_renewals;
  DELETE FROM public.subscription_history;

  -- Step 4F: Delete core student subscriptions
  DELETE FROM public.student_subscriptions;

  -- Step 4G: Delete standard refund ledger events for target demo orders/payments
  DELETE FROM public.payment_refund_events pre
  WHERE pre.order_id IN (SELECT order_id FROM _sub_target_orders)
     OR pre.payment_id IN (SELECT payment_id FROM _sub_target_payments);

  -- Step 4H: Delete invoices for target demo orders
  DELETE FROM public.invoices i
  WHERE i.order_id IN (SELECT order_id FROM _sub_target_orders);

  -- Step 4I: Delete payments for target demo orders
  DELETE FROM public.payments p
  WHERE p.order_id IN (SELECT order_id FROM _sub_target_orders);

  -- Step 4J: Delete line items strictly scoped to explicitly captured targets
  DELETE FROM public.order_items oi
  WHERE oi.item_id IN (SELECT item_id FROM _sub_all_target_items);

  -- Step 4K: Delete parent orders for target demo orders
  DELETE FROM public.orders o
  WHERE o.order_id IN (SELECT order_id FROM _sub_target_orders);

  -- ──────────────────────────────────────────────────────────────────────────
  -- SECTION 5: POST-DELETION VERIFICATION & EXACT SNAPSHOT ASSERTIONS
  -- ──────────────────────────────────────────────────────────────────────────

  -- Assertion 5A: Verify all 6 subscription runtime tables are completely empty
  SELECT count(*) INTO v_post_student_subs FROM public.student_subscriptions;
  SELECT count(*) INTO v_post_sub_history FROM public.subscription_history;
  SELECT count(*) INTO v_post_sub_renewals FROM public.subscription_renewals;
  SELECT count(*) INTO v_post_sub_cancellations FROM public.subscription_cancellations;
  SELECT count(*) INTO v_post_sub_grace FROM public.subscription_grace_periods;
  SELECT count(*) INTO v_post_sub_usage FROM public.subscription_usage;

  IF (v_post_student_subs + v_post_sub_history + v_post_sub_renewals + 
      v_post_sub_cancellations + v_post_sub_grace + v_post_sub_usage) > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: Subscription runtime tables still contain rows! student_subscriptions: %, history: %, renewals: %, cancellations: %, grace: %, usage: %',
      v_post_student_subs, v_post_sub_history, v_post_sub_renewals, v_post_sub_cancellations, v_post_sub_grace, v_post_sub_usage;
  END IF;

  -- Assertion 5B: Verify zero remaining subscription order items
  SELECT count(*) INTO v_post_sub_items 
  FROM public.order_items 
  WHERE item_type = 'subscription_plan' OR plan_id IS NOT NULL;

  IF v_post_sub_items > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: order_items still contains % subscription items (by item_type or plan_id)!', v_post_sub_items;
  END IF;

  -- Assertion 5C: Verify zero remaining legacy subscription course enrollments
  SELECT count(*) INTO v_post_sub_enrollments
  FROM public.course_enrollments
  WHERE enrollment_type = 'subscription';

  IF v_post_sub_enrollments > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: course_enrollments still contains % legacy subscription-type enrollments!', v_post_sub_enrollments;
  END IF;

  -- Assertion 5D: Verify zero invoices linked to targeted orders remain
  SELECT count(*) INTO v_post_invoices_remaining
  FROM public.invoices i
  WHERE i.order_id IN (SELECT order_id FROM _sub_target_orders);

  IF v_post_invoices_remaining > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % invoices linked to targeted orders still exist!', v_post_invoices_remaining;
  END IF;

  -- Assertion 5E: Verify zero refund events linked to targeted orders or payments remain
  SELECT count(*) INTO v_post_refunds_remaining
  FROM public.payment_refund_events pre
  WHERE pre.order_id IN (SELECT order_id FROM _sub_target_orders)
     OR pre.payment_id IN (SELECT payment_id FROM _sub_target_payments);

  IF v_post_refunds_remaining > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % payment_refund_events linked to targeted orders/payments still exist!', v_post_refunds_remaining;
  END IF;

  -- Assertion 5F: Verify zero targeted orders remain
  SELECT count(*) INTO v_post_orders_remaining
  FROM public.orders o
  WHERE o.order_id IN (SELECT order_id FROM _sub_target_orders);

  IF v_post_orders_remaining > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % targeted orders still exist!', v_post_orders_remaining;
  END IF;

  -- Assertion 5G: Verify zero targeted payments remain
  SELECT count(*) INTO v_post_payments_remaining
  FROM public.payments p
  WHERE p.payment_id IN (SELECT payment_id FROM _sub_target_payments)
     OR p.order_id IN (SELECT order_id FROM _sub_target_orders);

  IF v_post_payments_remaining > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % targeted payments still exist!', v_post_payments_remaining;
  END IF;

  -- Assertion 5H: Verify zero targeted order items from _sub_all_target_items remain
  SELECT count(*) INTO v_post_items_remaining
  FROM public.order_items oi
  WHERE oi.item_id IN (SELECT item_id FROM _sub_all_target_items);

  IF v_post_items_remaining > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % targeted order_items still exist!', v_post_items_remaining;
  END IF;

  -- Assertion 5I: Verify zero targeted entitlement grants remain
  SELECT count(*) INTO v_post_sub_grants 
  FROM public.order_entitlement_grants 
  WHERE entitlement_type = 'subscription'
     OR order_id IN (SELECT order_id FROM _sub_target_orders)
     OR (order_item_id IS NOT NULL AND order_item_id IN (SELECT item_id FROM _sub_all_target_items));

  IF v_post_sub_grants > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % targeted order_entitlement_grants still exist!', v_post_sub_grants;
  END IF;

  -- Assertion 5J: Verify all targeted notifications and recipients are completely removed
  SELECT count(*) INTO v_post_target_notifs_remaining
  FROM public.notifications n
  WHERE n.notification_id IN (SELECT notification_id FROM _sub_target_notifications);

  IF v_post_target_notifs_remaining > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % targeted notifications still exist!', v_post_target_notifs_remaining;
  END IF;

  SELECT count(*) INTO v_post_target_recipients_remaining
  FROM public.notification_recipients nr
  WHERE nr.notification_id IN (SELECT notification_id FROM _sub_target_notifications);

  IF v_post_target_recipients_remaining > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % targeted notification recipients still exist!', v_post_target_recipients_remaining;
  END IF;

  -- Assertion 5K: Verify zero remaining subscription notifications by event_type or reference_type
  SELECT count(*) INTO v_post_sub_notifs 
  FROM public.notifications n
  WHERE n.event_type IN ('subscription_expiring', 'subscription_expired')
     OR n.reference_type IN ('subscription', 'subscription_plan')
     OR n.reference_type LIKE 'subscription_%';

  IF v_post_sub_notifs > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: notifications still contains % subscription notifications by event_type or reference_type!', v_post_sub_notifs;
  END IF;

  -- Assertion 5L: Verify removal of course and PYQ records belonging to deleted mixed demo transactions
  SELECT count(*) INTO v_post_mixed_course_enrollments
  FROM public.course_enrollments ce
  WHERE ce.order_item_id IN (SELECT item_id FROM _sub_target_items WHERE item_type = 'course');

  IF v_post_mixed_course_enrollments > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % mixed demo course enrollments still remain!', v_post_mixed_course_enrollments;
  END IF;

  SELECT count(*) INTO v_post_mixed_pyq_purchases
  FROM public.student_pyq_purchases spp
  WHERE spp.order_item_id IN (SELECT item_id FROM _sub_target_items WHERE item_type = 'pyq_package');

  IF v_post_mixed_pyq_purchases > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP VERIFICATION FAILED: % mixed demo PYQ purchases still remain!', v_post_mixed_pyq_purchases;
  END IF;

  -- Assertion 5M: EXACT ROW-LEVEL VERIFICATION FOR 17 CAPTURED/FAILED INSTALLMENT RECORDS
  SELECT count(*) INTO v_conflict_count
  FROM _snap_protected_installments s
  LEFT JOIN public.orders cur_o ON cur_o.order_id = s.order_id
  LEFT JOIN public.payments cur_p ON cur_p.payment_id = s.payment_id
  LEFT JOIN public.order_items cur_oi ON cur_oi.item_id = s.item_id
  WHERE cur_o.order_id IS NULL OR to_jsonb(cur_o.*) <> s.order_row
     OR cur_p.payment_id IS NULL OR to_jsonb(cur_p.*) <> s.payment_row
     OR cur_oi.item_id IS NULL OR to_jsonb(cur_oi.*) <> s.item_row;

  IF v_conflict_count > 0 THEN
    SELECT s.order_id INTO v_conflict_id
    FROM _snap_protected_installments s
    LEFT JOIN public.orders cur_o ON cur_o.order_id = s.order_id
    LEFT JOIN public.payments cur_p ON cur_p.payment_id = s.payment_id
    LEFT JOIN public.order_items cur_oi ON cur_oi.item_id = s.item_id
    WHERE cur_o.order_id IS NULL OR to_jsonb(cur_o.*) <> s.order_row
       OR cur_p.payment_id IS NULL OR to_jsonb(cur_p.*) <> s.payment_row
       OR cur_oi.item_id IS NULL OR to_jsonb(cur_oi.*) <> s.item_row
    ORDER BY s.order_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: Protected captured/failed installment record modified or deleted! Order ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.orders o
  JOIN public.payments p ON p.order_id = o.order_id
  JOIN public.order_items oi ON oi.order_id = o.order_id
  LEFT JOIN _snap_protected_installments s ON s.order_id = o.order_id AND s.payment_id = p.payment_id AND s.item_id = oi.item_id
  WHERE p.status = 'captured'
    AND o.fulfillment_status = 'failed'
    AND oi.item_type = 'installment'
    AND s.order_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new captured/failed installment records found!', v_conflict_count;
  END IF;

  -- Assertion 5N: EXACT ROW-LEVEL VERIFICATION FOR INSTALLMENT ARCHITECTURE
  -- student_course_agreements
  SELECT count(*) INTO v_conflict_count
  FROM _snap_agreements s
  LEFT JOIN public.student_course_agreements cur ON cur.agreement_id = s.agreement_id
  WHERE cur.agreement_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.agreement_id INTO v_conflict_id
    FROM _snap_agreements s
    LEFT JOIN public.student_course_agreements cur ON cur.agreement_id = s.agreement_id
    WHERE cur.agreement_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.agreement_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: student_course_agreements row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.student_course_agreements cur
  LEFT JOIN _snap_agreements s ON s.agreement_id = cur.agreement_id
  WHERE s.agreement_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in student_course_agreements!', v_conflict_count;
  END IF;

  -- student_installment_schedule
  SELECT count(*) INTO v_conflict_count
  FROM _snap_schedules s
  LEFT JOIN public.student_installment_schedule cur ON cur.schedule_id = s.schedule_id
  WHERE cur.schedule_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.schedule_id INTO v_conflict_id
    FROM _snap_schedules s
    LEFT JOIN public.student_installment_schedule cur ON cur.schedule_id = s.schedule_id
    WHERE cur.schedule_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.schedule_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: student_installment_schedule row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.student_installment_schedule cur
  LEFT JOIN _snap_schedules s ON s.schedule_id = cur.schedule_id
  WHERE s.schedule_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in student_installment_schedule!', v_conflict_count;
  END IF;

  -- installment_payment_allocations
  SELECT count(*) INTO v_conflict_count
  FROM _snap_allocations s
  LEFT JOIN public.installment_payment_allocations cur ON cur.allocation_id = s.allocation_id
  WHERE cur.allocation_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.allocation_id INTO v_conflict_id
    FROM _snap_allocations s
    LEFT JOIN public.installment_payment_allocations cur ON cur.allocation_id = s.allocation_id
    WHERE cur.allocation_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.allocation_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: installment_payment_allocations row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.installment_payment_allocations cur
  LEFT JOIN _snap_allocations s ON s.allocation_id = cur.allocation_id
  WHERE s.allocation_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in installment_payment_allocations!', v_conflict_count;
  END IF;

  -- course_installment_plans
  SELECT count(*) INTO v_conflict_count
  FROM _snap_installment_plans s
  LEFT JOIN public.course_installment_plans cur ON cur.plan_id = s.plan_id
  WHERE cur.plan_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.plan_id INTO v_conflict_id
    FROM _snap_installment_plans s
    LEFT JOIN public.course_installment_plans cur ON cur.plan_id = s.plan_id
    WHERE cur.plan_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.plan_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: course_installment_plans row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.course_installment_plans cur
  LEFT JOIN _snap_installment_plans s ON s.plan_id = cur.plan_id
  WHERE s.plan_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in course_installment_plans!', v_conflict_count;
  END IF;

  -- installment_adjustments
  SELECT count(*) INTO v_conflict_count
  FROM _snap_adjustments s
  LEFT JOIN public.installment_adjustments cur ON cur.adjustment_id = s.adjustment_id
  WHERE cur.adjustment_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.adjustment_id INTO v_conflict_id
    FROM _snap_adjustments s
    LEFT JOIN public.installment_adjustments cur ON cur.adjustment_id = s.adjustment_id
    WHERE cur.adjustment_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.adjustment_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: installment_adjustments row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.installment_adjustments cur
  LEFT JOIN _snap_adjustments s ON s.adjustment_id = cur.adjustment_id
  WHERE s.adjustment_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in installment_adjustments!', v_conflict_count;
  END IF;

  -- installment_dispute_restorations
  SELECT count(*) INTO v_conflict_count
  FROM _snap_disputes s
  LEFT JOIN public.installment_dispute_restorations cur ON cur.restoration_id = s.restoration_id
  WHERE cur.restoration_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.restoration_id INTO v_conflict_id
    FROM _snap_disputes s
    LEFT JOIN public.installment_dispute_restorations cur ON cur.restoration_id = s.restoration_id
    WHERE cur.restoration_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.restoration_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: installment_dispute_restorations row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.installment_dispute_restorations cur
  LEFT JOIN _snap_disputes s ON s.restoration_id = cur.restoration_id
  WHERE s.restoration_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in installment_dispute_restorations!', v_conflict_count;
  END IF;

  -- Assertion 5O: EXACT ROW-LEVEL VERIFICATION FOR PROTECTED COMMERCE & ENTITLEMENTS
  -- course_enrollments
  SELECT count(*) INTO v_conflict_count
  FROM _snap_protected_enrollments s
  LEFT JOIN public.course_enrollments cur ON cur.enrollment_id = s.enrollment_id
  WHERE cur.enrollment_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.enrollment_id INTO v_conflict_id
    FROM _snap_protected_enrollments s
    LEFT JOIN public.course_enrollments cur ON cur.enrollment_id = s.enrollment_id
    WHERE cur.enrollment_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.enrollment_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: Protected course_enrollments row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.course_enrollments cur
  LEFT JOIN _snap_protected_enrollments s ON s.enrollment_id = cur.enrollment_id
  WHERE s.enrollment_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected or uncleaned records found in course_enrollments!', v_conflict_count;
  END IF;

  -- student_pyq_purchases
  SELECT count(*) INTO v_conflict_count
  FROM _snap_protected_pyq s
  LEFT JOIN public.student_pyq_purchases cur ON cur.purchase_id = s.purchase_id
  WHERE cur.purchase_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.purchase_id INTO v_conflict_id
    FROM _snap_protected_pyq s
    LEFT JOIN public.student_pyq_purchases cur ON cur.purchase_id = s.purchase_id
    WHERE cur.purchase_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.purchase_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: Protected student_pyq_purchases row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.student_pyq_purchases cur
  LEFT JOIN _snap_protected_pyq s ON s.purchase_id = cur.purchase_id
  WHERE s.purchase_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected or uncleaned records found in student_pyq_purchases!', v_conflict_count;
  END IF;

  -- Unrelated orders
  SELECT count(*) INTO v_conflict_count
  FROM _snap_unrelated_orders s
  LEFT JOIN public.orders cur ON cur.order_id = s.order_id
  WHERE cur.order_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.order_id INTO v_conflict_id
    FROM _snap_unrelated_orders s
    LEFT JOIN public.orders cur ON cur.order_id = s.order_id
    WHERE cur.order_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.order_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: Unrelated orders row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.orders cur
  LEFT JOIN _snap_unrelated_orders s ON s.order_id = cur.order_id
  WHERE s.order_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected or uncleaned records found in orders!', v_conflict_count;
  END IF;

  -- Unrelated payments
  SELECT count(*) INTO v_conflict_count
  FROM _snap_unrelated_payments s
  LEFT JOIN public.payments cur ON cur.payment_id = s.payment_id
  WHERE cur.payment_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.payment_id INTO v_conflict_id
    FROM _snap_unrelated_payments s
    LEFT JOIN public.payments cur ON cur.payment_id = s.payment_id
    WHERE cur.payment_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.payment_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: Unrelated payments row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.payments cur
  LEFT JOIN _snap_unrelated_payments s ON s.payment_id = cur.payment_id
  WHERE s.payment_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected or uncleaned records found in payments!', v_conflict_count;
  END IF;

  -- Unrelated order_items
  SELECT count(*) INTO v_conflict_count
  FROM _snap_unrelated_items s
  LEFT JOIN public.order_items cur ON cur.item_id = s.item_id
  WHERE cur.item_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.item_id INTO v_conflict_id
    FROM _snap_unrelated_items s
    LEFT JOIN public.order_items cur ON cur.item_id = s.item_id
    WHERE cur.item_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.item_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: Unrelated order_items row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.order_items cur
  LEFT JOIN _snap_unrelated_items s ON s.item_id = cur.item_id
  WHERE s.item_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected or uncleaned records found in order_items!', v_conflict_count;
  END IF;

  -- Assertion 5P: EXACT ROW-LEVEL VERIFICATION FOR CATALOG TABLES
  -- subscription_plans
  SELECT count(*) INTO v_conflict_count
  FROM _snap_plans s
  LEFT JOIN public.subscription_plans cur ON cur.plan_id = s.plan_id
  WHERE cur.plan_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.plan_id INTO v_conflict_id
    FROM _snap_plans s
    LEFT JOIN public.subscription_plans cur ON cur.plan_id = s.plan_id
    WHERE cur.plan_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.plan_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: subscription_plans row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.subscription_plans cur
  LEFT JOIN _snap_plans s ON s.plan_id = cur.plan_id
  WHERE s.plan_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in subscription_plans!', v_conflict_count;
  END IF;

  -- subscription_features
  SELECT count(*) INTO v_conflict_count
  FROM _snap_features s
  LEFT JOIN public.subscription_features cur ON cur.feature_id = s.feature_id
  WHERE cur.feature_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.feature_id INTO v_conflict_id
    FROM _snap_features s
    LEFT JOIN public.subscription_features cur ON cur.feature_id = s.feature_id
    WHERE cur.feature_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.feature_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: subscription_features row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.subscription_features cur
  LEFT JOIN _snap_features s ON s.feature_id = cur.feature_id
  WHERE s.feature_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in subscription_features!', v_conflict_count;
  END IF;

  -- plan_unlocks (composite PK)
  SELECT count(*) INTO v_conflict_count
  FROM _snap_plan_unlocks s
  LEFT JOIN public.plan_unlocks cur ON cur.plan_id = s.plan_id AND cur.feature_id = s.feature_id
  WHERE cur.plan_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: plan_unlocks row modified or deleted!';
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.plan_unlocks cur
  LEFT JOIN _snap_plan_unlocks s ON s.plan_id = cur.plan_id AND s.feature_id = cur.feature_id
  WHERE s.plan_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in plan_unlocks!', v_conflict_count;
  END IF;

  -- Assertion 5Q: EXACT ROW-LEVEL VERIFICATION FOR WEBHOOK & RTDN LEDGERS
  -- webhook_quarantine_events
  SELECT count(*) INTO v_conflict_count
  FROM _snap_webhook_quarantine s
  LEFT JOIN public.webhook_quarantine_events cur ON cur.quarantine_id = s.quarantine_id
  WHERE cur.quarantine_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.quarantine_id INTO v_conflict_id
    FROM _snap_webhook_quarantine s
    LEFT JOIN public.webhook_quarantine_events cur ON cur.quarantine_id = s.quarantine_id
    WHERE cur.quarantine_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.quarantine_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: webhook_quarantine_events row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.webhook_quarantine_events cur
  LEFT JOIN _snap_webhook_quarantine s ON s.quarantine_id = cur.quarantine_id
  WHERE s.quarantine_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in webhook_quarantine_events!', v_conflict_count;
  END IF;

  -- google_play_rtdn_events
  SELECT count(*) INTO v_conflict_count
  FROM _snap_rtdn_events s
  LEFT JOIN public.google_play_rtdn_events cur ON cur.event_id = s.event_id
  WHERE cur.event_id IS NULL OR to_jsonb(cur.*) <> s.row_data;

  IF v_conflict_count > 0 THEN
    SELECT s.event_id INTO v_conflict_id
    FROM _snap_rtdn_events s
    LEFT JOIN public.google_play_rtdn_events cur ON cur.event_id = s.event_id
    WHERE cur.event_id IS NULL OR to_jsonb(cur.*) <> s.row_data
    ORDER BY s.event_id
    LIMIT 1;
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: google_play_rtdn_events row modified or deleted! ID: %', v_conflict_id;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.google_play_rtdn_events cur
  LEFT JOIN _snap_rtdn_events s ON s.event_id = cur.event_id
  WHERE s.event_id IS NULL;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'POST-CLEANUP INTEGRITY VIOLATION: % unexpected new records found in google_play_rtdn_events!', v_conflict_count;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- SECTION 6: DIAGNOSTIC SUMMARY REPORT
  -- ──────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'MIGRATION 244 SUBSCRIPTION DEMO-DATA CLEANUP COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Subscription-only demo orders deleted:     %', v_target_sub_only_orders_count;
  RAISE NOTICE 'Mixed demo orders deleted:                 %', v_target_mixed_orders_count;
  RAISE NOTICE 'Total demo orders deleted:                 %', v_target_orders_count;
  RAISE NOTICE 'Demo payments deleted:                     %', v_target_payments_count;
  RAISE NOTICE 'Explicitly captured order items deleted:   %', v_target_all_items_count;
  RAISE NOTICE '  - Order-linked items:                    %', v_target_items_count;
  RAISE NOTICE '  - Orphaned demo subscription items:      %', v_target_orphaned_items_count;
  RAISE NOTICE '  - Mixed course items cleaned:            %', v_target_mixed_course_items_count;
  RAISE NOTICE '  - Mixed PYQ items cleaned:               %', v_target_mixed_pyq_items_count;
  RAISE NOTICE 'Legacy subscription enrollments deleted:   %', v_target_sub_enrollments_count;
  RAISE NOTICE 'Demo invoices deleted:                     %', v_target_invoices_count;
  RAISE NOTICE 'Demo refund events deleted:                %', v_target_refund_events_count;
  RAISE NOTICE 'Demo entitlement grants deleted:           %', v_target_grants_count;
  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'student_subscriptions deleted:             %', v_count_student_subs;
  RAISE NOTICE 'subscription_history deleted:              %', v_count_sub_history;
  RAISE NOTICE 'subscription_renewals deleted:             %', v_count_sub_renewals;
  RAISE NOTICE 'subscription_cancellations deleted:        %', v_count_sub_cancellations;
  RAISE NOTICE 'subscription_grace_periods deleted:        %', v_count_sub_grace;
  RAISE NOTICE 'subscription_usage deleted:                %', v_count_sub_usage;
  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'Subscription notifications deleted:        %', v_target_notifications_count;
  RAISE NOTICE 'Notification recipients deleted:           %', v_target_recipients_count;
  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'EXACT ROW-LEVEL SNAPSHOT VERIFICATION PASSED:';
  RAISE NOTICE '  - student_course_agreements:             % rows verified identical', v_baseline_agreements;
  RAISE NOTICE '  - student_installment_schedule:          % rows verified identical', v_baseline_schedules;
  RAISE NOTICE '  - installment_payment_allocations:       % rows verified identical', v_baseline_allocations;
  RAISE NOTICE '  - course_installment_plans:             % rows verified identical', v_baseline_installment_plans;
  RAISE NOTICE '  - installment_adjustments:               % rows verified identical', v_baseline_adjustments;
  RAISE NOTICE '  - installment_dispute_restorations:      % rows verified identical', v_baseline_disputes;
  RAISE NOTICE '  - Protected captured/failed installments:17 rows verified identical (17 distinct order/payment/items)';
  RAISE NOTICE '  - Protected course enrollments:          % rows verified identical', v_baseline_protected_enrollments;
  RAISE NOTICE '  - Protected PYQ purchases:               % rows verified identical', v_baseline_protected_pyq;
  RAISE NOTICE '  - Unrelated commerce orders:             % rows verified identical', v_baseline_unrelated_orders;
  RAISE NOTICE '  - Unrelated commerce payments:           % rows verified identical', v_baseline_unrelated_payments;
  RAISE NOTICE '  - Unrelated order items:                 % rows verified identical', v_baseline_unrelated_items;
  RAISE NOTICE '  - subscription_plans catalog:            % rows verified identical', v_baseline_plans;
  RAISE NOTICE '  - subscription_features catalog:         % rows verified identical', v_baseline_features;
  RAISE NOTICE '  - plan_unlocks catalog:                  % rows verified identical', v_baseline_plan_unlocks;
  RAISE NOTICE '  - webhook_quarantine_events:             % rows verified identical', v_baseline_webhook_quarantine;
  RAISE NOTICE '  - google_play_rtdn_events:               % rows verified identical', v_baseline_rtdn_events;
  RAISE NOTICE '============================================================';
END $$;
