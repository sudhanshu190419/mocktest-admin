# Make Me Topper — Google Play Subscription Integration Audit
**Android Package:** `com.makemetopper.app` (Application ID) / `com.mocktestapp` (Project Package)  
**Target Systems:** Android App (`MockTestApp`), Admin Panel (`mocktest-admin`), Supabase Backend (`ocolfottogbybitfpdqy`), Google Play Console  
**Billing Engine:** `react-native-iap` 15.6.2 / Google Play Billing Library (PBL) 9.1.0  
**Audit Status:** Complete Read-Only Architectural Audit (No code or production data modified)  
**Date:** October 2026

---

## 1. Executive Summary

This audit assesses the readiness of the Make Me Topper platform to support **course-scoped auto-renewing subscriptions** alongside existing **one-time permanent course purchases**. 

### Key Audit Findings

1. **Architecture Is Already Designed for Subscriptions, but Disconnected from Admin Workflow:**
   - The Supabase database schema (`subscription_plans`, `student_subscriptions`, `course_enrollments`, `orders`, `order_items`) already has native, production-grade schema support for course-scoped subscriptions (Migrations `089`, `090`, `096`, `103`, `104`).
   - The backend verification Edge Function (`verify-google-play-purchase`) and Pub/Sub webhook (`google-play-rtdn-webhook`) already have full implementation branches for Google Play Subscriptions v2 (`purchases.subscriptionsv2.tokens.get`).
   - The Android app (`MockTestApp`) already has `purchaseSubscriptionPlan` implemented in `playBillingService.ts` and UI hooks in `CourseDetailScreen.tsx` and `PaymentConfirmationScreen.tsx`.

2. **The Major Operational Blockers:**
   - **No Automated Sync to Google Play Console:** Google Play Console has no API connection to automatically register subscription products created in the admin panel. When an administrator creates a subscription plan in the admin dashboard, the corresponding subscription product (`sub_<plan_id_clean_hex>`) and base plan (`p1m`, `p3m`, `p6m`, `p1y`) **must be manually configured in the Google Play Console**.
   - **Admin UI Fragmentation:** Course creation (`src/app/admin/courses`) only exposes one-time pricing (`original_price`, `discounted_price`). Subscription plans are hidden in a separate module (`src/app/admin/commerce/subscription-plans`), and the course editor does not show or manage subscription plans for that course.
   - **Service Account IAM Permissions (Active Production Blocker):** Google Play Developer API currently returns **HTTP 401 Unauthorized / Insufficient Permissions** because the Google Cloud service account `make-me-topper-play-billing@make-me-topper-play-billing.iam.gserviceaccount.com` has not been granted financial and subscription permissions for package `com.makemetopper.app` in Google Play Console under **Users and permissions**.

3. **Safety of Existing One-Time Purchases:**
   - Existing one-time course purchasers are fully protected. Migration `096` defines the SQL helper `is_permanent_course_owner(course_id)` which guarantees that any user with `course_enrollments.enrollment_type = 'purchase'` has permanent lifetime access that can never be revoked by subscription expiration, cancellation, or background deactivation crons.

---

## 2. Architecture Overview

The system operates a multi-platform commerce model separating website purchases (Razorpay) from Android app purchases (Google Play Billing), converging onto a single unified Supabase database schema.

