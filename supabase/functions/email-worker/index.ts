/**
 * Make Me Topper — email-worker Edge Function
 *
 * Background worker endpoint for claiming and processing batches from public.email_queue.
 *
 * Security:
 *  - Enforces constant-time service_role bearer check or worker secret key.
 *  - Rejects unauthenticated calls with 401 Unauthorized.
 *
 * Execution:
 *  - Recovers stale locks.
 *  - Claims next available batch respecting priority (critical > high > normal > low).
 *  - Renders branded HTML/text templates.
 *  - Dispatches via Resend API or MockEmailProvider (fallback / test mode).
 *  - Updates state machine: sent, retried (backoff), failed, or cancelled.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { isServiceRoleCall } from '../_shared/serviceRoleAuth.ts';
import {
  createSupabaseWorkerDb,
  resolveWorkerProvider,
  runEmailWorkerBatch,
} from './emailWorkerCore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')?.trim() || '';
const MOCK_EMAIL = Deno.env.get('MOCK_EMAIL') === 'true';
const WORKER_SECRET = Deno.env.get('EMAIL_WORKER_SECRET') || null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-worker-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  // 1. Authenticate caller (constant-time service-role key or worker secret)
  const authHeader = req.headers.get('Authorization');
  const workerKeyHeader = req.headers.get('X-Worker-Key');

  let isAuthorized = false;

  // Check service_role
  const serviceRoleCheck = isServiceRoleCall(authHeader);
  if (serviceRoleCheck.ok) {
    isAuthorized = true;
  } else if (
    WORKER_SECRET &&
    workerKeyHeader &&
    workerKeyHeader === WORKER_SECRET
  ) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return jsonResponse(
      {
        error: 'Unauthorized',
        message: 'Valid service_role key or worker secret required',
      },
      401
    );
  }

  // 2. Parse batch size from query param or request body
  const url = new URL(req.url);
  let batchSize = parseInt(url.searchParams.get('batch') || '20', 10);

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body?.batchSize && typeof body.batchSize === 'number') {
        batchSize = body.batchSize;
      }
    } catch {
      // Empty or non-JSON body is acceptable; use query params or defaults
    }
  }

  // 3. Resolve and validate Provider (Fail-closed in production)
  const providerResolution = resolveWorkerProvider({
    mockEmailExplicit: MOCK_EMAIL,
    resendApiKey: RESEND_API_KEY,
    from: Deno.env.get('EMAIL_FROM') || 'Make Me Topper <info@makemetopper.com>',
    replyTo: Deno.env.get('EMAIL_REPLY_TO') || 'support@inovoxy.com',
  });

  if (!providerResolution.provider) {
    console.error(`[email-worker] ${providerResolution.error}`);
    return jsonResponse(
      {
        success: false,
        error: 'CONFIGURATION_ERROR',
        message: providerResolution.error,
      },
      500
    );
  }

  const provider = providerResolution.provider;
  if (provider.name === 'mock') {
    console.log('[email-worker] Operating in explicit MOCK EMAIL provider mode');
  }

  // 4. Initialize Supabase Client with service_role privileges
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const workerDb = createSupabaseWorkerDb(supabase);

  // 5. Execute Queue Worker Batch
  try {
    const summary = await runEmailWorkerBatch(workerDb, provider, {
      batchSize,
      workerId: `edge-worker-${crypto.randomUUID().slice(0, 8)}`,
    });

    console.log(
      `[email-worker] Batch completed: claimed=${summary.totalClaimed}, sent=${summary.succeeded}, retried=${summary.retried}, failed=${summary.failed}, cancelled=${summary.cancelled}, duration=${summary.durationMs}ms`
    );

    return jsonResponse({
      success: true,
      provider: provider.name,
      ...summary,
    });
  } catch (batchErr) {
    const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
    console.error('[email-worker] Critical batch execution failure:', batchErr);
    return jsonResponse(
      {
        success: false,
        error: 'BATCH_EXECUTION_FAILURE',
        message: msg,
      },
      500
    );
  }
});

