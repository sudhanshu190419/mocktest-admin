// ============================================================================
// Shared Helper: S3 / Cloudflare R2 Signing Utility
//
// Provides AWS Signature V4 (SigV4) primitives for Cloudflare R2 operations.
// Used by recording-playback-url and recording-delete Edge Functions.
//
// All functions use the Web Crypto API available in Deno — no external
// dependencies required.
//
// @module _shared/s3Signing
// ============================================================================

// ═══════════════════════════════════════════════════════════════════════════
// Byte/String Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a Uint8Array to a lowercase hex string.
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a string to a Uint8Array (UTF-8 encoded).
 */
export function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Base64url-encode a Uint8Array (RFC 4648 §5).
 * Uses '-' and '_' instead of '+' and '/', and strips trailing '=' padding.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64url-encode a string directly (treats the string as UTF-8 text).
 */
export function base64UrlEncodeString(input: string): string {
  return base64UrlEncode(toBytes(input));
}

// ═══════════════════════════════════════════════════════════════════════════
// Hashing / HMAC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute SHA-256 hash of a string.
 *
 * @returns The raw hash as a Uint8Array.
 */
export async function sha256(data: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', toBytes(data));
  return new Uint8Array(hash);
}

/**
 * Compute SHA-256 hash and return as a lowercase hex string.
 */
export async function sha256Hex(data: string): Promise<string> {
  return toHex(await sha256(data));
}

/**
 * Compute HMAC-SHA256 of a message using the given key.
 *
 * @param key     - The HMAC key as raw bytes.
 * @param message - The message to sign (string, UTF-8 encoded internally).
 * @returns The HMAC-SHA256 output as raw bytes.
 */
export async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, toBytes(message)),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AWS SigV4 Signing Key Derivation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Derive the AWS Signature V4 signing key.
 *
 * Key derivation chain:
 *   kSecret  = "AWS4" + secretKey
 *   kDate    = HMAC-SHA256(kSecret, dateStamp)
 *   kRegion  = HMAC-SHA256(kDate, region)
 *   kService = HMAC-SHA256(kRegion, service)
 *   kSigning = HMAC-SHA256(kService, "aws4_request")
 *
 * @param key       - The AWS secret access key (R2 secret key).
 * @param dateStamp - Date in YYYYMMDD format (e.g. "20260726").
 * @param region    - AWS region (use "auto" for Cloudflare R2).
 * @param service   - AWS service name (use "s3" for R2).
 * @returns The derived signing key as raw bytes.
 */
export async function getSignatureKey(
  key: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kDate = await hmacSha256(toBytes(`AWS4${key}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return await hmacSha256(kService, 'aws4_request');
}

/**
 * Compute the AWS Signature V4 signature for a string-to-sign.
 *
 * @param secretKey  - The AWS secret access key.
 * @param dateStamp  - Date in YYYYMMDD format.
 * @param region     - AWS region (use "auto" for Cloudflare R2).
 * @param service    - AWS service name (use "s3").
 * @param stringToSign - The SigV4 string-to-sign.
 * @returns The hex-encoded signature.
 */
export async function computeSignature(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
  stringToSign: string,
): Promise<string> {
  const signingKey = await getSignatureKey(secretKey, dateStamp, region, service);
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  return toHex(signatureBytes);
}

/**
 * Compute the SHA-256 hash of the canonical request (for SigV4 string-to-sign).
 *
 * @param canonicalRequest - The SigV4 canonical request string.
 * @returns Lowercase hex-encoded SHA-256 hash.
 */
export async function hashCanonicalRequest(canonicalRequest: string): Promise<string> {
  return toHex(await sha256(canonicalRequest));
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility: Build commonly used AWS date/time strings
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build AWS-formatted date/time strings from a Date object.
 *
 * @returns dateStamp (YYYYMMDD) and amzDate (YYYYMMDDTHHMMSSZ).
 */
export function getAmzDates(now: Date): { dateStamp: string; amzDate: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  return { dateStamp, amzDate };
}
