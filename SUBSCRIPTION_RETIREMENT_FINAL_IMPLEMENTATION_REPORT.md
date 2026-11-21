# Make Me Topper — Complete Subscription Module Retirement Final Implementation Report

**Date:** 2026-11-05  
**Status:** IMPLEMENTATION COMPLETE (Source-Code & Migration Level)  
**Repositories:**
- Android App: `C:\Projects\MockTestApp`
- Website, Admin Panel & Supabase Edge Functions: `C:\Projects\mocktest-admin`

---

## 1. Executive Summary

In accordance with the architectural directive and `SUBSCRIPTION_RETIREMENT_FINAL_INVENTORY.md`, the obsolete subscription purchasing and entitlement module has been permanently retired across both repositories.

The platform now supports exclusively three purchasing models:
1. **Full Course Purchase:**
   - **Android:** Native Google Play Billing one-time in-app product (`course_<32_hex_uuid>`).
   - **Website:** Razorpay one-time checkout (`mode = 'purchase'`).
2. **Installment Course Purchase:**
   - **Android:** Direct redirect to website checkout.
   - **Website:** Razorpay initial tranche checkout (`mode = 'installment'`) and subsequent tranche settlement via student portal.
3. **PYQ Package Purchase:**
   - **Android:** Native Google Play Billing one-time in-app product (`pyq_<32_hex_uuid>`).
   - **Website:** Razorpay one-time checkout.

All subscription-specific code, hooks, providers, services, UI components, background cron jobs, and database tables have been removed. All functioning non-subscription commerce, course access, batch assignment, and installment management workflows remain fully operational and intact.

---

## 2. Files Deleted

### A. Android App (`MockTestApp`) — 19 Files Deleted
| Category | File Path | Reason for Deletion |
| :--- | :--- | :--- |
| **Provider** | `src/providers/SubscriptionProvider.tsx` | Obsolete subscription context provider. |
| **Hooks** | `src/hooks/useSubscription.ts` | Obsolete hook supplying `useSubscription` and `useSubscriptionGate`. |
| | `src/hooks/useSubscriptionStatus.ts` | Obsolete subscription status query hook. |
| | `src/hooks/useRenewalOptions.ts` | Obsolete subscription renewal pricing hook. |
| **Services** | `src/services/subscriptionService.ts` | Obsolete client service calling dropped subscription tables/RPCs. |
| | `src/services/renewalService.ts` | Obsolete client service for subscription renewal calculations. |
| | `src/services/subscription/subscriptionBannerService.ts` | Obsolete floating subscription expiry banner emitter. |
| **Components** | `src/components/subscription/SubscriptionBadge.tsx` | Obsolete profile subscription status badge. |
| | `src/components/subscription/SubscriptionSummaryCard.tsx` | Obsolete subscription overview card. |
| | `src/components/subscription/SubscriptionStatusBanner.tsx` | Obsolete subscription status banner. |
| | `src/components/subscription/SubscriptionExpiryBanner.tsx` | Obsolete subscription expiry warning banner. |
| | `src/components/subscription/RenewSubscriptionDialog.tsx` | Obsolete modal dialog for renewing subscriptions. |
| **Types** | `src/types/subscription.ts` | Obsolete TypeScript interfaces (`SubscriptionPlan`, `SubscriptionAccessSummary`, etc.). |
| | `src/types/renewal.ts` | Obsolete renewal calculation types. |
| **Tests** | `__tests__/subscription/authSubscriptionRecovery.test.tsx` | Obsolete subscription recovery unit tests. |
| | `__tests__/subscription/renewalNavigationFix.test.tsx` | Obsolete subscription renewal navigation tests. |
| | `__tests__/subscription/useSubscriptionFlow.test.tsx` | Obsolete subscription context flow tests. |
| | `__tests__/services/payment/checkSubscriptionActivation.test.ts` | Obsolete subscription activation polling tests. |
| | `__tests__/services/payment/subscriptionAccessParityAndIsolation.test.ts` | Obsolete subscription parity tests. |

### B. Website & Admin (`mocktest-admin`) — 2 Test Suites Deleted
| Category | File Path | Reason for Deletion |
| :--- | :--- | :--- |
| **Tests** | `src/services/admin/__tests__/googlePlayRenewalReconciliation.test.ts` | Obsolete tests for dropped RPC `reconcile_google_play_renewal_batch`. |
| | `src/services/admin/__tests__/googlePlayRtdnAuthSecurity.test.ts` | Obsolete tests for dropped `google-play-rtdn-webhook`. |

