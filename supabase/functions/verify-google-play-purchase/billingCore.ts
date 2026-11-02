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
export function validatePaymentTimestampConstraint(createdAt: string, paidAt?: string | null): boolean {
  if (paidAt === null || paidAt === undefined) return true;
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
  transactionTimestamp?: string | null;
  gatewayResponse: any;
  purchaseToken?: string;
}) {
  const enhancedResponse =
    params.gatewayResponse && typeof params.gatewayResponse === 'object'
      ? {
          ...params.gatewayResponse,
          ...(params.purchaseToken ? { purchaseToken: params.purchaseToken } : {}),
        }
      : params.gatewayResponse;

  const ts = params.transactionTimestamp || new Date().toISOString();
  return {
    order_id: params.orderId,
    institute_id: params.instituteId,
    attempt_number: 1,
    gateway: 'google_play',
    gateway_order_id: params.effectiveOrderId,
    gateway_payment_id: params.effectiveOrderId,
    gateway_response: enhancedResponse,
    amount: params.amount,
    currency: params.currency,
    status: 'captured',
    created_at: ts,
    paid_at: ts,
    updated_at: ts,
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
      if (parsed && typeof parsed === 'object') {
        if (parsed.purchaseToken === purchaseToken || (orderId && parsed.orderId === orderId)) {
          return o.order_id;
        }
      }
    } catch {
      // If JSON.parse fails due to trailing text or malformed JSON, fallback to safe regex extraction
      if (typeof o.notes === 'string') {
        const tokenMatch = o.notes.match(/"purchaseToken"\s*:\s*"([^"]+)"/);
        if (tokenMatch && tokenMatch[1] === purchaseToken) {
          return o.order_id;
        }
        if (orderId) {
          const orderMatch = o.notes.match(/"orderId"\s*:\s*"([^"]+)"/);
          if (orderMatch && orderMatch[1] === orderId) {
            return o.order_id;
          }
        }
      }
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
}) {
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
    p_gateway_response: params.googleVerificationResult && typeof params.googleVerificationResult === 'object'
      ? {
          ...params.googleVerificationResult,
          purchaseToken: params.purchaseToken,
          verified: true,
          verified_at: params.transactionTimestamp,
        }
      : {
          verified: true,
          productId: params.productId,
          purchaseToken: params.purchaseToken,
          verified_at: params.transactionTimestamp,
        },
    p_transaction_timestamp: params.transactionTimestamp || new Date().toISOString(),
    p_subscription_end_date: params.subscriptionEndDate || null,
    p_is_auto_renew: params.autoRenewSetting !== undefined ? params.autoRenewSetting : true,
    p_billing_name: params.billingName || 'Student',
    p_billing_email: params.billingEmail || 'student@makemetopper.com',
  };
}

export interface RpcHandlingResult {
  action: 'proceed_to_post_commit' | 'return_response' | 'throw_fatal';
  effectiveFinalOrderId?: string;
  entitlementGranted?: string;
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

