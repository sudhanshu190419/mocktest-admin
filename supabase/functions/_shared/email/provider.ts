/**
 * Make Me Topper — Email Provider Abstraction
 *
 * Defines the contract for transactional email dispatch services
 * (Resend, mock/local provider, Amazon SES, SendGrid, etc.).
 */

import { EmailSendRequest, EmailSendResult } from './types.ts';

export interface EmailProvider {
  readonly name: string;

  /**
   * Dispatches an email message via the provider.
   * Must classify failure into retryable (e.g. 429, 5xx) vs non-retryable (e.g. 400, 422).
   */
  sendEmail(request: EmailSendRequest): Promise<EmailSendResult>;
}

