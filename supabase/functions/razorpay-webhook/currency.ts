// =============================================================================
// MAKE ME TOPPER — RAZORPAY STRICT INR CURRENCY UNIT CONVERSION & WEBHOOK POLICY
// Revision 34: Verified Dispute Restoration, Durable Webhook Quarantine and Authorized Reconciliation
// =============================================================================

export class InvalidCurrencyValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCurrencyValueError';
  }
}

export interface ConvertPaiseOptions {
  allowZero?: boolean;
}

/**
 * Strict currency conversion boundary for Razorpay INR webhook payloads.
 *
 * Rules:
 * 1. Razorpay transmits currency amounts in paise (1 INR = 100 paise).
 * 2. Database schema stores all financial fields in decimal rupees (NUMERIC(10,2)).
 * 3. Ingestion boundary must execute single-point conversion: paise / 100.0.
 * 4. Zero amounts are rejected by default (refunds cannot be 0).
 *    Zero amounts are permitted only when options.allowZero is explicitly true
 *    (e.g., dispute notification where amount_deducted = 0).
 * 5. Negative amounts, fractional paise, NaN, Infinity, null, and non-numeric types are rejected.
 * 6. Non-INR currencies are rejected.
 */
export function convertPaiseToRupeesStrict(
  minorUnits: unknown,
  currencyCode: string = 'INR',
  options: ConvertPaiseOptions = {}
): number {
  if (currencyCode.toUpperCase() !== 'INR') {
    throw new InvalidCurrencyValueError(
      `Unsupported currency: expected INR, got ${currencyCode}`
    );
  }

  if (typeof minorUnits !== 'number' || !Number.isFinite(minorUnits)) {
    throw new InvalidCurrencyValueError(
      `Invalid monetary value: ${minorUnits} must be a finite number`
    );
  }

  if (!Number.isInteger(minorUnits)) {
    throw new InvalidCurrencyValueError(
      `Fractional currency unit received: ${minorUnits} paise must be a safe integer`
    );
  }

  if (minorUnits < 0) {
    throw new InvalidCurrencyValueError(
      `Negative currency unit received: ${minorUnits} cannot be negative`
    );
  }

  if (minorUnits === 0 && !options.allowZero) {
    throw new InvalidCurrencyValueError(
      `Zero currency unit received: zero is not permitted for this operation`
    );
  }

  if (minorUnits > 100_000_000) {
    throw new InvalidCurrencyValueError(
      `Monetary value exceeds maximum supported limit: ${minorUnits} paise`
    );
  }

  return Number((minorUnits / 100.0).toFixed(2));
}

export function convertPaiseToRupees(
  minorUnits: unknown,
  currencyCode: string = 'INR',
  options: ConvertPaiseOptions = {}
): number {
  return convertPaiseToRupeesStrict(minorUnits, currencyCode, options);
}

export type WebhookFailureCategory =
  | 'UNAUTHENTICATED'
  | 'MALFORMED_PAYLOAD_SYNTAX'
  | 'AUTHENTICATED_MALFORMED_FINANCIAL_DATA'
  | 'DATABASE_FAILURE'
  | 'VALID_EVENT';

export interface WebhookResponsePolicy {
  category: WebhookFailureCategory;
  httpStatus: number;
  retryable: boolean;
  providerWillRetry: boolean;
  quarantineRequired: boolean;
  claimFinancialProcessed: boolean;
  description: string;
}

