// ============================================================================
// Supabase Edge Function: user-account-delete
//
// Deno / Supabase Edge Runtime | Production Ready
//
// Handles atomic, secure account deletion for Make Me Topper.
//
// Security & Compliance:
//   1. Validates caller JWT authoritatively via Supabase Auth (auth.getUser()).
//   2. Strictly enforces recent OTP re-authentication (F-02): requires verified
//      amr with method 'otp' and timestamp within the last 300 seconds.
//   3. Strictly derives target user ID from the verified session (never client body).
//   4. Cleans up user-owned files across Supabase Storage buckets.
//   5. Calls the SECURITY DEFINER PostgreSQL RPC `delete_user_account_data`
//      to cascade-delete dependent records and legally anonymize financial history.
//   6. Deletes the Supabase Auth user record via auth.admin.deleteUser().
//   7. Completely idempotent and safe for retries.
//
// @module edge-functions/user-account-delete
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { handleUserAccountDelete } from './accountDeleteCore.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  return handleUserAccountDelete(req, {
    createSupabaseClient: (url, key, options) => createClient(url, key, options),
  });
});
