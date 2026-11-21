/**
 * Make Me Topper — Mock Email Provider
 *
 * In-memory provider implementation for local development, automated tests,
 * and environments where RESEND_API_KEY is not configured.
 * Guarantees zero real email dispatch while providing full tracking.
 */

import { EmailProvider } from './provider.ts';
import { EmailSendRequest, EmailSendResult } from './types.ts';

export interface DispatchedMockEmail extends EmailSendRequest {
  providerMessageId: string;
  dispatchedAt: Date;
}

export class MockEmailProvider implements EmailProvider {
  public readonly name = 'mock';
  public dispatchedEmails: DispatchedMockEmail[] = [];

  private nextFailure: {
    error: string;
    retryable: boolean;
    statusCode: number;
    retryAfterSeconds?: number;
  } | null = null;

  /**
   * Configures synthetic failure for the next sendEmail invocation.
   */
  public simulateFailureOnce(
    error: string,
    retryable: boolean = true,
    statusCode: number = 500,
    retryAfterSeconds?: number
  ): void {
    this.nextFailure = { error, retryable, statusCode, retryAfterSeconds };
  }

  /**
   * Clears recorded emails and simulated failures.
   */
  public reset(): void {
    this.dispatchedEmails = [];
    this.nextFailure = null;
  }

  public async sendEmail(request: EmailSendRequest): Promise<EmailSendResult> {
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      return {
        success: false,
        error: failure.error,
        retryable: failure.retryable,
        statusCode: failure.statusCode,
        retryAfterSeconds: failure.retryAfterSeconds,
      };
    }

    const providerMessageId = `mock_msg_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;

    this.dispatchedEmails.push({
      ...request,
      providerMessageId,
      dispatchedAt: new Date(),
    });

    return {
      success: true,
      providerMessageId,
      retryable: false,
      statusCode: 200,
    };
  }
}