```
                          ┌────────────────────────────────────────────────────────┐
                          │                   ADMIN DASHBOARD                      │
                          │            (C:\Projects\mocktest-admin)                │
                          └──────┬──────────────────────────────────┬──────────────┘
                                 │ Course Creation                  │ Plan Creation
                                 ▼ (original_price)                 ▼ (monthly/annual)
                          ┌──────────────────────┐        ┌─────────────────────────┐
                          │   courses (table)    │        │subscription_plans(table)│
                          └──────────┬───────────┘        └────────────┬────────────┘
                                     │                                 │
                   ┌─────────────────┴─────────────────────────────────┴─────────────────┐
                   │                                                                     │
                   ▼ [MANUAL CONFIGURATION REQUIRED]                                     ▼ [MANUAL CONFIGURATION REQUIRED]
      ┌─────────────────────────┐                                           ┌─────────────────────────┐
      │   Google Play Console   │                                           │   Google Play Console   │
      │   In-App Products       │                                           │   Subscriptions         │
      │   course_<course_uuid>  │                                           │   sub_<plan_uuid>       │
      │   One-time INR price    │                                           │   Base Plans: p1m / p1y │
      └────────────┬────────────┘                                           └────────────┬────────────┘
                   │                                                                     │
                   │ Query: getPlayProducts([sku], 'inapp')                              │ Query: getPlayProducts([sku], 'subs')
                   ▼                                                                     ▼
    ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
    │                                  MAKE ME TOPPER ANDROID APP                                     │
    │                                 (C:\Projects\MockTestApp)                                        │
    │  - CourseDetailScreen: Displays One-Time Option + DB Subscription Plans (Monthly/Annual)         │
    │  - playBillingService: requestPurchase({ type: 'inapp' | 'subs', subscriptionOffers })           │
    │  - SHA-256 Account Obfuscation: Passes sha256(student_id) as obfuscatedAccountId                 │
    └────────────────────────────────┬─────────────────────────────────┬───────────────────────────────┘
                                     │                                 │
                 (1) Purchase Result │                                 │ (4) Pub/Sub Webhook (Async)
                     purchaseToken   │                                 │     RTDN Renew / Cancel / Expire
                                     ▼                                 ▼
    ┌──────────────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
    │            SUPABASE EDGE FUNCTION                │   │           SUPABASE EDGE FUNCTION          │
    │          verify-google-play-purchase             │   │          google-play-rtdn-webhook         │
    │  - Verifies token with Google Publisher API      │   │  - Ingests Pub/Sub push notification      │
    │  - Validates obfuscatedExternalAccountId (SHA256)│   │  - Queries subscriptionsv2 authoritative  │
    │  - Prevents replay / cross-account theft         │   │  - Transitions: active, grace, expired    │
    │  - Acknowledges transaction                      │   │  - Writes subscription_history audit log │
    └────────────────────────┬─────────────────────────┘   └─────────────────────┬─────────────────────┘
                             │                                                   │
                             ▼                                                   ▼
    ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
    │                                    SUPABASE DATABASE ENGINE                                      │
    │  - orders & order_items: Immutable financial transaction records                                 │
    │  - payments: Google Play order ID & purchase token uniqueness                                    │
    │  - student_subscriptions: Active/grace subscription state, end_date, auto_renew                   │
    │  - course_enrollments: Active student access entitlement (type: 'purchase' vs 'subscription')    │
    │  - is_permanent_course_owner(): DB function protecting lifetime purchasers from revocation       │
    └──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Current One-Time Purchase Flow

| Step | Component | File Path | Line Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| **1. Course Creation** | Admin Web | `src/services/admin/courseManagementService.ts` | L614–L650 | Admin enters course title, stream, and price (`original_price`, `discounted_price`). Stored in `courses` table. |
| **2. Play SKU Mapping** | Mobile App | `src/utils/playSkuHelper.ts` | L41–L44 | Function `getCoursePlaySku(courseId)` sanitizes course UUID to 32 hex chars: `course_<32_hex_uuid>`. |
| **3. Catalog Display** | Mobile App | `src/screens/courses/CourseDetailScreen.tsx` | L155–L185 | Renders "Full Course" card with course price and badge "Permanent Access". |
| **4. Checkout Initiation**| Mobile App | `src/screens/subscription/PaymentConfirmationScreen.tsx` | L225–L231 | Passes `courseId` and computed SKU to `purchaseOneTimeProduct`. |
| **5. Play Billing Client**| Mobile App | `src/services/payment/playBillingService.ts` | L450–L535 | Derives SHA-256 `obfuscatedAccountId`, queries Google Play for `inapp` product, calls `requestPurchase`. |
| **6. Purchase Callback** | Mobile App | `src/services/payment/playBillingService.ts` | L550–L590 | Receives `Purchase` object containing `purchaseToken` and `orderId`. |
| **7. Server Verification**| Backend | `supabase/functions/verify-google-play-purchase/index.ts` | L230–L350 | Authorizes via JWT, checks replay in `payments`, queries Google `purchases.products.get`, validates `obfuscatedExternalAccountId`, acknowledges purchase. |
| **8. Entitlement Grant** | Backend | `supabase/functions/verify-google-play-purchase/index.ts` | L530–L556 | Inserts `orders`, `order_items` (`item_type = 'course'`), `payments`, and upserts `course_enrollments` (`enrollment_type = 'purchase'`, `is_active = true`, `expires_at = null`). |
| **9. Device Acknowledge**| Mobile App | `src/services/payment/playBillingService.ts` | L595–L605 | Calls `finishTransaction({ purchase, isConsumable: false })`. UI updates to enrolled state. |

---

## 4. Existing Google Play Billing Feature Audit

| Feature | Audit Status | Evidence in Codebase |
| :--- | :--- | :--- |
| **A. One-time purchases** | **Implemented and verified in code** | `playBillingService.ts:purchaseOneTimeProduct` (L435) & `verify-google-play-purchase:productType === 'inapp'` (L340). |
| **B. Auto-renewing subscriptions** | **Partially implemented** | Complete code exists in `playBillingService.ts:purchaseSubscriptionPlan` (L705) and `verify-google-play-purchase:productType === 'subs'` (L355), but **lacks automated Play Console sync** and is blocked by service account API permissions. |
| **C. Prepaid subscriptions** | **Not implemented** | Code assumes recurring base plans (`autoRenewingPlan`). Prepaid base plans with top-up extensions are not mapped. |
| **D. Purchase restoration** | **Implemented and verified in code** | `playBillingService.ts:restorePurchases` (L855–L925) queries `getAvailablePurchases()`, parses `course_` vs `sub_` SKUs, verifies with backend, and finishes transaction. |
| **E. Purchase acknowledgement** | **Implemented and verified in code** | Both server-side (`purchases.products.acknowledge` / `purchases.subscriptionsv2.tokens` in `verify-google-play-purchase` L380) and client-side (`finishTransaction` in `playBillingService.ts` L598, L805). |
| **F. Subscription expiry handling** | **Implemented and verified in code** | Dual mechanism: (1) Event-driven via `google-play-rtdn-webhook` (L300–L350) and (2) Scheduled cleanup via `cron-subscription-deactivation` (L35–L90) which deactivates `enrollment_type = 'subscription'` only. |
| **G. Subscription cancellation & renewal** | **Implemented and verified in code** | `billingCore.ts:calculateRtdnTransition` (L368–L440): `SUBSCRIPTION_CANCELED` sets `is_auto_renew = false` while maintaining access until `end_date`. `SUBSCRIPTION_RENEWED` updates `end_date` and maintains active access. |
| **H. Backend purchase verification** | **Implemented and verified in code** | `verify-google-play-purchase/index.ts` enforces server-side verification using Google Android Publisher API via RS256 service-account tokens. |
| **I. Pending, failed, refunded, revoked handling** | **Implemented and verified in code** | State validation in `billingCore.ts:verifyGooglePlayPurchaseState` rejects pending payments (`PAYMENT_PENDING`); `google-play-rtdn-webhook` maps `SUBSCRIPTION_REVOKED` to `refunded` and revokes access. |

---

## 5. Admin Panel Findings

### Course Creation vs. Subscription Plans Disconnect

Administrators currently configure courses and subscriptions in two completely disconnected areas of the Admin Panel:

1. **Course Management (`src/app/admin/courses`):**
   - Managed via `CourseCreateModal.tsx` (L124–L190) and `CourseEditModal.tsx`.
   - **Supported fields:** Title, Slug, Stream, Short Description, Description, Language, Original Price, Discounted Price, Currency.
   - **Limitation:** Can only configure a single one-time price. It is impossible to configure subscription options or link recurring billing cycles to a course from this screen.
   - **No Google Play Fields:** Does not store Google Play Product IDs.

2. **Subscription Plans Module (`src/app/admin/commerce/subscription-plans`):**
   - Managed via `SubscriptionPlanFormModal.tsx` (L61–L87) and `subscriptionPlanAdminService.ts`.
   - **Supported fields:** Course Selector (`courseId`), Plan Name, Description, Billing Cycle (`monthly`, `quarterly`, `half_yearly`, `yearly`), Price, Duration Days, Trial Days, Is Featured, Is Active.
   - **Database constraint:** `uq_subscription_plans_course_billing_cycle` enforces that a course can have at most one plan per billing cycle.
   - **Limitation:** Does not display the generated Google Play SKU (`sub_<plan_uuid>`) or Base Plan ID (`p1m`, `p1y`), nor does it validate whether the plan has been created in Google Play Console.

### Can the Admin Panel Support the Illustrative Example Today?

> **Example:** NEET Complete Course  
> - One-time purchase: ₹4,999  
> - Monthly subscription: ₹499/month  
> - Annual subscription: ₹3,999/year  

**Audit Finding:**
- **In the Database:** **YES.** The database natively supports this exact setup today. The course row in `courses` stores the one-time price (₹4,999), and two rows in `subscription_plans` store the Monthly (₹499) and Yearly (₹3,999) plans linked by `course_id`.
- **In the Admin Panel UI:** **PARTIALLY.** An admin must create the course first under Courses, then manually navigate to `Commerce -> Subscription Plans`, create the Monthly plan linked to the course, and then create the Annual plan linked to the course.
- **In Google Play Console:** **NO (Requires Manual Action).** The administrator must manually log into Google Play Console, navigate to **Monetize > Subscriptions**, create a subscription product with the exact deterministic SKU, configure the base plans (`p1m`, `p1y`), set prices, and create offers.

---

## 6. Android App Findings

### Code Inspection: `CourseDetailScreen.tsx` & `PaymentConfirmationScreen.tsx`

1. **Dual Purchase Mode Already Wired:**
   - In `CourseDetailScreen.tsx` (L108–L185), the screen fetches subscription plans using `useSubscriptionPlans(courseId)`.
   - If plans exist in the database, it renders a carousel/list containing:
     - The subscription plans (e.g., Monthly, Annual)
     - The "Full Course" one-time purchase option (Permanent Access)
   - When a student selects a plan, `handleEnrollInit` (L260–L290) branches:
     - If subscription selected: navigates to `PaymentConfirmationScreen` with `isOneTimeCourse: false`, `planId`, `billingCycle`.
     - If Full Course selected: navigates to `PaymentConfirmationScreen` with `isOneTimeCourse: true`.

2. **Google Play Billing Call Path:**
   - `PaymentConfirmationScreen.tsx` (L215–L230):
     ```typescript
     if (!isOneTime && planId && isUUID(planId)) {
       const sku = getSubscriptionPlanPlaySku(planId, billingCycle);
       result = await purchaseSubscriptionPlan({ sku, planId, courseId });
     } else {
       const sku = getCoursePlaySku(courseId);
       result = await purchaseOneTimeProduct({ sku, courseId });
     }
     ```
   - `playSkuHelper.ts` (L48–L72):
     - Subscription SKU: `sub_${uuidToCleanHex(planId)}` (Total length: 36 characters).
     - Base Plan IDs: `p1m` (monthly), `p3m` (quarterly), `p6m` (half-yearly), `p1y` (yearly/annual).

3. **Offer Token Resolution:**
   - In `playBillingService.ts:resolveSubscriptionOffer` (L635–L690):
     - Queries Google Play for subscription product using `getPlayProducts([sku], 'subs')`.
     - Searches `subscriptionOfferDetailsAndroid` for an offer matching `basePlanId` (e.g. `p1m`).
     - Extracts the active `offerToken`.
     - **Critical Requirement:** In Google Play Console, every base plan must have at least one active offer (or base-plan offer) so that `offerToken` is returned. If an offer is inactive or missing, the mobile app returns: *"Subscription offer is unavailable in Google Play Store."*

4. **Account State and Logout/Login Safety:**
   - Obfuscated Account ID: Before launching Google Play Billing, the app computes `sha256(student_auth_uid)` and sets `obfuscatedAccountId` on the Google Play purchase request (`playBillingService.ts` L513, L735).
   - If a student logs out mid-purchase, the session is cleared. When returning, `restorePurchases` matches the purchase token to the authenticated user on the backend.

---

## 7. Supabase Backend and Security Audit

### Purchase Verification Function: `verify-google-play-purchase`

1. **Authentication:**
   - Enforces Supabase Auth session via `Authorization: Bearer <JWT>`. Anonymous or unauthenticated requests are rejected with HTTP 401.

2. **Cross-Account Replay Attack Prevention:**
   - Location: `index.ts` (L199–L220).
   - Before contacting Google, the function checks the `payments` table for existing records matching `gateway_payment_id = orderId` or `gateway_order_id = purchaseToken`.
   - If the payment was already recorded under a different `profile_id`, the request is immediately rejected with **HTTP 409 Conflict**: *"This purchase has already been claimed by another account."*

3. **Cryptographic Account Ownership Validation:**
   - Location: `index.ts` (L312–L331).
   - The backend recomputes `sha256(student_profile_id)` and compares it against Google Play's authoritative `obfuscatedExternalAccountId`.
   - If Google Play reports an account identifier that does not match the caller's verified Supabase user ID, the request is rejected with **HTTP 403 Forbidden**: *"Purchase account mismatch. The Google Play transaction belongs to a different student profile."*

4. **Subscription Verification (`productType === 'subs'`):**
   - Calls Google Android Publisher API v3:
     `GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.makemetopper.app/purchases/subscriptionsv2/tokens/{purchaseToken}`
   - Validates `subscriptionState`:
     - Accepts: `SUBSCRIPTION_STATE_ACTIVE`, `SUBSCRIPTION_STATE_IN_GRACE_PERIOD`.
     - Rejects: `SUBSCRIPTION_STATE_PENDING` (HTTP 422), `SUBSCRIPTION_STATE_EXPIRED` (HTTP 422), `SUBSCRIPTION_STATE_REVOKED` (HTTP 422).
   - Validates course-plan consistency:
     - Verifies `subscription_plans.course_id === resolvedCourseId` (`billingCore.ts:validateSubscriptionCourseAssociation`).
   - Grants Access:
     - Inserts `student_subscriptions` row with `status = 'active'`, `is_auto_renew = true`, `start_date = now`, `end_date = googleExpiryTime`.
     - Upserts `course_enrollments` with `enrollment_type = 'subscription'`, `is_active = true`.

5. **Real-Time Developer Notifications (`google-play-rtdn-webhook`):**
   - Ingests Google Cloud Pub/Sub push messages.
   - Validates Google OIDC Push JWT (`verifyGooglePubSubOidcToken`).
   - RTDN is treated strictly as an **untrusted trigger**. The webhook always queries `purchases.subscriptionsv2.tokens.get` directly to get authoritative Google state.
   - Applies state transitions via `calculateRtdnTransition`:
     - Cancellation (`SUBSCRIPTION_CANCELED`): Turns off `is_auto_renew`, but leaves `is_active = true` until `end_date`.
     - Renewal (`SUBSCRIPTION_RENEWED`): Extends `end_date`, keeps `is_active = true`.
     - Grace period (`SUBSCRIPTION_IN_GRACE_PERIOD`): Sets `status = 'grace'`, sets `grace_end_date = now + 7d`, access remains active.
     - Expiry (`SUBSCRIPTION_EXPIRED`): Sets `status = 'expired'`, updates `course_enrollments.is_active = false`.
     - Revocation / Refund (`SUBSCRIPTION_REVOKED`): Sets `status = 'refunded'`, immediately revokes access.

---

## 8. Google Play Console Configuration Requirements

Because Google Play has no public API for the Admin Panel to automatically create subscription products, every subscription plan created in the Admin Panel requires corresponding manual configuration in Google Play Console.

### Step-by-Step Google Play Console Setup

1. **Service Account API Permissions (Critical Current Blocker):**
   - Go to **Google Play Console > Users and permissions > Service accounts**.
   - Locate: `make-me-topper-play-billing@make-me-topper-play-billing.iam.gserviceaccount.com`.
   - Click **View app permissions**. Add `com.makemetopper.app`.
   - Under **Account permissions > Financial data**, check:
     - `View financial data, orders, and cancellation survey responses`
     - `Manage orders and subscriptions`
   - Click **Save changes**.

2. **Subscription Product Creation:**
   - Go to **Monetize > Products > Subscriptions**.
   - Click **Create subscription**.
   - **Product ID:** Must match the exact SKU derived by `playSkuHelper.ts`:
     `sub_<plan_id_clean_hex>`  
     *(Example: for plan UUID `e5555555-4444-3333-2222-111111111111`, Product ID must be `sub_e5555555444433332222111111111111`)*.
   - **Name:** Course Subscription Name (e.g., "NEET Biology Monthly").

3. **Base Plan Configuration:**
   - Inside the subscription product, click **Add base plan**.
   - **Base Plan ID:** Must match the billing cycle identifier:
     - Monthly: `p1m`
     - Quarterly: `p3m`
     - Half-Yearly: `p6m`
     - Annual / Yearly: `p1y`
   - **Type:** Auto-renewing.
   - **Billing Period:** 1 month, 3 months, 6 months, or 1 year.
   - **Grace Period:** Set to **7 days** (matches backend `grace_end_date` logic).
   - **Price:** Set the exact INR price matching `subscription_plans.price`.
   - Click **Activate**.

4. **Offer Configuration:**
   - Under the Base Plan, click **Add offer**.
   - Create a standard default offer (no eligibility criteria, or available to all users).
   - Click **Activate offer**.
   - *Note: Without an active offer, PBL 9.x cannot resolve an `offerToken` and will reject the purchase.*

5. **Real-Time Developer Notifications (RTDN):**
   - Go to **Monetize > Monetization setup**.
   - Under **Google Play Billing > Real-time developer notifications**:
     - Topic name: `projects/make-me-topper-play-billing/topics/play-billing-rtdn`
   - In Google Cloud Console, configure a Push Subscription to:
     `https://ocolfottogbybitfpdqy.supabase.co/functions/v1/google-play-rtdn-webhook`
   - Enable Google OIDC authentication on the push subscription.