  if (rpcData?.success) {
    return {
      action: 'proceed_to_post_commit',
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
export interface AuthoritativeOrderResolution {
  authoritativeOrderId: string;
  isAuthoritative: boolean;
  source:
    | 'google_subscription_line_item_order_id'
    | 'google_inapp_order_id'
    | 'google_subscription_latest_order_id'
    | 'deterministic_token_hash';
  diagnosticClientOrderId?: string | null;
}

/**
 * Computes a standard SHA-256 cryptographic digest of a purchase token using the Web Crypto API.
 * Returns a 32-character (128-bit) uppercase hexadecimal prefix for collision-resistant,
 * deterministic transaction identity when Google Play Developer API omits an order ID.
 */
export async function computeTokenDigest(token: string): Promise<string> {
  const safeToken = token || '';
  const encoder = new TextEncoder();
  const data = encoder.encode(safeToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const fullHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return fullHex.slice(0, 32);
}

/**
 * Backward-compatible async helper for computeTokenDigest.
 */
export async function deterministicTokenHash(token: string): Promise<string> {
  return computeTokenDigest(token);
}

/**
 * Resolves authoritative order ID for Google Play purchase verification.
 *
 * Strict Security Principles (F-09 Final Review):
 * 1. Prefers authoritative identifier returned by Google Play Developer API:
 *    - For subscriptions: googleVerificationResult.latestOrderId
 *    - For in-app products: googleVerificationResult.orderId
 * 2. NEVER uses client-provided orderId for payment identity or replay detection.
 *    Client-supplied orderId is an untrusted client string that an attacker can modify
 *    to bypass replay checks or trigger false renewal processing.
 * 3. Fallback (sandbox / test purchases where Google Developer API omits orderId):
 *    Derives a cryptographic SHA-256 digest strictly from purchaseToken:
 *    - For subscriptions: GPA.SUB.<SHA256_32HEX>
 *    - For in-app products: GPA.TOK.<SHA256_32HEX>
 *    Because purchaseToken is identical across retries and validated by Google,
 *    this identifier is 100% deterministic, collision-resistant, and immune to client manipulation.
 */
export async function resolveAuthoritativeOrderId(params: {
  isSub: boolean;
  googleVerificationResult?: any;
  clientOrderId?: string | null;
  purchaseToken: string;
  productId?: string | null;
}): Promise<AuthoritativeOrderResolution> {
  const { isSub, googleVerificationResult, clientOrderId, purchaseToken, productId } = params;
  const diagnosticClientOrderId = (clientOrderId && typeof clientOrderId === 'string' && clientOrderId.trim() !== '')
    ? clientOrderId.trim()
    : null;

  const lineItems = Array.isArray(googleVerificationResult?.lineItems) ? googleVerificationResult.lineItems : [];
  const normalizedProductId = (productId && typeof productId === 'string' && productId.trim() !== '')
    ? productId.trim()
    : null;

  // 1. Authoritative line item selection:
  // - If productId is supplied: ONLY match the line item for that specific product.
  //   Never select an unrelated product's line item.
  // - If productId is NOT supplied: match ONLY if there is exactly 1 line item.
  //   If there are multiple line items and no productId, the response is ambiguous across items.
  let matchedLineItem: any = null;
  if (normalizedProductId) {
    matchedLineItem = lineItems.find(
      (item: any) =>
        item?.productId === normalizedProductId &&
        typeof item?.latestSuccessfulOrderId === 'string' &&
        item.latestSuccessfulOrderId.trim() !== ''
    ) || null;
  } else if (lineItems.length === 1) {
    const singleItem = lineItems[0];
    if (typeof singleItem?.latestSuccessfulOrderId === 'string' && singleItem.latestSuccessfulOrderId.trim() !== '') {
      matchedLineItem = singleItem;
    }
  }

  // 2. Authoritative root-level latestOrderId eligibility:
  // Root latestOrderId on SubscriptionPurchaseV2 is only justified when:
  // a) Subscription state supports it (ACTIVE, IN_GRACE_PERIOD, CANCELED).
  // b) Product context is unambiguous:
  //    - No productId supplied AND lineItems.length <= 1; OR
  //    - ProductId supplied AND lineItems.length <= 1 (if 1 item, item.productId must match normalizedProductId).
  // If lineItems.length > 1, root latestOrderId is ambiguous across products and MUST NOT be used.
  // If lineItems has 1 item and item.productId !== normalizedProductId, root latestOrderId belongs to another product and MUST NOT be used.
  const isRootOrderIdJustified = (): boolean => {
    const subState = googleVerificationResult?.subscriptionState;
    const isStateSupported = !subState || subState === 'SUBSCRIPTION_STATE_ACTIVE' || subState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' || subState === 'SUBSCRIPTION_STATE_CANCELED';
    if (!isStateSupported) return false;

    if (lineItems.length === 0) return true;
    if (lineItems.length === 1) {
      return !normalizedProductId || lineItems[0]?.productId === normalizedProductId;
    }
    return false;
  };

  if (isSub) {
    // Subscription flow:
    if (matchedLineItem?.latestSuccessfulOrderId) {
      return {
        authoritativeOrderId: matchedLineItem.latestSuccessfulOrderId.trim(),
        isAuthoritative: true,
        source: 'google_subscription_line_item_order_id',
        diagnosticClientOrderId,
      };
    }

    if (
      isRootOrderIdJustified() &&
      googleVerificationResult?.latestOrderId &&
      typeof googleVerificationResult.latestOrderId === 'string' &&
      googleVerificationResult.latestOrderId.trim() !== ''
    ) {
      return {
        authoritativeOrderId: googleVerificationResult.latestOrderId.trim(),
        isAuthoritative: true,
        source: 'google_subscription_latest_order_id',
        diagnosticClientOrderId,
      };
    }
  } else {
    // In-app one-time purchase flow:
    if (
      googleVerificationResult?.orderId &&
      typeof googleVerificationResult.orderId === 'string' &&
      googleVerificationResult.orderId.trim() !== ''
    ) {
      return {
        authoritativeOrderId: googleVerificationResult.orderId.trim(),
        isAuthoritative: true,
        source: 'google_inapp_order_id',
        diagnosticClientOrderId,
      };
    }

    // Cross-fallback: check unambiguous subscription line item or root order ID if payload is a subscription
    if (matchedLineItem?.latestSuccessfulOrderId) {
      return {
        authoritativeOrderId: matchedLineItem.latestSuccessfulOrderId.trim(),
        isAuthoritative: true,
        source: 'google_subscription_line_item_order_id',
        diagnosticClientOrderId,
      };
    }

    if (
      isRootOrderIdJustified() &&
      googleVerificationResult?.latestOrderId &&
      typeof googleVerificationResult.latestOrderId === 'string' &&
      googleVerificationResult.latestOrderId.trim() !== ''
    ) {
      return {
        authoritativeOrderId: googleVerificationResult.latestOrderId.trim(),
        isAuthoritative: true,
        source: 'google_subscription_latest_order_id',
        diagnosticClientOrderId,
      };
    }
  }

  // Deterministic SHA-256 fallback derived strictly from purchaseToken.
  // CRITICAL: clientOrderId is NEVER used as fallback identity.
  // When an order is missing, ambiguous, or belonging to another product,
  // this returns isAuthoritative = false, guaranteeing it fails closed in evaluateExistingPaymentMatch.
  const hash = await computeTokenDigest(purchaseToken);
  const prefix = isSub ? 'GPA.SUB' : 'GPA.TOK';

  return {
    authoritativeOrderId: prefix + '.' + hash,
    isAuthoritative: false,
    source: 'deterministic_token_hash',
    diagnosticClientOrderId,
  };
}

export interface ExistingPaymentCheckParams {
  isSub: boolean;
  authoritativeOrderId: string;
  purchaseToken: string;
  existingPayment: {
    payment_id: string;
    order_id: string;
    status: string;
    gateway_payment_id?: string | null;
    gateway_order_id?: string | null;
    gateway_response?: any;
    orders?: {
      profile_id?: string | null;
      student_id?: string | null;
      notes?: any;
    } | null;
  } | null;
  currentProfileId: string;
  googleVerificationResult?: any;
  existingSubscriptionEndDate?: string | null;
  existingSubscriptionOrderId?: string | null;
  transactionTimestamp?: string | number | Date | null;
  productId?: string | null;
}

export interface ExistingPaymentCheckResult {
  isDuplicate: boolean;
  isAccountMismatch: boolean;
  isSubscriptionRenewal: boolean;
  isEntitlementRecovery?: boolean;
  isMissingSubscriptionEvidence?: boolean;
  paymentOwnerProfileId?: string | null;
  existingOrderId?: string;
  decisionReason?: string;
}

/**
 * Extracts Google Play order renewal cycle index.
 * - Suffix '..0' -> cycle 0 (1st renewal)
 * - Suffix '..1' -> cycle 1 (2nd renewal)
 * - Suffix '..N' -> cycle N
 * - Unsuffixed base order (GPA.xxxx) -> cycle -1 (initial purchase)
 * - Synthetic token fallback (GPA.SUB.xxxx) -> cycle -1
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
 * Evaluates whether an existing captured payment in PostgreSQL represents:
 * 1. An unauthorized cross-account token replay (account mismatch).
 * 2. An idempotent retry of the exact same transaction (duplicate).
 * 3. The reconciliation of a previously recorded fallback ID to a delayed Google-issued ID.
 * 4. A legitimate recurring subscription renewal cycle (new latestOrderId with cycle >= 1).
 * 5. An entitlement recovery for an already-recorded payment with missing local subscription state.
 */
export function evaluateExistingPaymentMatch(
  params: ExistingPaymentCheckParams
): ExistingPaymentCheckResult {
  const {
    isSub,
    authoritativeOrderId,
    existingPayment,
    currentProfileId,
    googleVerificationResult,
    existingSubscriptionEndDate,
    existingSubscriptionOrderId,
    transactionTimestamp,
    productId,
  } = params;

  if (!existingPayment) {
    return {
      isDuplicate: false,
      isAccountMismatch: false,
      isSubscriptionRenewal: false,
      decisionReason: 'no_existing_payment',
    };
  }

  const paymentOwnerProfileId = existingPayment.orders?.profile_id || null;
  const isAccountMismatch = Boolean(paymentOwnerProfileId && paymentOwnerProfileId !== currentProfileId);

  if (isAccountMismatch) {
    return {
      isDuplicate: true,
      isAccountMismatch: true,
      isSubscriptionRenewal: false,
      paymentOwnerProfileId,
      existingOrderId: existingPayment.order_id,
      decisionReason: 'account_mismatch',
    };
  }

  // For subscriptions: distinguish renewal from idempotent retry or transition from fallback ID
  if (isSub) {
    const existingRecordedId = existingPayment.gateway_payment_id || existingPayment.gateway_order_id || '';

    // A renewal requires an authoritative incoming order ID distinct from the recorded payment
    const isDistinctOrder = Boolean(
      existingRecordedId &&
      authoritativeOrderId &&
      existingRecordedId !== authoritativeOrderId
    );

    const isIncomingFallback = authoritativeOrderId.startsWith('GPA.SUB.');
    const isExistingFallback = existingRecordedId.startsWith('GPA.SUB.');

    if (isDistinctOrder && !isIncomingFallback) {
      // In Google Play, the initial subscription purchase uses an unsuffixed order ID (e.g. GPA.xxxx).
      // The 1st renewal receives cycle index 0 suffix: ..0 (e.g. GPA.xxxx..0).
      // The 2nd renewal receives cycle index 1 suffix: ..1 (e.g. GPA.xxxx..1).
      // Subsequent renewals receive incrementing cycle indexes (..2, ..3, etc.).
      // Any genuine renewal cycle suffix matches /\.\.\d+$/
      const isValidRenewalCycle = /\.\.\d+$/.test(authoritativeOrderId);
      if (!isValidRenewalCycle) {
        return {
          isDuplicate: true,
          isAccountMismatch: false,
          isSubscriptionRenewal: false,
          paymentOwnerProfileId,
          existingOrderId: existingPayment.order_id,
          decisionReason: 'invalid_renewal_cycle_format',
        };
      }

      const incomingCycle = extractOrderCycle(authoritativeOrderId);
      const recordedCycle = extractOrderCycle(existingRecordedId);
      const isNewerCycle = (incomingCycle !== null && recordedCycle !== null && incomingCycle > recordedCycle);

      // Strictly fail-closed renewal verification:
      // Require ALL mandatory evidence:
      // 1. Google-verified subscription expiry must be non-null and parseable.
      // 2. Google-verified expiry must be strictly later than current transaction reference time.
      // 3. Google subscription state must not indicate an expired/canceled subscription.
      // 4. If a previously granted subscription expiry is established, the Google-verified expiry
      //    must advance beyond it, be an RTDN-synchronized reconciliation, or be a verified license-test renewal.
      const lineItems = Array.isArray(googleVerificationResult?.lineItems) ? googleVerificationResult.lineItems : [];
      let matchedItem = (productId && typeof productId === 'string')
        ? lineItems.find((item: any) => item?.productId === productId && item?.expiryTime)
        : null;
      if (!matchedItem && (!productId || lineItems.length === 1)) {
        matchedItem = lineItems.find((item: any) => item?.expiryTime);
      }
      const googleExpiry = matchedItem?.expiryTime || (lineItems.length === 0 ? googleVerificationResult?.expiryTimeMillis : null);

      if (!googleExpiry) {
        // Missing required expiry evidence: fail closed, treat as duplicate/already processed
        return {
          isDuplicate: true,
          isAccountMismatch: false,
          isSubscriptionRenewal: false,
          paymentOwnerProfileId,
          existingOrderId: existingPayment.order_id,
          decisionReason: 'missing_expiry_evidence',
        };
      }

      const gTime = new Date(/^\d+$/.test(String(googleExpiry)) ? parseInt(String(googleExpiry), 10) : String(googleExpiry)).getTime();
      if (isNaN(gTime)) {
        return {
          isDuplicate: true,
          isAccountMismatch: false,
          isSubscriptionRenewal: false,
          paymentOwnerProfileId,
          existingOrderId: existingPayment.order_id,
          decisionReason: 'unparseable_google_expiry',
        };
      }

      // Verify Google-verified expiry is strictly in the future relative to the transaction timestamp
      const refTime = transactionTimestamp ? new Date(transactionTimestamp).getTime() : Date.now();
      if (gTime <= refTime) {
        // Expiry has already lapsed or is not strictly in the future: fail closed
        return {
          isDuplicate: true,
          isAccountMismatch: false,
          isSubscriptionRenewal: false,
          paymentOwnerProfileId,
          existingOrderId: existingPayment.order_id,
          decisionReason: 'google_expiry_in_past',
        };
      }

      // Verify Google subscription state if present
      const subState = googleVerificationResult?.subscriptionState;
      if (subState && subState !== 'SUBSCRIPTION_STATE_ACTIVE' && subState !== 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
        return {
          isDuplicate: true,
          isAccountMismatch: false,
          isSubscriptionRenewal: false,
          paymentOwnerProfileId,
          existingOrderId: existingPayment.order_id,
          decisionReason: 'inactive_subscription_state',
        };
      }

      // Detect official Google Play license test purchase
      // Google Play Developer API SubscriptionsV2 returns testPurchase: {} for license test purchases.
      const isTestPurchase = Boolean(
        googleVerificationResult?.testPurchase !== undefined &&
        googleVerificationResult?.testPurchase !== null
      );

      // If existing subscription end date exists, require incoming expiry to strictly advance beyond it.
      // EXCEPTION 1: Safe RTDN Webhook Reconciliation.
      // If the RTDN webhook has already run for this renewal, it updated existingSubscriptionEndDate
      // to the new expiry date, BUT left student_subscriptions.order_id referencing the PREVIOUS order.
      // In that specific case (gDateStr === eDateStr && existingSubscriptionOrderId === existingPayment.order_id),
      // the financial ledger payment for this new renewal cycle is still unrecorded and must be safely reconciled.
      //
      // EXCEPTION 2: Accelerated Test Renewal (License Testing).
      // In Google Play license testing, subscriptions renew on accelerated schedules (e.g. 5-15 mins).
      // The initial purchase stored_expiry was set to +30 days by plan-duration fallback
      // to satisfy PostgreSQL check constraint ck_student_subscriptions_end_date (end_date > start_date).
      // Consequently, Google's genuine future test expiry (today + 5 mins) will be <= eTime (+30 days).
      // When:
      //  1. isTestPurchase is true (verified license test purchase),
      //  2. isNewerCycle is true (incoming renewal cycle is strictly newer than recorded cycle),
      //  3. gTime > refTime (verified Google expiry is strictly in the future),
      //  4. Subscription still references prior order (or missing order),
      // this is an unrecorded accelerated test renewal that must be permitted to reach the database RPC.
      // Migration 217: the ledger, not this pre-check, is authoritative for entitlement windows.
      let isNonAdvancingVerifiedCycle = false;
      let rtdnReconciliationApplied = false;

      if (existingSubscriptionEndDate) {
        const eTime = new Date(existingSubscriptionEndDate).getTime();
        const gDateStr = new Date(gTime).toISOString().slice(0, 10);
        const eDateStr = existingSubscriptionEndDate.slice(0, 10);

        const isRtdnReconciliation = Boolean(
          gDateStr === eDateStr &&
          existingSubscriptionOrderId &&
          existingPayment?.order_id &&
          existingSubscriptionOrderId === existingPayment.order_id
        );

        const isAcceleratedTestRenewal = Boolean(
          isTestPurchase &&
          isNewerCycle &&
          gTime > refTime &&
          (existingSubscriptionOrderId === null || existingSubscriptionOrderId === existingPayment.order_id)
        );

        // Migration 217: a strictly newer, verified Google Play cycle must reach the database RPC
        // even when its expiry does not advance the persisted date. Accelerated (non-test)
        // renewals, the plan-duration fallback for degenerate same-day expiries, and locally
        // extended windows all produce that shape. complete_google_play_purchase records the
        // payment for the EXACT order id and applies greatest(), so entitlement can never
        // regress; duplicate protection now rests on exact-order-id idempotency instead of an
        // expiry-ordering heuristic. Older/equal cycles and replayed order ids stay fail-closed.
        const isVerifiedNewerCycle = Boolean(
          isNewerCycle &&
          gTime > refTime &&
          authoritativeOrderId !== existingRecordedId &&
          !isIncomingFallback
        );

        const isAdvancedExpiry = !isNaN(eTime) && gDateStr > eDateStr && gTime > eTime;
        const isExpiryValid = isAdvancedExpiry || isRtdnReconciliation || isAcceleratedTestRenewal || isVerifiedNewerCycle;

        rtdnReconciliationApplied = isRtdnReconciliation;
        isNonAdvancingVerifiedCycle = Boolean(isVerifiedNewerCycle && !isAdvancedExpiry && !isRtdnReconciliation);

        if (!isExpiryValid) {
          // Google expiry has not advanced strictly beyond persisted entitlement: fail closed
          return {
            isDuplicate: true,
            isAccountMismatch: false,
            isSubscriptionRenewal: false,
            paymentOwnerProfileId,
            existingOrderId: existingPayment.order_id,
            decisionReason: 'expiry_not_advanced',
          };
        }
      }

      const decisionReason = isTestPurchase && isNewerCycle && gTime <= (existingSubscriptionEndDate ? new Date(existingSubscriptionEndDate).getTime() : 0)
        ? 'accelerated_test_renewal'
        : (rtdnReconciliationApplied
            ? 'rtdn_reconciliation'
            : (isNonAdvancingVerifiedCycle
                ? 'verified_newer_cycle_non_advancing_expiry'
                : 'valid_new_renewal_cycle'));

      // Valid renewal cycle confirmed with all mandatory evidence established:
      return {
        isDuplicate: false,
        isAccountMismatch: false,
        isSubscriptionRenewal: true,
        paymentOwnerProfileId,
        existingOrderId: existingPayment.order_id,
        decisionReason,
      };
    }

    // Check if entitlement is missing in DB for an already-recorded payment (Recovery of already-processed purchase or renewal)
    if (!existingSubscriptionEndDate) {
      const lineItems = Array.isArray(googleVerificationResult?.lineItems) ? googleVerificationResult.lineItems : [];
      let matchedItem = (productId && typeof productId === 'string')
        ? lineItems.find((item: any) => item?.productId === productId && item?.expiryTime)
        : null;
      if (!matchedItem && (!productId || lineItems.length === 1)) {
        matchedItem = lineItems.find((item: any) => item?.expiryTime);
      }
      const googleExpiry = matchedItem?.expiryTime || (lineItems.length === 0 ? googleVerificationResult?.expiryTimeMillis : null);
      if (googleExpiry) {
        const gTime = new Date(/^\d+$/.test(String(googleExpiry)) ? parseInt(String(googleExpiry), 10) : String(googleExpiry)).getTime();
        const refTime = transactionTimestamp ? new Date(transactionTimestamp).getTime() : Date.now();
        if (!isNaN(gTime) && gTime > refTime) {
          // Entitlement missing in DB but valid future Google expiry exists: needs entitlement recovery via RPC
          return {
            isDuplicate: true,
            isAccountMismatch: false,
            isSubscriptionRenewal: false,
            isEntitlementRecovery: true,
            paymentOwnerProfileId,
            existingOrderId: existingPayment.order_id,
          };
        }
      }

      // Existing payment found but subscription record is missing and Google-verified expiry is missing or invalid:
      // FAIL CLOSED. Do not return 200 OK duplicate claiming entitlement is active.
      return {
        isDuplicate: true,
        isAccountMismatch: false,
        isSubscriptionRenewal: false,
        isEntitlementRecovery: false,
        isMissingSubscriptionEvidence: true,
        paymentOwnerProfileId,
        existingOrderId: existingPayment.order_id,
      };
    }
  }

  return {
    isDuplicate: true,
    isAccountMismatch: false,
    isSubscriptionRenewal: false,
    paymentOwnerProfileId,
    existingOrderId: existingPayment.order_id,
    decisionReason: 'idempotent_duplicate_same_order',
  };
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

  const recordedCycles = recordedOrderIds
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

  const cleanBaseOrderId = baseOrderId.replace(/\.\.\d+$/, '');

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
