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

      // Classify error by status code
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
          statusCode,
          retryAfterSeconds,
          error: `Rate limit exceeded: ${errorMessage}`,
        };
      }

      // 5xx Server Errors (500, 502, 503, 504) -> transient, retryable
      if (statusCode >= 500 && statusCode <= 599) {
        return {
          success: false,
          retryable: true,
          statusCode,
          error: `Server error: ${errorMessage}`,
        };
      }

      // 4xx Client Errors (400, 401, 403, 422) -> permanent, do NOT retry
      return {
        success: false,
        retryable: false,
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
          error: `Request timed out after ${this.timeoutMs}ms`,
          statusCode: 408,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        retryable: true,
        error: `Network failure: ${message}`,
        statusCode: 0,
      };
    }
  }
}