---

## 9. Database Architecture & Backward Compatibility

### Existing Schema State (Migrations 089, 090, 096)

The database schema already cleanly separates one-time purchases from recurring subscriptions:

| Table | One-Time Purchase Record | Subscription Purchase Record |
| :--- | :--- | :--- |
| `courses` | Defines course & lifetime price (`original_price`). | Parent entity linked via `course_id`. |
| `subscription_plans` | *Not used.* | Defines plan duration, billing cycle, and recurring price. |
| `orders` | `status = 'confirmed'`, `total_amount`. | `status = 'confirmed'`, `total_amount`. |
| `order_items` | `item_type = 'course'`, `course_id` populated, `plan_id = null`. | `item_type = 'subscription_plan'`, `course_id` & `plan_id` populated. |
| `payments` | `gateway = 'google_play'`, `order_id`, `purchase_token`. | `gateway = 'google_play'`, `order_id`, `purchase_token`. |
| `student_subscriptions` | *No record created.* | Row created with `status = 'active'`, `start_date`, `end_date`, `is_auto_renew`. |
| `course_enrollments` | `enrollment_type = 'purchase'`, `is_active = true`, `expires_at = null`. | `enrollment_type = 'subscription'`, `is_active = true`, `expires_at = null`. |

### Proof of Backward Compatibility: Migration 096

