/**
 * google-play-rtdn-webhook
 *
 * Ingests Google Cloud Pub/Sub Real-Time Developer Notifications (RTDN)
 * for Google Play Subscriptions and In-App purchases.
 *
 * Security & Reliability Architecture:
 *  1. Request Authentication (F-03): Strictly requires authenticated Google Cloud
 *     Pub/Sub OIDC Bearer token. Validates cryptographic signature via Google,
 *     verifies issuer ('accounts.google.com'), enforces non-empty expected audience
 *     and service account email (failing closed on misconfiguration or mismatch),
 *     and requires email_verified = true. Query parameter secrets are rejected.
 *  2. Authoritative Verification: RTDN event serves purely as a trigger. Webhook
 *     queries Google Play Developer API (purchases.subscriptionsv2.get) directly
 *     to obtain true authoritative state.
 *  3. Strict Schema Enum Mapping: Enforces exact PostgreSQL enums.
 *  4. Idempotency: Deduplicates repeated Pub/Sub messages via purchaseToken / state evaluations.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleRtdnHttpRequest, getGoogleAccessToken } from "./billingCore.ts";

serve((req) =>
  handleRtdnHttpRequest(req, {
    createSupabaseAdminClient: (url, key) => createClient(url, key),
    googleAccessTokenFetcher: getGoogleAccessToken,
  })
);
