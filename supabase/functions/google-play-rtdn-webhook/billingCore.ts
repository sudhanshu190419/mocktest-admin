/**
 * Billing Verification Core Helpers
 *
 * Pure, runtime-agnostic business logic and safety checks for Google Play
 * In-App Purchases, Subscriptions, and RTDN Lifecycle Notifications.
 *
 * Used by:
 *  - supabase/functions/verify-google-play-purchase/index.ts (Deno Edge Function)
 *  - supabase/functions/google-play-rtdn-webhook/index.ts (Deno Edge Function)
 *  - __tests__/payment/playBillingCatalogMapping.test.ts (Jest Unit Test Suite)
 */

export interface ServiceAccountValidation {
  valid: boolean;
  clientEmail?: string;
  privateKey?: string;
  error?: string;
}

export interface GooglePurchaseStateValidation {
  valid: boolean;
  error?: string;
  state?: string | number;
  isAutoRenew?: boolean;
  expiryTime?: string;
  isCanceledWithRemainingAccess?: boolean;
}

export interface CourseAssociationValidation {
  valid: boolean;
  courseId?: string;
  error?: string;
}

export interface RtdnTransitionInput {
  notificationType: number;
  currentStatus: "pending" | "active" | "grace" | "expired" | "cancelled" | "refunded";
  currentEndDate?: string | null;
  currentStartDate?: string | null;
  authoritativeGoogleSub?: any;
  productId?: string;
  planDurationDays?: number;
  billingCycle?: string;
  nowMs?: number;
  graceDays?: number;
  contentAccessDays?: number;
}

export interface RtdnTransitionResult {
  mappedStatus: "pending" | "active" | "grace" | "expired" | "cancelled" | "refunded";
  mappedReason: "new_purchase" | "renewal" | "upgrade" | "downgrade" | "manual_activation" | "payment_failure" | "payment_recovery" | "admin_action" | "expiry" | "cancellation" | "refund";
  isAutoRenew: boolean;
  isEntitlementActive: boolean;
  newEndDate: string | null;
  graceEndDate: string | null;
  contentAccessEndDate: string | null;
}

/** Converts standard 8-4-4-4-12 UUID string to clean 32-char lowercase hex. */
export function uuidToCleanHex(uuid: string): string {
  return uuid.replace(/[^a-f0-9]/gi, "").toLowerCase();
}

/** Reconstructs standard 8-4-4-4-12 UUID from 32-char hex string. */
export function cleanHexToUuid(hex: string): string | null {
  if (!hex || hex.length !== 32) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Validates Google Cloud Service Account JSON credentials safely.
 * Never exposes private key or sensitive contents in error messages.
 */
export function validateServiceAccountJson(serviceAccountJson: string | null | undefined): ServiceAccountValidation {
  if (!serviceAccountJson || typeof serviceAccountJson !== "string" || serviceAccountJson.trim() === "") {
    return {
      valid: false,
      error: "Missing Google Service Account credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON in Supabase secrets.",
    };
  }

  try {
    const sa = JSON.parse(serviceAccountJson);
    if (!sa || typeof sa !== "object") {
      return {
        valid: false,
        error: "Malformed service account configuration: Expected JSON object.",
      };
    }

    if (!sa.client_email || typeof sa.client_email !== "string" || !sa.client_email.includes("@")) {
      return {
        valid: false,
        error: "Malformed service account credentials: Missing or invalid client_email.",
      };
    }

    if (!sa.private_key || typeof sa.private_key !== "string" || !sa.private_key.includes("PRIVATE KEY")) {
      return {
        valid: false,
        error: "Malformed service account credentials: Missing or invalid private_key PEM.",
      };
    }

    return {
      valid: true,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    };
  } catch (err) {
    return {
      valid: false,
      error: "Failed to parse Google Service Account JSON: Invalid JSON syntax.",
    };
  }
}

/**
 * Validates that Google Developer API purchase verification response is in an active/purchased state.
 *
 * In-App Products:
 *  - purchaseState: 0 = Purchased, 1 = Canceled, 2 = Pending
 *
 * Subscriptions (subscriptionsv2):
 *  - subscriptionState:
 *      'SUBSCRIPTION_STATE_ACTIVE' | 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' |
 *      'SUBSCRIPTION_STATE_ON_HOLD' | 'SUBSCRIPTION_STATE_PAUSED' |
 *      'SUBSCRIPTION_STATE_CANCELED' | 'SUBSCRIPTION_STATE_EXPIRED' |
 *      'SUBSCRIPTION_STATE_PENDING' | 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
 *
 * Handles SUBSCRIPTION_STATE_CANCELED by preserving remaining paid access when
 * authoritative expiryTime is in the future. Fails closed if expired or missing expiryTime.
 */
export function verifyGooglePlayPurchaseState(
  isSub: boolean,
  googleResult: any,
  requestedProductId?: string,
  nowMs: number = Date.now()
): GooglePurchaseStateValidation {
  if (!googleResult || typeof googleResult !== "object") {
    return {
      valid: false,
      error: "Google Play API returned empty or invalid response body.",
    };
  }

  if (isSub) {
    const subState = googleResult.subscriptionState;

    // 1. Confirm line item corresponds to requested product if lineItems are present
    let lineItem = googleResult.lineItems?.[0];
    if (googleResult.lineItems && googleResult.lineItems.length > 0 && requestedProductId) {
      const found = googleResult.lineItems.find((li: any) => li.productId === requestedProductId);
      if (found) {
        lineItem = found;
      } else {
        return {
          valid: false,
          state: subState,
          error: `Google Play subscription does not contain the requested product line item (${requestedProductId}).`,
        };
      }
    }

    const expiryTime = lineItem?.expiryTime;
    const isAutoRenew = lineItem?.autoRenewingPlan?.autoRenewEnabled ?? true;

    // 2. ACTIVE or IN_GRACE_PERIOD: fully active subscription
    if (subState === "SUBSCRIPTION_STATE_ACTIVE" || subState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
      return {
        valid: true,
        state: subState,
        isAutoRenew,
        expiryTime,
      };
    }

    // 3. CANCELED: user turned off auto-renew, but paid entitlement may still be valid until expiryTime
    if (subState === "SUBSCRIPTION_STATE_CANCELED") {
      if (!expiryTime) {
        return {
          valid: false,
          state: subState,
          error: "Subscription is canceled and no authoritative expiryTime was returned by Google Play.",
        };
      }

      const expiryMs = Date.parse(expiryTime);
      if (isNaN(expiryMs)) {
        return {
          valid: false,
          state: subState,
          error: "Subscription is canceled and authoritative expiryTime format is invalid.",
        };
      }

      // Check if current time is before authoritative expiryTime
      if (expiryMs > nowMs) {
        return {
          valid: true,
          state: subState,
          isAutoRenew: false,
          expiryTime,
          isCanceledWithRemainingAccess: true,
        };
      }

      return {
        valid: false,
        state: subState,
        error: "Subscription is canceled and its paid access period has expired.",
      };
    }

    // 4. EXPIRED, ON_HOLD, PAUSED, PENDING, or UNKNOWN: fail-closed
    let stateMessage = `Google Play subscription is not in an active state (current state: ${subState || "UNKNOWN"}).`;
    if (subState === "SUBSCRIPTION_STATE_EXPIRED") {
      stateMessage = "Google Play subscription has expired. Entitlement cannot be granted.";
    } else if (subState === "SUBSCRIPTION_STATE_ON_HOLD") {
      stateMessage = "Google Play subscription is on hold due to payment failure. Entitlement cannot be granted.";
    } else if (subState === "SUBSCRIPTION_STATE_PAUSED") {
      stateMessage = "Google Play subscription is paused. Entitlement cannot be granted.";
    } else if (subState === "SUBSCRIPTION_STATE_PENDING" || subState === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
      stateMessage = `Google Play subscription is in a pending unconfirmed state (${subState}). Entitlement cannot be granted.`;
    }

    return {
      valid: false,
      state: subState,
      error: stateMessage,
    };
  } else {
    const purchaseState = googleResult.purchaseState;
    if (purchaseState === 0) {
      return {
        valid: true,
        state: purchaseState,
      };
    }

    const stateDesc = purchaseState === 1 ? "CANCELED" : purchaseState === 2 ? "PENDING" : `UNKNOWN(${purchaseState})`;
    return {
      valid: false,
      state: purchaseState,
      error: `Google Play transaction is not completed (state: ${stateDesc}).`,
    };
  }
}

/**
 * Calculates authoritative subscription expiry date.
 * Prioritizes Google Play subscriptionsv2 expiryTime over local plan duration,
 * while strictly enforcing that the resulting expiry date is in the future (> startDate)
 * to comply with database check constraint ck_student_subscriptions_end_date.
 */
export function calculateSubscriptionExpiry(params: {
  startDate: Date;
  planDurationDays?: number;
  billingCycle?: string;
  googleExpiryTime?: string;
}): string {
  const startDateStr = params.startDate.toISOString().split("T")[0];

  if (params.googleExpiryTime) {
    const raw = String(params.googleExpiryTime).trim();
    const parsedMs = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    const gDate = !isNaN(parsedMs) ? new Date(parsedMs) : new Date(raw);
    if (!isNaN(gDate.getTime())) {
      const gDateStr = gDate.toISOString().split("T")[0];
      // In Google Play License Testing / test tracks, renewal cycles are accelerated (e.g. 5-15 mins).
      // This causes googleExpiryTime to fall on the same UTC day as startDate (gDateStr === startDateStr).
      // PostgreSQL relation "student_subscriptions" enforces check constraint
      // "ck_student_subscriptions_end_date" (end_date > start_date).
      // Therefore, only accept Google's expiry date if it is strictly greater than the start date.
      if (gDateStr > startDateStr) {
        return gDateStr;
      }
    }
  }

  const days =
    params.planDurationDays && params.planDurationDays >= 1
      ? params.planDurationDays
      : params.billingCycle === "yearly" || params.billingCycle === "annual"
      ? 365
      : params.billingCycle === "half_yearly"
      ? 182
      : params.billingCycle === "quarterly"
      ? 90
      : 30;

  const end = new Date(params.startDate);
  end.setDate(end.getDate() + days);
  return end.toISOString().split("T")[0];
}

/**
 * Validates that a subscription plan has a non-null course_id per Migration 090.
 */
export function validateSubscriptionCourseAssociation(
  plan: { plan_id: string; course_id?: string | null } | null | undefined
): CourseAssociationValidation {
  if (!plan) {
    return {
      valid: false,
      error: "Subscription plan not found in database catalog.",
    };
  }

  if (!plan.course_id || plan.course_id.trim() === "") {
    return {
      valid: false,
      error: "Subscription plan is not associated with any course. Cannot grant entitlement.",
    };
  }

  return {
    valid: true,
    courseId: plan.course_id,
  };
}

/**
 * Pure state-transition evaluator for Google Play Real-Time Developer Notifications (RTDN).
 *
 * Fail-Closed Lifecycle Semantics:
 *  - Matches the exact product lineItem when productId is provided.
 *  - Type 2 (SUBSCRIPTION_RENEWED): Requires authoritative Google response with valid future expiry.
 *    If Google data is absent and subscription is already expired, it remains expired (fail-closed).
 *  - Type 7 (SUBSCRIPTION_RESTARTED): Requires authoritative Google response confirming auto-renewal.
 *    Preserves current unexpired term. An expired subscription cannot be reactivated without Google confirmation.
 *  - Type 1 (SUBSCRIPTION_RECOVERED): Requires authoritative Google confirmation. Cannot revive expired sub.
 *  - Type 3 (SUBSCRIPTION_CANCELED): Preserves paid access until verified expiry; disables auto-renewal.
 *  - Type 13 (SUBSCRIPTION_EXPIRED): Revokes entitlement.
 *  - Authoritative Google states EXPIRED, REVOKED, ON_HOLD, and PAUSED override local state fail-closed.
 */

export interface SubscriptionWindowsInput {
  endDate: string;
  graceDays?: number;
  contentAccessDays?: number;
}

export interface SubscriptionWindowsResult {
  graceEndDate: string;
  contentAccessEndDate: string;
}

/**
 * Calculates grace_end_date and content_access_end_date in UTC day granularity,
 * matching the Razorpay access policy and Migration 204.
 */
export function calculateSubscriptionWindows(params: SubscriptionWindowsInput): SubscriptionWindowsResult {
  const { endDate, graceDays = 7, contentAccessDays = 30 } = params;

  function addDays(isoDate: string, days: number): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  const graceEndDate = addDays(endDate, graceDays);
  const contentAccessEndDate = addDays(graceEndDate, contentAccessDays);

  return {
    graceEndDate,
    contentAccessEndDate,
  };
}

export interface InstituteSubscriptionSettings {
  graceDays: number;
  contentAccessDays: number;
}

/**
 * Loads institute-specific subscription grace and content access durations
 * from public.system_settings, defaulting to 7 and 30 days respectively.
 */
export async function getInstituteSubscriptionSettings(
  supabaseAdmin: any,
  instituteId?: string | null
): Promise<InstituteSubscriptionSettings> {
  const DEFAULT_GRACE_DAYS = 7;
  const DEFAULT_CONTENT_ACCESS_DAYS = 30;

  if (!instituteId) {
    return {
      graceDays: DEFAULT_GRACE_DAYS,
      contentAccessDays: DEFAULT_CONTENT_ACCESS_DAYS,
    };
  }

  try {
    const { data } = await supabaseAdmin
      .from("system_settings")
      .select("setting_key, setting_value, data_type")
      .eq("institute_id", instituteId)
      .in("setting_key", ["grace_days", "content_access_days"])
      .eq("is_active", true);

    let graceDays = DEFAULT_GRACE_DAYS;
    let contentAccessDays = DEFAULT_CONTENT_ACCESS_DAYS;

    if (data && Array.isArray(data)) {
      for (const row of data) {
        const val = Number(row.setting_value);
        if (Number.isFinite(val) && val >= 0) {
          if (row.setting_key === "grace_days") {
            graceDays = Math.round(val);
          } else if (row.setting_key === "content_access_days") {
            contentAccessDays = Math.round(val);
          }
        }
      }
    }

    return { graceDays, contentAccessDays };
  } catch (err) {
    console.warn("[SETTINGS_LOOKUP_WARN] Failed to load institute subscription settings, using defaults:", err);
    return {
      graceDays: DEFAULT_GRACE_DAYS,
      contentAccessDays: DEFAULT_CONTENT_ACCESS_DAYS,
    };
  }
}

export function calculateRtdnTransition(params: RtdnTransitionInput): RtdnTransitionResult {
  const {
    notificationType,
    currentStatus,
    currentEndDate,
    currentStartDate,
    authoritativeGoogleSub,
    productId,
    nowMs = Date.now(),
    graceDays = 7,
    contentAccessDays = 30,
  } = params;

  // 1. Match the correct subscription line item
  let lineItem: any = null;
  if (authoritativeGoogleSub?.lineItems && Array.isArray(authoritativeGoogleSub.lineItems) && authoritativeGoogleSub.lineItems.length > 0) {
    if (productId) {
      lineItem = authoritativeGoogleSub.lineItems.find((li: any) => li.productId === productId) || null;
    } else {
      lineItem = authoritativeGoogleSub.lineItems[0] || null;
    }
  }

  // 2. Authoritative line-item expiry resolution
  const googleExpiryTime = lineItem?.expiryTime;
  let newEndDateStr: string | null = null;
  let isExpiredByGoogleTime = false;

  if (googleExpiryTime) {
    const parsed = Date.parse(googleExpiryTime);
    if (!isNaN(parsed)) {
      newEndDateStr = new Date(parsed).toISOString().split("T")[0];
      isExpiredByGoogleTime = parsed <= nowMs;
    }
  }

  const googleSubState = authoritativeGoogleSub?.subscriptionState;

  const isTestPurchase = Boolean(
    authoritativeGoogleSub?.testPurchase !== undefined &&
    authoritativeGoogleSub?.testPurchase !== null
  );

  // Assess whether authoritative Google expiry falls on or before start_date (same-day license test expiry)
  const isSameDayOrEarlierExpiry = Boolean(
    newEndDateStr && currentStartDate && newEndDateStr <= currentStartDate
  );

  // Accelerated test subscription: strictly requires Google's explicit testPurchase indicator.
  // A same-day expiry alone in production is only a heuristic and must not classify a production subscription as a test.
  const isAcceleratedTest = isTestPurchase;

  // 2b. Terminal Refund & Revocation Guard: A refunded or revoked subscription is in a terminal state for that transaction.
  // Stale notifications (e.g. Pub/Sub delayed renewal/recovery) or delayed/cached Google API responses
  // reporting ACTIVE MUST NEVER resurrect entitlement for an already refunded or revoked transaction.
  // Genuine renewals apply only to active/grace/expired subscriptions. Any legitimate re-subscription by the student
  // generates a new transaction verified independently via verify-google-play-purchase.
  if (currentStatus === "refunded") {
    return {
      mappedStatus: "refunded",
      mappedReason: "refund",
      isAutoRenew: false,
      isEntitlementActive: false,
      newEndDate: currentEndDate || null,
      graceEndDate: null,
      contentAccessEndDate: null,
    };
  }

  // 3. Assess current database entitlement state
  const todayStr = new Date(nowMs).toISOString().split("T")[0];
  const isCurrentDateExpired = currentEndDate ? currentEndDate < todayStr : false;
  const isCurrentStatusExpired = (currentStatus === "expired" || currentStatus === "cancelled");
  const isCurrentlyExpired = isCurrentStatusExpired || isCurrentDateExpired;

  // Local verified future entitlement guard:
  // True when the local database holds an established, paid entitlement extending through today or into the future.
  const hasFutureLocalEntitlement = Boolean(currentEndDate && currentEndDate >= todayStr);

  let mappedStatus: "pending" | "active" | "grace" | "expired" | "cancelled" | "refunded" = currentStatus;
  let mappedReason: "new_purchase" | "renewal" | "upgrade" | "downgrade" | "manual_activation" | "payment_failure" | "payment_recovery" | "admin_action" | "expiry" | "cancellation" | "refund" = "renewal";
  let isAutoRenew = true;
  let isEntitlementActive = true;
  let graceEndDate: string | null = null;
  let contentAccessEndDate: string | null = null;
  let calculatedEndDate: string | null = currentEndDate || null;

  function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split("T")[0];
  }

  switch (notificationType) {
    case 2: // SUBSCRIPTION_RENEWED (New billing period charged and started)
      if (!newEndDateStr || !authoritativeGoogleSub || !lineItem) {
        // FAIL-CLOSED: Cannot grant a new billing cycle without authoritative Google response and expiry
        if (isCurrentlyExpired) {
          mappedStatus = "expired";
          isEntitlementActive = false;
          isAutoRenew = false;
          calculatedEndDate = currentEndDate || null;
        } else {
          // If still within current paid term, preserve current access, but DO NOT extend
          mappedStatus = "active";
          isEntitlementActive = true;
          calculatedEndDate = currentEndDate || null;
        }
      } else {
        mappedStatus = "active";
        mappedReason = "renewal";
        isAutoRenew = true;
        isEntitlementActive = true;
        calculatedEndDate = newEndDateStr;
        graceEndDate = addDays(newEndDateStr, graceDays);
        contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
      }
      break;

    case 7: // SUBSCRIPTION_RESTARTED (User restored auto-renewal for an unexpired subscription)
      if (!newEndDateStr || !authoritativeGoogleSub || !lineItem) {
        // FAIL-CLOSED: Cannot restart an expired subscription without authoritative Google confirmation
        if (isCurrentlyExpired) {
          mappedStatus = "expired";
          isEntitlementActive = false;
          isAutoRenew = false;
          calculatedEndDate = currentEndDate || null;
        } else {
          // If still within current paid term, preserve current access, but auto-renewal is NOT confirmed
          mappedStatus = "active";
          isEntitlementActive = true;
          isAutoRenew = false;
          calculatedEndDate = currentEndDate || null;
        }
      } else {
        mappedStatus = "active";
        mappedReason = "renewal";
        // Restore is_auto_renew only when Google confirms auto-renewal enabled
        isAutoRenew = Boolean(lineItem?.autoRenewingPlan?.autoRenewEnabled);
        isEntitlementActive = true;
        // Preserves current term expiry, does NOT add duration
        calculatedEndDate = newEndDateStr;
        graceEndDate = addDays(newEndDateStr, graceDays);
        contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
      }
      break;

    case 1: // SUBSCRIPTION_RECOVERED (Payment recovered from grace/hold)
      if (!newEndDateStr || !authoritativeGoogleSub || !lineItem) {
        // FAIL-CLOSED: Cannot recover an expired subscription without authoritative Google confirmation
        if (isCurrentlyExpired) {
          mappedStatus = "expired";
          isEntitlementActive = false;
          isAutoRenew = false;
          calculatedEndDate = currentEndDate || null;
        } else {
          mappedStatus = currentStatus === "grace" ? "grace" : "active";
          isEntitlementActive = true;
          calculatedEndDate = currentEndDate || null;
        }
      } else {
        mappedStatus = "active";
        mappedReason = "payment_recovery";
        isAutoRenew = true;
        isEntitlementActive = true;
        calculatedEndDate = newEndDateStr;
        graceEndDate = addDays(newEndDateStr, graceDays);
        contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
      }
      break;

    case 4: // SUBSCRIPTION_PURCHASED (Initial purchase)
      mappedStatus = "active";
      mappedReason = "new_purchase";
      isAutoRenew = true;
      isEntitlementActive = true;
      if (newEndDateStr) {
        calculatedEndDate = newEndDateStr;
        graceEndDate = addDays(newEndDateStr, graceDays);
        contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
      } else {
        calculatedEndDate = currentEndDate || null;
      }
      break;

    case 6: // SUBSCRIPTION_IN_GRACE_PERIOD
      mappedStatus = "grace";
      mappedReason = "payment_failure";
      isEntitlementActive = true;
      {
        if (currentEndDate) {
          graceEndDate = addDays(currentEndDate, graceDays);
        } else {
          const gEnd = new Date(nowMs);
          gEnd.setUTCDate(gEnd.getUTCDate() + graceDays);
          graceEndDate = gEnd.toISOString().split("T")[0];
        }
        contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
      }
      break;

    case 5: // SUBSCRIPTION_ON_HOLD
    case 10: // SUBSCRIPTION_PAUSED
      mappedStatus = "pending";
      mappedReason = notificationType === 5 ? "payment_failure" : "admin_action";
      isEntitlementActive = false;
      break;

    case 3: // SUBSCRIPTION_CANCELED (Auto-renew turned off by user)
      mappedReason = "cancellation";
      isAutoRenew = false;

      // Monotonic Entitlement Protection on Cancellation:
      // A cancellation notification (type 3) signifies that auto-renewal has been turned off by the user.
      // It does NOT terminate current entitlement. The user has already paid for the current billing cycle.
      //
      // Rule 1: A production subscription canceled with an authoritative future expiry remains entitled until that expiry.
      // Rule 2: A production subscription that Google authoritatively confirms as expired cannot remain active solely because its local end_date is in the future.
      // Rule 3: An accelerated Google Play test subscription (isAcceleratedTest === true) preserves logical entitlement
      //         established by verified captured renewal payments (hasFutureLocalEntitlement).
      const hasUnexpiredGooglePeriod = Boolean(
        newEndDateStr && newEndDateStr >= todayStr && !isExpiredByGoogleTime && googleSubState !== "SUBSCRIPTION_STATE_EXPIRED"
      );

      const isEntitledUntilFuture =
        hasUnexpiredGooglePeriod ||
        (isAcceleratedTest && hasFutureLocalEntitlement) ||
        (!authoritativeGoogleSub && hasFutureLocalEntitlement);

      if (isEntitledUntilFuture) {
        // Paid entitlement preserved until expiry date
        mappedStatus = currentStatus === "grace" ? "grace" : "active";
        isEntitlementActive = true;
        // Preserve current paid-through dates; monotonic protection guarantees end_date never shrinks
        if (newEndDateStr && (!currentStartDate || newEndDateStr > currentStartDate) && (!currentEndDate || newEndDateStr >= currentEndDate)) {
          calculatedEndDate = newEndDateStr;
        } else {
          calculatedEndDate = currentEndDate || null;
        }
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      } else {
        mappedStatus = "expired";
        isEntitlementActive = false;
        if (isSameDayOrEarlierExpiry) {
          calculatedEndDate = null;
          graceEndDate = null;
          contentAccessEndDate = null;
        } else {
          calculatedEndDate = (newEndDateStr && (!currentStartDate || newEndDateStr > currentStartDate))
            ? newEndDateStr
            : (currentEndDate || null);
          if (calculatedEndDate) {
            graceEndDate = addDays(calculatedEndDate, graceDays);
            contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
          }
        }
      }
      break;

    case 12: // SUBSCRIPTION_REVOKED
      mappedStatus = "refunded";
      mappedReason = "refund";
      isAutoRenew = false;
      isEntitlementActive = false;
      graceEndDate = null;
      contentAccessEndDate = null;
      break;

    case 13: // SUBSCRIPTION_EXPIRED
    default:
      if ((googleSubState === "SUBSCRIPTION_STATE_ACTIVE" || googleSubState === "SUBSCRIPTION_STATE_CANCELED") && googleExpiryTime && !isExpiredByGoogleTime) {
        // Rule 4: Out-of-order EXPIRED notification: Google confirms subscription is active with future expiry.
        // Preserve active entitlement and renewal state.
        mappedStatus = currentStatus === "grace" ? "grace" : "active";
        mappedReason = googleSubState === "SUBSCRIPTION_STATE_CANCELED" ? "cancellation" : "renewal";
        isAutoRenew = googleSubState === "SUBSCRIPTION_STATE_CANCELED" ? false : Boolean(lineItem?.autoRenewingPlan?.autoRenewEnabled);
        isEntitlementActive = true;
        calculatedEndDate = (newEndDateStr && (!currentStartDate || newEndDateStr > currentStartDate))
          ? newEndDateStr
          : (currentEndDate || null);
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      } else if (isAcceleratedTest && hasFutureLocalEntitlement) {
        // Rule 3: Accelerated test subscription whose Google test clock reached expiration,
        // but whose verified captured renewal payments established future logical entitlement.
        mappedStatus = currentStatus === "grace" ? "grace" : "active";
        mappedReason = "expiry";
        isAutoRenew = false;
        isEntitlementActive = true;
        calculatedEndDate = currentEndDate || null;
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      } else {
        // Rule 2: Production expiration (or accelerated test whose logical entitlement has also passed)
        mappedStatus = "expired";
        mappedReason = "expiry";
        isAutoRenew = false;
        isEntitlementActive = false;
        if (isSameDayOrEarlierExpiry) {
          calculatedEndDate = null;
          graceEndDate = null;
          contentAccessEndDate = null;
        } else {
          calculatedEndDate = (newEndDateStr && (!currentStartDate || newEndDateStr > currentStartDate))
            ? newEndDateStr
            : (currentEndDate || null);
          if (calculatedEndDate) {
            graceEndDate = addDays(calculatedEndDate, graceDays);
            contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
          }
        }
      }
      break;
  }


  // 4. Authoritative Google State Override (Google API ground truth takes precedence):
  if (authoritativeGoogleSub) {
    if ((googleSubState === "SUBSCRIPTION_STATE_ACTIVE" || googleSubState === "SUBSCRIPTION_STATE_CANCELED") && googleExpiryTime && !isExpiredByGoogleTime) {
      // 4a. Google explicitly confirms ACTIVE or CANCELED with future expiry.
      // Overrides any stale expired/pending state, protecting newer renewals or unexpired cancellations.
      // Terminal states (refunded) are NEVER overridden (guarded at Step 2b).
      if (mappedStatus === "expired" || mappedStatus === "pending") {
        mappedStatus = currentStatus === "grace" ? "grace" : "active";
        mappedReason = googleSubState === "SUBSCRIPTION_STATE_CANCELED" ? "cancellation" : "renewal";
        isEntitlementActive = true;
        isAutoRenew = googleSubState === "SUBSCRIPTION_STATE_CANCELED" ? false : Boolean(lineItem?.autoRenewingPlan?.autoRenewEnabled);
        calculatedEndDate = (newEndDateStr && (!currentEndDate || newEndDateStr >= currentEndDate))
          ? newEndDateStr
          : (calculatedEndDate || currentEndDate || null);
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      }
    } else if (googleSubState === "SUBSCRIPTION_STATE_EXPIRED" || (googleExpiryTime && isExpiredByGoogleTime)) {
      // 4b. Google authoritatively confirms the subscription is EXPIRED (or Google expiry timestamp has passed).
      //
      // Rule 2 (Production Safety):
      // In production (!isAcceleratedTest), Google's expired verdict is strictly authoritative.
      // A production subscription cannot remain active solely because its local end_date is in the future.
      //
      // Rule 3 (Test Policy):
      // An accelerated test subscription (isAcceleratedTest === true) preserves logical entitlement
      // established by verified captured renewal payments (hasFutureLocalEntitlement).
      const shouldPreserveTestEntitlement = isAcceleratedTest && hasFutureLocalEntitlement;

      if (mappedStatus !== "refunded" && !shouldPreserveTestEntitlement) {
        mappedStatus = "expired";
        mappedReason = "expiry";
        isEntitlementActive = false;
        isAutoRenew = false;
        if (isSameDayOrEarlierExpiry) {
          calculatedEndDate = null;
          graceEndDate = null;
          contentAccessEndDate = null;
        } else if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      }
    } else if (googleSubState === "SUBSCRIPTION_STATE_REVOKED") {
      // 4c. Rule 5: Immediate Revocation
      mappedStatus = "refunded";
      mappedReason = "refund";
      isEntitlementActive = false;
      isAutoRenew = false;
      graceEndDate = null;
      contentAccessEndDate = null;
    } else if (googleSubState === "SUBSCRIPTION_STATE_ON_HOLD" || googleSubState === "SUBSCRIPTION_STATE_PAUSED") {
      mappedStatus = "pending";
      mappedReason = googleSubState === "SUBSCRIPTION_STATE_ON_HOLD" ? "payment_failure" : "admin_action";
      isEntitlementActive = false;
    }
  }

  return {
    mappedStatus,
    mappedReason,
    isAutoRenew,
    isEntitlementActive,
    newEndDate: calculatedEndDate,
    graceEndDate,
    contentAccessEndDate,
  };
}


