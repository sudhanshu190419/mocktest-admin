/**
 * Make Me Topper — Resend Transactional Email Provider
 *
 * Implements resilient dispatch against Resend API (https://api.resend.com/emails).
 * Features:
 * - Constant-time and timeout-safe fetch execution.
 * - Native idempotency header transmission.
 * - HTTP status classification (transient retryable vs permanent rejection).
 * - Safe error message sanitization.
 */

import { EmailProvider } from './provider.ts';
import { EmailSendRequest, EmailSendResult } from './types.ts';

export interface ResendProviderOptions {
  apiKey?: string;
  from?: string;
  replyTo?: string;
  timeoutMs?: number;
}

export class ResendProvider implements EmailProvider {
  public readonly name = 'resend';
  private readonly apiKey: string | null;
  private readonly defaultFrom: string;
  private readonly defaultReplyTo?: string;
  private readonly timeoutMs: number;

  constructor(options: ResendProviderOptions = {}) {
    const envKey =
      typeof Deno !== 'undefined'
        ? Deno.env.get('RESEND_API_KEY')
        : typeof process !== 'undefined'
        ? process.env.RESEND_API_KEY
        : undefined;

    this.apiKey = options.apiKey || envKey || null;
    this.defaultFrom =
      options.from ||
      (typeof Deno !== 'undefined' ? Deno.env.get('EMAIL_FROM') : undefined) ||
      'Make Me Topper <info@makemetopper.com>';
    this.defaultReplyTo =
      options.replyTo ||
      (typeof Deno !== 'undefined' ? Deno.env.get('EMAIL_REPLY_TO') : undefined) ||
      'support@inovoxy.com';
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  public async sendEmail(request: EmailSendRequest): Promise<EmailSendResult> {
    if (!this.apiKey) {
      return {
        success: false,
        retryable: false,
        error: 'RESEND_API_KEY is not configured in environment',
        statusCode: 500,
      };
    }

    const endpoint = 'https://api.resend.com/emails';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (request.idempotencyKey) {
      headers['Idempotency-Key'] = request.idempotencyKey;
    }

    const payload = {
      from: request.from || this.defaultFrom,
      to: [request.to],
      subject: request.subject,
      html: request.html,
      text: request.text,
      reply_to: request.replyTo || this.defaultReplyTo,
      headers: request.headers,
      tags: request.tags,
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseJson: Record<string, unknown> = {};
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        // Non-JSON response
      }

      const statusCode = response.status;

      if (response.ok) {
        const providerMessageId = (responseJson.id as string) || undefined;
        return {
          success: true,
          providerMessageId,
          retryable: false,
          statusCode,
        };
      }

      // Classify error by status code and error details
      const rawErrorCode =
        (responseJson.name as string) ||
        (responseJson.code as string) ||
        (responseJson.error_code as string) ||
        '';
      const errorMessage =
        (responseJson.message as string) ||
        (responseJson.error as string) ||
        `Resend HTTP ${statusCode}: ${responseText.slice(0, 200)}`;

      // 429 Too Many Requests -> retryable, respect Retry-After header if present
      if (statusCode === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) || 60
          : 60;

        return {
          success: false,
          retryable: true,
          isAmbiguous: true,
          providerErrorCode: rawErrorCode || 'rate_limit_exceeded',
          statusCode,
          retryAfterSeconds,
          error: `Rate limit exceeded: ${errorMessage}`,
        };
      }

      // 409 Conflict: Idempotency concurrency and payload mismatch errors
      if (statusCode === 409) {
        const isConcurrent =
          rawErrorCode === 'concurrent_idempotent_requests' ||
          errorMessage.toLowerCase().includes('concurrent') ||
          errorMessage.toLowerCase().includes('in progress');

        if (isConcurrent) {
          // Another request with the same idempotency key is currently executing on Resend.
          // This is NOT proof of non-acceptance. Must retain reservation and retry with same key.
          return {
            success: false,
            retryable: true,
            isAmbiguous: true,
            providerErrorCode: 'concurrent_idempotent_requests',
            statusCode,
            retryAfterSeconds: 5,
            error: `Resend 409 concurrent request in progress: ${errorMessage}`,
          };
        }

        // 409 invalid_idempotent_request: Key reused with different payload
        // Not a definitive rejection of original request! Must NOT release reservation.
        return {
          success: false,
          retryable: false,
          isAmbiguous: true,
          providerErrorCode: 'invalid_idempotent_request',
          statusCode,
          error: `Resend 409 payload mismatch for idempotency key: ${errorMessage}`,
        };
      }

      // 5xx Server Errors (500, 502, 503, 504) -> transient, ambiguous
      if (statusCode >= 500 && statusCode <= 599) {
        return {
          success: false,
          retryable: true,
          isAmbiguous: true,
          providerErrorCode: rawErrorCode || 'server_error',
          statusCode,
          error: `Server error: ${errorMessage}`,
        };
      }

      // 400 Bad Request
      if (statusCode === 400) {
        const isKeyFormatError =
          rawErrorCode === 'invalid_idempotency_key' ||
          errorMessage.toLowerCase().includes('idempotency');

        if (isKeyFormatError) {
          return {
            success: false,
            retryable: false,
            isAmbiguous: true,
            providerErrorCode: rawErrorCode || 'invalid_idempotency_key',
            statusCode,
            error: `Client error (idempotency key): ${errorMessage}`,
          };
        }

        return {
          success: false,
          retryable: false,
          isAmbiguous: false,
          providerErrorCode: rawErrorCode || 'bad_request',
          statusCode,
          error: `Client error: ${errorMessage}`,
        };
      }

      // 401 / 403 Unauthorized / Forbidden -> definitive rejection if provider rejected request
      if (statusCode === 401 || statusCode === 403) {
        return {
          success: false,
          retryable: false,
          isAmbiguous: false,
          providerErrorCode: rawErrorCode || (statusCode === 401 ? 'unauthorized' : 'forbidden'),
          statusCode,
          error: `Auth error: ${errorMessage}`,
        };
      }

      // 422 Unprocessable Entity (unverified domain, illegal address, suppressed recipient) -> definitive rejection
      if (statusCode === 422) {
        return {
          success: false,
          retryable: false,
          isAmbiguous: false,
          providerErrorCode: rawErrorCode || 'unprocessable_entity',
          statusCode,
          error: `Unprocessable entity: ${errorMessage}`,
        };
      }

      // 4xx Client Errors
      return {
        success: false,
        retryable: false,
        isAmbiguous: false,
        providerErrorCode: rawErrorCode || 'client_error',
        statusCode,
        error: `Client error: ${errorMessage}`,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'));

      if (isAbort) {
        return {
          success: false,
          retryable: true,
          isAmbiguous: true,
          providerErrorCode: 'timeout',
          error: `Request timed out after ${this.timeoutMs}ms`,
          statusCode: 408,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        retryable: true,
        isAmbiguous: true,
        providerErrorCode: 'network_failure',
        error: `Network failure: ${message}`,
        statusCode: 0,
      };
    }
  }
}