### C. Supabase Edge Functions & Shared Code — 7 Directories/Files Deleted
| Repository | Path | Reason for Deletion |
| :--- | :--- | :--- |
| `mocktest-admin` | `supabase/functions/complete-subscription-purchase/` | Obsolete subscription webhook fulfillment endpoint. |
| `mocktest-admin` | `supabase/functions/subscription-lifecycle/` | Obsolete daily cron lifecycle handler. |
| `mocktest-admin` | `supabase/functions/subscription-renewal-options/` | Obsolete renewal calculation endpoint. |
| `mocktest-admin` | `supabase/functions/google-play-rtdn-webhook/` | Obsolete Google Play RTDN webhook endpoint. |
| `MockTestApp` | `supabase/functions/google-play-rtdn-webhook/` | Duplicate copy of RTDN webhook. |
| `MockTestApp` | `supabase/functions/cron-subscription-deactivation/` | Obsolete legacy cron deactivation function. |
| `mocktest-admin` | `supabase/functions/_shared/subscriptionAccess.ts` | Shared helper querying dropped `student_subscriptions` table. |

---

## 3. Files Modified

### A. Android App (`MockTestApp`)
1. **`App.tsx`:**
   - Removed `SubscriptionProvider` wrapping the root component tree.
   - Removed `SubscriptionExpiryBanner` floating overlay.
   - Preserved all other providers (`AuthProvider`, `Redux`, `QueryClient`, etc.) and root navigation.
2. **`src/providers/AuthProvider.tsx`:**
   - Removed `invalidateSubscriptionStatus` imports and call sites on login, logout, and token refresh.
   - Preserved all session, JWT, profile, and multi-device session management.
3. **`src/screens/tabs/ProfileTabScreen.tsx`:**
   - Removed `SubscriptionBadge` import and hero header badge button.
   - Preserved student profile editing, order history, help center, and account deletion.
4. **`src/screens/subscription/PaymentConfirmationScreen.tsx`:**
   - Preserved as the dedicated native Google Play checkout confirmation screen for one-time course purchases.
   - Removed all `fetchSubscriptionStatus` polling and state.
   - Removed `SubscriptionAccessSummary` import and dependencies on deleted `types/subscription`.
   - Removed grace period and content access date rows from `SuccessView`; now displays clean "Course Unlocked!", Amount paid, and "Permanent Access".
   - Removed `alreadySubscribed` branch from `FailedView`; now displays standard retryable or non-retryable failure states.
5. **`src/services/payment/playBillingService.ts`:**
   - Removed `sub_*` product handling in `verifyAndFinalizePurchase()`; immediate fail-closed rejection with `SUBSCRIPTIONS_DISCONTINUED`.
   - Removed `parsePlanIdFromSku` import and `planId` parameter.
   - Added filter in `restoreUserPurchases()` to skip obsolete `sub_*` Google Play purchase items during restore operations.
   - Preserved full one-time purchase verification, token idempotency, account validation, and fulfillment for `course_*` and `pyq_*` products.
6. **`src/utils/playSkuHelper.ts`:**
   - Removed obsolete `parsePlanIdFromSku()`.
   - Preserved canonical `getCoursePlaySku`, `getPyqPackagePlaySku`, `parseCourseIdFromSku`, and `parsePackageIdFromSku`.
7. **`src/hooks/home/useEnrolledCourseIds.ts`:**
   - Removed query to `student_subscriptions`.
   - Queries exclusively `course_enrollments` (`is_active = true`), preserving home screen course card discovery.
8. **`src/hooks/home/useEnrolledCourses.ts`:**
   - Removed concurrent `student_subscriptions` query and priority-merging logic.
   - Queries exclusively `course_enrollments` (`is_active = true`), mapping each enrolled course to permanent active access.
9. **`src/services/home/demoService.ts`:**
   - Removed secondary eligibility check on `student_subscriptions`.
   - Preserved primary confirmed-orders and `course_enrollments` lookup for new-user demo eligibility.