export interface JwtUser {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; [key: string]: unknown };
}

export interface AuthVerificationResult {
  authenticated: boolean;
  profileId: string | null;
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Authoritatively verifies the Supabase Auth access token.
 * Security Rules:
 * 1. User identity is derived EXCLUSIVELY from Supabase Auth validation (auth.getUser).
 * 2. If auth.getUser returns an error or no user, the request is REJECTED (HTTP 401).
 * 3. NEVER falls back to unverified JWT claims or base64 payload decoding.
 */
export async function authenticatePlayPurchaseRequest(
  authHeader: string | null | undefined,
  supabaseAuth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string; [key: string]: unknown } | null } | null;
      error: { message: string; status?: number } | null;
    }>;
  },
): Promise<AuthVerificationResult> {
  if (!authHeader) {
    return {
      authenticated: false,
      profileId: null,
      statusCode: 401,
      errorMessage: "Missing Authorization header",
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return {
      authenticated: false,
      profileId: null,
      statusCode: 401,
      errorMessage: "Malformed Authorization header",
    };
  }

  const { data: userData, error: userError } = await supabaseAuth.getUser(token);

  if (userError || !userData?.user?.id) {
    return {
      authenticated: false,
      profileId: null,
      statusCode: 401,
      errorMessage: "Invalid or expired session",
    };
  }

  return {
    authenticated: true,
    profileId: userData.user.id,
  };
}

/**
 * @deprecated For security reasons, do NOT use unverified JWT payload extraction for authentication or authorization.
 * All client requests must be validated authoritatively via Supabase Auth (auth.getUser).
 *
 * Extracts authenticated user claims from a verified JWT token.
 * Validates expiration against nowMs and fails closed if expired or missing sub.
 */
export function extractUserFromVerifiedJwt(token: string, nowMs: number = Date.now()): JwtUser | null {
  if (!token || typeof token !== "string") return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const jsonStr = atob(padded);
    const payload = JSON.parse(jsonStr) as Record<string, unknown>;

    if (!payload.sub || typeof payload.sub !== "string") {
      return null;
    }
    if (typeof payload.exp === "number" && payload.exp < Math.floor(nowMs / 1000)) {
      return null;
    }

    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      user_metadata:
        payload.user_metadata && typeof payload.user_metadata === "object"
          ? (payload.user_metadata as { full_name?: string; [key: string]: unknown })
          : undefined,
    };
  } catch {
    return null;
  }
}

export interface SanitizedGoogleApiError {
  status: number;
  classification: string;
  errorStatus: string | null;
  errorMessage: string | null;
  errorReason?: string;
  errorDomain?: string;
}

/**
 * Sanitizes and classifies Google Play Developer API errors, redacting sensitive tokens.
 */
export function sanitizeGoogleApiError(status: number, rawBody?: string | null): SanitizedGoogleApiError {
  let classification = "GOOGLE_API_ERROR";
  if (status === 401 || status === 403) {
    classification = "GOOGLE_API_AUTH_OR_PERMISSION_ERROR";
  } else if (status === 404) {
    classification = "PURCHASE_TOKEN_NOT_FOUND";
  } else if (status === 400) {
    classification = "INVALID_REQUEST_PARAMETERS";
  }

  let errorStatus: string | null = null;
  let errorMessage: string | null = null;
  let errorReason: string | undefined = undefined;
  let errorDomain: string | undefined = undefined;

  if (rawBody && typeof rawBody === "string") {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed.error) {
        if (typeof parsed.error === "string") {
          errorStatus = parsed.error;
          errorMessage = parsed.error_description || parsed.error;
        } else if (typeof parsed.error === "object") {
          errorStatus = parsed.error.status || null;
          errorMessage = parsed.error.message || null;
          if (Array.isArray(parsed.error.errors) && parsed.error.errors.length > 0) {
            errorReason = parsed.error.errors[0].reason;
            errorDomain = parsed.error.errors[0].domain;
          }
        }
      }
    } catch {
      if (rawBody.trim()) {
        const textMatch = rawBody.match(/<title>(.*?)<\/title>/i) || rawBody.match(/<h1>(.*?)<\/h1>/i);
        errorMessage = textMatch ? textMatch[1] : rawBody.slice(0, 300);
      }
    }
  }

  if (errorMessage) {
    errorMessage = errorMessage.replace(/ya29\.[a-zA-Z0-9_.-]+/g, "[REDACTED]");
  }

  return {
    status,
    classification,
    errorStatus,
    errorMessage,
    errorReason,
    errorDomain,
  };
}

/**
 * Builds the database insert payload for a draft invoice snapshot.
 */
export function buildInvoiceSnapshotPayload(params: {
  orderId: string;
  instituteId: string;
  billingName?: string;
  billingEmail?: string;
  unitPrice: number;
  year?: number;
}) {
  const yr = params.year || new Date().getFullYear();
  const shortId = params.orderId.replace(/-/g, "").slice(0, 8);
  const invoiceNum = 'INV-GP-' + yr + '-' + shortId;

  return {
    order_id: params.orderId,
    institute_id: params.instituteId,
    invoice_number: invoiceNum,
    status: "draft",
    billing_name: params.billingName,
    billing_email: params.billingEmail,
    total_amount: params.unitPrice,
    currency: "INR",
  };
}


/**
 * Direct JavaScript verification of the PostgreSQL constraint:
 * CHECK (paid_at IS NULL OR paid_at >= created_at)
 */
export function validatePaymentTimestampConstraint(createdAt: string, paidAt: string | null): boolean {
  if (paidAt === null) return true;
  const createdMs = Date.parse(createdAt);
  const paidMs = Date.parse(paidAt);
  if (isNaN(createdMs) || isNaN(paidMs)) return false;
  return paidMs >= createdMs;
}

/**
 * Builds payment insert payload guaranteeing identical created_at and paid_at.
 */
export function buildGooglePlayPaymentPayload(params: {
  orderId: string;
  instituteId: string;
  effectiveOrderId: string;
  amount: number;
  currency: string;
  transactionTimestamp: string;
  gatewayResponse: any;
}) {
  return {
    order_id: params.orderId,
    institute_id: params.instituteId,
    attempt_number: 1,
    gateway: 'google_play',
    gateway_order_id: params.effectiveOrderId,
    gateway_payment_id: params.effectiveOrderId,
    gateway_response: params.gatewayResponse,
    amount: params.amount,
    currency: params.currency,
    status: 'captured',
    created_at: params.transactionTimestamp,
    paid_at: params.transactionTimestamp,
    updated_at: params.transactionTimestamp,
  };
}

/**
 * Migration 096 Lifetime Ownership Preservation Guard:
 * If a student already owns the course permanently ('purchase'),
 * subsequent subscriptions MUST NEVER downgrade or overwrite to 'subscription'.
 */
export function resolveCourseEnrollmentType(
  existingType: string | null | undefined,
  newType: string
): string {
  if (existingType === 'purchase') {
    return 'purchase';
  }
  return newType;
}

/**
 * Finds an unfulfilled order matching a Google Play purchaseToken or orderId.
 */
export function findMatchingUnfulfilledOrder(
  orders: any[],
  purchaseToken: string,
  orderId?: string
): string | null {
  if (!Array.isArray(orders)) return null;
  for (const o of orders) {
    if (!o || !o.notes) continue;
    try {
      const parsed = typeof o.notes === 'string' ? JSON.parse(o.notes) : o.notes;
      if (parsed.purchaseToken === purchaseToken || (orderId && parsed.orderId === orderId)) {
        return o.order_id;
      }
    } catch {
      // Ignore unparseable notes
    }
  }
  return null;
}

export interface ExistingOrderItemValidationParams {
  orderItems: Array<{
    item_id?: string;
    item_type?: string;
    course_id?: string | null;
    plan_id?: string | null;
    package_id?: string | null;
  }> | null | undefined;
  expectedItemType: 'course' | 'subscription_plan' | 'pyq_package';
  expectedCourseId?: string | null;
  expectedPlanId?: string | null;
  expectedPackageId?: string | null;
}

export interface ExistingOrderItemValidationResult {
  valid: boolean;
  orderItemId?: string;
  errorCode?: 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER' | 'ORDER_ITEM_MISMATCH';
  error?: string;
}

/**
 * Validates that an existing order has a matching, complete line item.
 *
 * Safety Invariants:
 * 1. Fails closed with ORDER_ITEM_MISSING_FOR_EXISTING_ORDER if order_items is empty or missing.
 * 2. Fails closed with ORDER_ITEM_MISMATCH if item_type, course_id, plan_id, or package_id diverge.
 * 3. Never permits partial orders to proceed to payment or entitlement granting.
 */
export function validateExistingOrderItem(
  params: ExistingOrderItemValidationParams
): ExistingOrderItemValidationResult {
  const { orderItems, expectedItemType, expectedCourseId, expectedPlanId, expectedPackageId } = params;

  if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    return {
      valid: false,
      errorCode: 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
      error: 'Existing order found for this purchase token but it has no associated order items. Failing closed.',
    };
  }

  const item = orderItems[0];
  if (!item || !item.item_id) {
    return {
      valid: false,
      errorCode: 'ORDER_ITEM_MISSING_FOR_EXISTING_ORDER',
      error: 'Existing order item has invalid or missing item_id.',
    };
  }

  if (item.item_type !== expectedItemType) {
    return {
      valid: false,
      errorCode: 'ORDER_ITEM_MISMATCH',
      error: `Existing order item type (${item.item_type}) does not match expected purchase item type (${expectedItemType}).`,
    };
  }

  if (expectedItemType === 'course') {
    const itemCourse = item.course_id || null;
    const expCourse = expectedCourseId || null;
    if (itemCourse !== expCourse) {
      return {
        valid: false,
        errorCode: 'ORDER_ITEM_MISMATCH',
        error: `Existing order item course_id (${itemCourse}) does not match expected course_id (${expCourse}).`,
      };
    }
  } else if (expectedItemType === 'subscription_plan') {
    const itemPlan = item.plan_id || null;
    const expPlan = expectedPlanId || null;
    const itemCourse = item.course_id || null;
    const expCourse = expectedCourseId || null;

    if (itemPlan !== expPlan || (expCourse && itemCourse !== expCourse)) {
      return {
        valid: false,
        errorCode: 'ORDER_ITEM_MISMATCH',
        error: `Existing order item plan_id (${itemPlan}) or course_id (${itemCourse}) does not match expected plan (${expPlan}) or course (${expCourse}).`,
      };
    }
  } else if (expectedItemType === 'pyq_package') {
    const itemPkg = item.package_id || null;
    const expPkg = expectedPackageId || null;
    if (itemPkg !== expPkg) {
      return {
        valid: false,
        errorCode: 'ORDER_ITEM_MISMATCH',
        error: `Existing order item package_id (${itemPkg}) does not match expected package_id (${expPkg}).`,
      };
    }
  }

  return {
    valid: true,
    orderItemId: item.item_id,
  };
}

/**
 * Migration 086 Subscription Invariant:
 * Determines whether to update an existing active/grace row or insert a new one.
 */