/**
 * Determine the exact HTTP status and operational response policy for a Razorpay webhook event.
 *
 * CRITICAL RAZORPAY PROVIDER RETRY BEHAVIOR (Revision 34, Issue 3):
 * Razorpay treats ANY non-2xx HTTP status code as a delivery failure.
 * - Razorpay retries failed webhook deliveries according to an exponential backoff schedule for 24 hours.
 * - Razorpay does NOT differentiate between 4xx and 5xx errors: both 400 (Bad Request) and 401 (Unauthorized)
 *   will be retried by Razorpay.
 * - Continuous failures (non-2xx responses) can cause Razorpay to automatically disable the webhook endpoint.
 *
 * POLICY SPECIFICATION:
 * 1. UNAUTHENTICATED (Invalid Signature):
 *    - Must reject with HTTP 401. Never accept unauthenticated events or write them to database.
 *    - Razorpay will retry (providerWillRetry: true). Operational alert must be raised.
 *
 * 2. MALFORMED_PAYLOAD_SYNTAX (Invalid JSON):
 *    - Must reject with HTTP 400.
 *    - Razorpay will retry (providerWillRetry: true). Operational alert must be raised.
 *
 * 3. AUTHENTICATED_MALFORMED_FINANCIAL_DATA:
 *    - Signature is valid and JSON is valid, but monetary or lifecycle data fails validation (e.g. negative paise).
 *    - Must be durably quarantined into `public.webhook_quarantine_events` (and agreement review flagged if linked).
 *    - Once quarantine write succeeds: Return HTTP 200 with { success: true, quarantined: true }.
 *      This stops Razorpay retry loop (providerWillRetry: false) and prevents endpoint disabling.
 *    - If quarantine write fails (database unavailable): Return HTTP 500 (retryable path).
 *
 * 4. DATABASE_FAILURE:
 *    - Transient Supabase/PostgreSQL failure. Return HTTP 500 so Razorpay retries delivery.
 *
 * 5. VALID_EVENT:
 *    - All validation passes and financial state applied. Return HTTP 200.
 */
export function determineWebhookResponsePolicy(
  signatureValid: boolean,
  jsonValid: boolean,
  financialDataValid: boolean,
  databaseAvailable: boolean
): WebhookResponsePolicy {
  if (!signatureValid) {
    return {
      category: 'UNAUTHENTICATED',
      httpStatus: 401,
      retryable: false,
      providerWillRetry: true,
      quarantineRequired: false,
      claimFinancialProcessed: false,
      description: 'Reject unauthenticated request with 401. Razorpay retries any non-2xx status for 24h. Operational alert raised.',
    };
  }

  if (!jsonValid) {
    return {
      category: 'MALFORMED_PAYLOAD_SYNTAX',
      httpStatus: 400,
      retryable: false,
      providerWillRetry: true,
      quarantineRequired: false,
      claimFinancialProcessed: false,
      description: 'Reject invalid JSON syntax with 400. Razorpay retries delivery for 24h. Operational alert raised.',
    };
  }

  if (!financialDataValid) {
    if (!databaseAvailable) {
      return {
        category: 'DATABASE_FAILURE',
        httpStatus: 500,
        retryable: true,
        providerWillRetry: true,
        quarantineRequired: true,
        claimFinancialProcessed: false,
        description: 'Durable quarantine persistence failed due to database outage; return 500 so Razorpay retries delivery.',
      };
    }
    return {
      category: 'AUTHENTICATED_MALFORMED_FINANCIAL_DATA',
      httpStatus: 200,
      retryable: false,
      providerWillRetry: false,
      quarantineRequired: true,
      claimFinancialProcessed: false,
      description: 'Durable quarantine succeeded; acknowledge with 200 to halt retry loop and protect endpoint health without applying financial effect.',
    };
  }

  if (!databaseAvailable) {
    return {
      category: 'DATABASE_FAILURE',
      httpStatus: 500,
      retryable: true,
      providerWillRetry: true,
      quarantineRequired: false,
      claimFinancialProcessed: false,
      description: 'Database error processing valid event; return 500 so Razorpay retries delivery.',
    };
  }

  return {
    category: 'VALID_EVENT',
    httpStatus: 200,
    retryable: false,
    providerWillRetry: false,
    quarantineRequired: false,
    claimFinancialProcessed: true,
    description: 'Process valid financial event and acknowledge with 200.',
  };
}
