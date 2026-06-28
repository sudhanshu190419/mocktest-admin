/**
 * Auth Types
 *
 * Core type definitions for the authentication service layer.
 * Designed for scalability and future role-based access control (RBAC).
 *
 * Dependencies:
 * - This file is consumed by src/services/authService.ts
 * - The `DbProfile` type mirrors the `profiles` table schema in PostgreSQL.
 */

// ─── Auth Response ───────────────────────────────────────────────────────────

/**
 * Standardized API response shape for all auth operations.
 *
 * Every service function returns this structure so that consumers never
 * need to handle raw Supabase exceptions or error shapes.
 *
 * @template T - The shape of the data payload on success.
 */
export interface AuthResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /**
   * Non-fatal warning carried alongside a successful response.
   *
   * Use this for side-effect failures that don't prevent the primary
   * operation from succeeding.  For example, if the auth account is
   * created but the profile row insert fails, the response has
   * `{ success: true, warning: 'Profile creation failed: ...' }`.
   *
   * Callers should display this to the user or log it for debugging.
   */
  warning?: string;
}

// ─── User Roles (RBAC-ready) ────────────────────────────────────────────────

/**
 * Enumerated user roles for role-based access control (RBAC).
 *
 * Extend this union when adding new roles:
 *   export type UserRole = 'student' | 'teacher' | 'admin' | 'moderator';
 *
 * @note The **source of truth** for the role is the `profiles.role` column
 *       in PostgreSQL, NOT `auth.users.raw_user_meta_data`. The service
 *       layer always queries the `profiles` table after authentication.
 */
export type UserRole = 'student' | 'teacher' | 'admin';

// ─── Database Profile Shape ─────────────────────────────────────────────────

/**
 * Mirrors the `profiles` table schema in PostgreSQL.
 *
 * Profile creation is handled entirely by the database trigger
 * (`on_auth_user_created` → `handle_new_user()`). The frontend
 * never inserts into `public.profiles`.
 *
 * @see https://supabase.com/docs/guides/auth/managing-user-data
 */
export interface DbProfile {
  profile_id: string;
  institute_id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

// ─── User Profile ───────────────────────────────────────────────────────────

/**
 * Public-facing user profile consumed by screens, hooks, and stores.
 *
 * Derived from two sources:
 * 1. `auth.users` – for `id`, `email`, `createdAt`, `emailVerified`
 * 2. `public.profiles` – for `name`, `role`, `instituteId`, `phone`, `avatarUrl`
 *
 * The DB profile is the authoritative source. Auth metadata is used only
 * as a fallback before the database trigger creates the profile row.
 */
export interface UserProfile {
  /** Unique identifier (matches `auth.users.id` and `profiles.profile_id`). */
  id: string;

  /** Verified email address from `auth.users.email`. */
  email: string;

  /** Whether the email has been confirmed (`auth.users.email_confirmed_at`). */
  emailVerified: boolean;

  /** Display / full name from `profiles.name`. */
  name: string;

  /**
   * Role from `profiles.role`.
   *
   * @default 'student'
   */
  role: UserRole;

  /** Institute the user belongs to (`profiles.institute_id`). */
  instituteId: string | null;

  /** Phone number from `profiles.phone`. */
  phone: string | null;

  /** Avatar URL from `profiles.avatar_url`. */
  avatarUrl: string | null;

  /** ISO-8601 timestamp of when the user was created. */
  createdAt: string;
}

// ─── Session Data ───────────────────────────────────────────────────────────

/**
 * Shape returned by `getSession()` and `refreshSession()`.
 *
 * Carries enough information for downstream consumers (e.g. an auth
 * context provider) to decide whether the user is authenticated and who
 * they are, without an additional network round-trip.
 */
export interface SessionData {
  /** Whether a valid session exists. */
  isAuthenticated: boolean;

  /** The raw access token (JWT). Null when not authenticated. */
  accessToken: string | null;

  /** The raw refresh token. Null when not authenticated. */
  refreshToken: string | null;

  /** The user profile derived from the session. Null when not authenticated. */
  user: UserProfile | null;
}

// ─── Input DTOs ─────────────────────────────────────────────────────────────

/**
 * Input required to register a new account.
 */
export interface SignUpInput {
  email: string;
  password: string;
  name: string;
}

/**
 * Input required to authenticate an existing account.
 */
export interface SignInInput {
  email: string;
  password: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Shape returned by validation helpers.
 *
 * When `valid` is `false`, `error` contains a human-readable message.
 * This is designed to be seamlessly replaced by a Zod schema in the
 * future without changing the public API.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}
