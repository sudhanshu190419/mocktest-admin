/**
 * Postgres / PostgREST / Supabase Auth error → user-facing message.
 * Never surface raw backend errors (07-GOTCHAS.md #7).
 */

const POSTGRES_MESSAGES: Record<string, string> = {
  '23505': 'That value is already registered to another account.',
  '23503': 'This action references data that no longer exists.',
  '23502': 'A required field is missing.',
  '23514': 'Invalid data provided.',
  PGRST116: "We couldn't find that record.",
  PGRST301: 'Your session has expired. Please log in again.',
};

export function messageForError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.';

  const err = error as {
    code?: string;
    message?: string;
    status?: number;
    error_description?: string;
  };

  const rawMsg = err.error_description || err.message || '';
  const lower = rawMsg.toLowerCase();

  if (err.code && POSTGRES_MESSAGES[err.code]) {
    return POSTGRES_MESSAGES[err.code];
  }

  // Supabase Auth specific error codes & patterns
  if (err.code === 'user_already_exists' || lower.includes('user already registered')) {
    return 'An account with this phone number already exists. Please log in instead.';
  }

  if (err.code === 'invalid_credentials' || lower.includes('invalid login credentials')) {
    return 'Incorrect phone number or password. Please try again.';
  }

  if (err.code === 'otp_expired' || lower.includes('token has expired')) {
    return 'The verification code has expired. Please request a new code.';
  }

  if (lower.includes('token is invalid') || lower.includes('invalid token')) {
    return 'The verification code is incorrect. Please check the code and try again.';
  }

  if (
    err.code === 'over_sms_send_rate_limit' ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    err.status === 429
  ) {
    return 'Too many attempts. Please wait a minute and try again.';
  }

  if (
    lower.includes('signup requires a valid password') ||
    lower.includes('password should be at least')
  ) {
    return 'Password must be at least 6 characters long.';
  }

  if (lower.includes('for security purposes') && lower.includes('seconds')) {
    return 'Please wait a moment before requesting another code.';
  }

  if (err.status && err.status >= 500) {
    return 'The server is having trouble right now. Please try again shortly.';
  }

  // Supabase Auth human-readable messages that are safe to show
  if (
    rawMsg &&
    !lower.includes('exception') &&
    !lower.includes('sql') &&
    !lower.includes('postgres')
  ) {
    return rawMsg;
  }

  return 'Something went wrong. Please try again.';
}

/** True for the unique-violation raised when `profiles.email` collides. */
export function isDuplicateEmailError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}