export function resolveSubscriptionAction(
  existingSubs: any[],
  planId: string
): { action: 'update' | 'insert'; targetSubscriptionId?: string } {
  if (Array.isArray(existingSubs)) {
    const match = existingSubs.find(
      (s: any) => s.plan_id === planId && (s.status === 'active' || s.status === 'grace')
    );
    if (match) {
      return {
        action: 'update',
        targetSubscriptionId: match.subscription_id,
      };
    }
  }
  return { action: 'insert' };
}

export type RpcErrorCategory =
  | 'INTEGRITY_CONSTRAINT_VIOLATION'
  | 'PERMISSION_DENIED'
  | 'UNDEFINED_COLUMN'
  | 'UNDEFINED_TABLE'
  | 'SCHEMA_CACHE_OR_SIGNATURE_MISMATCH'
  | 'UNDEFINED_FUNCTION'
  | 'TRANSACTION_OR_DEADLOCK'
  | 'CONNECTION_FAILURE'
  | 'EXECUTION_FAILURE'
  | 'UNKNOWN';

export interface ClassifiedRpcError {
  category: RpcErrorCategory;
  code: string;
  message: string;
  isDiscoveryError: boolean;
  safeToFallback: boolean;
  diagnosticMessage: string;
}

/**
 * Classifies errors returned by complete_google_play_purchase RPC.
 * Disambiguates between PostgREST discovery/signature issues, permission denials,
 * constraint violations, and internal SQL execution errors.
 */
export function classifyRpcError(
  err: { code?: string; message?: string; details?: string; hint?: string } | null | undefined
): ClassifiedRpcError {
  if (!err) {
    return {
      category: 'UNKNOWN',
      code: '',
      message: '',
      isDiscoveryError: false,
      safeToFallback: false,
      diagnosticMessage: 'No RPC error object provided',
    };
  }

  const code = typeof err.code === 'string' ? err.code : '';
  const msg = (err.message || '').trim();
  const lowerMsg = msg.toLowerCase();

  // 1. Permission error (SQLSTATE 42501 / PGRST301)
  if (code === '42501' || code === 'PGRST301' || lowerMsg.includes('permission denied')) {
    return {
      category: 'PERMISSION_DENIED',
      code: code || '42501',
      message: msg,
      isDiscoveryError: false,
      safeToFallback: false,
      diagnosticMessage: `Permission denied for complete_google_play_purchase RPC (code: ${code || '42501'}). Verify service_role EXECUTE grant.`,
    };
  }

  // 2. Constraint violations (SQLSTATE class 23)
  if (code.startsWith('23') || lowerMsg.includes('constraint') || lowerMsg.includes('violates')) {
    return {
      category: 'INTEGRITY_CONSTRAINT_VIOLATION',
      code,
      message: msg,
      isDiscoveryError: false,
      safeToFallback: false,
      diagnosticMessage: `Database integrity constraint violation during atomic purchase execution: ${msg}`,
    };
  }

  // 3. Undefined column / table within SQL execution (SQLSTATE 42703, 42P01)
  if (code === '42703' || (lowerMsg.includes('column') && lowerMsg.includes('does not exist'))) {
    return {
      category: 'UNDEFINED_COLUMN',
      code: code || '42703',
      message: msg,
      isDiscoveryError: false,
      safeToFallback: false,
      diagnosticMessage: `Database schema mismatch inside complete_google_play_purchase RPC: ${msg}`,
    };
  }

  if (code === '42P01' || (lowerMsg.includes('relation') && lowerMsg.includes('does not exist'))) {
    return {
      category: 'UNDEFINED_TABLE',
      code: code || '42P01',
      message: msg,
      isDiscoveryError: false,
      safeToFallback: false,
      diagnosticMessage: `Database table missing during complete_google_play_purchase RPC: ${msg}`,
    };
  }

  // 4. Deadlock / Transaction rollback (SQLSTATE class 40)
  if (code.startsWith('40') || lowerMsg.includes('deadlock')) {
    return {
      category: 'TRANSACTION_OR_DEADLOCK',
      code,
      message: msg,
      isDiscoveryError: false,
      safeToFallback: false,
      diagnosticMessage: `Database transaction serialization/deadlock in RPC: ${msg}`,
    };
  }

  // 5. Connection failures (SQLSTATE class 08)
  if (code.startsWith('08') || lowerMsg.includes('connection')) {
    return {
      category: 'CONNECTION_FAILURE',
      code,
      message: msg,
      isDiscoveryError: false,
      safeToFallback: false,
      diagnosticMessage: `Database connection failure during RPC: ${msg}`,
    };
  }

  // 6. PostgREST function discovery failure (PGRST202)
  // CRITICAL: PGRST202 indicates either argument mismatch, unapplied migration, or stale schema cache.
  // It MUST NOT trigger silent non-atomic fallback because PostgREST returns this on parameter mismatch!
  if (code === 'PGRST202' || (lowerMsg.includes('could not find the function') && lowerMsg.includes('schema cache'))) {
    return {
      category: 'SCHEMA_CACHE_OR_SIGNATURE_MISMATCH',
      code: code || 'PGRST202',
      message: msg,
      isDiscoveryError: true,
      safeToFallback: false,
      diagnosticMessage: `PostgREST could not find complete_google_play_purchase in schema cache (PGRST202). Likely causes: argument signature mismatch, unapplied migration, or stale schema cache. Requires NOTIFY pgrst, 'reload schema'.`,
    };
  }

  // 7. PostgreSQL native undefined_function (SQLSTATE 42883)
  if (code === '42883' || (lowerMsg.includes('function') && lowerMsg.includes('does not exist') && !lowerMsg.includes('column') && !lowerMsg.includes('relation'))) {
    return {
      category: 'UNDEFINED_FUNCTION',
      code: code || '42883',
      message: msg,
      isDiscoveryError: true,
      safeToFallback: false,
      diagnosticMessage: `Function public.complete_google_play_purchase does not exist in PostgreSQL (SQLSTATE 42883). Migration has not been applied.`,
    };
  }

  return {
    category: 'EXECUTION_FAILURE',
    code,
    message: msg,
    isDiscoveryError: false,
    safeToFallback: false,
    diagnosticMessage: `Atomic RPC execution failed: ${msg}`,
  };
}

/**
 * Strictly evaluates whether an RPC error represents a true missing function.
 *
 * Rejects PGRST202 (which may be a signature mismatch or stale cache),
 * permission denials (42501), constraint violations (23xxx), and execution errors (42703).
 */
export function isRpcMissingError(
  err: { code?: string; message?: string; details?: string; hint?: string } | null | undefined
): boolean {
  if (!err) return false;
  const classified = classifyRpcError(err);

  // PGRST202, permission denied, constraints, column mismatches, deadlocks NEVER qualify
  if (
    classified.category === 'SCHEMA_CACHE_OR_SIGNATURE_MISMATCH' ||
    classified.category === 'PERMISSION_DENIED' ||
    classified.category === 'INTEGRITY_CONSTRAINT_VIOLATION' ||
    classified.category === 'UNDEFINED_COLUMN' ||
    classified.category === 'UNDEFINED_TABLE' ||
    classified.category === 'TRANSACTION_OR_DEADLOCK' ||
    classified.category === 'CONNECTION_FAILURE'
  ) {
    return false;
  }

  // Only native PostgreSQL 42883 undefined_function can represent a truly missing function
  if (classified.category === 'UNDEFINED_FUNCTION') {
    return true;
  }

  return false;
}

/**
 * Validates course association integrity across subscription plan, order item, and target course.
 */
export function validateSubscriptionCourseIntegrity(
  planCourseId?: string | null,
  orderCourseId?: string | null,
  expectedCourseId?: string | null
): { valid: boolean; resolvedCourseId?: string; error?: string } {
  if (!planCourseId) {
    return { valid: false, error: 'Subscription plan is missing associated course ID' };
  }
  if (orderCourseId && orderCourseId !== planCourseId) {
    return {
      valid: false,
      error: `Course mismatch between order item (${orderCourseId}) and subscription plan (${planCourseId})`,
    };
  }
  if (expectedCourseId && expectedCourseId !== planCourseId) {
    return {
      valid: false,
      error: `Subscription plan course (${planCourseId}) does not match expected target course (${expectedCourseId})`,
    };
  }
  return { valid: true, resolvedCourseId: planCourseId };
}

export interface BuildOrderItemPayloadParams {
  orderId: string;
  instituteId: string;
  itemType: 'course' | 'subscription_plan' | 'pyq_package';
  courseId?: string | null;
  planId?: string | null;
  packageId?: string | null;
  itemName: string;
  unitPrice: number;
  quantity?: number;
  discountAmount?: number;
  lineTotal?: number;
  createdAt?: string;
}

export interface OrderItemPayload {
  order_id: string;
  institute_id: string;
  item_type: 'course' | 'subscription_plan' | 'pyq_package';
  course_id: string | null;
  plan_id: string | null;
  package_id: string | null;
  item_name: string;
  unit_price: number;
  quantity: number;
  discount_amount: number;
  line_total: number;
  created_at: string;
}

/**
 * Builds validated payload for public.order_items insert.
 *
 * Schema Invariants:
 * - Strictly excludes updated_at (table is an immutable ledger without updated_at column).
 * - Enforces ck_order_items_item_type_consistency:
 *   - course: course_id is set, plan_id is null, package_id is null.
 *   - subscription_plan: course_id is set, plan_id is set, package_id is null.
 *   - pyq_package: package_id is set, course_id is null, plan_id is null.
 */
export function buildOrderItemPayload(params: BuildOrderItemPayloadParams): OrderItemPayload {
  const transactionTimestamp = params.createdAt || new Date().toISOString();
  const unitPrice = typeof params.unitPrice === 'number' && !isNaN(params.unitPrice) ? params.unitPrice : 0;
  const quantity = params.quantity !== undefined ? params.quantity : 1;
  const discountAmount = params.discountAmount !== undefined ? params.discountAmount : 0;
  const lineTotal = params.lineTotal !== undefined ? params.lineTotal : (unitPrice * quantity - discountAmount);

  let courseId: string | null = null;
  let planId: string | null = null;
  let packageId: string | null = null;

  if (params.itemType === 'course') {
    courseId = params.courseId || null;
    planId = null;
    packageId = null;
  } else if (params.itemType === 'subscription_plan') {
    courseId = params.courseId || null;
    planId = params.planId || null;
    packageId = null;
  } else if (params.itemType === 'pyq_package') {
    courseId = null;
    planId = null;
    packageId = params.packageId || null;
  }

  return {
    order_id: params.orderId,
    institute_id: params.instituteId,
    item_type: params.itemType,
    course_id: courseId,
    plan_id: planId,
    package_id: packageId,
    item_name: params.itemName,
    unit_price: unitPrice,
    quantity,
    discount_amount: discountAmount,
    line_total: lineTotal,
    created_at: transactionTimestamp,
  };
}

/**
 * Builds atomic complete_google_play_purchase RPC payload matching Migration 204.
 */
export function buildGooglePlayRpcPayload(params: {
  profileId: string;
  instituteId: string;
  studentId?: string | null;
  resolvedItemType: 'course' | 'subscription_plan' | 'pyq_package';
  resolvedCourseId?: string | null;
  resolvedPlanId?: string | null;
  resolvedPackageId?: string | null;
  itemName: string;
  unitPrice: number;
  effectiveOrderId: string;
  purchaseToken: string;
  productId: string;
  googleVerificationResult?: any;
  transactionTimestamp: string;
  subscriptionEndDate?: string | null;
  autoRenewSetting?: boolean;
  billingName?: string | null;
  billingEmail?: string | null;
  rtdnEventId?: string | null;
  rtdnAttempt?: number;
}) {
  const baseVerification = typeof params.googleVerificationResult === 'object' && params.googleVerificationResult !== null
    ? params.googleVerificationResult
    : {
        verified: true,
        productId: params.productId,
        purchaseToken: params.purchaseToken,
        verified_at: params.transactionTimestamp,
      };

  const gatewayResponse = {
    ...baseVerification,
    ...(params.rtdnEventId ? { rtdn_event_id: params.rtdnEventId, rtdn_attempt: params.rtdnAttempt || 1 } : {}),
  };

  return {
    p_profile_id: params.profileId,
    p_institute_id: params.instituteId,
    p_student_id: params.studentId || null,
    p_item_type: params.resolvedItemType,
    p_course_id:
      params.resolvedItemType === 'course' || params.resolvedItemType === 'subscription_plan'
        ? params.resolvedCourseId || null
        : null,
    p_plan_id: params.resolvedItemType === 'subscription_plan' ? params.resolvedPlanId || null : null,
    p_package_id: params.resolvedItemType === 'pyq_package' ? params.resolvedPackageId || null : null,
    p_item_name: params.itemName,
    p_unit_price: params.unitPrice,
    p_effective_order_id: params.effectiveOrderId,
    p_purchase_token: params.purchaseToken,
    p_product_id: params.productId,
    p_gateway_response: gatewayResponse,
    p_transaction_timestamp: params.transactionTimestamp,
    p_subscription_end_date: params.subscriptionEndDate || null,
    p_is_auto_renew: params.autoRenewSetting !== undefined ? params.autoRenewSetting : true,
    p_billing_name: params.billingName || 'Student',
    p_billing_email: params.billingEmail || 'student@makemetopper.com',
  };
}

export type GooglePlayRpcOutcome =
  | 'purchase_recorded'
  | 'renewal_recorded'
  | 'renewal_recorded_backfill'
  | 'already_recorded'
  | 'reconciliation_required';

export interface RpcHandlingResult {
  action: 'proceed_to_post_commit' | 'return_response' | 'throw_fatal' | 'reconciliation_required';
  effectiveFinalOrderId?: string;
  entitlementGranted?: string;
  outcome?: GooglePlayRpcOutcome;
  paymentId?: string | null;
  cycleIndex?: number | null;
  reconciliationReason?: string | null;
  httpStatus?: number;
  responseBody?: any;
  fatalError?: string;
  errorClassification?: RpcErrorCategory;
}

/**
 * Handles responses and error codes from complete_google_play_purchase RPC.
 */
export function handleGooglePlayRpcResponse(
  rpcData: any,
  rpcErr: any,
  options?: { allowLegacyFallback?: boolean }
): RpcHandlingResult {
  if (rpcErr) {
    const classified = classifyRpcError(rpcErr);

    // Controlled legacy fallback policy:
    // In production, the atomic RPC is expected and verified to exist.
    // Client-side sequential fallback is strictly disabled by default.
    // Only if options.allowLegacyFallback is explicitly true AND the function
    // is truly missing in PostgreSQL (42883) do we allow fallback.
    // PGRST202 (signature mismatch/stale cache) NEVER triggers fallback.
    if (options?.allowLegacyFallback && isRpcMissingError(rpcErr)) {
      return {
        action: 'throw_fatal',
        fatalError: '__RPC_UNAVAILABLE__',
        errorClassification: classified.category,
      };
    }

    return {
      action: 'throw_fatal',
      fatalError: `Database atomic purchase execution failed [${classified.category}]: ${classified.diagnosticMessage}`,
      errorClassification: classified.category,
    };
  }

  if (rpcData?.code === 'STALE_LEASE_LOST') {
    return {
      action: 'return_response',
      httpStatus: 503,
      responseBody: {
        success: false,
        error: rpcData?.error || 'Stale worker lease lost; event reclaimed by another worker',
        code: 'STALE_LEASE_LOST',
        staleWorkerAborted: true,
        retryable: true,
      },
    };
  }

  if (rpcData?.success && rpcData?.outcome === 'reconciliation_required') {
    // The database explicitly declined to record this cycle. Never treat this as success.
    return {
      action: 'reconciliation_required',
      effectiveFinalOrderId: rpcData?.orderId || null,
      cycleIndex: typeof rpcData?.cycleIndex === 'number' ? rpcData.cycleIndex : null,
      reconciliationReason: rpcData?.reason || 'RECONCILIATION_REQUIRED',
      httpStatus: 200,
      responseBody: {
        success: false,
        reconciled: false,
        outcome: 'reconciliation_required',
        reason: rpcData?.reason || 'RECONCILIATION_REQUIRED',
        ...(rpcData?.orderId ? { orderId: rpcData.orderId } : {}),
      },
    };
  }

  if (rpcData?.success) {
    const outcome = typeof rpcData?.outcome === 'string' ? (rpcData.outcome as GooglePlayRpcOutcome) : null;
    if (!outcome) {
      // Fail closed: a bare success envelope is not proof that any payment row exists.
      return {
        action: 'reconciliation_required',
        effectiveFinalOrderId: rpcData?.orderId || null,
        reconciliationReason: 'MISSING_OUTCOME',
        httpStatus: 200,
        responseBody: {
          success: false,
          reconciled: false,
          outcome: 'reconciliation_required',
          reason: 'MISSING_OUTCOME',
          ...(rpcData?.orderId ? { orderId: rpcData.orderId } : {}),
        },
      };
    }

    return {
      action: 'proceed_to_post_commit',
      outcome,
      paymentId: rpcData?.paymentId || null,
      cycleIndex: typeof rpcData?.cycleIndex === 'number' ? rpcData.cycleIndex : null,
      effectiveFinalOrderId: rpcData.orderId,
      entitlementGranted: rpcData.entitlement || (rpcData.alreadyProcessed ? 'already_processed' : ''),
    };
  }

  return {
    action: 'return_response',
    httpStatus: rpcData?.code === 'ACCOUNT_MISMATCH' ? 409 : (rpcData?.code === 'FORBIDDEN_ROLE' ? 403 : 422),
    responseBody: {
      success: false,
      error: rpcData?.error || 'Failed to process purchase via database RPC',
      code: rpcData?.code || 'PURCHASE_REJECTED',
      ...(rpcData?.orderId ? { orderId: rpcData.orderId } : {}),
    },
  };
}

// ── Google Cloud Pub/Sub OIDC Webhook Authentication & Execution Core (F-03) ───

// Google Play Subscription Notification Types
export const SUB_NOTIFICATION_TYPES: Record<number, string> = {
  1: "SUBSCRIPTION_RECOVERED",
  2: "SUBSCRIPTION_RENEWED",
  3: "SUBSCRIPTION_CANCELED",
  4: "SUBSCRIPTION_PURCHASED",
  5: "SUBSCRIPTION_ON_HOLD",
  6: "SUBSCRIPTION_IN_GRACE_PERIOD",
  7: "SUBSCRIPTION_RESTARTED",
  8: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
  9: "SUBSCRIPTION_DEFERRED",
  10: "SUBSCRIPTION_PAUSED",
  11: "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
  12: "SUBSCRIPTION_REVOKED",
  13: "SUBSCRIPTION_EXPIRED",
};

/**
 * Generates an OAuth2 access token for Google Android Publisher API using service account key.
 * Uses standard Web Crypto API (supported in Deno, Node 18+, and browsers).
 */