10. **`src/services/payment/paymentService.ts`:**
    - Removed `checkSubscriptionActivation()` polling function.
    - Updated `CourseEnrollmentDetails` interface to `enrollmentType?: 'purchase' | 'installment'`.
    - Preserved `createPaymentOrder()`, `checkCourseEnrollment()`, `checkPyqPurchase()`, `checkCourseOwned()`, and `verifyGooglePlayPurchase()`.
11. **`src/services/payment/orderHistoryService.ts`:**
    - Updated `OrderItem.itemType` and `DbOrderItemRow.item_type` unions to `'course' | 'pyq_package' | 'installment' | string`.
12. **`src/screens/liveClasses/RecordedClassesScreen.tsx`:**
    - Removed unused `useSubscription` and `useSubscriptionGate('canViewRecorded')` dead variables and imports.
    - Preserved batch assignment requirement (`batchIds.length === 0` screen) and backend `verify_recording_playback_access` RPC security.
13. **`src/screens/tabs/MockTestsTabScreen.tsx`:**
    - Removed unused `useSubscription` and `useSubscriptionGate('canAttemptMockTests')` dead variables and imports.
    - Preserved navigation to `ExamPackDetail` with package parameters.
14. **`src/screens/tests/ExamPackDetailScreen.tsx`:**
    - Removed `useSubscriptionGate('canOpenPdf')` and `useSubscription`.
    - Replaced PDF gate with authoritative `isEnrolled` check (derived from `usePurchasedPyqIds` and package price), prompting the student to purchase the package if unowned.
15. **`src/screens/tests/PyqPapersScreen.tsx`:**
    - Removed `useSubscriptionGate('canOpenPdf')` and `useSubscriptionGate('canAttemptMockTests')`.
    - Replaced with authoritative `hasAccess` check derived from `usePurchasedPyqIds(user?.id)` and package price (`isFree`), redirecting unowned attempts to `ExamPackDetail`.
16. **`src/hooks/useNotifications.ts`:**
    - Removed `triggerExpiryBanner` import and subscription notification expiry banner triggering block.
    - Preserved Supabase Realtime notification channel subscription and cache invalidation.
17. **`src/services/fcm/fcmService.ts`:**
    - Removed `triggerExpiryBanner` import and `subscription_expiring` / `subscription_expired` banner interception block.
    - Preserved all FCM token registration, background handlers, and commerce notification deduplication.
18. **`src/hooks/course/useCourseTabsContent.ts`:**
    - Updated default cold-start cache fallback from `enrollmentType: 'subscription'` to `'purchase'`.
19. **`src/components/courses/CourseStickyFooter.tsx`:**
    - Updated footer access text from `activeSubscription` translation key to `'Enrolled'`.
20. **`src/components/home/ActiveBatchResourcesSection.tsx`:**
    - Updated status badge label from `home.batch.activeSubscription` to `home.batch.activeBatch` ("ACTIVE BATCH").
21. **`src/screens/home/HomeScreen.tsx`:**
    - Updated header comment on `handleHeroEnrollPress` to document course enrollment routing.

### B. Website & Admin Panel (`mocktest-admin`)
1. **`src/types/courseCatalog.ts`:**
   - Removed `BillingCycle`, `PlanFeature`, and `SubscriptionPlan` interfaces.
   - Removed `plans: SubscriptionPlan[];` property from the `Course` interface.
   - Preserved `Course`, `CoursePresentation`, and `CourseInstallmentPlan`.
2. **`src/services/courseCatalogService.ts`:**
   - Removed `SubscriptionPlan` import and empty `const plans: SubscriptionPlan[] = [];` initialization.
   - Removed `plans` from `mapDbCourseRow()` return object.
   - Preserved all full course querying, pricing formatting, and installment plan fetching.
3. **`src/components/marketing/StoreCourseCard.tsx`:**
   - Removed `course.plans.find(...)` lookup for monthly plan pricing.
   - Replaced obsolete monthly subscription line with clean installment availability indicator (`course.installmentPlans.length > 0`).
4. **`src/app/admin/commerce/orders/page.tsx`:**
   - Removed `'subscription_plan'` from `PRODUCT_TYPE_OPTIONS`; replaced with `'installment'`.
   - Updated `getProductTypeLabel()` to map `'installment'` to `'Installment'`.
5. **`src/app/admin/commerce/pyq/page.tsx`:**
   - Removed `'subscription'` option from `ACCESS_TYPE_OPTIONS`.