In `mocktest-admin/supabase/migrations/096_subscription_entitlement_ownership.sql` (L150–L200), the SQL function `is_permanent_course_owner` was deployed:

```sql
create or replace function public.is_permanent_course_owner(p_course_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1
    from public.course_enrollments ce
    where ce.course_id = p_course_id
      and ce.student_id = public.get_my_student_id()
      and ce.enrollment_type = 'purchase'
      and ce.is_active = true
      and ce.revoked_at is null
      and (ce.expires_at is null or ce.expires_at >= now())
  );
$$;
```

This helper is called at the top of `can_student_access_live_course` and `can_student_access_content`.

**Why this guarantees zero disruption to existing students:**
1. Any student who purchased a course via one-time payment (Android Google Play or Website Razorpay) has `course_enrollments.enrollment_type = 'purchase'`.
2. Even if that student later purchases a monthly subscription that subsequently cancels or expires, `is_permanent_course_owner` continues to return `TRUE`.
3. Background deactivation crons (`cron-subscription-deactivation/index.ts` L75) explicitly filter by `.eq("enrollment_type", "subscription")`. It is physically impossible for the deactivation cron to deactivate an `enrollment_type = 'purchase'` row.

---

## 10. Security & Account-Ownership Audit

| Threat Vector | Mitigation in Place | Code Evidence | Evaluation |
| :--- | :--- | :--- | :--- |
| **Token Theft / Replay Attack** | `payments` table unique constraint & query check on `purchaseToken`. Rejects existing token for another student. | `verify-google-play-purchase/index.ts:199–220` | **Secure (Fail-Closed).** HTTP 409 Conflict returned. |
| **Cross-Account Purchase Sharing** | Google Play purchase records `obfuscatedExternalAccountId`. Server verifies `sha256(student_id)`. | `verify-google-play-purchase/index.ts:312–331` | **Secure (Cryptographically Verified).** Prevents User B from verifying User A's token. |
| **Fake Webhook Triggers** | RTDN webhook verifies Google OIDC Bearer token; treats notification purely as a trigger; queries Google Developer API for authoritative state. | `google-play-rtdn-webhook/index.ts:140–180, 240–270` | **Secure.** Attacker cannot spoof renewal or subscription status. |
| **Premature Cancellation Lockout** | `calculateRtdnTransition` preserves access when user cancels auto-renewal. Access remains active until `end_date`. | `google-play-rtdn-webhook/billingCore.ts:465–480` | **Compliant with Google Play Developer Policy.** |
| **Client-Side Pricing Tampering** | Edge Function ignores any pricing sent by client; looks up authoritative prices in `courses` and `subscription_plans` tables. | `verify-google-play-purchase/index.ts:400–415` | **Secure.** Client cannot alter purchase amount. |

