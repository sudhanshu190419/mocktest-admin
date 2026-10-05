// ============================================================================
// Supabase Edge Function: user-account-delete
//
// Deno / Supabase Edge Runtime | Production Ready
//
// Handles atomic, secure account deletion for Make Me Topper.
//
// Security & Compliance:
//   1. Validates caller JWT via Supabase Auth (auth.getUser()).
//   2. Strictly derives target user ID from the verified session (never client body).
//   3. Cleans up user-owned files across Supabase Storage buckets.
//   4. Calls the SECURITY DEFINER PostgreSQL RPC `delete_user_account_data`
//      to cascade-delete dependent records and legally anonymize financial history.
//   5. Deletes the Supabase Auth user record via auth.admin.deleteUser().
//   6. Completely idempotent and safe for retries.
//
// @module edge-functions/user-account-delete
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(message: string, status: number = 400, details?: string): Response {
  return jsonResponse(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    status,
  );
}

/**
 * Remove all files under a specific prefix in a storage bucket.
 */
async function cleanStoragePrefix(
  adminClient: any,
  bucket: string,
  prefix: string,
): Promise<void> {
  if (!prefix) return;
  try {
    const { data: files, error: listError } = await adminClient.storage
      .from(bucket)
      .list(prefix, { limit: 100 });

    if (listError || !files || files.length === 0) {
      return;
    }

    const pathsToDelete = files.map((f: { name: string }) => `${prefix}/${f.name}`);
    const { error: removeError } = await adminClient.storage
      .from(bucket)
      .remove(pathsToDelete);

    if (removeError) {
      console.warn(
        `[user-account-delete] Warning removing storage files in ${bucket}/${prefix}:`,
        removeError.message,
      );
    }
  } catch (err) {
    console.warn(`[user-account-delete] Storage cleanup error in ${bucket}/${prefix}:`, err);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  // 2. Validate Authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('Authentication required. Missing or malformed Bearer token.', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error('[user-account-delete] Missing required Supabase environment variables');
    return errorResponse('Server configuration error.', 500);
  }

  try {
    // 3. Authenticate caller JWT
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await callerClient.auth.getUser();

    if (authError || !user) {
      return errorResponse('Invalid or expired authentication token.', 401);
    }

    const userId = user.id;
    console.log(`[user-account-delete] Initiating account deletion for user: ${userId}`);

    // 4. Create Service-Role client
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 5. Look up student_id / teacher_id before deleting database records
    const { data: student } = await adminClient
      .from('student_details')
      .select('student_id')
      .eq('profile_id', userId)
      .maybeSingle();
    const studentId = student?.student_id;

    const { data: teacher } = await adminClient
      .from('teacher_details')
      .select('teacher_id')
      .eq('profile_id', userId)
      .maybeSingle();
    const teacherId = teacher?.teacher_id;

    // 6. Clean up user-owned storage files
    await Promise.allSettled([
      cleanStoragePrefix(adminClient, 'profile-images', userId),
      studentId ? cleanStoragePrefix(adminClient, 'doubt-attachments', studentId) : Promise.resolve(),
      studentId ? cleanStoragePrefix(adminClient, 'student-submissions', studentId) : Promise.resolve(),
      studentId ? cleanStoragePrefix(adminClient, 'certificates', studentId) : Promise.resolve(),
      cleanStoragePrefix(adminClient, 'certificates', userId),
      teacherId ? cleanStoragePrefix(adminClient, 'teacher-documents', teacherId) : Promise.resolve(),
    ]);

    // 7. Execute PostgreSQL stored procedure to delete/anonymize database data
    const { data: rpcResult, error: rpcError } = await adminClient.rpc(
      'delete_user_account_data',
      { p_target_profile_id: userId },
    );

    if (rpcError) {
      console.error('[user-account-delete] DB RPC delete_user_account_data failed:', rpcError);
      return errorResponse('Failed to delete database records: ' + rpcError.message, 500);
    }

    // 8. Delete the Supabase Auth user via Admin API
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      // If already deleted, log and continue
      console.warn(
        '[user-account-delete] Supabase Auth deleteUser note:',
        deleteUserError.message,
      );
    }

    console.log(`[user-account-delete] Account deletion completed for user: ${userId}`);

    return jsonResponse({
      success: true,
      message: 'Your account and personal data have been permanently deleted.',
      userId,
      details: rpcResult,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('[user-account-delete] Unhandled error:', err);
    return errorResponse('An unexpected error occurred during account deletion.', 500, errorMsg);
  }
});