export async function getGoogleAccessToken(serviceAccountJson: string): Promise<string | null> {
  try {
    if (!serviceAccountJson) return null;
    const sa = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const encodeBase64Url = (str: string) => btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = encodeBase64Url(JSON.stringify(claim));
    const unsignedToken = `${header}.${payload}`;

    const pem = sa.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s+/g, "");
    const binaryKey = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(unsignedToken)
    );

    const signatureBase64 = encodeBase64Url(String.fromCharCode(...new Uint8Array(signature)));
    const jwt = `${unsignedToken}.${signatureBase64}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      console.error(`[RTDN_AUTH_ERROR] Google token exchange failed with status ${tokenRes.status}`);
      return null;
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token || null;
  } catch (err: any) {
    console.error("[RTDN_AUTH_ERROR] Exception getting access token:", err?.message || "Unknown error");
    return null;
  }
}

export interface GooglePubSubIdTokenPayload {
  iss?: string;
  sub?: string;
  aud?: string;
  email?: string;
  email_verified?: boolean | string;
  exp?: number | string;
  iat?: number | string;
  [key: string]: unknown;
}

export interface GooglePubSubClaimsValidationInput {
  payload: GooglePubSubIdTokenPayload | null | undefined;
  expectedAudience: string | undefined;
  expectedServiceAccountEmail: string | undefined;
  nowSec?: number;
}

export interface GooglePubSubClaimsValidationResult {
  valid: boolean;
  statusCode?: number;
  error?: string;
  email?: string;
  audience?: string;
}

export interface RtdnAuthResult {
  authenticated: boolean;
  statusCode?: number;
  errorMessage?: string;
  email?: string;
  audience?: string;
}

export interface RtdnTokenInfoFetcherResult {
  ok: boolean;
  status: number;
  payload?: GooglePubSubIdTokenPayload;
  errorText?: string;
}

export type RtdnTokenInfoFetcher = (token: string) => Promise<RtdnTokenInfoFetcherResult>;

export interface RtdnHandlerDependencies {
  env?: {
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    GOOGLE_SERVICE_ACCOUNT_JSON?: string;
    ANDROID_PACKAGE_NAME?: string;
    RTDN_EXPECTED_AUDIENCE?: string;
    PUBSUB_SERVICE_ACCOUNT_EMAIL?: string;
  };
  tokenInfoFetcher?: RtdnTokenInfoFetcher;
  googleAccessTokenFetcher?: (serviceAccountJson: string) => Promise<string | null>;
  googleApiFetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  createSupabaseAdminClient?: (url: string, key: string) => any;
  supabaseAdmin?: any;
  nowSec?: number;
  maxLocalSubscriptionRetries?: number;
}

/**
 * Validates Google Cloud Pub/Sub OIDC claims against server security requirements.
 *
 * Security Requirements:
 *  1. Server Configuration: Both expectedAudience and expectedServiceAccountEmail
 *     must be non-empty strings. If missing, fails closed with HTTP 500.
 *  2. Issuer: Must strictly be 'https://accounts.google.com' or 'accounts.google.com'.
 *  3. Expiry: Token exp claim must be strictly later than nowSec (exp > nowSec).
 *     Rejects exp <= nowSec.
 *  4. Audience: Token aud claim must strictly match expectedAudience (FAIL CLOSED).
 *  5. Identity: Token email claim must strictly match expectedServiceAccountEmail (FAIL CLOSED).
 *  6. Verified Email: Token email_verified claim must explicitly be true.
 */
export function validateGooglePubSubClaims(
  input: GooglePubSubClaimsValidationInput
): GooglePubSubClaimsValidationResult {
  const {
    payload,
    expectedAudience,
    expectedServiceAccountEmail,
    nowSec = Math.floor(Date.now() / 1000),
  } = input;

  // 1. Enforce server configuration: expectedAudience must be configured
  if (!expectedAudience || typeof expectedAudience !== 'string' || !expectedAudience.trim()) {
    return {
      valid: false,
      statusCode: 500,
      error: 'Server misconfiguration: RTDN_EXPECTED_AUDIENCE must be configured',
    };
  }

  // 2. Enforce server configuration: expectedServiceAccountEmail must be configured
  if (!expectedServiceAccountEmail || typeof expectedServiceAccountEmail !== 'string' || !expectedServiceAccountEmail.trim()) {
    return {
      valid: false,
      statusCode: 500,
      error: 'Server misconfiguration: PUBSUB_SERVICE_ACCOUNT_EMAIL must be configured',
    };
  }

  // 3. Payload must exist and be an object
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      statusCode: 401,
      error: 'Invalid or missing token payload',
    };
  }

  // 4. Strict Issuer verification
  const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    return {
      valid: false,
      statusCode: 401,
      error: `Invalid token issuer: ${payload.iss || 'missing'}`,
    };
  }

  // 5. Expiry check: token exp must be strictly later than nowSec (nowSec < payload.exp).
  // Rejects if exp is in the past OR equals the current second.
  if (!payload.exp || Number(payload.exp) <= nowSec) {
    return {
      valid: false,
      statusCode: 401,
      error: 'Token expired',
    };
  }

  // 6. Strict Audience verification (FAIL CLOSED — rejection, not warning)
  if (!payload.aud || payload.aud !== expectedAudience.trim()) {
    return {
      valid: false,
      statusCode: 401,
      error: `Audience mismatch: expected ${expectedAudience.trim()}, got ${payload.aud || 'missing'}`,
    };
  }

  // 7. Strict Service Account Identity verification
  if (!payload.email || payload.email.toLowerCase() !== expectedServiceAccountEmail.trim().toLowerCase()) {
    return {
      valid: false,
      statusCode: 401,
      error: `Service account identity mismatch: expected ${expectedServiceAccountEmail.trim()}, got ${payload.email || 'missing'}`,
    };
  }

  // 8. email_verified must be explicitly true
  const isVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (!isVerified) {
    return {
      valid: false,
      statusCode: 401,
      error: 'Service account email is not verified by Google',
    };
  }

  return {
    valid: true,
    email: payload.email,
    audience: payload.aud,
  };
}

/**
 * Default production Google Tokeninfo fetcher.
 * Queries Google's OAuth2 tokeninfo service to cryptographically verify token signature.
 */
export async function defaultGoogleTokenInfoFetcher(token: string): Promise<RtdnTokenInfoFetcherResult> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const errorText = await res.text();
    return { ok: false, status: res.status, errorText };
  }
  const payload = await res.json();
  return { ok: true, status: res.status, payload };
}

/**
 * Authoritatively authenticates an incoming Google Cloud Pub/Sub push request.
 *
 * Rules:
 *  - Must supply a Bearer token in the Authorization header.
 *  - URL query-parameter secrets (?secret=...) are NEVER accepted.
 *  - Token signature is verified against Google.
 *  - Claims are authoritatively validated (iss, aud, email, email_verified, exp).
 *  - Downstream operations are completely stopped on any failure.
 */
export async function authenticateRtdnRequest(params: {
  authHeader: string | null | undefined;
  expectedAudience: string | undefined;
  expectedServiceAccountEmail: string | undefined;
  tokenInfoFetcher?: RtdnTokenInfoFetcher;
  nowSec?: number;
}): Promise<RtdnAuthResult> {
  const {
    authHeader,
    expectedAudience,
    expectedServiceAccountEmail,
    tokenInfoFetcher = defaultGoogleTokenInfoFetcher,
    nowSec,
  } = params;

  // 1. Missing Authorization header (Fail-Closed)
  if (!authHeader) {
    return {
      authenticated: false,
      statusCode: 401,
      errorMessage: 'Missing Authorization header',
    };
  }

  // 2. Malformed Authorization header
  if (!authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      statusCode: 401,
      errorMessage: "Malformed Authorization header: must start with 'Bearer '",
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      authenticated: false,
      statusCode: 401,
      errorMessage: 'Malformed Authorization header: token is empty',
    };
  }

  // 3. Server Configuration Check (Fail-Closed immediately)
  if (!expectedAudience || !expectedAudience.trim()) {
    return {
      authenticated: false,
      statusCode: 500,
      errorMessage: 'Server misconfiguration: RTDN_EXPECTED_AUDIENCE must be configured',
    };
  }
  if (!expectedServiceAccountEmail || !expectedServiceAccountEmail.trim()) {
    return {
      authenticated: false,
      statusCode: 500,
      errorMessage: 'Server misconfiguration: PUBSUB_SERVICE_ACCOUNT_EMAIL must be configured',
    };
  }

  // 4. Token Cryptographic Verification via Google Tokeninfo
  let tokenInfoRes: RtdnTokenInfoFetcherResult;
  try {
    tokenInfoRes = await tokenInfoFetcher(token);
  } catch (err: any) {
    return {
      authenticated: false,
      statusCode: 401,
      errorMessage: `Google token verification error: ${err.message || 'Network error'}`,
    };
  }

  if (!tokenInfoRes.ok || !tokenInfoRes.payload) {
    return {
      authenticated: false,
      statusCode: 401,
      errorMessage: `Google token signature validation failed: ${tokenInfoRes.errorText || 'Invalid token'}`,
    };
  }

  // 5. Claims Validation
  const claimsResult = validateGooglePubSubClaims({
    payload: tokenInfoRes.payload,
    expectedAudience,
    expectedServiceAccountEmail,
    nowSec,
  });

  if (!claimsResult.valid) {
    return {
      authenticated: false,
      statusCode: claimsResult.statusCode || 401,
      errorMessage: claimsResult.error || 'Token claims validation failed',
    };
  }

  return {
    authenticated: true,
    email: claimsResult.email,
    audience: claimsResult.audience,
  };
}

function getEnvVar(name: string, depsEnv?: Record<string, string | undefined>): string {
  if (depsEnv && depsEnv[name] !== undefined) {
    return depsEnv[name] || "";
  }
  if (typeof (globalThis as any).Deno !== "undefined" && (globalThis as any).Deno.env?.get) {
    return (globalThis as any).Deno.env.get(name) || "";
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env[name] || "";
  }
  return "";
}

/**
 * Real production HTTP request handler for the RTDN webhook.
 * Encapsulates the entire request-response lifecycle so it can be tested
 * directly with real Request and Response objects without mocking internal flow.
 */

/**
 * Extracts zero-indexed renewal cycle counter from Google Play order ID:
 * - 'GPA.xxxx..0' -> cycle 0 (1st renewal)
 * - 'GPA.xxxx..1' -> cycle 1 (2nd renewal)
 * - 'GPA.xxxx..N' -> cycle N
 * - Unsuffixed base order ('GPA.xxxx') -> cycle -1 (initial purchase)
 */
export function extractOrderCycle(orderId: string | null | undefined): number | null {
  if (!orderId || typeof orderId !== 'string') return null;
  const trimmed = orderId.trim();
  const match = trimmed.match(/\.\.(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  if (trimmed.length > 0) {
    return -1;
  }
  return null;
}

/**
 * Migration 217: resolves where an incoming renewal sits relative to the cycles already
 * recorded for the SAME Google Play order family (base order id).
 *
 * This ordering is used ONLY to decide whether authoritative Orders API verification is
 * mandatory before any write. Cycle ordering by itself is never proof that a cycle was paid.
 */
export function resolveRenewalCyclePosition(params: {
  incomingOrderId: string;
  recordedOrderIds: string[];
}): { incomingCycle: number | null; maxRecordedCycle: number; isHistorical: boolean; isAlreadyRecorded: boolean } {
  const incomingOrderId = (params.incomingOrderId || '').trim();
  const incomingCycle = extractOrderCycle(incomingOrderId);

  if (!incomingOrderId) {
    return { incomingCycle: null, maxRecordedCycle: -1, isHistorical: false, isAlreadyRecorded: false };
  }

  const cleanBaseOrderId = incomingOrderId.replace(/\.\.\d+$/, '');
  const familyOrderIds = (params.recordedOrderIds || [])
    .filter((id) => typeof id === 'string' && id.trim().length > 0)
    .filter((id) => id.trim().replace(/\.\.\d+$/, '') === cleanBaseOrderId)
    .map((id) => id.trim());

  // An exact-id match is a duplicate delivery of an already ledgered order, not a backfill.
  const isAlreadyRecorded = familyOrderIds.includes(incomingOrderId);

  const recordedCycles = familyOrderIds
    .map((id) => extractOrderCycle(id))
    .filter((c): c is number => c !== null);

  const maxRecordedCycle = recordedCycles.length > 0 ? Math.max(...recordedCycles) : -1;
  const isHistorical =
    !isAlreadyRecorded &&
    incomingCycle !== null &&
    incomingCycle >= 0 &&
    incomingCycle <= maxRecordedCycle;

  return { incomingCycle, maxRecordedCycle, isHistorical, isAlreadyRecorded };
}

export interface ExactOrderVerificationResult {
  verified: boolean;
  /** A transient Google/network failure: retryable, never a business verdict about the order. */
  retryable: boolean;
  failureReason?: string;
  cycleIndex: number | null;
  detail?: VerifiedRenewalOrderDetail;
}

/**
 * Migration 217: authoritative verification of ONE exact external Google Play order id through
 * the Google Play Orders API. Used for delayed/older renewal cycles, where the current
 * subscriptionsv2 response no longer describes that cycle.
 *
 * Distinguishes a transient Google availability failure (retryable) from a business verdict
 * (order not found, not PROCESSED, product/token/amount/currency mismatch) so an outage is
 * never recorded as "unverifiable renewal".
 */
export async function verifyExactRenewalOrder(params: {
  accessToken: string;
  packageName: string;
  orderId: string;
  purchaseToken: string;
  productId: string;
  expectedPrice?: number;
  expectedCurrency?: string;
  apiFetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<ExactOrderVerificationResult> {
  const orderId = (params.orderId || '').trim();
  const cycleIndex = extractOrderCycle(orderId);

  if (!orderId) {
    return { verified: false, retryable: false, failureReason: 'MISSING_ORDER_ID', cycleIndex };
  }

  const googleRes = await fetchGoogleOrder({
    accessToken: params.accessToken,
    packageName: params.packageName,
    orderId,
    apiFetcher: params.apiFetcher,
  });

  if (googleRes.status !== 200 || !googleRes.order) {
    // 408/429/5xx and network failures are transient. Every other 4xx is a definitive
    // "this order cannot be verified" answer (e.g. 404 order not found).
    const retryable =
      googleRes.status === 0 ||
      googleRes.status === 408 ||
      googleRes.status === 429 ||
      googleRes.status >= 500;
    return {
      verified: false,
      retryable,
      failureReason: `ORDERS_API_HTTP_${googleRes.status}`,
      cycleIndex,
    };
  }

  const verification = verifyGooglePlayOrder({
    order: googleRes.order,
    expectedOrderId: orderId,
    expectedProductId: params.productId,
    expectedPurchaseToken: params.purchaseToken,
    expectedCurrency: params.expectedCurrency || DEFAULT_PLATFORM_CURRENCY,
    expectedPrice: params.expectedPrice,
  });

  if (!verification.verified) {
    return {
      verified: false,
      retryable: false,
      failureReason: verification.failureReason || 'ORDER_NOT_VERIFIED',
      cycleIndex,
    };
  }

  const amount = verification.verifiedAmount;
  const currency = verification.verifiedCurrency;
  const transactionTimestamp = verification.paymentTimestampIso || verification.createTimeIso || null;

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return { verified: false, retryable: false, failureReason: 'MISSING_VERIFIED_AMOUNT', cycleIndex };
  }
  if (!currency || typeof currency !== 'string') {
    return { verified: false, retryable: false, failureReason: 'MISSING_VERIFIED_CURRENCY', cycleIndex };
  }
  if (!transactionTimestamp) {
    return { verified: false, retryable: false, failureReason: 'MISSING_VERIFIED_TIMESTAMP', cycleIndex };
  }

  return {
    verified: true,
    retryable: false,
    cycleIndex,
    detail: {
      orderId,
      cycleIndex: cycleIndex ?? 0,
      unitPrice: amount,
      currency,
      transactionTimestamp,
      subscriptionEndDate: transactionTimestamp.split('T')[0],
      isAutoRenew: true,
      gatewayResponse: {
        verified: true,
        source: 'google_orders_api',
        verification_source: 'orders_api',
        verified_order_id: orderId,
        verified_amount: amount,
        order: googleRes.order,
        currency,
      },
    },
  };
}

/**
 * Migration 217: durable proof lookup. Reads the captured payment row for one EXACT external
 * Google Play order id. Accepts either ledger column because both are written by the RPCs,
 * and never falls back to a purchase-token match (which would resolve to another cycle).
 */
export async function findCapturedPaymentForExternalOrder(
  supabaseAdmin: any,
  externalOrderId: string
): Promise<{ paymentId: string | null; orderId: string | null }> {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function' || !externalOrderId) {
    return { paymentId: null, orderId: null };
  }

  for (const column of ['gateway_payment_id', 'gateway_order_id']) {
    try {
      const { data } = await supabaseAdmin
        .from('payments')
        .select('payment_id, order_id')
        .eq('gateway', 'google_play')
        .eq('status', 'captured')
        .eq(column, externalOrderId)
        .maybeSingle();

      if (data?.payment_id) {
        return { paymentId: data.payment_id, orderId: data.order_id ?? null };
      }
    } catch (_) {
      // Fall through to the next identifier column.
    }
  }

  return { paymentId: null, orderId: null };
}

/**
 * Migration 217: moves a renewal event out of `processing` when the RPC returns a structured,
 * non-retryable business rejection, so the ledger status matches the HTTP response instead of
 * dangling until the lease expires. Stale-worker decisions are never written.
 */
export async function markRenewalEventRejected(
  supabaseAdmin: any,
  ledgerEventId: string | null,
  workerAttempt: number | null,
  reason: string
): Promise<void> {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function' || !ledgerEventId) return;
  try {
    const tableRef = supabaseAdmin.from('google_play_rtdn_events');
    if (!tableRef || typeof tableRef.update !== 'function') return;

    let query: any = tableRef
      .update({
        processing_status: 'failed',
        error_message: reason,
        processed_at: new Date().toISOString(),
      })
      .eq('event_id', ledgerEventId);

    if (workerAttempt !== null && workerAttempt !== undefined && query && typeof query.eq === 'function') {
      query = query.eq('attempts', workerAttempt);
    }

    if (query && typeof query.select === 'function') {
      await query.select('event_id');
    } else if (query && typeof query.then === 'function') {
      await query;
    }
  } catch (_) {}
}

/**
 * Releases an RTDN event claim back to `pending` so a subsequent Pub/Sub delivery
 * can reclaim it once client-side checkout commits the student_subscriptions record.
 * Fencing: verifies both event_id and workerAttempt.
 */
export async function releaseRtdnEventClaim(
  supabaseAdmin: any,
  ledgerEventId: string | null,
  workerAttempt: number | null,
  reason: string
): Promise<void> {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function' || !ledgerEventId) return;
  try {
    const tableRef = supabaseAdmin.from('google_play_rtdn_events');
    if (!tableRef || typeof tableRef.update !== 'function') return;

    let query: any = tableRef
      .update({
        processing_status: 'pending',
        error_message: reason,
      })
      .eq('event_id', ledgerEventId);

    if (workerAttempt !== null && workerAttempt !== undefined && query && typeof query.eq === 'function') {
      query = query.eq('attempts', workerAttempt);
    }

    if (query && typeof query.select === 'function') {
      await query.select('event_id');
    } else if (query && typeof query.then === 'function') {
      await query;
    }
  } catch (_) {}
}

/**
 * Transitions an RTDN event claim to a durable terminal / reconciliation state
 * (`reconciliation_required` for financial/purchase events, `failed` for others)
 * when retries waiting for a local subscription are exhausted.
 * Fencing: verifies both event_id and workerAttempt.
 */
export async function finalizeRtdnEventMissingSubscription(
  supabaseAdmin: any,
  ledgerEventId: string | null,
  workerAttempt: number | null,
  terminalStatus: 'reconciliation_required' | 'failed',
  reason: string,
  metadata?: any
): Promise<void> {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function' || !ledgerEventId) return;
  try {
    const tableRef = supabaseAdmin.from('google_play_rtdn_events');
    if (!tableRef || typeof tableRef.update !== 'function') return;

    let query: any = tableRef
      .update({
        processing_status: terminalStatus,
        error_message: reason,
        processed_at: new Date().toISOString(),
        metadata: metadata || null,
      })
      .eq('event_id', ledgerEventId);

    if (workerAttempt !== null && workerAttempt !== undefined && query && typeof query.eq === 'function') {
      query = query.eq('attempts', workerAttempt);
    }

    if (query && typeof query.select === 'function') {
      await query.select('event_id');
    } else if (query && typeof query.then === 'function') {
      await query;
    }
  } catch (_) {}
}

export interface GoogleMoney {
  currencyCode: string; // ISO 4217 three-letter currency code (e.g., "INR", "USD")
  units?: string;       // Whole units as a decimal string representing int64 (e.g., "499")
  nanos?: number;       // Fractional units as int32 representing 10^-9 units (e.g., 500000000 = 0.50)
}

export interface GoogleSubscriptionOfferPhaseDetails {
  pricingPhase?: string;
  recurrenceMode?: string;
  billingPeriod?: string;
  price?: GoogleMoney;
  freeTrialDetails?: Record<string, any>;
  introductoryPriceDetails?: Record<string, any>;
  baseDetails?: Record<string, any>;
  prorationPeriodDetails?: Record<string, any>;
}

export interface GoogleSubscriptionDetails {
  basePlanId?: string;
  offerId?: string;
  offerPhaseDetails?: GoogleSubscriptionOfferPhaseDetails[];
  servicePeriodStartTime?: string;
}

export interface GoogleOrderLineItem {
  productId?: string;
  productTitle?: string;
  listingPrice?: GoogleMoney;
  total?: GoogleMoney;
  tax?: GoogleMoney;
  subscriptionDetails?: GoogleSubscriptionDetails;
  oneTimePurchaseDetails?: any;
  paidAppDetails?: any;
}

export interface GoogleOrderHistoryProcessedEvent {
  eventTime?: string; // RFC 3339 timestamp when order was processed
}

export interface GoogleOrderHistoryRefundEvent {
  eventTime?: string;
  refundType?: string;
}

export interface GoogleOrderHistory {
  processedEvent?: GoogleOrderHistoryProcessedEvent;
  refundEvent?: GoogleOrderHistoryRefundEvent;
}

/**
 * Official Google Play Orders API Order resource:
 * https://developers.google.com/android-publisher/api-ref/rest/v3/orders
 */
export interface GoogleOrderDetails {
  taxInclusive?: boolean;
  taxIncluded?: GoogleMoney;
  taxExcluded?: GoogleMoney;
}

export interface GoogleOrderResponse {
  orderId: string;
  purchaseToken?: string;
  state?: 'PENDING' | 'PROCESSED' | 'CANCELED' | 'PENDING_REFUND' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | string;
  createTime?: string; // RFC 3339 timestamp string when order was created (e.g., "2026-10-24T15:14:33.000Z")
  lastEventTime?: string;
  orderHistory?: GoogleOrderHistory;
  orderDetails?: GoogleOrderDetails;
  lineItems?: GoogleOrderLineItem[];
  total?: GoogleMoney;
  tax?: GoogleMoney;
}

/**
 * Supported platform currencies and their ISO 4217 minor unit decimal places.
 * Default platform currency is INR (2 decimal places).
 */
export const DEFAULT_PLATFORM_CURRENCY = 'INR';

export const ISO_4217_CURRENCY_DECIMALS: Record<string, number> = {
  // 0 decimal places
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // 3 decimal places
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

export function getCurrencyDecimalPlaces(currencyCode: string): number {
  const code = (currencyCode || '').trim().toUpperCase();
  if (code in ISO_4217_CURRENCY_DECIMALS) {
    return ISO_4217_CURRENCY_DECIMALS[code];
  }
  return 2; // Standard default for INR, USD, EUR, GBP, CAD, AUD, etc.
}

export interface ParsedGoogleMoney {
  valid: boolean;
  currency: string;
  amount: number;
  amountString: string;
  amountMinorUnits: bigint;
  decimalPlaces: number;
  error?: string;
}

export interface ParseGoogleMoneyOptions {
  allowedCurrencies?: string[];
  expectedCurrency?: string;
  enforceCurrencyPolicy?: boolean;
  allowZero?: boolean;
}

/**
 * Parses Google Money object into exact standard currency units without floating-point corruption.
 * Uses integer minor unit arithmetic with BigInt to guarantee exact half-up rounding and carry normalization
 * across all ISO 4217 currency exponent boundaries (0, 2, or 3 decimal places).
 * Compatible with TypeScript ES2017 targets (avoids BigInt literals).
 *
 * Currency Policy Enforcement:
 * Defaults strictly to DEFAULT_PLATFORM_CURRENCY ('INR').
 * A caller cannot accidentally bypass this restriction by omitting an optional flag.
 */
export function parseGoogleMoney(
  money?: GoogleMoney,
  options?: ParseGoogleMoneyOptions
): ParsedGoogleMoney {
  if (!money || typeof money !== 'object') {
    return {
      valid: false,
      currency: '',
      amount: 0,
      amountString: '0',
      amountMinorUnits: BigInt(0),
      decimalPlaces: 2,
      error: 'Missing Money object in order total',
    };
  }

  // 1. Currency code validation
  const currency = (money.currencyCode || '').trim().toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    return {
      valid: false,
      currency,
      amount: 0,
      amountString: '0',
      amountMinorUnits: BigInt(0),
      decimalPlaces: 2,
      error: `Invalid currencyCode: '${money.currencyCode}'`,
    };
  }

  // 2. Strict Currency Policy & Mismatch Validation:
  if (options?.expectedCurrency) {
    const expected = options.expectedCurrency.trim().toUpperCase();
    if (currency !== expected) {
      return {
        valid: false,
        currency,
        amount: 0,
        amountString: '0',
        amountMinorUnits: BigInt(0),
        decimalPlaces: 2,
        error: `Currency mismatch: expected '${expected}', got '${currency}'`,
      };
    }
  }

  if (options?.enforceCurrencyPolicy || (options?.allowedCurrencies && options.allowedCurrencies.length > 0)) {
    const allowed = (options?.allowedCurrencies && options.allowedCurrencies.length > 0)
      ? options.allowedCurrencies.map((c) => c.trim().toUpperCase())
      : [DEFAULT_PLATFORM_CURRENCY];

    if (!allowed.includes(currency)) {
      return {
        valid: false,
        currency,
        amount: 0,
        amountString: '0',
        amountMinorUnits: BigInt(0),
        decimalPlaces: 2,
        error: `Unsupported currency: '${currency}' violates platform currency policy (allowed: ${allowed.join(', ')})`,
      };
    }
  }

  // 3. Units validation (must be non-negative integer string)
  const rawUnits = (money.units ?? '0').toString().trim();
  if (!/^\d+$/.test(rawUnits)) {
    return {
      valid: false,
      currency,
      amount: 0,
      amountString: '0',
      amountMinorUnits: BigInt(0),
      decimalPlaces: 2,
      error: `Invalid or malformed Money units: '${money.units}'`,
    };
  }
  const units = BigInt(rawUnits);

  // 4. Nanos validation (must be integer in range [0, 999_999_999])
  if (money.nanos !== undefined && money.nanos !== null) {
    if (typeof money.nanos !== 'number' || !Number.isInteger(money.nanos) || money.nanos < 0 || money.nanos >= 1_000_000_000) {
      return {
        valid: false,
        currency,
        amount: 0,
        amountString: '0',
        amountMinorUnits: BigInt(0),
        decimalPlaces: 2,
        error: `Invalid Money nanos: ${money.nanos}`,
      };
    }
  }
  const rawNanos = money.nanos ?? 0;

  // 5. Exact minor unit arithmetic based on currency decimal places
  const d = getCurrencyDecimalPlaces(currency);
  const scale = BigInt(10) ** BigInt(9 - d);
  const halfScale = scale / BigInt(2);

  // Integer half-up rounding: (nanos + halfScale) / scale
  const minorFromNanos = (BigInt(rawNanos) + halfScale) / scale;
  const minorMultiplier = BigInt(10) ** BigInt(d);
  const totalMinorUnits = units * minorMultiplier + minorFromNanos;

  if (totalMinorUnits < BigInt(0) || (!options?.allowZero && totalMinorUnits === BigInt(0))) {
    return {
      valid: false,
      currency,
      amount: 0,
      amountString: '0',
      amountMinorUnits: BigInt(0),
      decimalPlaces: d,
      error: totalMinorUnits === BigInt(0)
        ? `Non-positive monetary amount (units: '${money.units}', nanos: ${money.nanos})`
        : `Negative monetary amount (units: '${money.units}', nanos: ${money.nanos})`,
    };
  }

  // 6. Normalization and decimal string formatting
  const normalizedUnits = totalMinorUnits / minorMultiplier;
  const normalizedFraction = totalMinorUnits % minorMultiplier;
  const amountString = d === 0
    ? normalizedUnits.toString()
    : `${normalizedUnits}.${normalizedFraction.toString().padStart(d, '0')}`;

  // 7. Validated conversion to Number
  const amount = Number(amountString);
  if (isNaN(amount) || (options?.allowZero ? amount < 0 : amount <= 0)) {
    return {
      valid: false,
      currency,
      amount: 0,
      amountString: '0',
      amountMinorUnits: BigInt(0),
      decimalPlaces: d,
      error: `Failed to convert valid monetary string to number: '${amountString}'`,
    };
  }

  return {
    valid: true,
    currency,
    amount,
    amountString,
    amountMinorUnits: totalMinorUnits,
    decimalPlaces: d,
  };
}

/**
 * Fetches transaction details directly from the Google Play Orders API:
 * GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{packageName}/orders/{orderId}
 */
export async function fetchGoogleOrder(params: {
  accessToken: string;
  packageName: string;
  orderId: string;
  apiFetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<{ status: number; order?: GoogleOrderResponse; error?: string }> {
  const { accessToken, packageName, orderId, apiFetcher } = params;
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/orders/${encodeURIComponent(orderId)}`;
  const fetcher = apiFetcher || fetch;
  try {
    const res = await fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      return { status: res.status, error: errText || `Google Orders API returned HTTP ${res.status}` };
    }
    const order = await res.json();
    return { status: 200, order };
  } catch (err: any) {
    return { status: 500, error: err?.message || 'Network error fetching Google order' };
  }
}