6. **`src/services/admin/commerceService.ts`:**
   - Updated `ItemType` union from `'subscription_plan' | 'pyq_package' | 'course'` to `'course' | 'pyq_package' | 'installment'`.
7. **Notification Files:**
   - `src/types/notification.ts`: Removed `'subscription_expiring'` and `'subscription_expired'` from `NotificationType`.
   - `src/utils/notification.ts`: Removed subscription emoji cases (`🕐`, `🚫`), label cases, action URL routing for `subscription_plan`, and priority inferences.
   - `src/services/notification/notificationService.ts`: Removed `subscription_expired` and `subscription_expiring` default priority mappings.
   - `src/services/student/studentNotificationWebService.ts`: Removed subscription event mappings.
   - `src/app/admin/notifications/[id]/page.tsx`: Removed `subscription` / `subscription_plan` reference type label case.
   - `src/utils/__tests__/notificationDoubt.test.ts`: Removed subscription test assertions.
8. **Admin Unit Tests:**
   - `src/services/admin/__tests__/googlePlayPaymentRecording.test.ts`: Truncated obsolete renewal suite describes 27 and 28; preserved all 26 core payment, idempotency, and fulfillment unit tests (4,118 lines preserved).
   - `src/services/admin/__tests__/googlePlayVerificationCore.test.ts`: Replaced obsolete subscription state tests with one-time purchase verification tests (`purchaseState` 0, 1, 2); removed obsolete RTDN, subscription course, and subscription expiry test describes; preserved credential validation, JWT verification, and invoice snapshot safety tests.

### C. Supabase Edge Functions (`mocktest-admin`)
1. **`supabase/functions/create-payment-order/index.ts`:**
   - Updated `ProductType` to `'course' | 'pyq_package' | 'installment'`.
   - Removed call to `complete-subscription-purchase`.
   - Replaced subscription plan load branch with `INVALID_PRODUCT_TYPE` rejection.
   - Replaced subscription order item insert branch with error response.
   - Made `body.conversion` fail closed with `CONVERSION_DISCONTINUED`.
   - Strictly preserved Full Course, Installment initial tranche, subsequent installment tranche, and PYQ package order creation.
2. **`supabase/functions/razorpay-webhook/index.ts`:**
   - Removed `plan_id` from `OrderItemRow` and select query.
   - Replaced `routeToSubscriptionPurchase` with immediate rejection.
   - Removed `student_subscriptions` query in `checkExistingEntitlements`.
   - Strictly preserved Full Course, Installment, and PYQ package fulfillment, refunds, and payment verification.
3. **`supabase/functions/verify-google-play-purchase/index.ts`:**
   - Added immediate fail-closed rejection for `isSub` (`SUBSCRIPTIONS_DISCONTINUED`).
   - Removed `student_subscriptions` query and `order_items.plan_id` select.
   - Set `productType: 'inapp'` and `subscriptionEndDate: null` across all remaining execution paths.
   - Strictly preserved one-time course and PYQ verification, purchase token deduplication, order creation, and fulfillment.
4. **`supabase/functions/subscription-access-status/` (Permanently Retired & Deleted):**
   - Completely deleted from the repository. No compatibility shim or replacement endpoint is retained.
   - Comprehensive codebase audits confirmed zero active callers across Android application, website, and admin source code.
   - Authorization for courses, batch assignments, live classes, recordings, installments, and PYQ packages is enforced directly via authoritative database queries and dedicated RPCs.

---

## 4. Database — Migration 246 Details

**File:** `supabase/migrations/246_retire_subscription_module.sql`  
**Locations:**
- `C:\Projects\MockTestApp\supabase\migrations\246_retire_subscription_module.sql`
- `C:\Projects\mocktest-admin\supabase\migrations\246_retire_subscription_module.sql`

**File SHA-256 Checksum:**  
`5EEAA8E134FEE95340DBB2E71EB6D1F1798B8A135E154B6B6F551BFDE9C42E59`  
*(Verified 100% byte-identical across both repositories)*

