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
      if (isExpiredByGoogleTime || googleSubState === "SUBSCRIPTION_STATE_EXPIRED" || isCurrentlyExpired) {
        mappedStatus = "expired";
        isEntitlementActive = false;
      } else {
        // Paid entitlement preserved until expiry date
        mappedStatus = currentStatus === "grace" ? "grace" : "active";
        isEntitlementActive = true;
      }
      if (newEndDateStr) {
        calculatedEndDate = newEndDateStr;
      } else {
        calculatedEndDate = currentEndDate || null;
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
      if (googleSubState === "SUBSCRIPTION_STATE_ACTIVE" && googleExpiryTime && !isExpiredByGoogleTime) {
        // Out-of-order EXPIRED notification: Google confirms subscription is active with future expiry.
        // Preserve active entitlement and renewal state.
        mappedStatus = "active";
        mappedReason = "renewal";
        isAutoRenew = Boolean(lineItem?.autoRenewingPlan?.autoRenewEnabled);
        isEntitlementActive = true;
        calculatedEndDate = newEndDateStr || currentEndDate || null;
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      } else {
        mappedStatus = "expired";
        mappedReason = "expiry";
        isAutoRenew = false;
        isEntitlementActive = false;
        if (newEndDateStr) {
          calculatedEndDate = newEndDateStr;
        } else {
          calculatedEndDate = currentEndDate || null;
        }
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      }
      break;
  }

  // 4. Authoritative Google State Override (Google API ground truth takes precedence):
  if (authoritativeGoogleSub) {
    if (googleSubState === "SUBSCRIPTION_STATE_ACTIVE" && googleExpiryTime && !isExpiredByGoogleTime) {
      // If Google explicitly confirms ACTIVE and unexpired, override any stale expired/pending state.
      // Terminal states (refunded) are NEVER overridden (guarded at Step 2b).
      if (mappedStatus === "expired" || mappedStatus === "pending") {
        mappedStatus = "active";
        mappedReason = "renewal";
        isEntitlementActive = true;
        isAutoRenew = Boolean(lineItem?.autoRenewingPlan?.autoRenewEnabled);
        calculatedEndDate = newEndDateStr || calculatedEndDate;
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      }
    } else if (googleSubState === "SUBSCRIPTION_STATE_EXPIRED" || (googleExpiryTime && isExpiredByGoogleTime)) {
      if (mappedStatus !== "refunded") {
        mappedStatus = "expired";
        isEntitlementActive = false;
        isAutoRenew = false;
        if (calculatedEndDate) {
          graceEndDate = addDays(calculatedEndDate, graceDays);
          contentAccessEndDate = addDays(graceEndDate, contentAccessDays);
        }
      }
    } else if (googleSubState === "SUBSCRIPTION_STATE_REVOKED") {
      mappedStatus = "refunded";
      mappedReason = "refund";
      isEntitlementActive = false;
      isAutoRenew = false;
      graceEndDate = null;
      contentAccessEndDate = null;
    } else if (googleSubState === "SUBSCRIPTION_STATE_ON_HOLD") {
      if (mappedStatus !== "refunded") {
        mappedStatus = "pending";
        mappedReason = "payment_failure";
        isEntitlementActive = false;
        isAutoRenew = false;
        graceEndDate = null;
        contentAccessEndDate = null;
      }
    } else if (googleSubState === "SUBSCRIPTION_STATE_PAUSED") {
      if (mappedStatus !== "refunded") {
        mappedStatus = "pending";
        mappedReason = "admin_action";
        isEntitlementActive = false;
        isAutoRenew = false;
        graceEndDate = null;
        contentAccessEndDate = null;
      }
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
    p_gateway_response: params.googleVerificationResult || {
      verified: true,
      productId: params.productId,
      purchaseToken: params.purchaseToken,
      verified_at: params.transactionTimestamp,
    },
    p_transaction_timestamp: params.transactionTimestamp,
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