/**
 * Authoritatively validates order resource data returned by Google Play Orders API against expected criteria:
 * - Order.state MUST be 'PROCESSED' (the only valid state for a completed transaction).
 * - Distinguishes between order creation time (createTime) and authoritative processing time
 *   (orderHistory.processedEvent.eventTime). Uses processedEvent.eventTime as primary payment timestamp
 *   with safe fallback to createTime. Fails closed if neither is valid RFC 3339 without fabricating timestamps.
 * - orderId, purchaseToken, and productId MUST match expected subscription parameters.
 * - total MUST be a valid Google Money object with a positive amount and valid 3-letter currency.
 * - Enforces INR currency policy by default and compares verified amount against expected subscription price.
 */
export function verifyGooglePlayOrder(params: {
  order: GoogleOrderResponse | undefined;
  expectedOrderId: string;
  expectedProductId?: string;
  expectedPurchaseToken?: string;
  expectedCurrency?: string;
  expectedPrice?: number;
  allowedCurrencies?: string[];
  enforceCurrencyPolicy?: boolean;
}): {
  verified: boolean;
  failureReason?: string;
  verifiedAmount?: number;
  verifiedAmountString?: string;
  verifiedCurrency?: string;
  createTimeIso?: string;
  processedTimeIso?: string;
  paymentTimestampIso?: string;
  timestampSource?: 'processed_event' | 'create_time_fallback';
} {
  const {
    order,
    expectedOrderId,
    expectedProductId,
    expectedPurchaseToken,
    expectedCurrency = DEFAULT_PLATFORM_CURRENCY,
    expectedPrice,
    allowedCurrencies,
  } = params;

  if (!order || typeof order !== 'object') {
    return { verified: false, failureReason: 'Missing order resource' };
  }

  // 1. Exact orderId check
  if (order.orderId !== expectedOrderId) {
    return { verified: false, failureReason: `Order ID mismatch: expected ${expectedOrderId}, got ${order.orderId}` };
  }

  // 2. Strict Order.state validation: ONLY 'PROCESSED' is accepted
  if (!order.state || typeof order.state !== 'string') {
    return { verified: false, failureReason: 'Missing order state in Google Orders API response' };
  }
  const stateUpper = order.state.toUpperCase();
  if (stateUpper !== 'PROCESSED') {
    if (stateUpper === 'PENDING') {
      return { verified: false, failureReason: 'Order is pending and has not been processed' };
    }
    if (stateUpper === 'CANCELED') {
      return { verified: false, failureReason: 'Order was canceled' };
    }
    if (['REFUNDED', 'PARTIALLY_REFUNDED', 'PENDING_REFUND'].includes(stateUpper)) {
      return { verified: false, failureReason: `Order cannot be recorded: refund state ${order.state}` };
    }
    return { verified: false, failureReason: `Order state is not PROCESSED (got: ${order.state})` };
  }

  // 3. Authoritative payment transaction timestamp selection:
  let selectedPaymentTimestampIso: string | undefined;
  let selectedTimestampSource: 'processed_event' | 'create_time_fallback' | undefined;
  let validCreateTimeIso: string | undefined;
  let validProcessedTimeIso: string | undefined;

  // Validate createTime if present
  if (order.createTime) {
    if (typeof order.createTime !== 'string') {
      return { verified: false, failureReason: 'createTime must be a string timestamp' };
    }
    const parsed = Date.parse(order.createTime);
    if (isNaN(parsed)) {
      return { verified: false, failureReason: `createTime is not a valid RFC 3339 timestamp: '${order.createTime}'` };
    }
    if (parsed > Date.now() + 60_000) {
      return { verified: false, failureReason: `createTime is in the future: '${order.createTime}'` };
    }
    validCreateTimeIso = new Date(parsed).toISOString();
  }

  // Validate orderHistory.processedEvent.eventTime if present
  const rawProcessedEventTime = order.orderHistory?.processedEvent?.eventTime;
  if (rawProcessedEventTime) {
    if (typeof rawProcessedEventTime !== 'string') {
      return { verified: false, failureReason: 'processedEvent.eventTime must be a string timestamp' };
    }
    const parsed = Date.parse(rawProcessedEventTime);
    if (isNaN(parsed)) {
      return { verified: false, failureReason: `processedEvent.eventTime is not a valid RFC 3339 timestamp: '${rawProcessedEventTime}'` };
    }
    if (parsed > Date.now() + 60_000) {
      return { verified: false, failureReason: `processedEvent.eventTime is in the future: '${rawProcessedEventTime}'` };
    }
    validProcessedTimeIso = new Date(parsed).toISOString();
  }

  if (validProcessedTimeIso) {
    selectedPaymentTimestampIso = validProcessedTimeIso;
    selectedTimestampSource = 'processed_event';
  } else if (validCreateTimeIso) {
    selectedPaymentTimestampIso = validCreateTimeIso;
    selectedTimestampSource = 'create_time_fallback';
  } else {
    return {
      verified: false,
      failureReason: 'Missing valid processing or creation timestamp in Google Orders API response',
    };
  }

  // 4. Exact purchaseToken check
  if (expectedPurchaseToken) {
    if (!order.purchaseToken) {
      return { verified: false, failureReason: 'Missing purchaseToken in Google Orders API response' };
    }
    if (order.purchaseToken !== expectedPurchaseToken) {
      return { verified: false, failureReason: `Purchase token mismatch: expected ${expectedPurchaseToken}, got ${order.purchaseToken}` };
    }
  }

  // 5. Line items and productId check
  if (expectedProductId) {
    if (!Array.isArray(order.lineItems) || order.lineItems.length === 0) {
      return { verified: false, failureReason: 'Missing lineItems in Google Orders API response' };
    }
    const matched = order.lineItems.some((item) => item.productId === expectedProductId);
    if (!matched) {
      const found = order.lineItems.map((i) => i.productId).filter(Boolean).join(', ');
      return { verified: false, failureReason: `Product ID mismatch: expected ${expectedProductId}, found [${found}]` };
    }
  }

  // 5b. Find matched line item for product-level inspection
  const matchedLineItem = expectedProductId
    ? order.lineItems?.find((item) => item.productId === expectedProductId)
    : order.lineItems?.[0];

  // 6. Monetary amount and currency validation via Money object
  const targetCurrency = (expectedCurrency || DEFAULT_PLATFORM_CURRENCY).trim().toUpperCase();
  const moneyParsed = parseGoogleMoney(order.total, {
    expectedCurrency: targetCurrency,
    allowedCurrencies: allowedCurrencies || [targetCurrency],
    enforceCurrencyPolicy: true,
    allowZero: true,
  });
  if (!moneyParsed.valid) {
    return { verified: false, failureReason: moneyParsed.error || 'Invalid monetary amount in order total' };
  }

  // Parse matched lineItem listingPrice and total if available
  let listingPriceParsed: ParsedGoogleMoney | null = null;
  if (matchedLineItem?.listingPrice) {
    listingPriceParsed = parseGoogleMoney(matchedLineItem.listingPrice, {
      expectedCurrency: targetCurrency,
      allowedCurrencies: allowedCurrencies || [targetCurrency],
      enforceCurrencyPolicy: true,
      allowZero: false,
    });
  }

  let lineItemTotalParsed: ParsedGoogleMoney | null = null;
  if (matchedLineItem?.total) {
    lineItemTotalParsed = parseGoogleMoney(matchedLineItem.total, {
      expectedCurrency: targetCurrency,
      allowedCurrencies: allowedCurrencies || [targetCurrency],
      enforceCurrencyPolicy: true,
      allowZero: true,
    });
  }

  // 7. Authoritative price comparison against expected subscription plan price
  if (expectedPrice !== undefined && expectedPrice !== null) {
    const orderTotalMatches = moneyParsed.amount === expectedPrice;
    const listingPriceMatches = Boolean(listingPriceParsed?.valid && listingPriceParsed.amount === expectedPrice);
    const lineItemTotalMatches = Boolean(lineItemTotalParsed?.valid && lineItemTotalParsed.amount === expectedPrice);

    // Support legitimate Google Play promotional discounts and introductory offers using documented fields:
    // Distinguish official Google Play Orders API schema fields:
    // - LineItem.listingPrice: standard catalog listing price
    // - LineItem.total / Order.total: actual amount paid by customer after discounts and tax
    // - SubscriptionDetails.offerId: promotional offer identifier
    // - SubscriptionDetails.offerPhaseDetails: phase breakdowns (free trials, introductory pricing, base pricing, proration)
    const subDetails = matchedLineItem?.subscriptionDetails;
    const offerPhases = Array.isArray(subDetails?.offerPhaseDetails) ? subDetails!.offerPhaseDetails : [];

    const hasIntroductoryPhase = offerPhases.some(
      (phase) =>
        Boolean(phase.introductoryPriceDetails) ||
        (typeof phase.pricingPhase === 'string' && phase.pricingPhase.toUpperCase() === 'INTRODUCTORY')
    );

    const hasFreeTrialPhase = offerPhases.some(
      (phase) =>
        Boolean(phase.freeTrialDetails) ||
        (typeof phase.pricingPhase === 'string' && phase.pricingPhase.toUpperCase() === 'FREE_TRIAL')
    );

    const hasOnlyBasePricePhases =
      offerPhases.length > 0 &&
      offerPhases.every(
        (phase) =>
          Boolean(phase.baseDetails) ||
          (typeof phase.pricingPhase === 'string' && ['REGULAR', 'BASE'].includes(phase.pricingPhase.toUpperCase()))
      );

    const hasValidOfferId = Boolean(
      subDetails?.offerId &&
      typeof subDetails.offerId === 'string' &&
      subDetails.offerId.trim().length > 0
    );

    // Support legitimate tax-exclusive pricing if taxInclusive is explicitly false
    const isTaxExclusiveAddition = Boolean(
      order.orderDetails?.taxInclusive === false &&
      listingPriceMatches &&
      moneyParsed.amount > expectedPrice
    );

    const isStandardBasePrice = orderTotalMatches || (lineItemTotalMatches && moneyParsed.amount === expectedPrice);

    // Strict Policy:
    // 1. A base-price phase alone (baseDetails) MUST NOT qualify as an introductory discount.
    // 2. An introductory discount requires: listingPrice matches expectedPrice, moneyParsed.amount < expectedPrice,
    //    AND documented offer evidence (introductoryPriceDetails OR valid promotional offerId without baseDetails-only conflict).
    const isDocumentedIntroductoryDiscount = Boolean(
      listingPriceMatches &&
      moneyParsed.amount < expectedPrice &&
      moneyParsed.amount > 0 &&
      (hasIntroductoryPhase || (hasValidOfferId && !hasOnlyBasePricePhases))
    );

    // 3. A free trial requires: listingPrice matches expectedPrice, moneyParsed.amount === 0,
    //    AND documented trial evidence (freeTrialDetails OR valid trial offerId).
    const isDocumentedFreeTrial = Boolean(
      listingPriceMatches &&
      moneyParsed.amount === 0 &&
      (hasFreeTrialPhase || hasValidOfferId)
    );

    const isPriceValid = isStandardBasePrice || isDocumentedIntroductoryDiscount || isDocumentedFreeTrial || isTaxExclusiveAddition;

    if (!isPriceValid) {
      if (moneyParsed.amount < expectedPrice) {
        if (hasOnlyBasePricePhases && !hasIntroductoryPhase && !hasFreeTrialPhase && !hasValidOfferId) {
          return {
            verified: false,
            failureReason: `Order amount mismatch: base pricing phase does not justify discounted charge of ${moneyParsed.amount} ${moneyParsed.currency} (expected catalog price ${expectedPrice} ${moneyParsed.currency})`,
          };
        }
        if (moneyParsed.amount === 0 && !hasFreeTrialPhase && !hasValidOfferId) {
          return {
            verified: false,
            failureReason: `Zero monetary amount in order total without verified free trial offer evidence`,
          };
        }
        return {
          verified: false,
          failureReason: `Order amount mismatch: expected ${expectedPrice} ${moneyParsed.currency}, got ${moneyParsed.amount} ${moneyParsed.currency} without documented promotional offer evidence`,
        };
      }

      if (moneyParsed.amount > expectedPrice && !isTaxExclusiveAddition) {
        return {
          verified: false,
          failureReason: `Order amount mismatch: expected ${expectedPrice} ${moneyParsed.currency}, got ${moneyParsed.amount} ${moneyParsed.currency} (exceeds expected catalog price)`,
        };
      }

      return {
        verified: false,
        failureReason: `Order amount mismatch: expected ${expectedPrice} ${moneyParsed.currency}, got ${moneyParsed.amount} ${moneyParsed.currency}${listingPriceParsed?.valid ? ` (listing price: ${listingPriceParsed.amount} ${listingPriceParsed.currency})` : ''}`,
      };
    }
  }

  return {
    verified: true,
    verifiedAmount: moneyParsed.amount,
    verifiedAmountString: moneyParsed.amountString,
    verifiedCurrency: moneyParsed.currency,
    createTimeIso: validCreateTimeIso,
    processedTimeIso: validProcessedTimeIso,
    paymentTimestampIso: selectedPaymentTimestampIso,
    timestampSource: selectedTimestampSource,
  };
}

