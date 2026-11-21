/**
 * Make Me Topper — email-webhook Edge Function
 *
 * Receives and processes delivery webhooks from Resend (bounces, complaints, delivery confirmations).
 *
 * Security:
 *  - verify_jwt = false at runtime level; authentication is enforced authoritatively
 *    via Svix standard HMAC-SHA256 signature verification over (svix-id, svix-timestamp, rawBody).
 *  - Constant-time signature verification prevents timing attacks.
 *  - Enforces timestamp freshness (5 min tolerance) to prevent replay attacks.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  createSupabaseWebhookDb,
  processWebhookEvent,
  verifySvixWebhookSignature,
} from './emailWebhookCore.ts';
import { ResendWebhookPayload } from '../_shared/email/types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  const rawBody = await req.text();

  // 1. Signature Verification (Strict Fail-Closed)
  if (!RESEND_WEBHOOK_SECRET || RESEND_WEBHOOK_SECRET.trim() === '') {
    console.error(
      '[email-webhook] Configuration error: RESEND_WEBHOOK_SECRET is not configured. Webhook rejected.'
    );
    return jsonResponse(
      {
        error: 'CONFIGURATION_ERROR',
        message: 'RESEND_WEBHOOK_SECRET is not configured on this server. Webhook rejected.',
      },
      500
    );
  }

  const verification = await verifySvixWebhookSignature({
    secret: RESEND_WEBHOOK_SECRET,
    payload: rawBody,
    svixId,
    svixTimestamp,
    svixSignature,
  });

  if (!verification.valid) {
    console.warn(
      `[email-webhook] Webhook signature rejected: reason=${verification.reason}`
    );
    return jsonResponse(
      {
        error: 'Unauthorized',
        message: 'Invalid webhook signature',
        reason: verification.reason,
      },
      401
    );
  }

  // 2. Parse Event JSON
  let event: ResendWebhookPayload;
  try {
    event = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch (err) {
    return jsonResponse({ error: 'Malformed JSON payload' }, 400);
  }

  // 3. Initialize Supabase Client with service_role privileges
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const webhookDb = createSupabaseWebhookDb(supabase);

  // 4. Process event with deduplication metadata
  try {
    const result = await processWebhookEvent(webhookDb, event, {
      svixId,
      svixTimestamp,
    });
    return jsonResponse(result, 200);
  } catch (processErr) {
    const msg =
      processErr instanceof Error ? processErr.message : String(processErr);
    console.error(`[email-webhook] Processing error:`, processErr);
    return jsonResponse({ error: 'INTERNAL_ERROR', message: msg }, 500);
  }
});