---

## 11. Exact Files That Need Changes

To move from the current state to a fully seamless, production-ready subscription release, the following files will need enhancements (when implementation begins):

| File Path | Component | Current State | Required Change |
| :--- | :--- | :--- | :--- |
| `mocktest-admin/src/app/admin/courses/[id]/page.tsx` | Admin UI | Course view only shows one-time price. | Add a "Subscription Plans" tab/card showing active subscription plans for this course with an "Add Subscription Plan" quick-action. |
| `mocktest-admin/src/components/ui/SubscriptionPlanFormModal.tsx` | Admin UI | Creates plan in DB only. | Display the exact Google Play Product ID (`sub_<plan_hex>`) and Base Plan ID (`p1m`, `p1y`) so the admin can copy-paste them directly into Google Play Console. |
| `MockTestApp/src/screens/courses/CourseDetailScreen.tsx` | Mobile UI | Displays plans in a single list. | Enhance visual comparison between "Permanent Full Course Ownership" vs "Recurring Monthly/Annual Pass" so students clearly understand billing terms. |
| `MockTestApp/src/services/payment/playBillingService.ts` | Mobile Logic | `requestPurchase` and `resolveSubscriptionOffer` are fully written. | Add explicit telemetry for Google Play Billing Response Codes `BILLING_UNAVAILABLE`, `DEVELOPER_ERROR`, and `ITEM_ALREADY_OWNED` to aid debugging. |
| `MockTestApp/supabase/functions/verify-google-play-purchase/index.ts` | Backend | Verification code is complete. | Verify error recovery when Google Publisher API credentials expire or encounter rate limits. |