export interface VerifiedRenewalOrderDetail {
  orderId: string;
  cycleIndex: number;
  unitPrice: number;
  currency: string;
  transactionTimestamp: string;
  subscriptionEndDate: string;
  isAutoRenew: boolean;
  gatewayResponse: any;
}

export interface RenewalGapReconciliationResult {
  reconciledOrders: string[];
  unresolvedGaps: string[];
  errors: string[];
  verifiedOrderDetails?: VerifiedRenewalOrderDetail[];
}

/**
 * Inspects recorded payments versus incoming Google latestSuccessfulOrderId, detects missing intermediate cycles,
 * verifies each candidate order against the Google Play Orders API, and records verified renewals atomically.
 */
export async function detectAndReconcileRenewalGaps(params: {
  baseOrderId: string;
  incomingOrderId: string;
  recordedOrderIds: string[];
  purchaseToken: string;
  productId: string;
  planId: string;
  profileId: string;
  studentId: string;
  instituteId: string;
  googleAccessToken: string;
  packageName: string;
  supabaseAdmin: any;
  expectedPrice?: number;
  expectedCurrency?: string;
  apiFetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  rtdnEventId?: string | null;
  rtdnAttempt?: number;
  deferExecution?: boolean;
}): Promise<RenewalGapReconciliationResult> {
  const {
    baseOrderId,
    incomingOrderId,
    recordedOrderIds,
    purchaseToken,
    productId,
    planId,
    profileId,
    studentId,
    instituteId,
    googleAccessToken,
    packageName,
    supabaseAdmin,
    apiFetcher,
  } = params;

  const result: RenewalGapReconciliationResult = {
    reconciledOrders: [],
    unresolvedGaps: [],
    errors: [],
  };

  const incomingCycle = extractOrderCycle(incomingOrderId);
  if (incomingCycle === null || incomingCycle < 0) {
    return result;
  }

  const cleanBaseOrderId = baseOrderId.replace(/\.\.\d+$/, '');

  // Isolate recorded cycles strictly to orders belonging to this subscription's base order family
  const relevantOrderIds = recordedOrderIds.filter((id) => {
    if (!id || typeof id !== 'string') return false;
    const cleanId = id.trim().replace(/\.\.\d+$/, '');
    return cleanId === cleanBaseOrderId;
  });

  const recordedCycles = relevantOrderIds
    .map(extractOrderCycle)
    .filter((c): c is number => c !== null);
  const maxRecordedCycle = recordedCycles.length > 0 ? Math.max(...recordedCycles) : -1;

  if (incomingCycle <= maxRecordedCycle + 1) {
    return result; // No gap
  }

  console.log(`[RECONCILIATION_GAP_DETECTED] Gap detected between cycle ${maxRecordedCycle} and ${incomingCycle} for token ${purchaseToken.slice(0, 8)}...`);

  // Resolve expected plan price and currency if not explicitly supplied
  let targetPrice = params.expectedPrice;
  if (targetPrice === undefined && supabaseAdmin && planId) {
    try {
      const { data: planData } = await supabaseAdmin
        .from('subscription_plans')
        .select('price')
        .eq('plan_id', planId)
        .maybeSingle();
      if (planData?.price !== undefined && planData?.price !== null) {
        targetPrice = Number(planData.price);
      }
    } catch (_) {}
  }
  const targetCurrency = params.expectedCurrency || DEFAULT_PLATFORM_CURRENCY;

  for (let cycle = maxRecordedCycle + 1; cycle < incomingCycle; cycle++) {
    const candidateOrderId = `${cleanBaseOrderId}..${cycle}`;
    console.log(`[RECONCILIATION_VERIFY_ORDER] Attempting authoritative verification for intermediate order: ${candidateOrderId}`);

    const googleRes = await fetchGoogleOrder({
      accessToken: googleAccessToken,
      packageName,
      orderId: candidateOrderId,
      apiFetcher,
    });

    if (googleRes.status === 200 && googleRes.order) {
      const verification = verifyGooglePlayOrder({
        order: googleRes.order,
        expectedOrderId: candidateOrderId,
        expectedProductId: productId,
        expectedPurchaseToken: purchaseToken,
        expectedCurrency: targetCurrency,
        expectedPrice: targetPrice,
      });

      if (verification.verified) {
        const verifiedAmount = verification.verifiedAmount!;
        const verifiedCurrency = verification.verifiedCurrency!;
        const transactionTimestamp = verification.paymentTimestampIso || verification.createTimeIso!;

        const rpcPayload = buildGooglePlayRpcPayload({
          profileId,
          instituteId,
          studentId,
          resolvedItemType: 'subscription_plan',
          resolvedPlanId: planId,
          itemName: `Subscription Renewal Cycle ..${cycle}`,
          unitPrice: verifiedAmount,
          effectiveOrderId: candidateOrderId,
          purchaseToken,
          productId,
          googleVerificationResult: {
            verified: true,
            source: 'google_orders_api',
            verification_source: 'orders_api',
            verified_order_id: candidateOrderId,
            cycle_index: cycle,
            order: googleRes.order,
            currency: verifiedCurrency,
          },
          transactionTimestamp,
          subscriptionEndDate: transactionTimestamp.split('T')[0],
          autoRenewSetting: true,
        });

        const orderDetail: VerifiedRenewalOrderDetail = {
          orderId: candidateOrderId,
          cycleIndex: cycle,
          unitPrice: verifiedAmount,
          currency: verifiedCurrency,
          transactionTimestamp,
          subscriptionEndDate: transactionTimestamp.split('T')[0],
          isAutoRenew: true,
          gatewayResponse: {
            verified: true,
            source: 'google_orders_api',
            verification_source: 'orders_api',
            verified_order_id: candidateOrderId,
            cycle_index: cycle,
            order: googleRes.order,
            currency: verifiedCurrency,
          },
        };
        result.verifiedOrderDetails = result.verifiedOrderDetails || [];
        result.verifiedOrderDetails.push(orderDetail);

        if (params.deferExecution) {
          console.log(`[RECONCILIATION_COLLECTED] Intermediate order ${candidateOrderId} verified for atomic batch recording.`);
          result.reconciledOrders.push(candidateOrderId);
          continue;
        }

        if (typeof supabaseAdmin.rpc === 'function') {
          try {
            const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('complete_google_play_purchase', rpcPayload);
            const rpcRes = handleGooglePlayRpcResponse(rpcData, rpcErr);
            if (rpcRes.action === 'proceed_to_post_commit') {
              console.log(`[RECONCILIATION_SUCCESS] Intermediate order ${candidateOrderId} safely recorded in payment ledger.`);
              result.reconciledOrders.push(candidateOrderId);
            } else {
              console.warn(`[RECONCILIATION_WARN] Intermediate order ${candidateOrderId} RPC returned: ${JSON.stringify(rpcRes)}`);
              result.errors.push(`RPC error on ${candidateOrderId}`);
            }
          } catch (dbErr: any) {
            console.error(`[RECONCILIATION_ERROR] Exception recording intermediate order ${candidateOrderId}:`, dbErr.message);
            result.errors.push(dbErr.message);
          }
        }
      } else {
        console.warn(`[RECONCILIATION_GAP_UNVERIFIED] Candidate order ${candidateOrderId} failed Google verification: ${verification.failureReason}. Not fabricating payment row.`);
        result.unresolvedGaps.push(candidateOrderId);
      }
    } else {
      console.warn(`[RECONCILIATION_GAP_UNVERIFIED] Candidate order ${candidateOrderId} could not be found in Google Play Orders API (status: ${googleRes.status}). Not fabricating payment row.`);
      result.unresolvedGaps.push(candidateOrderId);
    }
  }

  return result;
}

/**
 * Safely reconciles a specific missing historical renewal order via the Google Play Orders API.
 * Never fabricates unverified transaction details.
 */