### A. Update `complete_google_play_purchase()` (Section 1)
- Removed all read and write queries to `google_play_rtdn_events`.
- Removed subscription renewal ledger operations and `p_gateway_response->>'rtdn_event_id'` handling.
- Retained safe fail-closed rejection when `p_item_type = 'subscription_plan'`.
- Preserved:
  - Account and student ownership validation (`profiles` lookup).
  - Purchase-token idempotency via `payments.gateway_payment_id`.
  - Atomic order creation (`orders`) and order line item creation (`order_items`).
  - Payment record creation (`payments`) with verified timestamp constraint safety.
  - Course fulfillment (`course_enrollments`) with `enrollment_type = 'purchase'`.
  - PYQ fulfillment (`student_pyq_purchases`).
  - Invoice snapshot record creation (`invoices`).
  - All existing exception handling and transaction rollback semantics.

### B. Obsolete Subscription RPCs Dropped with `RESTRICT` (Section 2)
The following 6 functions were confirmed subscription-only and dropped:
1. `public.apply_google_play_rtdn_state_transition(uuid, text, text, timestamptz, jsonb)`
2. `public.reconcile_google_play_renewal_batch(integer)`
3. `public.transition_subscription_to_grace(uuid, integer)`
4. `public.total_subscription_payments(uuid)`
5. `public.diag_assigned_notes_access(uuid, uuid, uuid)` *(Confirmed temporary diagnostic helper created in Migration 099 querying `student_subscriptions`)*
6. `public.fulfill_standard_subscription_order(uuid, uuid, uuid, uuid, numeric, text, text, timestamptz)`

### C. Standalone Subscription Trigger Functions Dropped (Section 3)
1. `public.trgfn_subscription_auto_history()`
2. `public.trgfn_subscription_check_capacity()`
3. `public.trgfn_subscription_validate_course()`
4. `public.trgfn_subscription_validate_status()`

### D. Cron Job & Vault Secret Removed (Section 4)
1. **pg_cron:** Unscheduled cron job named `'subscription-lifecycle-daily'` via `cron.unschedule()`.
2. **Supabase Vault:** Deleted secret named `'subscription_lifecycle_url'` from `vault.decrypted_secrets` / `vault.secrets`.

### E. Obsolete Subscription Tables Dropped with `RESTRICT` (Section 5)
Dropped in exact child-to-parent foreign-key dependency order using `DROP TABLE IF EXISTS ... RESTRICT` (no blanket `CASCADE`):
1. `public.subscription_usage`
2. `public.subscription_grace_periods`
3. `public.subscription_cancellations`
4. `public.subscription_renewals`
5. `public.subscription_history`
6. `public.student_subscriptions`
7. `public.plan_unlocks`
8. `public.subscription_plans`
9. `public.subscription_features`
10. `public.google_play_rtdn_events`

### F. Obsolete Subscription Enum Types Dropped with `RESTRICT` (Section 6)
Dropped after dependent tables were removed, using `DROP TYPE IF EXISTS ... RESTRICT`:
1. `public.subscription_status_type`
2. `public.subscription_change_reason_type`
3. `public.cancellation_reason_type`
4. `public.grace_period_resolution_type`
5. `public.plan_billing_cycle_type`
6. `public.feature_category_type`

### G. Post-Migration Automated Assertions (Section 7)
Migration 246 executes 11 defensive assertions inside a transactional `DO $$` block, rolling back if any condition fails:
1. Confirms all 10 subscription tables no longer exist in `information_schema.tables`.
2. Confirms all 6 subscription enum types no longer exist in `pg_type`.
3. Confirms all 6 dropped RPCs no longer exist in `pg_proc`.
4. Confirms all 4 trigger functions no longer exist in `pg_proc`.
5. Confirms cron job `'subscription-lifecycle-daily'` is absent from `cron.job`.
6. Confirms Vault secret `'subscription_lifecycle_url'` is absent.
7. Confirms `course_enrollments` table exists.
8. Confirms `student_pyq_purchases` table exists.
9. Confirms `course_installment_plans` table exists.
10. Confirms `student_course_agreements` table exists.
11. Confirms historical baseline of 17 captured/failed installment orders remains strictly preserved.

---

## 5. Database Objects Intentionally Preserved

The following objects were audited and confirmed essential for current operations:
1. **Shared Enum Types:**
   - `public.item_type`: Retained with legacy label `'subscription_plan'` intact to avoid table rewriting. Protected by Migration 245 CHECK constraint `ck_order_items_item_type_not_subscription_plan` which prevents any new insertions of `'subscription_plan'`.
   - `public.notification_event_type`: Retained with historical labels intact.