---

## 12. Phased Implementation Plan

```
  PHASE 1: GOOGLE CLOUD & PLAY CONSOLE PERMISSIONS (Prerequisite)
  ├── 1.1 Grant Financial & Subscription permissions to service account in Play Console.
  ├── 1.2 Verify HTTP 200 response from Google Android Publisher API via verify-google-play-purchase.
  └── 1.3 Confirm Pub/Sub topic and OIDC Push subscription to google-play-rtdn-webhook.

  PHASE 2: ADMIN PANEL USABILITY ENHANCEMENTS
  ├── 2.1 Add "Google Play SKU & Base Plan Helper" modal to SubscriptionPlanFormModal.
  ├── 2.2 Add linked Subscription Plans tab to Course Detail page (src/app/admin/courses/[id]).
  └── 2.3 Add validation warning in admin panel reminding admin to activate SKU in Play Console.

  PHASE 3: GOOGLE PLAY CONSOLE PRODUCT SEEDING
  ├── 3.1 Create Subscription Products in Play Console for all target courses (sub_<plan_hex>).
  ├── 3.2 Configure Base Plans (p1m = 1 month, p1y = 1 year) with 7-day grace period.
  └── 3.3 Create and activate default base-plan offers for all products.

  PHASE 4: ANDROID APP TESTING & REFINEMENT
  ├── 4.1 Internal testing release on Google Play (Internal Test Track).
  ├── 4.2 Validate license tester accounts with accelerated renewal cycles (5-minute renewals).
  ├── 4.3 Test purchase flow: CourseDetail -> Plan Selection -> Google Checkout -> Verification -> Unlock.
  └── 4.4 Verify UI reflects renewal date and management link (play.google.com/store/account/subscriptions).

  PHASE 5: LIFECYCLE & WEBHOOK INTEGRATION TESTING
  ├── 5.1 Test RTDN event: SUBSCRIPTION_RENEWED (verify end_date extension).
  ├── 5.2 Test RTDN event: SUBSCRIPTION_CANCELED (verify access persists until end_date).
  ├── 5.3 Test RTDN event: SUBSCRIPTION_IN_GRACE_PERIOD (verify grace status and access).
  ├── 5.4 Test RTDN event: SUBSCRIPTION_EXPIRED (verify course_enrollments.is_active = false).
  └── 5.5 Test Permanent Owner safety (verify lifetime purchasers never lose access).
```