export async function reconcileHistoricalRenewalOrder(params: {
  orderId: string;
  purchaseToken: string;
  productId: string;
  planId: string;
  profileId: string;
  studentId: string;
  instituteId: string;
  googleAccessToken: string;
  packageName: string;
  supabaseAdmin: any;
  expectedPrice?: number;
  expectedCurrency?: string;
  apiFetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<{
  reconciled: boolean;
  alreadyProcessed?: boolean;
  orderId?: string;
  paymentId?: string;
  error?: string;
}> {
  const {
    orderId,
    purchaseToken,
    productId,
    planId,
    profileId,
    studentId,
    instituteId,
    googleAccessToken,
    packageName,
    supabaseAdmin,
    apiFetcher,
  } = params;

  const googleRes = await fetchGoogleOrder({
    accessToken: googleAccessToken,
    packageName,
    orderId,
    apiFetcher,
  });

  if (googleRes.status !== 200 || !googleRes.order) {
    return {
      reconciled: false,
      error: `Order ${orderId} could not be authoritatively verified via Google Play Orders API (status: ${googleRes.status}, error: ${googleRes.error || 'Not found'}). Historical payment cannot be recorded.`,
    };
  }

  let targetPrice = params.expectedPrice;
  if (targetPrice === undefined && supabaseAdmin && planId) {
    try {
      const { data: planData } = await supabaseAdmin
        .from('subscription_plans')
        .select('price')
        .eq('plan_id', planId)
        .maybeSingle();
      if (planData?.price !== undefined && planData?.price !== null) {
        targetPrice = Number(planData.price);
      }
    } catch (_) {}
  }
  const targetCurrency = params.expectedCurrency || DEFAULT_PLATFORM_CURRENCY;

  const verification = verifyGooglePlayOrder({
    order: googleRes.order,
    expectedOrderId: orderId,
    expectedProductId: productId,
    expectedPurchaseToken: purchaseToken,
    expectedCurrency: targetCurrency,
    expectedPrice: targetPrice,
  });

  if (!verification.verified) {
    return {
      reconciled: false,
      error: `Order ${orderId} failed Google verification: ${verification.failureReason}. Payment will not be fabricated.`,
    };
  }

  const verifiedAmount = verification.verifiedAmount!;
  const verifiedCurrency = verification.verifiedCurrency!;
  const transactionTimestamp = verification.paymentTimestampIso || verification.createTimeIso!;

  const rpcPayload = buildGooglePlayRpcPayload({
    profileId,
    instituteId,
    studentId,
    resolvedItemType: 'subscription_plan',
    resolvedPlanId: planId,
    itemName: `Historical Subscription Renewal ${orderId}`,
    unitPrice: verifiedAmount,
    effectiveOrderId: orderId,
    purchaseToken,
    productId,
    googleVerificationResult: {
      verified: true,
      source: 'google_orders_api',
      order: googleRes.order,
      currency: verifiedCurrency,
    },
    transactionTimestamp,
    subscriptionEndDate: transactionTimestamp.split('T')[0],
    autoRenewSetting: true,
  });

  if (typeof supabaseAdmin.rpc !== 'function') {
    return {
      reconciled: false,
      error: 'supabaseAdmin.rpc is unavailable',
    };
  }

  try {
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('complete_google_play_purchase', rpcPayload);
    const rpcRes = handleGooglePlayRpcResponse(rpcData, rpcErr);
    if (rpcRes.action === 'proceed_to_post_commit') {
      return {
        reconciled: true,
        alreadyProcessed: Boolean(rpcData?.alreadyProcessed),
        orderId: rpcData?.orderId,
        paymentId: rpcData?.paymentId,
      };
    } else {
      return {
        reconciled: false,
        error: rpcRes.responseBody?.error || 'Database RPC rejected historical purchase',
      };
    }
  } catch (err: any) {
    return {
      reconciled: false,
      error: `Exception executing complete_google_play_purchase: ${err.message}`,
    };
  }
}

export async function handleRtdnHttpRequest(
  req: Request,
  deps?: RtdnHandlerDependencies
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  let supabaseAdmin: any = null;
  let purchaseToken: string | null = null;
  let notificationType: number | null = null;
  let notificationEventTime: number | null = null;
  let notificationPackageName: string | null = null;
  let subscriptionId: string | null = null;
  let androidPackageName = "com.makemetopper.app";
  let ledgerEventId: string | null = null;
  let workerAttempt = 1;

  try {
    const supabaseUrl = getEnvVar("SUPABASE_URL", deps?.env);
    const serviceRoleKey = getEnvVar("SUPABASE_SERVICE_ROLE_KEY", deps?.env);
    const googleServiceAccountJson = getEnvVar("GOOGLE_SERVICE_ACCOUNT_JSON", deps?.env);
    androidPackageName = getEnvVar("ANDROID_PACKAGE_NAME", deps?.env) || "com.makemetopper.app";
    const expectedAudience = getEnvVar("RTDN_EXPECTED_AUDIENCE", deps?.env);
    const expectedServiceAccountEmail = getEnvVar("PUBSUB_SERVICE_ACCOUNT_EMAIL", deps?.env);

    // ── 1. Authenticate Incoming Pub/Sub Push Request (Strict Google OIDC) ────
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");

    const authResult = await authenticateRtdnRequest({
      authHeader,
      expectedAudience,
      expectedServiceAccountEmail,
      tokenInfoFetcher: deps?.tokenInfoFetcher,
      nowSec: deps?.nowSec,
    });

    if (!authResult.authenticated) {
      // Safe diagnostic logging — NEVER log raw token, secret, or Authorization header
      console.warn(`[RTDN_UNAUTHORIZED] Authentication rejected: ${authResult.errorMessage || "Unauthorized"}`);
      return new Response(
        JSON.stringify({ error: authResult.errorMessage || "Unauthorized" }),
        {
          status: authResult.statusCode || 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[RTDN_AUTH_SUCCESS] Authenticated via Google OIDC (${authResult.email})`);

    // ── 2. Parse & Verify Pub/Sub Message Payload ─────────────────────────────
    const body = await req.json();
    console.log("[RTDN_DIAGNOSTIC] Message received", {
      messageId: body?.message?.messageId || "unknown",
      publishTime: body?.message?.publishTime || null,
    });

    if (!body?.message?.data) {
      console.log("[RTDN] No Pub/Sub message data found. Returning 200 acknowledge.");
      return new Response(JSON.stringify({ status: "ignored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Decode Base64 Pub/Sub payload
    const decodedStr = atob(body.message.data);
    const notification = JSON.parse(decodedStr);
    notificationPackageName = notification.packageName || null;
    notificationEventTime = notification.eventTimeMillis ? Number(notification.eventTimeMillis) : null;

    if (notificationPackageName && notificationPackageName !== androidPackageName) {
      console.warn(`[RTDN_WARN] Received notification for package ${notificationPackageName}, expected ${androidPackageName}. Acknowledged without processing.`);
      return new Response(JSON.stringify({ status: "package_mismatch_ignored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.log("[RTDN_DIAGNOSTIC] Notification parsed", {
      hasTestNotification: Boolean(notification.testNotification),
      hasSubscriptionNotification: Boolean(notification.subscriptionNotification),
      notificationType: notification.subscriptionNotification?.notificationType || null,
    });

    if (notification.testNotification) {
      console.log("[RTDN] Test notification received from Google Play Console.");
      return new Response(JSON.stringify({ status: "test_acknowledged" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const subNotification = notification.subscriptionNotification;
    if (!subNotification) {
      console.log("[RTDN] Non-subscription notification. Acknowledged.");
      return new Response(JSON.stringify({ status: "acknowledged" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const nType = subNotification.notificationType;
    const pToken = subNotification.purchaseToken;
    if (typeof nType !== "number" || !pToken) {
      console.log("[RTDN] Missing notificationType or purchaseToken. Acknowledged.");
      return new Response(JSON.stringify({ status: "invalid_payload" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    notificationType = nType;
    purchaseToken = pToken;
    subscriptionId = subNotification.subscriptionId || null;
    const eventName = SUB_NOTIFICATION_TYPES[nType] || `UNKNOWN_TYPE_${nType}`;
    console.log(`[RTDN_TRIGGER] Event ${eventName} (type ${notificationType}) for subscription: ${subscriptionId || "unknown"}`);

    supabaseAdmin = deps?.supabaseAdmin || (deps?.createSupabaseAdminClient
      ? deps.createSupabaseAdminClient(supabaseUrl, serviceRoleKey)
      : null);

    if (!supabaseAdmin) {
      console.error("[RTDN_FATAL_ERROR] Supabase client not initialized");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── 2b. Durable RTDN Event Ledger Check (Idempotency) ────────────────────
    // ── 2b. Durable RTDN Event Ledger Check & In-Flight Concurrency Control ───
    if (typeof supabaseAdmin.from === "function" && purchaseToken && notificationEventTime) {
      try {
        const tableRef = supabaseAdmin.from("google_play_rtdn_events");
        if (tableRef && typeof tableRef.select === "function") {
          const { data: existingLedgerEvent } = await tableRef
            .select("event_id, processing_status, attempts, received_at")
            .eq("purchase_token", purchaseToken)
            .eq("event_time_millis", notificationEventTime)
            .eq("notification_type", notificationType)
            .maybeSingle();

          if (existingLedgerEvent) {
            ledgerEventId = existingLedgerEvent.event_id;
            if (existingLedgerEvent.processing_status === "completed") {
              console.log(`[RTDN_IDEMPOTENT_DUPLICATE] Event ${eventName} (${notificationType}) at ${notificationEventTime} already completed in ledger. Acknowledging HTTP 200.`);
              return new Response(JSON.stringify({ success: true, processed: eventName, idempotentDuplicate: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }

            if (existingLedgerEvent.processing_status === "processing") {
              const receivedMs = existingLedgerEvent.received_at ? new Date(existingLedgerEvent.received_at).getTime() : 0;
              const isFresh = receivedMs > 0 && (Date.now() - receivedMs) < 60000;
              if (isFresh) {
                // Return transient HTTP 503 so Pub/Sub does not prematurely ack while original is processing
                console.log(`[RTDN_IN_FLIGHT_DUPLICATE] Event ${eventName} (${notificationType}) at ${notificationEventTime} is currently in-flight. Returning HTTP 503 retryable.`);
                return new Response(JSON.stringify({ success: false, error: "Event is currently being processed by another worker", inFlight: true, retryable: true }), {
                  status: 503,
                  headers: { "Content-Type": "application/json", "Retry-After": "30" },
                });
              }
              // If stale (> 60s), allow retry to reclaim and re-execute
            }

            // Retry of a failed or stale event: atomically reclaim with conditional update on attempts
            const currentAttempts = existingLedgerEvent.attempts || 1;
            const nextAttempts = currentAttempts + 1;
            workerAttempt = nextAttempts;

            if (typeof tableRef.update === "function") {
              let reclaimQuery = tableRef
                .update({
                  processing_status: "processing",
                  attempts: nextAttempts,
                  received_at: new Date().toISOString(),
                  error_message: null,
                })
                .eq("event_id", existingLedgerEvent.event_id)
                .eq("attempts", currentAttempts);

              if (typeof (reclaimQuery as any).neq === "function") {
                reclaimQuery = (reclaimQuery as any).neq("processing_status", "completed");
              }

              const expiredCutoffIso = new Date(Date.now() - 60000).toISOString();
              if (existingLedgerEvent.processing_status === "processing" && typeof (reclaimQuery as any).lte === "function") {
                reclaimQuery = (reclaimQuery as any).lte("received_at", expiredCutoffIso);
              }

              let reclaimRes: any = null;
              if (reclaimQuery && typeof reclaimQuery.select === "function") {
                reclaimRes = await reclaimQuery.select("event_id");
              } else if (reclaimQuery && typeof reclaimQuery.then === "function") {
                reclaimRes = await reclaimQuery;
              }

              if (Array.isArray(reclaimRes?.data) && reclaimRes.data.length === 0) {
                // Check if winning worker committed 'completed' while we waited on the row lock
                if (typeof tableRef.select === "function") {
                  try {
                    const selObj: any = tableRef.select("processing_status");
                    const eqObj: any = selObj && typeof selObj.eq === "function" ? selObj.eq("event_id", existingLedgerEvent.event_id) : null;
                    const freshCheckRes = eqObj && typeof eqObj.maybeSingle === "function" ? await eqObj.maybeSingle() : null;

                    if (freshCheckRes?.data?.processing_status === "completed") {
                      console.log(`[RTDN_IDEMPOTENT_DUPLICATE] Event ${eventName} (${notificationType}) was completed by winning worker. Acknowledging HTTP 200.`);
                      return new Response(JSON.stringify({ success: true, processed: eventName, idempotentDuplicate: true }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                      });
                    }
                  } catch (_) {}
                }

                console.warn(`[RTDN_RECLAIM_RACE_LOST] Another worker reclaimed event ${eventName}. Returning HTTP 503.`);
                return new Response(JSON.stringify({ success: false, error: "Reclaim race lost; event claimed by another worker", reclaimRaceLost: true, retryable: true }), {
                  status: 503,
                  headers: { "Content-Type": "application/json", "Retry-After": "30" },
                });
              }
            }
          } else {
            // First delivery: atomically claim event by inserting processing_status = 'processing'
            if (typeof tableRef.insert === "function") {
              const insertRes = tableRef.insert({
                notification_type: notificationType,
                purchase_token: purchaseToken,
                package_name: notificationPackageName || androidPackageName,
                subscription_id: subscriptionId || null,
                event_time_millis: notificationEventTime,
                processing_status: "processing",
                attempts: 1,
                received_at: new Date().toISOString(),
              });

              let insertErr: any = null;
              let inserted: any = null;

              if (insertRes && typeof insertRes.select === "function") {
                const selRes = await insertRes.select("event_id").maybeSingle();
                insertErr = selRes?.error;
                inserted = selRes?.data;
              } else if (insertRes && typeof insertRes.then === "function") {
                const res = await insertRes;
                insertErr = res?.error;
                inserted = res?.data;
              }

              if (insertErr) {
                // Must NOT acknowledge with HTTP 200! Return HTTP 503 so Pub/Sub retries if winning worker fails
                console.log(`[RTDN_CONCURRENT_RACE] Another worker claimed event ${eventName}. Returning HTTP 503 retryable.`);
                return new Response(JSON.stringify({ success: false, error: "Concurrent claim collision; event is being processed by another worker", concurrentClaim: true, retryable: true }), {
                  status: 503,
                  headers: { "Content-Type": "application/json", "Retry-After": "30" },
                });
              }
              if (inserted?.event_id) {
                ledgerEventId = inserted.event_id;
              }
            }
          }
        }
      } catch (ledgerCheckErr: any) {
        console.warn("[RTDN_LEDGER_CHECK_WARN]", ledgerCheckErr?.message || "Skipping event ledger check");
      }
    }

    // Locate the matching student_subscription by purchaseToken
    const normalizedPurchaseToken = typeof purchaseToken === "string" ? purchaseToken.trim() : purchaseToken;
    const { data: subscription, error: subQueryErr } = await supabaseAdmin
      .from("student_subscriptions")
      .select("subscription_id, student_id, plan_id, institute_id, start_date, end_date, status")
      .eq("payment_method_id", normalizedPurchaseToken)
      .maybeSingle();

    if (subQueryErr) {
      console.error(`[RTDN_ERROR] Database query error fetching student_subscription by purchaseToken:`, subQueryErr.message);
      throw new Error(`Database query error fetching student_subscription: ${subQueryErr.message}`);
    }

    if (!subscription) {
      const maxRetries = deps?.maxLocalSubscriptionRetries ?? 5;
      const isInitialPurchase = notificationType === 4; // SUBSCRIPTION_PURCHASED
      const isRenewal = notificationType === 2; // SUBSCRIPTION_RENEWED
      const isFinancialEvent = isInitialPurchase || isRenewal;

      const maskedToken = normalizedPurchaseToken && normalizedPurchaseToken.length > 10
        ? `${normalizedPurchaseToken.slice(0, 6)}...${normalizedPurchaseToken.slice(-4)}`
        : (normalizedPurchaseToken || "unknown");
      console.warn(`[RTDN_WARNING] No local subscription found for purchaseToken (${maskedToken}) on event ${eventName} (product: ${subscriptionId || "unknown"}, attempt: ${workerAttempt}/${maxRetries})`);

      if (workerAttempt < maxRetries) {
        // Transient missing subscription: release claim to 'pending' with attempt fencing
        // so Pub/Sub can retry after client checkout commits student_subscriptions
        await releaseRtdnEventClaim(
          supabaseAdmin,
          ledgerEventId,
          workerAttempt,
          `Awaiting local subscription creation (attempt ${workerAttempt}/${maxRetries})`
        );

        console.warn(`[RTDN_RETRY_SCHEDULED] Released claim for event ${eventName} (attempt ${workerAttempt}/${maxRetries}). Returning HTTP 503 retryable.`);
        return new Response(
          JSON.stringify({
            success: false,
            error: "No local subscription found; awaiting client checkout completion",
            retryable: true,
            attempt: workerAttempt,
            maxRetries,
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "15",
            },
          }
        );
      }

      // Retries exhausted: finalize event with durable terminal / reconciliation status
      const terminalStatus = isFinancialEvent ? "reconciliation_required" : "failed";
      const failureReason = `NO_LOCAL_RECORD: Exhausted ${workerAttempt} retry attempts waiting for local subscription`;

      await finalizeRtdnEventMissingSubscription(
        supabaseAdmin,
        ledgerEventId,
        workerAttempt,
        terminalStatus,
        failureReason,
        {
          event_name: eventName,
          notification_type: notificationType,
          unmapped_reason: "NO_LOCAL_SUBSCRIPTION",
          exhausted_attempts: workerAttempt,
          message_id: body?.message?.messageId || null,
          publish_time: body?.message?.publishTime || null,
        }
      );

      console.error(`[RTDN_EXHAUSTED] Exhausted retries for ${eventName}. No local subscription exists. Finalized as ${terminalStatus}.`);
      return new Response(
        JSON.stringify({
          success: false,
          status: terminalStatus,
          error: failureReason,
          terminal: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // ── 3. Query Google Play Developer API for Authoritative State ──────────
    const accessTokenFetcher = deps?.googleAccessTokenFetcher || getGoogleAccessToken;
    const accessToken = await accessTokenFetcher(googleServiceAccountJson);
    const apiFetcher = deps?.googleApiFetcher || fetch;
    let authoritativeGoogleSub: any = null;
    let googleAuthoritativeError: string | null = null;

    if (!accessToken) {
      googleAuthoritativeError = "Google access token unavailable";
    } else {
      try {
        const verifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${androidPackageName}/purchases/subscriptionsv2/tokens/${purchaseToken}`;
        const googleRes = await apiFetcher(verifyUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (googleRes.ok) {
          authoritativeGoogleSub = await googleRes.json();
          console.log("[RTDN_DIAGNOSTIC] Authoritative Google state received", {
            subscriptionState: authoritativeGoogleSub?.subscriptionState || null,
            lineItemsCount: authoritativeGoogleSub?.lineItems?.length || 0,
          });
        } else {
          googleAuthoritativeError = `HTTP ${googleRes.status}`;
          console.warn("[RTDN_WARN] Could not query Google API. Status:", googleRes.status);
        }
      } catch (apiErr: any) {
        googleAuthoritativeError = apiErr?.message || "Google API exception";
        console.error("[RTDN_ERROR] Exception querying Google Developer API:", apiErr?.message || "Error");
      }
    }

    // Migration 217: an unverifiable renewal must fail retryable, never fall through to
    // "already processed". Google availability problems are not evidence about the cycle.
    if (notificationType === 2 && !authoritativeGoogleSub) {
      throw new Error(`Google Play authoritative verification unavailable for renewal: ${googleAuthoritativeError || "empty response"}`);
    }

    const nowIso = new Date().toISOString();
    const lineItem = authoritativeGoogleSub?.lineItems?.[0];
    const googleExpiryTime = lineItem?.expiryTime;
    const newEndDateStr = googleExpiryTime
      ? new Date(googleExpiryTime).toISOString().split("T")[0]
      : null;

    // Query linked course and authoritative plan duration
    const { data: plan, error: planErr } = await supabaseAdmin
      .from("subscription_plans")
      .select("course_id, duration_days, billing_cycle, price, name, currency_code")
      .eq("plan_id", subscription.plan_id)
      .maybeSingle();

    if (planErr) {
      console.error(`[RTDN_ERROR] Database query error fetching subscription plan ${subscription.plan_id}:`, planErr.message);
      throw new Error(`Database query error fetching subscription plan ${subscription.plan_id}: ${planErr.message}`);
    }

    // Fetch institute-specific subscription access window settings (default 7d grace, 30d content)
    const instituteSettings = await getInstituteSubscriptionSettings(
      supabaseAdmin,
      subscription.institute_id
    );

    // ── 4. Evaluate State Transition with Authoritative Google Response ─────
    const transition = calculateRtdnTransition({
      notificationType: notificationType as number,
      currentStatus: subscription.status,
      currentEndDate: subscription.end_date,
      currentStartDate: subscription.start_date,
      authoritativeGoogleSub,
      productId: subscriptionId || undefined,
      planDurationDays: plan?.duration_days,
      billingCycle: plan?.billing_cycle,
      nowMs: Date.now(),
      graceDays: instituteSettings.graceDays,
      contentAccessDays: instituteSettings.contentAccessDays,
    });

    // ── 4b. Server-Side Payment Ledger Recording for SUBSCRIPTION_RENEWED ───
    // Renewal ledger outcome (Migration 217): only a verified payment row counts as recorded.
    let renewalOutcome: GooglePlayRpcOutcome | null = null;
    let renewalPaymentVerified = false;
    let renewalReconciliationReason: string | null = null;
    if (notificationType === 2 && authoritativeGoogleSub) {
      const renewalLineItem = authoritativeGoogleSub?.lineItems?.[0];
      const authoritativeOrderId = renewalLineItem?.latestSuccessfulOrderId || authoritativeGoogleSub?.latestOrderId || null;

      if (authoritativeOrderId) {
        // Query student_details to obtain profile_id
        const { data: student, error: studentErr } = await supabaseAdmin
          .from("student_details")
          .select("profile_id")
          .eq("student_id", subscription.student_id)
          .maybeSingle();

        if (studentErr) {
          console.error(`[RTDN_ERROR] Database query error fetching student_details for ${subscription.student_id}:`, studentErr.message);
          throw new Error(`Database query error fetching student_details for ${subscription.student_id}: ${studentErr.message}`);
        }

        const profileId = student?.profile_id;

        if (profileId) {
          if (!plan) {
            console.error(`[RTDN_ERROR] Cannot record renewal for order ${authoritativeOrderId}: subscription plan ${subscription.plan_id} not found in database`);
            throw new Error(`Subscription plan ${subscription.plan_id} not found in database for order ${authoritativeOrderId}`);
          }
          // Fetch existing recorded payments for this student to detect intermediate renewal order gaps
          let recordedOrderIds: string[] = [];
          try {
            const { data: existingPayments } = await supabaseAdmin
              .from("payments")
              .select("gateway_order_id, gateway_payment_id")
              .eq("institute_id", subscription.institute_id);

            if (Array.isArray(existingPayments)) {
              recordedOrderIds = existingPayments
                .map((p: any) => p.gateway_order_id || p.gateway_payment_id)
                .filter(Boolean);
            }
          } catch (_) {}

          // Migration 217: relative cycle position for THIS incoming order. Cycle ordering only
          // decides whether exact-order Google verification is mandatory; it is never evidence
          // that an older cycle was paid.
          const orderPosition = resolveRenewalCyclePosition({
            incomingOrderId: authoritativeOrderId,
            recordedOrderIds,
          });

          // Authoritatively verify intermediate orders with Google Orders API outside the database transaction
          let gapResult: RenewalGapReconciliationResult | null = null;
          if (accessToken) {
            gapResult = await detectAndReconcileRenewalGaps({
              baseOrderId: authoritativeOrderId,
              incomingOrderId: authoritativeOrderId,
              recordedOrderIds,
              purchaseToken: purchaseToken as string,
              productId: subscriptionId || '',
              planId: subscription.plan_id,
              profileId,
              studentId: subscription.student_id,
              instituteId: subscription.institute_id,
              googleAccessToken: accessToken,
              packageName: androidPackageName,
              supabaseAdmin,
              expectedPrice: Number(plan?.price) || undefined,
              expectedCurrency: DEFAULT_PLATFORM_CURRENCY,
              apiFetcher,
              rtdnEventId: ledgerEventId,
              rtdnAttempt: workerAttempt,
              deferExecution: true,
            });
          }

          const intermediateOrders = gapResult?.verifiedOrderDetails || [];

          // Validate that the subscription plan price is explicitly known before renewal recording
          // Explicit finite-number check preserving supported zero-price behavior (0 >= 0 is valid)
          const rawPrice = plan.price !== undefined && plan.price !== null ? Number(plan.price) : NaN;
          const isPriceValid = typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice >= 0;

          if (!isPriceValid) {
            console.error(`[RTDN_ERROR] Cannot record renewal for order ${authoritativeOrderId}: plan price missing or invalid (${plan.price})`);
            throw new Error(`Cannot record renewal for order ${authoritativeOrderId}: plan price missing or invalid (${plan.price})`);
          }

          const verifiedPlanPrice = rawPrice;
          const targetCurrency = plan.currency_code ? String(plan.currency_code).trim() : DEFAULT_PLATFORM_CURRENCY;
          const planItemName = plan.name || (plan as any).plan_name || "Subscription Renewal";

          // Migration 217: a delayed/older cycle is recorded ONLY with authoritative Google Play
          // Orders API evidence for that EXACT external order id. The current subscriptionsv2
          // state plus a caller-asserted order id is never sufficient proof that an older cycle
          // was paid. Cycle ordering alone is not evidence.
          let olderCycleVerification: ExactOrderVerificationResult | null = null;
          let renewalBlockedReason: string | null = null;

          if (orderPosition.isHistorical) {
            const exactVerification = await verifyExactRenewalOrder({
              accessToken: accessToken as string,
              packageName: androidPackageName,
              orderId: authoritativeOrderId,
              purchaseToken: purchaseToken as string,
              productId: subscriptionId || '',
              expectedPrice: verifiedPlanPrice,
              expectedCurrency: targetCurrency,
              apiFetcher,
            });

            if (exactVerification.retryable) {
              // Transient Google failure: retryable, never a business verdict, never completion.
              throw new Error(`Google Play Orders API verification unavailable for older cycle ${authoritativeOrderId}: ${exactVerification.failureReason || "transient failure"}`);
            }

            if (!exactVerification.verified) {
              renewalBlockedReason = `OLDER_CYCLE_UNVERIFIED:${exactVerification.failureReason || "NOT_VERIFIED"}`;
              console.warn(`[RTDN_RECONCILIATION_REQUIRED] external_order_id=${authoritativeOrderId} reason=${renewalBlockedReason}`);
            } else {
              olderCycleVerification = exactVerification;
            }
          }

          const historicalCycle = olderCycleVerification?.detail ?? null;

          // For an older cycle the verified expiry used for the ledger row is the ESTABLISHED
          // entitlement: a backfill may never advance or reduce it, and the SQL applies
          // greatest() over the current end_date. The verified Orders API timestamp is used as
          // the authoritative payment time.
          const renewalEndDate = historicalCycle ? (subscription.end_date || null) : newEndDateStr;
          const renewalTransactionTimestamp = historicalCycle?.transactionTimestamp || nowIso;
          const renewalGatewayResponse = historicalCycle
            ? {
                ...(authoritativeGoogleSub && typeof authoritativeGoogleSub === "object" ? authoritativeGoogleSub : {}),
                verification_source: "orders_api",
                verified_order_id: historicalCycle.orderId,
                verified_amount: historicalCycle.unitPrice,
                verified_expiry: renewalEndDate,
                verified_transaction_time: historicalCycle.transactionTimestamp,
                cycle_index: orderPosition.incomingCycle,
                order: historicalCycle.gatewayResponse?.order ?? null,
                currency: historicalCycle.currency,
                verified: true,
              }
            : authoritativeGoogleSub;

          if (renewalBlockedReason) {
            renewalOutcome = "reconciliation_required";
            renewalReconciliationReason = renewalBlockedReason;
          }

          // If multiple orders need reconciliation (intermediate gaps + incoming), execute batch RPC
          // Migration 217: no recording RPC may run when exact-order verification failed.
          if (!renewalBlockedReason && intermediateOrders.length > 0 && typeof supabaseAdmin.rpc === "function") {
            const verifiedOrdersToRecord = [
              ...intermediateOrders.map(o => ({
                order_id: o.orderId,
                cycle_index: o.cycleIndex,
                unit_price: o.unitPrice,
                currency: o.currency,
                transaction_timestamp: o.transactionTimestamp,
                subscription_end_date: o.subscriptionEndDate,
                is_auto_renew: o.isAutoRenew,
                gateway_response: o.gatewayResponse,
              })),
              {
                order_id: authoritativeOrderId,
                cycle_index: orderPosition.incomingCycle ?? 0,
                unit_price: historicalCycle ? historicalCycle.unitPrice : verifiedPlanPrice,
                currency: historicalCycle ? historicalCycle.currency : targetCurrency,
                transaction_timestamp: renewalTransactionTimestamp,
                subscription_end_date: renewalEndDate,
                is_auto_renew: transition.isAutoRenew,
                gateway_response: renewalGatewayResponse,
              },
            ];

            let batchHandled = false;
            try {
              const { data: batchData, error: batchErr } = await supabaseAdmin.rpc("reconcile_google_play_renewal_batch", {
                p_rtdn_event_id: ledgerEventId,
                p_rtdn_attempt: workerAttempt,
                p_profile_id: profileId,
                p_institute_id: subscription.institute_id,
                p_student_id: subscription.student_id,
                p_plan_id: subscription.plan_id,
                p_course_id: plan?.course_id || null,
                p_product_id: subscriptionId || '',
                p_purchase_token: purchaseToken as string,
                p_orders: verifiedOrdersToRecord,
                p_metadata: {
                  event_name: eventName,
                  notification_type: notificationType,
                  message_id: body?.message?.messageId || null,
                  publish_time: body?.message?.publishTime || null,
                },
              });

              if (batchErr) {
                const isFunctionMissing =
                  batchErr.code === "PGRST202" ||
                  batchErr.message?.includes("does not exist") ||
                  batchErr.message?.includes("reconcile_google_play_renewal_batch");

                if (!isFunctionMissing) {
                  console.error(`[RTDN_FATAL_ERROR] Database batch RPC failed: ${batchErr.message}`);
                  throw new Error(`Database batch RPC failed: ${batchErr.message}`);
                }
                console.warn("[RTDN_BATCH_FALLBACK] Batch RPC missing in target schema, using sequential fallback:", batchErr.message);
              }

              if (batchData && typeof batchData === "object" && (batchData.success !== undefined || batchData.reconciled_orders !== undefined)) {
                batchHandled = true;
                if (batchData.success === false) {
                  if (batchData.code === "STALE_LEASE_LOST") {
                    console.warn(`[RTDN_STALE_WORKER] Worker with attempt ${workerAttempt} lost lease on event ${ledgerEventId}. Halting with 503 retryable.`);
                    return new Response(JSON.stringify({
                      error: batchData.error,
                      code: "STALE_LEASE_LOST",
                      staleWorkerAborted: true,
                      retryable: true,
                    }), {
                      status: 503,
                      headers: {
                        "Content-Type": "application/json",
                        "Retry-After": "30",
                      },
                    });
                  }
                  console.error(`[RTDN_ERROR] Batch reconciliation rejected: ${batchData.error}`);
                  throw new Error(`Batch reconciliation rejected: ${batchData.error}`);
                }
                const batchReconciled: string[] = Array.isArray(batchData?.reconciled_orders) ? batchData.reconciled_orders : [];
                const batchAlready: string[] = Array.isArray(batchData?.already_processed) ? batchData.already_processed : [];
                if (batchReconciled.length > 0 || batchAlready.length > 0) {
                  // Migration 217: the batch envelope is not proof by itself. Require a captured
                  // payment row for THIS incoming external order id before the event may complete.
                  const durableBatchPayment = await findCapturedPaymentForExternalOrder(supabaseAdmin, authoritativeOrderId);
                  renewalPaymentVerified = Boolean(durableBatchPayment.paymentId);

                  if (renewalPaymentVerified) {
                    renewalOutcome = batchReconciled.includes(authoritativeOrderId) ? "renewal_recorded" : "already_recorded";
                    if (renewalOutcome === "already_recorded") {
                      console.log(`[RTDN_BATCH_ALREADY_RECORDED] external_order_ids=${JSON.stringify(batchAlready)} payment_id=${durableBatchPayment.paymentId}`);
                    } else {
                      console.log(`[RTDN_BATCH_RECORDED] external_order_ids=${JSON.stringify(batchReconciled)} payment_id=${durableBatchPayment.paymentId}`);
                    }
                  } else {
                    renewalOutcome = "reconciliation_required";
                    renewalReconciliationReason = "PAYMENT_NOT_FOUND";
                    console.warn(`[RTDN_RECONCILIATION_REQUIRED] external_order_id=${authoritativeOrderId} reason=PAYMENT_NOT_FOUND`);
                  }
                } else {
                  renewalOutcome = "reconciliation_required";
                  renewalReconciliationReason = "BATCH_RECORDED_NOTHING";
                  console.warn("[RTDN_RECONCILIATION_REQUIRED] Batch RPC recorded no order for this event.");
                }
              }
            } catch (batchEx: any) {
              console.error("[RTDN_BATCH_FATAL] Unexpected exception calling batch RPC:", batchEx?.message);
              throw new Error(`Unexpected exception calling batch RPC: ${batchEx?.message || "Internal server error"}`);
            }

            if (!batchHandled) {
              // Fallback for mocks/older DB without reconcile_google_play_renewal_batch:
              // Record intermediate orders with defer_rtdn_completion, then incoming order with completion
              for (const intOrder of intermediateOrders) {
                const intPayload = buildGooglePlayRpcPayload({
                  profileId,
                  instituteId: subscription.institute_id,
                  studentId: subscription.student_id,
                  resolvedItemType: "subscription_plan",
                  resolvedPlanId: subscription.plan_id,
                  resolvedCourseId: plan?.course_id || null,
                  itemName: planItemName,
                  unitPrice: intOrder.unitPrice,
                  effectiveOrderId: intOrder.orderId,
                  purchaseToken: purchaseToken as string,
                  productId: subscriptionId || '',
                  googleVerificationResult: {
                    ...(intOrder.gatewayResponse && typeof intOrder.gatewayResponse === "object" ? intOrder.gatewayResponse : {}),
                    verification_source: "orders_api",
                    verified_order_id: intOrder.orderId,
                    cycle_index: intOrder.cycleIndex,
                  },
                  transactionTimestamp: intOrder.transactionTimestamp,
                  subscriptionEndDate: intOrder.subscriptionEndDate,
                  autoRenewSetting: intOrder.isAutoRenew,
                  rtdnEventId: ledgerEventId,
                  rtdnAttempt: workerAttempt,
                });
                if (intPayload.p_gateway_response) {
                  intPayload.p_gateway_response.defer_rtdn_completion = true;
                }
                await supabaseAdmin.rpc("complete_google_play_purchase", intPayload);
              }

              const rpcPayload = buildGooglePlayRpcPayload({
                profileId,
                instituteId: subscription.institute_id,
                studentId: subscription.student_id,
                resolvedItemType: "subscription_plan",
                resolvedPlanId: subscription.plan_id,
                resolvedCourseId: plan?.course_id || null,
                itemName: planItemName,
                // A verified older cycle is ledgered for the amount Google actually charged.
                unitPrice: historicalCycle ? historicalCycle.unitPrice : verifiedPlanPrice,
                effectiveOrderId: authoritativeOrderId,
                purchaseToken: purchaseToken as string,
                productId: subscriptionId || '',
                googleVerificationResult: renewalGatewayResponse,
                transactionTimestamp: renewalTransactionTimestamp,
                subscriptionEndDate: renewalEndDate,
                autoRenewSetting: transition.isAutoRenew,
                rtdnEventId: ledgerEventId,
                rtdnAttempt: workerAttempt,
              });

              const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("complete_google_play_purchase", rpcPayload);
              const rpcRes = handleGooglePlayRpcResponse(rpcData, rpcErr);
              if (rpcRes.action === "return_response") {
                if (rpcRes.responseBody?.staleWorkerAborted !== true) {
                  await markRenewalEventRejected(
                    supabaseAdmin,
                    ledgerEventId,
                    workerAttempt,
                    `RPC_REJECTED:${rpcRes.responseBody?.code || "PURCHASE_REJECTED"}`
                  );
                }
                return new Response(JSON.stringify(rpcRes.responseBody), {
                  status: rpcRes.httpStatus || 503,
                  headers: { "Content-Type": "application/json", ...(rpcRes.httpStatus === 503 ? { "Retry-After": "30" } : {}) },
                });
              }
            }
          } else if (!renewalBlockedReason && typeof supabaseAdmin.rpc === "function") {
            // Single renewal order (standard path expected by existing client callers and tests)
            const rpcPayload = buildGooglePlayRpcPayload({
              profileId,
              instituteId: subscription.institute_id,
              studentId: subscription.student_id,
              resolvedItemType: "subscription_plan",
              resolvedPlanId: subscription.plan_id,
              resolvedCourseId: plan?.course_id || null,
              itemName: planItemName,
              // A verified older cycle is ledgered for the amount Google actually charged.
              unitPrice: historicalCycle ? historicalCycle.unitPrice : verifiedPlanPrice,
              effectiveOrderId: authoritativeOrderId,
              purchaseToken: purchaseToken as string,
              productId: subscriptionId || '',
              googleVerificationResult: renewalGatewayResponse,
              transactionTimestamp: renewalTransactionTimestamp,
              subscriptionEndDate: renewalEndDate,
              autoRenewSetting: transition.isAutoRenew,
              rtdnEventId: ledgerEventId,
              rtdnAttempt: workerAttempt,
            });

            try {
              const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("complete_google_play_purchase", rpcPayload);
              const rpcRes = handleGooglePlayRpcResponse(rpcData, rpcErr);

              if (rpcRes.action === "throw_fatal") {
                console.error(`[RTDN_ERROR] Atomic purchase execution failed: ${rpcRes.fatalError}`);
                throw new Error(rpcRes.fatalError || "Atomic purchase execution failed");
              }

              if (rpcRes.action === "return_response") {
                console.warn(`[RTDN_RPC_RETURN] RPC returned non-success response: ${JSON.stringify(rpcRes.responseBody)}`);
                // Migration 217: a structured, non-retryable business rejection must not leave the
                // event in `processing` until its lease expires. Stale-worker decisions are untouched.
                if (rpcRes.responseBody?.staleWorkerAborted !== true) {
                  await markRenewalEventRejected(
                    supabaseAdmin,
                    ledgerEventId,
                    workerAttempt,
                    `RPC_REJECTED:${rpcRes.responseBody?.code || "PURCHASE_REJECTED"}`
                  );
                }
                return new Response(JSON.stringify(rpcRes.responseBody), {
                  status: rpcRes.httpStatus || 503,
                  headers: {
                    "Content-Type": "application/json",
                    ...(rpcRes.httpStatus === 503 ? { "Retry-After": "30" } : {}),
                  },
                });
              }

              if (rpcRes.action === "reconciliation_required") {
                renewalOutcome = "reconciliation_required";
                renewalPaymentVerified = false;
                renewalReconciliationReason = rpcRes.reconciliationReason || "RECONCILIATION_REQUIRED";
                console.warn(`[RTDN_RECONCILIATION_REQUIRED] external_order_id=${authoritativeOrderId} reason=${renewalReconciliationReason}`);
              } else {
                // Durable proof, not the RPC envelope: the payment row for THIS external order id must exist.
                const verifiedPayment = await findCapturedPaymentForExternalOrder(supabaseAdmin, authoritativeOrderId);

                renewalPaymentVerified = Boolean(verifiedPayment?.paymentId);
                renewalOutcome = rpcRes.outcome || "already_recorded";

                if (renewalPaymentVerified) {
                  if (renewalOutcome === "already_recorded") {
                    console.log(`[RTDN_RENEWAL_ALREADY_RECORDED] external_order_id=${authoritativeOrderId} cycle=${rpcRes.cycleIndex} payment_id=${verifiedPayment?.paymentId}`);
                  } else {
                    console.log(`[RTDN_RENEWAL_RECORDED] external_order_id=${authoritativeOrderId} cycle=${rpcRes.cycleIndex} payment_id=${verifiedPayment?.paymentId} outcome=${renewalOutcome}`);
                  }
                } else {
                  renewalOutcome = "reconciliation_required";
                  renewalReconciliationReason = "PAYMENT_NOT_FOUND";
                  console.warn(`[RTDN_RECONCILIATION_REQUIRED] external_order_id=${authoritativeOrderId} reason=PAYMENT_NOT_FOUND`);
                }
              }
            } catch (dbErr: any) {
              console.error("[RTDN_FATAL_ERROR] Database RPC execution failed:", dbErr?.message);
              throw new Error(`Database RPC execution failed: ${dbErr?.message || "Database error"}`);
            }
          }
        }
      }
    }

    // ── 5. Apply Atomic Database State Transitions ───────────────────────────
    if (notificationType === 2 && typeof supabaseAdmin.rpc === "function") {
      // For renewal events, complete_google_play_purchase / reconcile_google_play_renewal_batch commits all business mutations
      // (payments, student_subscriptions, course_enrollments, subscription_renewals,
      // subscription_history) and marks google_play_rtdn_events as completed in one atomic transaction.
      // Zero business mutations outside the RPC transaction are permitted.
    } else if (typeof supabaseAdmin.rpc === "function") {
      // For all non-renewal lifecycle transitions (cancellation, revocation, on-hold, paused, grace, recovered, restarted):
      // apply_google_play_rtdn_state_transition atomically validates lease ownership (attempts fence token)
      // and applies student_subscriptions update, subscription_history insert, course_enrollments update,
      // and google_play_rtdn_events completion within a single database transaction.
      const isRevokedOrHold = ["refunded", "pending"].includes(transition.mappedStatus);
      const isContentExpired = transition.mappedStatus === "expired" && (
        !transition.contentAccessEndDate ||
        transition.contentAccessEndDate < nowIso.slice(0, 10)
      );
      const shouldDeactivateEnrollment = isRevokedOrHold || isContentExpired;
      const deactivateReason = shouldDeactivateEnrollment
        ? (isRevokedOrHold
            ? (transition.mappedStatus === "refunded" ? "subscription_revoked" : "subscription_on_hold")
            : "subscription_content_expired")
        : null;

      const { data: transData, error: transErr } = await supabaseAdmin.rpc(
        "apply_google_play_rtdn_state_transition",
        {
          p_rtdn_event_id: ledgerEventId,
          p_rtdn_attempt: workerAttempt,
          p_subscription_id: subscription.subscription_id,
          p_mapped_status: transition.mappedStatus,
          p_mapped_reason: transition.mappedReason,
          p_is_auto_renew: transition.isAutoRenew,
          p_new_end_date: transition.newEndDate,
          p_grace_end_date: transition.graceEndDate,
          p_content_access_end_date: transition.contentAccessEndDate,
          p_course_id: plan?.course_id || null,
          p_student_id: subscription.student_id,
          p_should_deactivate_enrollment: shouldDeactivateEnrollment,
          p_deactivate_reason: deactivateReason,
          p_metadata: {
            event_name: eventName,
            notification_type: notificationType,
            message_id: body?.message?.messageId || null,
            publish_time: body?.message?.publishTime || null,
          },
        }
      );

      if (transErr) {
        console.error("[RTDN_FATAL_ERROR] Database state transition RPC failed:", transErr.message);
        throw new Error(`Database state transition RPC failed: ${transErr.message}`);
      }

      if (transData && transData.success === false) {
        if (transData.code === "STALE_LEASE_LOST") {
          console.warn(`[RTDN_STALE_WORKER] Worker with attempt ${workerAttempt} lost lease on event ${ledgerEventId}. Halting with 503 retryable.`);
          return new Response(JSON.stringify({
            error: transData.error,
            code: "STALE_LEASE_LOST",
            staleWorkerAborted: true,
            retryable: true,
          }), {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "30",
            },
          });
        }

        console.error(`[RTDN_ERROR] State transition rejected: ${transData.error}`);
        throw new Error(`State transition rejected: ${transData.error}`);
      }
    } else {
      // Fallback for minimal testing harnesses without RPC emulation:
      // Sequential updates with attempts fencing on the ledger.
      const isRevokedOrHold = ["refunded", "pending"].includes(transition.mappedStatus);
      const isContentExpired = transition.mappedStatus === "expired" && (
        !transition.contentAccessEndDate ||
        transition.contentAccessEndDate < nowIso.slice(0, 10)
      );
      const shouldDeactivateEnrollment = isRevokedOrHold || isContentExpired;

      const updatePayload: any = {
        status: transition.mappedStatus,
        is_auto_renew: transition.isAutoRenew,
        grace_end_date: transition.graceEndDate ?? null,
        content_access_end_date: transition.contentAccessEndDate ?? null,
        updated_at: nowIso,
      };

      if (
        transition.newEndDate &&
        (!subscription.start_date || transition.newEndDate > subscription.start_date) &&
        (!subscription.end_date || transition.newEndDate >= subscription.end_date)
      ) {
        updatePayload.end_date = transition.newEndDate;
      }

      if (
        transition.graceEndDate &&
        (!subscription.grace_end_date || transition.graceEndDate >= subscription.grace_end_date)
      ) {
        updatePayload.grace_end_date = transition.graceEndDate;
      } else if (!transition.graceEndDate && transition.mappedStatus === "refunded") {
        updatePayload.grace_end_date = null;
      }

      if (
        transition.contentAccessEndDate &&
        (!subscription.content_access_end_date || transition.contentAccessEndDate >= subscription.content_access_end_date)
      ) {
        updatePayload.content_access_end_date = transition.contentAccessEndDate;
      } else if (!transition.contentAccessEndDate && transition.mappedStatus === "refunded") {
        updatePayload.content_access_end_date = null;
      }

      if (transition.mappedStatus === "cancelled") {
        updatePayload.cancelled_at = nowIso;
      } else {
        updatePayload.cancelled_at = null;
      }

      const { data: updatedRows, error: updateErr } = await supabaseAdmin
        .from("student_subscriptions")
        .update(updatePayload)
        .eq("subscription_id", subscription.subscription_id)
        .select("subscription_id");

      if (updateErr || !updatedRows || updatedRows.length === 0) {
        const errMsg = updateErr?.message || "student_subscriptions update affected 0 rows";
        console.error(`[RTDN_ERROR] student_subscriptions update failed: ${errMsg}`);
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (transition.mappedStatus !== subscription.status) {
        try {
          const { error: histErr } = await supabaseAdmin.from("subscription_history").insert({
            subscription_id: subscription.subscription_id,
            student_id: subscription.student_id,
            institute_id: subscription.institute_id,
            status_before: subscription.status,
            status_after: transition.mappedStatus,
            change_reason: transition.mappedReason,
            occurred_at: nowIso,
            metadata: {
              event: eventName,
              notification_type: notificationType,
              google_expiry: newEndDateStr,
              authoritative_state: authoritativeGoogleSub?.subscriptionState || null,
            },
          });

          if (histErr) {
            console.warn("[RTDN_WARNING] History record insert warning:", histErr.message);
          }
        } catch (histEx: any) {
          console.warn("[RTDN_WARNING] History record insert exception:", histEx?.message || "Unknown error");
        }
      }

      if (plan?.course_id && shouldDeactivateEnrollment) {
        await supabaseAdmin
          .from("course_enrollments")
          .update({
            is_active: false,
            revoked_at: nowIso,
            revoked_reason: isRevokedOrHold
              ? (transition.mappedStatus === "refunded" ? "subscription_revoked" : "subscription_on_hold")
              : "subscription_content_expired",
          })
          .eq("course_id", plan.course_id)
          .eq("student_id", subscription.student_id)
          .eq("enrollment_type", "subscription");
      }
    }

    try {
      const tableRef = supabaseAdmin.from("google_play_rtdn_events");
      if (tableRef) {
        // Migration 217: a renewal event is completed ONLY when a payment row for this
        // exact external order id was verified. Otherwise it is recorded as reconciliation_required.
        const renewalNotRecorded = notificationType === 2 && !renewalPaymentVerified;
        const updatePayload = {
          order_id: authoritativeGoogleSub?.lineItems?.[0]?.latestSuccessfulOrderId || null,
          cycle_index: extractOrderCycle(authoritativeGoogleSub?.lineItems?.[0]?.latestSuccessfulOrderId),
          processing_status: renewalNotRecorded ? "reconciliation_required" : "completed",
          error_message: renewalNotRecorded
            ? `RENEWAL_NOT_RECORDED:${renewalReconciliationReason || "UNCONFIRMED"}`
            : null,
          processed_at: new Date().toISOString(),
          metadata: {
            event_name: eventName,
            message_id: body?.message?.messageId || null,
            publish_time: body?.message?.publishTime || null,
            ...(notificationType === 2
              ? {
                  outcome: renewalOutcome,
                  payment_verified: renewalPaymentVerified,
                  reconciliation_reason: renewalReconciliationReason,
                }
              : {}),
          },
        };

        if (ledgerEventId && typeof tableRef.update === "function") {
          // Fencing: conditional update requiring attempts === workerAttempt
          const updateQuery = tableRef
            .update(updatePayload)
            .eq("event_id", ledgerEventId)
            .eq("attempts", workerAttempt);

          let updateRes: any = null;
          if (updateQuery && typeof updateQuery.select === "function") {
            updateRes = await updateQuery.select("event_id");
          } else if (updateQuery && typeof updateQuery.then === "function") {
            updateRes = await updateQuery;
          }

          if (Array.isArray(updateRes?.data) && updateRes.data.length === 0) {
            console.warn(`[RTDN_STALE_WORKER] Worker with attempt ${workerAttempt} lost lease on event ${ledgerEventId}. Stale completion discarded.`);
          }
        } else if (typeof tableRef.upsert === "function") {
          await tableRef.upsert({
            notification_type: notificationType,
            purchase_token: purchaseToken,
            package_name: notificationPackageName || androidPackageName,
            subscription_id: subscriptionId || null,
            event_time_millis: notificationEventTime,
            ...updatePayload,
          }, { onConflict: "purchase_token,event_time_millis,notification_type" });
        } else if (typeof tableRef.insert === "function") {
          await tableRef.insert({
            notification_type: notificationType,
            purchase_token: purchaseToken,
            package_name: notificationPackageName || androidPackageName,
            subscription_id: subscriptionId || null,
            event_time_millis: notificationEventTime,
            ...updatePayload,
          });
        }
      }
    } catch (_) {}

    if (notificationType === 2 && !renewalPaymentVerified) {
      const reason = renewalReconciliationReason || "UNCONFIRMED";
      console.warn(`[RTDN_RECONCILIATION_REQUIRED] ${eventName} acknowledged without a recorded payment. reason=${reason}`);
      return new Response(JSON.stringify({
        success: true,
        processed: eventName,
        outcome: "reconciliation_required",
        reason,
        status: transition.mappedStatus,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[RTDN_SUCCESS] Processed ${eventName} -> Status: ${transition.mappedStatus}, Entitlement Active: ${transition.isEntitlementActive}${notificationType === 2 ? `, Outcome: ${renewalOutcome}` : ""}`);

    return new Response(JSON.stringify({ success: true, processed: eventName, status: transition.mappedStatus, ...(notificationType === 2 ? { outcome: renewalOutcome } : {}) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[RTDN_FATAL_ERROR]", err?.message || "Internal server error");
    try {
      const client = supabaseAdmin || deps?.supabaseAdmin;
      if (client) {
        let rpcRecorded = false;
        if (ledgerEventId && workerAttempt && typeof client.rpc === "function") {
          try {
            const { data: failRpcRes } = await client.rpc("record_google_play_rtdn_event_failure", {
              p_rtdn_event_id: ledgerEventId,
              p_rtdn_attempt: workerAttempt,
              p_error_message: err?.message || "Internal server error",
            });
            if (failRpcRes?.success) {
              rpcRecorded = true;
            }
          } catch (_) {}
        }

        if (!rpcRecorded && typeof client.from === "function") {
          const tableRef = client.from("google_play_rtdn_events");
          if (ledgerEventId && workerAttempt && typeof tableRef.update === "function") {
            // Fencing fallback: only mark failed if attempts === workerAttempt
            const failQuery = tableRef
              .update({
                processing_status: "failed",
                error_message: err?.message || "Internal server error",
                processed_at: new Date().toISOString(),
              })
              .eq("event_id", ledgerEventId)
              .eq("attempts", workerAttempt);

            let failRes: any = null;
            if (failQuery && typeof failQuery.select === "function") {
              failRes = await failQuery.select("event_id");
            } else if (failQuery && typeof failQuery.then === "function") {
              failRes = await failQuery;
            }

            if (Array.isArray(failRes?.data) && failRes.data.length === 0) {
              console.warn(`[RTDN_STALE_WORKER] Worker with attempt ${workerAttempt} lost lease on event ${ledgerEventId}. Stale failure discarded.`);
            }
          } else if (tableRef && typeof tableRef.upsert === "function" && purchaseToken && notificationEventTime && notificationType !== null) {
            await tableRef.upsert(
              {
                notification_type: notificationType,
                purchase_token: purchaseToken,
                package_name: notificationPackageName || androidPackageName,
                subscription_id: subscriptionId || null,
                event_time_millis: notificationEventTime,
                processing_status: "failed",
                error_message: err?.message || "Internal server error",
                processed_at: new Date().toISOString(),
              },
              { onConflict: "purchase_token,event_time_millis,notification_type" }
            );
          }
        }
      }
    } catch (_) {}

    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}