2. **Installment Schema & Records:**
   - `public.course_installment_plans`
   - `public.student_course_agreements` (and `plan_id` foreign key)
   - `public.student_installment_schedule`
   - `public.installment_payment_allocations`
   - `public.order_items.installment_plan_id`
   - All 17 historical captured/failed installment fulfillment records.
3. **Core Commerce & Entitlements:**
   - `public.course_enrollments` (`enrollment_type IN ('purchase', 'installment', 'admin_grant', 'free')`)
   - `public.student_pyq_purchases`
   - `public.orders`, `public.order_items`, `public.payments`, `public.invoices`
   - `public.complete_google_play_purchase()` (updated for one-time fulfillment)
   - `public.process_installment_payment()`
   - `public.verify_recording_playback_access()`

---

## 6. Edge Functions Summary

| Edge Function | Repository | Action Taken | Rationale |
| :--- | :--- | :--- | :--- |
| `complete-subscription-purchase` | `mocktest-admin` | **Deleted** | Obsolete subscription webhook fulfillment. |
| `subscription-lifecycle` | `mocktest-admin` | **Deleted** | Obsolete daily cron handler. |
| `subscription-renewal-options` | `mocktest-admin` | **Deleted** | Obsolete renewal calculation endpoint. |
| `google-play-rtdn-webhook` | Both repos | **Deleted** | Obsolete RTDN webhook endpoint. |
| `cron-subscription-deactivation` | `MockTestApp` | **Deleted** | Obsolete legacy deactivation job. |
| `_shared/subscriptionAccess.ts` | `mocktest-admin` | **Deleted** | Shared file querying dropped subscription tables. |
| `subscription-access-status` | `mocktest-admin` | **Deleted** | Permanently retired and deleted. Zero callers in Android or web code. |
| `verify-google-play-purchase` | `mocktest-admin` | **Modified** | Rejects `isSub` fail-closed; removes subscription queries; preserves one-time course/PYQ purchases. |
| `create-payment-order` | `mocktest-admin` | **Modified** | Removes subscription product orders; preserves course, installment, and PYQ orders. |
| `razorpay-webhook` | `mocktest-admin` | **Modified** | Rejects subscription routing; preserves course, installment, and PYQ fulfillment. |
| `complete-course-purchase` | `mocktest-admin` | **Preserved** | Authoritative one-time course fulfillment. |
| `complete-installment-purchase` | `mocktest-admin` | **Preserved** | Authoritative installment fulfillment. |
| `complete-pyq-purchase` | `mocktest-admin` | **Preserved** | Authoritative PYQ package fulfillment. |

---

## 7. Remaining Subscription References Classification

Every occurrence of the word `subscription` in the codebase has been audited and classified into one of four categories:

### A. Intentionally Preserved Compatibility Code
- **`src/screens/NotificationScreen.tsx` (Android):** Fallback routing that intercepts legacy notification clicks (e.g. `actionType === 'subscriptionPlans'`) and safely routes the student to `CourseDetail` or the `Courses` catalog instead of crashing.
- **`src/services/payment/playBillingService.ts` (Android):** Defensive rejection block returning `SUBSCRIPTIONS_DISCONTINUED` if Google Play delivers a legacy `sub_*` SKU.
- **`supabase/functions/verify-google-play-purchase/index.ts`:** Defensive rejection block returning `SUBSCRIPTIONS_DISCONTINUED` if an incoming request provides `productType === 'subs'`.

### B. Harmless Legacy Enum Labels & Schema Artifacts
- **PostgreSQL Enum `public.item_type`:** Contains `'subscription_plan'` label. Harmless because Migration 245 enforced `ck_order_items_item_type_not_subscription_plan` which strictly blocks insertion.
- **PostgreSQL Enum `public.notification_event_type`:** Contains historical `'subscription_expiring'` and `'subscription_expired'` labels. Harmless because no triggers or Edge Functions emit these event types.

### C. Documentation & History
- **`supabase/migrations/001` through `245`:** Historical database migration files. Untouched to preserve schema migration history and integrity.
- **`SUBSCRIPTION_RETIREMENT_FINAL_INVENTORY.md`:** Historical architecture audit document.
- **Code Comments:** Explanatory comments in preserved services referencing decoupled subscription architecture (e.g. `InstallmentOverdueLockoutView.tsx: "- Clear, unified overdue status messaging decoupled from legacy subscriptions"`).
- **React Native / Supabase Realtime APIs:** Uses of `AppState.addEventListener('change', ...)` which returns an `AppStateSubscription` object, and Supabase client `.channel(...).subscribe()` for realtime events. These are standard framework APIs unrelated to commercial subscriptions.