---

## 13. Testing Requirements Before Release

| Test Case | Scenario | Expected Outcome | Verification Method |
| :--- | :--- | :--- | :--- |
| **TC-01** | Initial Subscription Purchase | Student purchases monthly pass; Google Play confirms; backend records order & subscription; course unlocks immediately. | Internal Test Track (License Tester). |
| **TC-02** | Simultaneous One-Time & Sub Options | Course shows both ₹4,999 (Lifetime) and ₹499 (Monthly). Student selects Monthly; pays ₹499; gets `enrollment_type = 'subscription'`. | Verify `course_enrollments` in Supabase. |
| **TC-03** | Auto-Renewal Cycle | Google Play charges renewal after 1 month (5 mins in test); RTDN sends `SUBSCRIPTION_RENEWED`; webhook updates `end_date`. | Check `subscription_history` table. |
| **TC-04** | User Cancellation | Student cancels auto-renew in Google Play; RTDN sends `SUBSCRIPTION_CANCELED`; app sets `is_auto_renew = false`; course remains unlocked until `end_date`. | Verify access retained before expiry. |
| **TC-05** | Grace Period & Recovery | Renewal payment fails; Google grants grace; RTDN sends `SUBSCRIPTION_IN_GRACE_PERIOD`; student fixes card; RTDN sends `SUBSCRIPTION_RECOVERED`. | Check `student_subscriptions.status = 'grace' -> 'active'`. |
| **TC-06** | Subscription Expiry | Grace period elapses; RTDN sends `SUBSCRIPTION_EXPIRED` or daily cron runs; course access locked; Full Course purchase prompt shown. | Verify `course_enrollments.is_active = false`. |
| **TC-07** | Permanent Owner Safety | Student with existing one-time purchase subscribes to monthly plan; cancels monthly plan; plan expires. | Verify student STILL HAS ACCESS via `is_permanent_course_owner`. |
| **TC-08** | Cross-Account Fraud Attempt | User A purchases on device; User B attempts to verify User A's token with User B's Supabase session. | Backend returns HTTP 403 Forbidden (`obfuscatedAccountId` mismatch). |
| **TC-09** | Replay Fraud Attempt | User attempts to submit the same purchase token twice under a different account. | Backend returns HTTP 409 Conflict. |
| **TC-10** | Offline / Delayed Verification | Device loses internet during checkout callback; user re-opens app; `restorePurchases` runs. | Unacknowledged purchase verified and unlocked. |

---

## 14. Unresolved Questions & External Configuration Dependencies

1. **Google Play Console Service Account Access:**
   - *Dependency:* Google Play Console account owner must grant Financial and Subscription permissions to `make-me-topper-play-billing@make-me-topper-play-billing.iam.gserviceaccount.com`.
   - *Status:* External verification required. Until this is completed in Google Play Console, API calls to `androidpublisher` will return HTTP 401.

2. **Google Cloud Pub/Sub Topic Association:**
   - *Dependency:* The Pub/Sub topic `projects/make-me-topper-play-billing/topics/play-billing-rtdn` must be linked to Google Play Console Monetization Setup, and the push subscription must target `https://ocolfottogbybitfpdqy.supabase.co/functions/v1/google-play-rtdn-webhook`.
   - *Status:* External verification required.

3. **Prepaid Plans vs Auto-Renewing Plans:**
   - *Question for Product Leadership:* Will Make Me Topper offer only auto-renewing subscriptions, or should fixed-duration prepaid plans (e.g. non-renewing 30-day crash course passes) also be supported? Currently, the implementation assumes auto-renewing base plans.
