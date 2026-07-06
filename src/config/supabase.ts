/**
 * Supabase Client Configuration
 *
 * Initialises the Supabase client for browser environments.
 * Session persistence uses the browser's built-in storage (default
 * behaviour of the Supabase JS client when no custom storage is provided).
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL     — Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anonymous/public key
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2Nzg4ODAwMDAsImV4cCI6MjY3ODg4MDAwMH0.placeholder';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  if (typeof window !== 'undefined') {
    console.warn(
      'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) are not set. ' +
      'Running in Demo Mode.'
    );
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});