### D. Unresolved Subscription Dependencies
- **NONE.** There are zero unresolved subscription dependencies in either repository. All active imports, database foreign keys, and runtime RPC calls have been completely decoupled.

---

## 8. Confirmation of Preserved Purchasing & Access Flows

1. **Course Purchasing:**
   - Android: `purchaseOneTimeProduct({ sku: 'course_<hex>', courseId })` initiates Google Play Billing, verified server-side by `verify-google-play-purchase`, fulfilled via `complete_google_play_purchase()` granting active `course_enrollments`.
   - Website: Razorpay checkout creates order via `create-payment-order`, webhook invokes `complete-course-purchase`, creating active `course_enrollments`.
2. **Installment Purchasing:**
   - Android redirects to website checkout.
   - Website: Initial tranche creates `student_course_agreements`, `student_installment_schedule`, and `installment_payment_allocations`. Subsequent tranches processed via `process_installment_payment()`.
   - Arrears lockout: Students in arrears are locked out of live classes and recordings while preserving access to past content.
   - Baseline integrity: All 17 historical captured/failed installment fulfillment records remain untouched.
3. **PYQ Package Purchasing:**
   - Android: `purchaseOneTimeProduct({ sku: 'pyq_<hex>', packageId })` initiates Google Play Billing, verified server-side, granting active `student_pyq_purchases`.
   - Website: Razorpay checkout fulfills via `complete-pyq-purchase`.
   - Entitlement isolation: PYQ entitlements remain strictly distinct from course enrollments in both database tables and application hooks (`usePurchasedPyqIds`).

---

## 9. Whitespace & Patch Validation

Whitespace and patch formatting was validated across both repositories using `git diff --check`:

```powershell
# Android App repository
cd C:\Projects\MockTestApp
git diff --check
# Result: Clean (exit code 0)

# Website & Admin repository
cd C:\Projects\mocktest-admin
git diff --check
# Result: Clean (exit code 0)
```

No test commands (`npm test`, `jest`, etc.) or app builds were executed, complying with strict pairing boundaries.

---

## 10. Manual Actions Required by Repository Owner

The retirement is complete at the source-code and migration-file level. The repository owner must execute the following manual production deployment steps:

1. **Google Play Console:**
   - Navigate to **Monetize > Subscriptions** in the Google Play Console for Make Me Topper.
   - Deactivate all obsolete `sub_<uuid>` subscription products and base plans.
   - Verify that one-time in-app products (`course_<uuid>` and `pyq_<uuid>`) remain active and unaffected.
2. **Google Cloud Platform (GCP) / Pub/Sub:**
   - Confirm that the dedicated Google Play Real-Time Developer Notifications (RTDN) Pub/Sub subscription and topic have no other consumers.
   - Disable or delete the RTDN Pub/Sub subscription.
3. **Database Migration:**
   - Review and execute Migration 246 against the target database:
     `supabase/migrations/246_retire_subscription_module.sql`
   - Migration 246 will drop the 10 subscription tables, 6 RPCs, 4 triggers, 6 enum types, the pg_cron job, and Vault secret, and assert schema integrity.
4. **Supabase Edge Functions Deployment:**
   - Deploy updated Edge Functions:
     ```bash
     supabase functions deploy verify-google-play-purchase
     supabase functions deploy create-payment-order
     supabase functions deploy razorpay-webhook
     ```
   - Delete retired Edge Functions from Supabase project:
     ```bash
     supabase functions delete complete-subscription-purchase
     supabase functions delete subscription-lifecycle
     supabase functions delete subscription-renewal-options
     supabase functions delete google-play-rtdn-webhook
     supabase functions delete subscription-access-status
     ```
   *(Manual Action: Delete the deployed `subscription-access-status` Edge Function from the Supabase project after confirming no previously released application version or external client still calls it.)*
5. **Website & Admin Deployment:**
   - Deploy the updated Next.js application in `C:\Projects\mocktest-admin` (e.g. via Vercel).
6. **Android Application Build & Release:**
   - Build, sign, and release the new Android app version from `C:\Projects\MockTestApp`.
