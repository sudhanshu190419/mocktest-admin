/**
 * Make Me Topper — Branded Email Templates & Layout Engine
 *
 * Implements:
 * 1. Responsive, email-client-compatible HTML base layout with Make Me Topper branding.
 * 2. Strict HTML entity escaping for XSS prevention.
 * 3. Plain-text generator for multipart email delivery.
 * 4. Extensible template registry supporting Phase 2 Commerce & Financial Events:
 *    - PAY-01: Course Purchase Confirmed
 *    - PAY-02: PYQ Package Purchase Confirmed
 *    - PAY-03: Payment Failed
 *    - PAY-04: Refund Processed
 *    - PAY-05: Payment Received — Under Verification
 *    - PAY-06: Entitlement Revoked
 *    - INS-01: Initial Installment Paid
 *    - INS-02: Subsequent Installment Paid
 *    - test_email: Verification
 */

import { RenderedEmail, TemplateContext } from './types.ts';

/**
 * Escapes HTML characters to prevent XSS / HTML injection in generated emails.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a currency amount into standard INR representation (e.g. ₹1,499.00 or ₹1,499).
 */
export function formatCurrency(amount: unknown, currency: string = 'INR'): string {
  if (amount === null || amount === undefined || amount === '') return '₹0.00';
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (isNaN(num)) return `₹${escapeHtml(amount)}`;
  const symbol = currency.toUpperCase() === 'INR' ? '₹' : `${currency.toUpperCase()} `;
  return `${symbol}${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Strips HTML tags to produce a clean plain-text fallback.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface BaseLayoutOptions {
  preheader?: string;
  title: string;
  contentHtml: string;
  recipientEmail?: string;
  supportEmail?: string;
}

/**
 * Wraps inner HTML content in the standard Make Me Topper branded email template.
 */
export function renderBaseLayout(options: BaseLayoutOptions): string {
  const preheader = options.preheader ? escapeHtml(options.preheader) : '';
  const title = escapeHtml(options.title);
  const supportEmail = options.supportEmail || 'support@inovoxy.com';
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    td {
      padding: 0;
    }
    .wrapper {
      width: 100%;
      background-color: #f1f5f9;
      padding: 32px 0 48px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      padding: 28px 32px;
      text-align: center;
    }
    .header-logo {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #ffffff;
      text-decoration: none;
      display: inline-block;
    }
    .header-tagline {
      color: #bfdbfe;
      font-size: 13px;
      margin-top: 4px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .content {
      padding: 36px 32px;
      font-size: 15px;
      line-height: 1.6;
      color: #334155;
    }
    .button-container {
      margin: 28px 0;
      text-align: center;
    }
    .button {
      display: inline-block;
      background-color: #2563eb;
      color: #ffffff !important;
      font-weight: 600;
      font-size: 15px;
      padding: 12px 28px;
      text-decoration: none;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
    }
    .info-card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 18px 20px;
      margin: 20px 0;
    }
    .alert-card {
      background-color: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 18px 20px;
      margin: 20px 0;
      color: #991b1b;
    }
    .warning-card {
      background-color: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 18px 20px;
      margin: 20px 0;
      color: #92400e;
    }
    .footer {
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 24px 32px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
      line-height: 1.5;
    }
    .footer a {
      color: #2563eb;
      text-decoration: underline;
    }
    .data-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 14px;
    }
    .data-label {
      color: #64748b;
      font-weight: 500;
    }
    .data-val {
      color: #0f172a;
      font-weight: 600;
      text-align: right;
    }
  </style>
</head>
<body>
  ${preheader ? `<div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preheader}</div>` : ''}
  <div class="wrapper">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <div class="container">
            <!-- Header -->
            <div class="header">
              <a href="https://makemetopper.com" class="header-logo">Make Me Topper</a>
              <div class="header-tagline">Excellence in Exam Preparation</div>
            </div>
            
            <!-- Body Content -->
            <div class="content">
              ${options.contentHtml}
            </div>

            <!-- Footer -->
            <div class="footer">
              <p style="margin: 0 0 8px;">
                This transactional email was sent to <strong>${escapeHtml(options.recipientEmail || 'you')}</strong> regarding your Make Me Topper account.
              </p>
              <p style="margin: 0 0 8px;">
                Questions or support needed? Email us at <a href="mailto:${supportEmail}">${supportEmail}</a>
              </p>
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                &copy; ${currentYear} Make Me Topper. All rights reserved.
              </p>
            </div>
          </div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2 COMMERCE TEMPLATE RENDERERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * PAY-01: Course Purchase Confirmed
 */
export function renderCoursePurchaseConfirmedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || (payload.title as string) || 'Your Course';
  const enrollmentNumber = (payload.enrollmentNumber as string) || 'Pending Assignment';
  const orderId = (payload.orderId as string) || 'N/A';
  const amount = payload.amount !== undefined ? formatCurrency(payload.amount, payload.currency as string) : null;
  const purchaseDate = (payload.purchaseDate as string) || new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });

  const title = `Order Confirmed: ${courseName} — Make Me Topper`;
  const preheader = `Your course enrollment is confirmed for ${courseName}. Welcome to Make Me Topper!`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Welcome, ${escapeHtml(recipientName)}!</h2>
    <p>
      Thank you for purchasing <strong>${escapeHtml(courseName)}</strong>. Your payment has been confirmed and your student enrollment is now active.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Enrollment &amp; Order Summary
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Enrollment No:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(enrollmentNumber)}</code></td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Order Reference:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(orderId)}</code></td>
        </tr>
        ${amount ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Amount Paid:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${amount}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Purchase Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(purchaseDate)}</td>
        </tr>
      </table>
    </div>

    <div style="margin: 24px 0; padding: 16px; background-color: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 4px;">
      <div style="font-weight: 600; color: #15803d; margin-bottom: 4px;">Immediate Access Ready:</div>
      <div style="font-size: 14px; color: #166534;">
        You can log in to your dashboard to view your course curriculum, study materials, and access mock tests right away.
      </div>
    </div>

    <div style="margin: 20px 0; padding: 14px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; font-size: 13px; color: #475569;">
      <strong>Please note on Batch &amp; Live Classes:</strong> Timetables and live-class batch assignments are scheduled and allocated by the academic team. You will be notified in your app and student portal as soon as your batch is scheduled.
    </div>

    <div class="button-container">
      <a href="https://makemetopper.com/student/courses" class="button" target="_blank">Go to My Courses</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      Need help? Reach out to our dedicated support team at <a href="mailto:support@inovoxy.com">support@inovoxy.com</a> with your order reference.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * PAY-02: PYQ Package Purchase Confirmed
 */
export function renderPyqPurchaseConfirmedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const packageName = (payload.packageName as string) || 'Previous Year Questions Package';
  const purchaseId = (payload.purchaseId as string) || 'N/A';
  const orderId = (payload.orderId as string) || null;
  const amount = payload.amount !== undefined ? formatCurrency(payload.amount, payload.currency as string) : null;
  const purchaseDate = (payload.purchaseDate as string) || new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });

  const title = `Access Granted: ${packageName} — Make Me Topper`;
  const preheader = `Your PYQ package is ready! Start practicing previous year questions now.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Hello ${escapeHtml(recipientName)},</h2>
    <p>
      Your payment was successful! You now have unrestricted access to <strong>${escapeHtml(packageName)}</strong>.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Package Purchase Details
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Package:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(packageName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Purchase ID:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(purchaseId)}</code></td>
        </tr>
        ${orderId ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Order Reference:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(orderId)}</code></td>
        </tr>` : ''}
        ${amount ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Amount Paid:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${amount}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(purchaseDate)}</td>
        </tr>
      </table>
    </div>

    <p>
      You can now attempt questions by topic or year, analyze your performance, and view comprehensive solutions on both web and mobile app.
    </p>

    <div class="button-container">
      <a href="https://makemetopper.com/student/pyq" class="button" target="_blank">Start Practicing Now</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      Questions? Contact support at <a href="mailto:support@inovoxy.com">support@inovoxy.com</a>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * PAY-03: Payment Failed
 */
export function renderPaymentFailedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const itemTitle = (payload.itemTitle as string) || (payload.courseName as string) || 'Course / Educational Product';
  const amount = payload.amount !== undefined ? formatCurrency(payload.amount, payload.currency as string) : null;
  const gatewayPaymentId = (payload.gatewayPaymentId as string) || (payload.paymentId as string) || 'N/A';
  const failureReason = (payload.failureReason as string) || 'Transaction could not be completed by your bank/payment provider.';
  const retryUrl = (payload.retryUrl as string) || 'https://makemetopper.com';

  const title = `Payment Unsuccessful — Make Me Topper`;
  const preheader = `Your recent payment attempt could not be processed. Here is how to retry.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #dc2626; font-size: 20px; font-weight: 700;">Payment Not Completed</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      We were unable to complete your payment for <strong>${escapeHtml(itemTitle)}</strong>. Your order is currently pending and access has not been activated.
    </p>

    <div class="alert-card">
      <div style="font-weight: 700; margin-bottom: 8px; font-size: 14px;">Payment Failure Information:</div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        ${amount ? `
        <tr>
          <td style="padding: 4px 0; color: #7f1d1d; font-size: 13px;">Attempted Amount:</td>
          <td style="padding: 4px 0; font-weight: 600; text-align: right; color: #7f1d1d; font-size: 13px;">${amount}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 4px 0; color: #7f1d1d; font-size: 13px;">Reference ID:</td>
          <td style="padding: 4px 0; font-weight: 600; text-align: right; color: #7f1d1d; font-size: 13px;"><code>${escapeHtml(gatewayPaymentId)}</code></td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #7f1d1d; font-size: 13px;">Reported Reason:</td>
          <td style="padding: 4px 0; font-weight: 500; text-align: right; color: #7f1d1d; font-size: 13px;">${escapeHtml(failureReason)}</td>
        </tr>
      </table>
    </div>

    <div class="warning-card">
      <div style="font-weight: 600; margin-bottom: 4px;">Important: What if money was debited?</div>
      <div style="font-size: 13px; line-height: 1.5;">
        If your bank account or card was charged for this failed attempt, please note that the debited funds are held by your banking institution or payment provider and are typically released or reversed within 5 to 7 business days, depending on your bank's reconciliation cycle and payment method. If you do not see the reversal after this period, please reach out to your bank or contact our support team.
      </div>
    </div>

    <p style="font-size: 14px;">
      You can easily retry the payment using an alternate method (UPI, net banking, or another card) by clicking below:
    </p>

    <div class="button-container">
      <a href="${escapeHtml(retryUrl)}" class="button" target="_blank">Retry Payment</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      If you need assistance or if your account was charged without automatic reversal, please contact <a href="mailto:support@inovoxy.com">support@inovoxy.com</a> with Reference ID <code>${escapeHtml(gatewayPaymentId)}</code>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * PAY-04: Refund Processed
 */
export function renderRefundProcessedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const itemTitle = (payload.itemTitle as string) || (payload.courseName as string) || 'Your Order';
  const refundId = (payload.refundId as string) || 'N/A';
  const orderId = (payload.orderId as string) || null;
  const amount = payload.amount !== undefined ? formatCurrency(payload.amount, payload.currency as string) : '₹0.00';
  const refundDate = (payload.refundDate as string) || new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });

  const title = `Refund Processed — Make Me Topper`;
  const preheader = `A refund of ${amount} has been processed for ${itemTitle}.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Refund Processed</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      We have processed a refund for your payment regarding <strong>${escapeHtml(itemTitle)}</strong>.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Refund Details
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Refund Amount:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #2563eb; font-size: 15px;">${amount}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Refund Reference:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(refundId)}</code></td>
        </tr>
        ${orderId ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Original Order:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(orderId)}</code></td>
        </tr>` : ''}
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Processed On:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(refundDate)}</td>
        </tr>
      </table>
    </div>

    <div style="margin: 20px 0; padding: 14px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; color: #475569;">
      <strong>Processing Timeline:</strong> Refunds are credited directly back to your original source of payment (bank account, card, or UPI). It usually takes between <strong>5 to 7 business days</strong> to reflect in your account statement depending on your banking provider.
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      If you do not see the credit after 7 business days, please write to us at <a href="mailto:support@inovoxy.com">support@inovoxy.com</a> with Refund Reference <code>${escapeHtml(refundId)}</code>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * PAY-05: Payment Received — Under Verification
 */
export function renderPaymentUnderVerificationEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const itemTitle = (payload.itemTitle as string) || (payload.courseName as string) || 'Educational Product';
  const orderId = (payload.orderId as string) || 'N/A';
  const amount = payload.amount !== undefined ? formatCurrency(payload.amount, payload.currency as string) : null;
  const gatewayPaymentId = (payload.gatewayPaymentId as string) || null;

  const title = `We Received Your Payment — Verification in Progress`;
  const preheader = `We received your payment. Verification is in progress for your order.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #d97706; font-size: 20px; font-weight: 700;">Payment Received — Verification in Progress</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      We have safely received and recorded your payment${amount ? ` of <strong>${amount}</strong>` : ''} for <strong>${escapeHtml(itemTitle)}</strong>.
    </p>

    <div class="warning-card" style="border-width: 2px;">
      <div style="font-weight: 800; font-size: 15px; margin-bottom: 6px; color: #b45309;">
        ⚠️ IMPORTANT: PLEASE DO NOT PAY AGAIN
      </div>
      <div style="font-size: 14px; line-height: 1.5; color: #78350f;">
        Your payment has already been captured and securely received. To avoid duplicate charges, please do not attempt to initiate another payment for this order.
      </div>
    </div>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Order Verification Status
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Order Reference:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(orderId)}</code></td>
        </tr>
        ${gatewayPaymentId ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Transaction ID:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(gatewayPaymentId)}</code></td>
        </tr>` : ''}
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Status:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #d97706; font-size: 14px;">Under Administrative Review</td>
        </tr>
      </table>
    </div>

    <p style="font-size: 14px;">
      Our administration team conducts a standard security verification on flagged orders. This process is typically resolved within <strong>24 hours</strong>. Once verified, your course access will be unlocked automatically.
    </p>

    <div class="button-container">
      <a href="https://makemetopper.com/student/dashboard" class="button" target="_blank">View Dashboard</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      If you have questions about your pending verification, contact our support desk directly at <a href="mailto:support@inovoxy.com">support@inovoxy.com</a>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * PAY-06: Entitlement Revoked
 */
export function renderEntitlementRevokedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const productName = (payload.productName as string) || (payload.itemTitle as string) || 'Make Me Topper Product';
  const transactionId = (payload.transactionId as string) || 'N/A';
  const revokedDate = (payload.revokedDate as string) || new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });

  const title = `Access Update: ${productName} — Make Me Topper`;
  const preheader = `Important update regarding your access to ${productName}.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Access Revocation Notice</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      We are writing to notify you that access to <strong>${escapeHtml(productName)}</strong> has been revoked following an App Store revocation notice (such as a Family Sharing change or store revocation).
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Revocation Summary
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Product:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(productName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Transaction ID:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(transactionId)}</code></td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Effective Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(revokedDate)}</td>
        </tr>
      </table>
    </div>

    <p style="font-size: 14px;">
      If you believe this revocation was made in error or wish to re-enroll, you may purchase the product directly on our platform or contact our support team.
    </p>

    <div class="button-container">
      <a href="mailto:support@inovoxy.com" class="button" target="_blank">Contact Support</a>
    </div>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-01: Initial Installment Paid
 */
export function renderInstallmentInitialPaidEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const agreementId = (payload.agreementId as string) || 'N/A';
  const initialAmount = payload.initialAmount !== undefined ? formatCurrency(payload.initialAmount) : '₹0.00';
  const totalFee = payload.totalFee !== undefined ? formatCurrency(payload.totalFee) : '₹0.00';
  const outstandingBalance = payload.outstandingBalance !== undefined ? formatCurrency(payload.outstandingBalance) : '₹0.00';
  const nextDueDate = (payload.nextDueDate as string) || 'See Installment Schedule';

  const title = `Installment Plan Activated: ${courseName} — Make Me Topper`;
  const preheader = `Your initial installment of ${initialAmount} is confirmed. Installment agreement active!`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Installment Plan Activated!</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      Congratulations! Your initial installment payment has been received, and your installment plan for <strong>${escapeHtml(courseName)}</strong> is now active.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Installment Agreement Summary
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Agreement Reference:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(agreementId)}</code></td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Initial Payment Paid:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${initialAmount}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Total Plan Fee:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${totalFee}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Remaining Balance:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #2563eb; font-size: 14px;">${outstandingBalance}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Next Due Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(nextDueDate)}</td>
        </tr>
      </table>
    </div>

    <div style="margin: 20px 0; padding: 14px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; font-size: 13px; color: #475569;">
      <strong>Installment Access Guidelines:</strong> Your course access is unlocked under this agreement. To ensure uninterrupted access, please settle upcoming installments on or before their due dates. Batch allocation and live-class schedules are assigned by the academic team.
    </div>

    <div class="button-container">
      <a href="https://makemetopper.com/student/installments" class="button" target="_blank">View Installment Schedule</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      For assistance with your installment schedule, email <a href="mailto:support@inovoxy.com">support@inovoxy.com</a>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-02: Subsequent Installment Paid
 */
export function renderInstallmentSubsequentPaidEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const paymentId = (payload.paymentId as string) || 'N/A';
  const installmentNumber = payload.installmentNumber ? String(payload.installmentNumber) : null;
  const amount = payload.amount !== undefined ? formatCurrency(payload.amount) : '₹0.00';
  const outstandingBalance = payload.outstandingBalance !== undefined ? formatCurrency(payload.outstandingBalance) : '₹0.00';
  const isCompleted = payload.isCompleted === true || (payload.outstandingBalance !== undefined && Number(payload.outstandingBalance) <= 0);
  const nextDueDate = isCompleted ? 'Completed (No further dues)' : ((payload.nextDueDate as string) || 'See portal schedule');

  const title = `Installment Payment Received: ${courseName} — Make Me Topper`;
  const preheader = isCompleted
    ? `Congratulations! All installments completed for ${courseName}.`
    : `Installment payment of ${amount} received for ${courseName}.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">
      ${isCompleted ? 'All Installments Completed!' : 'Installment Payment Received'}
    </h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      ${isCompleted
        ? `We have received your final installment payment for <strong>${escapeHtml(courseName)}</strong>. Your installment agreement is now fully paid!`
        : `We have received your installment payment for <strong>${escapeHtml(courseName)}</strong>. Your payment has been credited toward your agreement.`}
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Payment &amp; Balance Breakdown
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Payment Reference:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(paymentId)}</code></td>
        </tr>
        ${installmentNumber ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Installment:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">Installment #${escapeHtml(installmentNumber)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Amount Received:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${amount}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Updated Balance:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: ${isCompleted ? '#16a34a' : '#2563eb'}; font-size: 14px;">
            ${isCompleted ? '₹0.00 (Fully Paid)' : outstandingBalance}
          </td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Next Due Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(nextDueDate)}</td>
        </tr>
      </table>
    </div>

    ${isCompleted ? `
    <div style="margin: 20px 0; padding: 14px; background-color: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 4px; font-size: 14px; color: #166534;">
      <strong>Installment Plan Complete:</strong> All scheduled installment payments for this course have been fully settled. Your course access is fully unlocked.<br><br>
      <strong>Note on Batch &amp; Live Classes:</strong> Live-class batch assignments, active timetable scheduling, and batch attendance continue to be managed and allocated by the academic team according to schedule. You will be notified in your student portal as soon as batch sessions are scheduled.
    </div>
    ` : `
    <p style="font-size: 14px;">
      Your uninterrupted access to all enrolled course content and practice tests continues.
    </p>
    `}

    <div class="button-container">
      <a href="https://makemetopper.com/student/installments" class="button" target="_blank">View Payment Ledger</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      Questions regarding your account? Contact <a href="mailto:support@inovoxy.com">support@inovoxy.com</a>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-03: Installment Due in 3 Days (Pre-Due Reminder)
 */
export function renderInstallmentDueIn3DaysEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const installmentNumber = payload.installmentNumber !== undefined ? String(payload.installmentNumber) : '1';
  const totalInstallments = payload.totalInstallments !== undefined ? ` of ${payload.totalInstallments}` : '';
  const amountDue = payload.amountDue !== undefined ? formatCurrency(payload.amountDue) : '₹0.00';
  const dueDate = (payload.dueDate as string) || (payload.effectiveDueDate as string) || 'in 3 days';
  const paymentUrl = (payload.paymentUrl as string) || 'https://makemetopper.com/student/courses';

  const title = `Your Make Me Topper installment is due in 3 days`;
  const preheader = `Upcoming installment of ${amountDue} for ${courseName} is due in 3 days on ${dueDate}.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Upcoming Installment Reminder</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      This is a friendly reminder that an upcoming installment for your course <strong>${escapeHtml(courseName)}</strong> is due in 3 days on <strong>${escapeHtml(dueDate)}</strong>.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Payment Details
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Installment:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">Installment ${escapeHtml(installmentNumber)}${escapeHtml(totalInstallments)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Amount Due:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #0284c7; font-size: 14px;">${amountDue}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Due Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(dueDate)}</td>
        </tr>
      </table>
    </div>

    <div class="button-container">
      <a href="${escapeHtml(paymentUrl)}" class="button" target="_blank">Pay Installment Now</a>
    </div>

    <p style="font-size: 14px; color: #475569; margin-top: 20px;">
      Completing your payment on time ensures uninterrupted access to your live interactive classes and study materials.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-04: Installment Due Today (08:00 AM IST Reminder)
 */
export function renderInstallmentDueTodayEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const installmentNumber = payload.installmentNumber !== undefined ? String(payload.installmentNumber) : '1';
  const totalInstallments = payload.totalInstallments !== undefined ? ` of ${payload.totalInstallments}` : '';
  const amountDue = payload.amountDue !== undefined ? formatCurrency(payload.amountDue) : '₹0.00';
  const dueDate = (payload.dueDate as string) || (payload.effectiveDueDate as string) || 'Today';
  const paymentUrl = (payload.paymentUrl as string) || 'https://makemetopper.com/student/courses';

  const title = `Reminder: Your installment payment is due today`;
  const preheader = `Action required: Your installment of ${amountDue} for ${courseName} is due today (${dueDate}).`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Installment Payment Due Today</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      This is a reminder that your scheduled installment payment for <strong>${escapeHtml(courseName)}</strong> is due today (<strong>${escapeHtml(dueDate)}</strong>).
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Due Today Details
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Installment:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">Installment ${escapeHtml(installmentNumber)}${escapeHtml(totalInstallments)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Amount Due:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #d97706; font-size: 14px;">${amountDue}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Deadline:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">Today (${escapeHtml(dueDate)})</td>
        </tr>
      </table>
    </div>

    <div class="button-container">
      <a href="${escapeHtml(paymentUrl)}" class="button" target="_blank">Pay Now</a>
    </div>

    <p style="font-size: 14px; color: #475569; margin-top: 20px;">
      Please ensure your payment is completed today to avoid any interruption to your live interactive classes.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-05: Installment Overdue (T+1 Overdue Alert)
 */
export function renderInstallmentOverdueEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const installmentNumber = payload.installmentNumber !== undefined ? String(payload.installmentNumber) : '1';
  const amountDue = payload.amountDue !== undefined ? formatCurrency(payload.amountDue) : '₹0.00';
  const originalDueDate = (payload.originalDueDate as string) || (payload.effectiveDueDate as string) || (payload.dueDate as string) || 'Yesterday';
  const paymentUrl = (payload.paymentUrl as string) || 'https://makemetopper.com/student/courses';

  const title = `Payment Reminder: Your installment is overdue`;
  const preheader = `Payment reminder: Your installment of ${amountDue} for ${courseName} is past due.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #dc2626; font-size: 20px; font-weight: 700;">Installment Payment Overdue</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      We noticed that your scheduled installment payment of <strong>${amountDue}</strong> for <strong>${escapeHtml(courseName)}</strong>, which was due on <strong>${escapeHtml(originalDueDate)}</strong>, has not yet been received.
    </p>

    <div class="info-card" style="border-left: 4px solid #ef4444;">
      <div style="font-weight: 700; color: #991b1b; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #fee2e2; padding-bottom: 6px;">
        Overdue Installment Details
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Installment:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">Installment ${escapeHtml(installmentNumber)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Overdue Amount:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #dc2626; font-size: 14px;">${amountDue}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Original Due Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(originalDueDate)}</td>
        </tr>
      </table>
    </div>

    <div class="button-container">
      <a href="${escapeHtml(paymentUrl)}" class="button" target="_blank" style="background-color: #dc2626;">Clear Overdue Payment</a>
    </div>

    <p style="font-size: 14px; color: #475569; margin-top: 20px;">
      Prompt payment is requested to maintain uninterrupted access to your live classes. Please clear this installment as soon as possible.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-06: Arrears Escalation and Academic Access Warning (T+7)
 */
export function renderArrearsWarningEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const overdueBalance = payload.overdueBalance !== undefined ? formatCurrency(payload.overdueBalance) : '₹0.00';
  const earliestDueDate = (payload.earliestDueDate as string) || (payload.effectiveDueDate as string) || '7+ days ago';
  const paymentUrl = (payload.paymentUrl as string) || 'https://makemetopper.com/student/courses';

  const title = `Important: Outstanding Installment and Academic Access Warning`;
  const preheader = `Urgent: Installment arrears for ${courseName} exceed 7 days. Review your academic access status.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #b91c1c; font-size: 20px; font-weight: 700;">Outstanding Installment & Academic Access Warning</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      Your installment payment for <strong>${escapeHtml(courseName)}</strong> is now more than 7 days overdue.
    </p>

    <div class="info-card" style="border-left: 4px solid #b91c1c; background-color: #fef2f2;">
      <div style="font-weight: 700; color: #991b1b; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #fee2e2; padding-bottom: 6px;">
        Account Arrears Summary
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Total Overdue Balance:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #b91c1c; font-size: 14px;">${overdueBalance}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Earliest Unpaid Due Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(earliestDueDate)}</td>
        </tr>
      </table>
    </div>

    <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 14px; margin: 18px 0;">
      <div style="font-weight: 700; color: #92400e; font-size: 14px; margin-bottom: 6px;">Current Academic Access Status:</div>
      <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #78350f; line-height: 1.6;">
        <li><strong>Live Classes & Recorded Lectures:</strong> Attendance and recording playback are suspended while account is in arrears.</li>
        <li><strong>Course Study Material & Notes:</strong> Temporarily accessible under our 30-day academic grace window from your paid-through date.</li>
      </ul>
    </div>

    <div class="button-container">
      <a href="${escapeHtml(paymentUrl)}" class="button" target="_blank" style="background-color: #b91c1c;">Clear Arrears & Restore Access</a>
    </div>

    <p style="font-size: 14px; color: #475569; margin-top: 20px;">
      Once your overdue payment is settled, full access to live classes and video recordings will be automatically restored immediately.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-07: Installment Plan Completed (Full Settlement)
 */
export function renderInstallmentPlanCompletedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const totalFee = payload.totalFee !== undefined ? formatCurrency(payload.totalFee) : '₹0.00';
  const agreementId = (payload.agreementId as string) || 'N/A';
  const certificateUrl = (payload.certificateUrl as string) || null;

  const title = `Congratulations! Your installment plan is complete`;
  const preheader = `You have successfully completed all installments for ${courseName}. Permanent ownership unlocked!`;

  const certificateHtml = certificateUrl
    ? `
    <div class="button-container">
      <a href="${escapeHtml(certificateUrl)}" class="button" target="_blank">Download Certificate</a>
    </div>
  `
    : `
    <div class="button-container">
      <a href="https://makemetopper.com/student/courses" class="button" target="_blank">Go to My Courses</a>
    </div>
  `;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #16a34a; font-size: 20px; font-weight: 700;">Installment Plan Complete!</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      Congratulations! You have successfully completed all scheduled installment payments for <strong>${escapeHtml(courseName)}</strong>. Your installment agreement is now fully settled.
    </p>

    <div class="info-card" style="border-left: 4px solid #16a34a; background-color: #f0fdf4;">
      <div style="font-weight: 700; color: #166534; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #bbf7d0; padding-bottom: 6px;">
        Settlement Confirmation
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Agreement Reference:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;"><code>${escapeHtml(agreementId)}</code></td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Total Amount Paid:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${totalFee}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Enrollment Status:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">Permanent Full Ownership</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Outstanding Balance:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #0f172a; font-size: 14px;">₹0.00</td>
        </tr>
      </table>
    </div>

    ${certificateHtml}

    <p style="font-size: 14px; color: #475569; margin-top: 20px;">
      Your account now holds permanent course ownership with ongoing access to course resources, class recordings, and materials. Thank you for learning with Make Me Topper!
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-08: Installment Due Date Rescheduled
 */
export function renderInstallmentRescheduledEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const installmentNumber = payload.installmentNumber !== undefined ? String(payload.installmentNumber) : '1';
  const originalDueDate = (payload.originalDueDate as string) || 'Previous Date';
  const newDueDate = (payload.newDueDate as string) || (payload.revisedDueDate as string) || 'Updated Date';
  const amountDue = payload.amountDue !== undefined ? formatCurrency(payload.amountDue) : '₹0.00';
  const reason = (payload.reason as string) || 'Approved academic extension';

  const title = `Your Installment Due Date Has Been Updated`;
  const preheader = `The due date for installment ${installmentNumber} in ${courseName} has been revised to ${newDueDate}.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Installment Due Date Updated</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      This email confirms that the due date for your installment in <strong>${escapeHtml(courseName)}</strong> has been officially updated by an academic administrator or counselor.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Revised Schedule Information
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Installment:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">Installment ${escapeHtml(installmentNumber)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Original Due Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #94a3b8; text-decoration: line-through; font-size: 14px;">${escapeHtml(originalDueDate)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Revised Due Date:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${escapeHtml(newDueDate)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Amount Due:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${amountDue}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Extension Reason:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #475569; font-size: 14px;">${escapeHtml(reason)}</td>
        </tr>
      </table>
    </div>

    <div class="button-container">
      <a href="https://makemetopper.com/student/courses" class="button" target="_blank">View Installment Schedule</a>
    </div>

    <p style="font-size: 14px; color: #475569; margin-top: 20px;">
      Your installment schedule has been adjusted accordingly. Reminders will now align with your new revised due date.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * INS-10: Arrears Cleared and Course Access Restored
 */
export function renderArrearsClearedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const courseName = (payload.courseName as string) || 'Your Course';
  const amountPaid = payload.amountPaid !== undefined ? formatCurrency(payload.amountPaid) : '₹0.00';
  const remainingOutstandingBalance = payload.remainingOutstandingBalance !== undefined ? formatCurrency(payload.remainingOutstandingBalance) : '₹0.00';
  const nextDueDate = (payload.nextDueDate as string) || 'According to schedule';

  const title = `Your Arrears Are Cleared — Course Access Restored`;
  const preheader = `Payment received. Overdue arrears for ${courseName} are cleared and academic access is restored.`;

  const contentHtml = `
    <h2 style="margin-top: 0; color: #16a34a; font-size: 20px; font-weight: 700;">Arrears Cleared — Access Restored!</h2>
    <p>Hello ${escapeHtml(recipientName)},</p>
    <p>
      Thank you for your payment. We have received your payment of <strong>${amountPaid}</strong> for <strong>${escapeHtml(courseName)}</strong>. Your overdue balance has been cleared, and your account has been returned to active standing.
    </p>

    <div class="info-card" style="border-left: 4px solid #16a34a; background-color: #f0fdf4;">
      <div style="font-weight: 700; color: #166534; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #bbf7d0; padding-bottom: 6px;">
        Account Standing Restored
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Course:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(courseName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Payment Received:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${amountPaid}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Overdue Balance:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">₹0.00 (Cleared)</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Remaining Plan Balance:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${remainingOutstandingBalance}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Next Scheduled Due Date:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(nextDueDate)}</td>
        </tr>
      </table>
    </div>

    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 14px; margin: 18px 0;">
      <div style="font-weight: 700; color: #166534; font-size: 14px; margin-bottom: 6px;">Academic Access Status: Fully Restored</div>
      <p style="margin: 0; font-size: 13px; color: #14532d; line-height: 1.5;">
        Full access to attend live classes, join cohort sessions, and play back lecture recordings has been immediately restored.
      </p>
    </div>

    <div class="button-container">
      <a href="https://makemetopper.com/student/live-classes" class="button" target="_blank">Join Live Classes</a>
    </div>

    <p style="font-size: 14px; color: #475569; margin-top: 20px;">
      Thank you for keeping your account up to date. Keep up the great work in your studies!
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * ACC-01: Student Welcome Email
 */
export function renderStudentWelcomeEmail(
  payload: Record<string, unknown>,
  context: TemplateContext = {}
): RenderedEmail {
  const recipientName = (payload.recipientName as string) || context.recipientName || 'Student';
  const title = 'Welcome to Make Me Topper!';
  const preheader = 'Welcome to Make Me Topper! Your account is active and ready for learning.';
  const appUrl = (payload.appUrl as string) || 'https://makemetopper.com/student/overview';

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Welcome to Make Me Topper, ${escapeHtml(recipientName)}!</h2>
    <p>
      We are excited to welcome you to the <strong>Make Me Topper</strong> learning community! Your email address has been successfully registered to your account.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Everything You Need to Succeed
      </div>
      <p style="margin: 6px 0; font-size: 14px; color: #334155;">
        🎯 <strong>Structured Courses:</strong> Master syllabus concepts with expert faculty guidance.
      </p>
      <p style="margin: 6px 0; font-size: 14px; color: #334155;">
        📅 <strong>Interactive Live Classes &amp; Timetables:</strong> Attend live lectures and track daily schedules.
      </p>
      <p style="margin: 6px 0; font-size: 14px; color: #334155;">
        📝 <strong>Mock Test Engine:</strong> Realistic test simulations, detailed analytics, and rank predictions.
      </p>
      <p style="margin: 6px 0; font-size: 14px; color: #334155;">
        📚 <strong>Chapter-wise PYQ Papers:</strong> Practice previous year questions with verified solutions.
      </p>
    </div>

    <div class="button-container">
      <a href="${escapeHtml(appUrl)}" class="button" target="_blank">Start Learning</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      Need any assistance getting started? Our support team is here to help at <a href="mailto:support@inovoxy.com">support@inovoxy.com</a>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * ACC-03: New/Untrusted Device Security Alert
 */
export function renderNewDeviceAlertEmail(
  payload: Record<string, unknown>,
  context: TemplateContext = {}
): RenderedEmail {
  const recipientName = (payload.recipientName as string) || context.recipientName || 'Student';
  const deviceName = (payload.deviceName as string) || 'Unknown device';
  const userAgent = (payload.userAgent as string) || 'Web browser';
  const attemptedAt = (payload.attemptedAt as string) || new Date().toISOString();
  const supportEmail = (payload.supportEmail as string) || 'support@inovoxy.com';
  const profileUrl = (payload.profileUrl as string) || 'https://makemetopper.com/student/profile';

  const title = 'Security Alert: New Device Sign-in Attempt';
  const preheader = 'Security alert: A sign-in attempt from a new or untrusted device was detected on your Make Me Topper account.';

  const contentHtml = `
    <h2 style="margin-top: 0; color: #9a3412; font-size: 20px; font-weight: 700;">Security Alert: New Sign-in Attempt</h2>
    <p>
      Hello ${escapeHtml(recipientName)}, a sign-in attempt from a <strong>new or untrusted device</strong> was detected for your Make Me Topper account.
    </p>

    <div class="warning-card">
      <div style="font-weight: 700; color: #9a3412; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #fde68a; padding-bottom: 6px;">
        Activity Details
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #92400e; font-size: 14px;">Device:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(deviceName)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #92400e; font-size: 14px;">Browser / Client:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(userAgent)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #92400e; font-size: 14px;">Date &amp; Time:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(attemptedAt)}</td>
        </tr>
      </table>
    </div>

    <div style="margin: 20px 0; padding: 14px; background-color: #f8fafc; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 14px; color: #334155;">
      <strong>What should you do?</strong>
      <ul style="margin: 8px 0 0 0; padding-left: 20px;">
        <li><strong>If this was you:</strong> You can approve or verify this sign-in attempt using your registered credentials.</li>
        <li><strong>If you do not recognize this activity:</strong> Someone else may be trying to access your account. Please change your password immediately and contact our support team.</li>
      </ul>
    </div>

    <div class="button-container">
      <a href="${escapeHtml(profileUrl)}" class="button" target="_blank">Review Account Security</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      Need help? Reach out to our security team at <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a> immediately.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * ACC-04: Account Deletion Confirmation
 */
export function renderAccountDeletedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext = {}
): RenderedEmail {
  const recipientName = (payload.recipientName as string) || context.recipientName || 'Student';
  const deletionDate = (payload.deletionDate as string) || new Date().toISOString();
  const supportEmail = (payload.supportEmail as string) || 'support@inovoxy.com';

  const title = 'Your Make Me Topper Account Has Been Deleted';
  const preheader = 'Your Make Me Topper account and personal data have been permanently deleted as requested.';

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Account Deletion Confirmation</h2>
    <p>
      Hello ${escapeHtml(recipientName)}, this email confirms that your Make Me Topper account has been <strong>successfully and permanently deleted</strong> in response to your request.
    </p>

    <div class="info-card">
      <div style="font-weight: 700; color: #334155; margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
        Deletion Summary
      </div>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Account Status:</td>
          <td style="padding: 5px 0; font-weight: 700; text-align: right; color: #dc2626; font-size: 14px;">Permanently Deleted</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Deletion Timestamp:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(deletionDate)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; color: #64748b; font-size: 14px;">Associated Email:</td>
          <td style="padding: 5px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(context.recipientEmail)}</td>
        </tr>
      </table>
    </div>

    <div style="margin: 20px 0; padding: 14px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; color: #475569; line-height: 1.6;">
      <strong>What has been removed:</strong>
      <br>
      Your profile data, personal notes, test attempt history, enrolled course progress, uploaded files, and active device sessions have been permanently removed from our active systems. Past financial invoices have been legally anonymized for statutory tax and audit compliance.
    </div>

    <p style="font-size: 14px; color: #334155;">
      You are always welcome to return in the future by registering a fresh account at <a href="https://makemetopper.com">makemetopper.com</a>.
    </p>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      If you did not request this deletion or believe this was done in error, please contact our support team immediately at <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * Template renderer for 'EXM-01': Official Mock Test Result Published
 */
export function renderMockTestResultPublishedEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || (payload.recipientName as string) || 'Student';
  const testTitle = (payload.testTitle as string) || (payload.test_title as string) || 'Mock Test';
  const attemptNumber = payload.attemptNumber ?? payload.attempt_number ?? 1;
  const score = payload.score ?? payload.totalScore ?? payload.total_score ?? 0;
  const maxScore = payload.maxScore ?? payload.totalMarks ?? payload.max_score ?? payload.total_marks ?? 0;
  const percentage = payload.percentage ?? (Number(maxScore) > 0 ? ((Number(score) / Number(maxScore)) * 100).toFixed(1) : '0');
  const rank = payload.rank !== null && payload.rank !== undefined ? Number(payload.rank) : null;
  const percentile = payload.percentile !== null && payload.percentile !== undefined ? Number(payload.percentile) : null;
  const correctCount = payload.correctCount ?? payload.correct_count ?? 0;
  const wrongCount = payload.wrongCount ?? payload.wrong_count ?? payload.incorrectCount ?? payload.incorrect_count ?? 0;
  const skippedCount = payload.skippedCount ?? payload.skipped_count ?? 0;
  const attemptId = payload.attemptId as string | undefined;
  const testId = payload.testId as string | undefined;
  const resultsUrl =
    (payload.resultsUrl as string) ||
    (testId && attemptId
      ? `https://makemetopper.com/student/tests/${testId}/results/${attemptId}`
      : 'https://makemetopper.com/student/results');
  const supportEmail = 'support@inovoxy.com';

  const title = `Official Result Published: ${testTitle} — Make Me Topper`;
  const preheader = `Your official scorecard and performance analysis for ${testTitle} are now available.`;

  // Format release date if present
  let formattedReleasedAt = '';
  if (payload.releasedAt) {
    try {
      const d = new Date(payload.releasedAt as string);
      if (!isNaN(d.getTime())) {
        formattedReleasedAt = d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Kolkata',
        }) + ' IST';
      }
    } catch {
      formattedReleasedAt = '';
    }
  }

  // Construct rank & percentile badges only if values are present and valid
  const hasRankOrPercentile = rank !== null || percentile !== null;
  const rankPercentileHtml = hasRankOrPercentile
    ? `
      <div style="margin: 16px 0; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
        ${rank !== null ? `
          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 16px; text-align: center; min-width: 130px;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #166534; letter-spacing: 0.5px;">All-India Rank</div>
            <div style="font-size: 20px; font-weight: 800; color: #15803d; margin-top: 2px;">#${escapeHtml(rank)}</div>
          </div>
        ` : ''}
        ${percentile !== null ? `
          <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 16px; text-align: center; min-width: 130px;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #1e40af; letter-spacing: 0.5px;">Percentile</div>
            <div style="font-size: 20px; font-weight: 800; color: #2563eb; margin-top: 2px;">${escapeHtml(percentile)}%</div>
          </div>
        ` : ''}
      </div>
    `
    : '';

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Hello ${escapeHtml(recipientName)},</h2>
    <p>
      The official results for <strong>${escapeHtml(testTitle)}</strong> have been finalized and published.
      Your official evaluation, performance analytics, and question solutions are now ready on Make Me Topper.
    </p>

    <div style="margin: 24px 0; background: linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%); border: 1px solid #cbd5e1; border-radius: 10px; padding: 20px; text-align: center;">
      <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Your Total Score</div>
      <div style="font-size: 32px; font-weight: 800; color: #0f172a; margin: 4px 0;">
        ${escapeHtml(score)} <span style="font-size: 18px; font-weight: 500; color: #64748b;">/ ${escapeHtml(maxScore)}</span>
      </div>
      <div style="font-size: 14px; font-weight: 600; color: #3b82f6;">
        Score Percentage: ${escapeHtml(percentage)}%
      </div>
      ${rankPercentileHtml}
    </div>

    <div style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background-color: #ffffff;">
      <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 700; color: #334155; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">Attempt Summary</h3>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Attempt Number:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">#${escapeHtml(attemptNumber)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Correct Answers:</td>
          <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #16a34a; font-size: 14px;">${escapeHtml(correctCount)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Incorrect Answers:</td>
          <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #dc2626; font-size: 14px;">${escapeHtml(wrongCount)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Skipped Questions:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #64748b; font-size: 14px;">${escapeHtml(skippedCount)}</td>
        </tr>
        ${formattedReleasedAt ? `
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Published On:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(formattedReleasedAt)}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    <div class="button-container" style="text-align: center; margin: 28px 0;">
      <a href="${escapeHtml(resultsUrl)}" class="button" target="_blank" style="background-color: #2563eb; color: #ffffff !important; display: inline-block; padding: 12px 28px; font-weight: 600; font-size: 15px; border-radius: 6px; text-decoration: none;">
        View Detailed Scorecard & Analysis
      </a>
    </div>

    <div style="margin: 20px 0; padding: 14px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; color: #475569; line-height: 1.6;">
      <strong>Pro Tip:</strong>
      <br>
      Reviewing your incorrect and skipped questions is the fastest way to improve your score. Log in to your student dashboard to review detailed solution step-throughs, speed analytics, and question-level insights.
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      If you have questions regarding this assessment or encounter difficulty accessing your scorecard, our academic support team is here to assist at <a href="mailto:${escapeHtml(supportEmail)}" style="color: #2563eb; text-decoration: none;">${escapeHtml(supportEmail)}</a>.
    </p>
  `;

  const html = renderBaseLayout({
    title,
    preheader,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
    supportEmail,
  });

  return {
    subject: title,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * Template renderer for 'test_email'
 */
function renderTestEmail(
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const recipientName = context.recipientName || 'Student';
  const testTitle = (payload.title as string) || 'Test Notification';
  const message = (payload.message as string) || 'This is a test email sent from Make Me Topper transactional notification system.';
  const actionUrl = (payload.actionUrl as string) || 'https://makemetopper.com';
  const actionText = (payload.actionText as string) || 'Visit Make Me Topper';
  const testId = (payload.testId as string) || 'TEST-' + Date.now();

  const contentHtml = `
    <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Hello ${escapeHtml(recipientName)},</h2>
    <p>${escapeHtml(message)}</p>
    
    <div class="info-card">
      <div style="font-weight: 600; color: #334155; margin-bottom: 6px;">Notification Verification Details:</div>
      <div style="font-size: 13px; color: #64748b;">
        <div><strong>Test Identifier:</strong> <code>${escapeHtml(testId)}</code></div>
        <div><strong>Timestamp:</strong> ${new Date().toISOString()}</div>
        <div><strong>Recipient:</strong> ${escapeHtml(context.recipientEmail)}</div>
      </div>
    </div>

    <div class="button-container">
      <a href="${escapeHtml(actionUrl)}" class="button" target="_blank">${escapeHtml(actionText)}</a>
    </div>

    <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
      If you did not initiate this test, please disregard this email.
    </p>
  `;

  const html = renderBaseLayout({
    title: testTitle,
    preheader: `Test notification from Make Me Topper - ${testId}`,
    contentHtml,
    recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
  });

  return {
    subject: testTitle,
    html,
    text: htmlToPlainText(html),
  };
}

/**
 * Main Template Renderer: routes template_id to the appropriate renderer.
 * Handles missing templates with a safe fallback rather than crashing.
 */
export function renderEmail(
  templateId: string,
  payload: Record<string, unknown>,
  context: TemplateContext
): RenderedEmail {
  const normalized = (templateId || '').trim().toLowerCase().replace(/_/g, '-');

  switch (normalized) {
    // PAY-01: Course Purchase Confirmed
    case 'pay-01':
    case 'course-purchase-confirmed':
    case 'course-purchased':
      return renderCoursePurchaseConfirmedEmail(payload, context);

    // PAY-02: PYQ Package Purchase Confirmed
    case 'pay-02':
    case 'pyq-purchase-confirmed':
    case 'pyq-purchased':
    case 'pyq-access-granted':
      return renderPyqPurchaseConfirmedEmail(payload, context);

    // PAY-03: Payment Failed
    case 'pay-03':
    case 'payment-failed':
      return renderPaymentFailedEmail(payload, context);

    // PAY-04: Refund Processed
    case 'pay-04':
    case 'refund-processed':
    case 'refund-confirmed':
      return renderRefundProcessedEmail(payload, context);

    // PAY-05: Payment Received — Under Verification
    case 'pay-05':
    case 'payment-under-verification':
    case 'payment-verification':
    case 'order-requires-admin-review':
      return renderPaymentUnderVerificationEmail(payload, context);

    // PAY-06: Entitlement Revoked
    case 'pay-06':
    case 'entitlement-revoked':
    case 'access-revoked':
      return renderEntitlementRevokedEmail(payload, context);

    // INS-01: Initial Installment Paid
    case 'ins-01':
    case 'installment-initial-paid':
    case 'installment-initial':
      return renderInstallmentInitialPaidEmail(payload, context);

    // INS-02: Subsequent Installment Paid
    case 'ins-02':
    case 'installment-subsequent-paid':
    case 'installment-subsequent':
      return renderInstallmentSubsequentPaidEmail(payload, context);

    // INS-03: Installment Due in 3 Days
    case 'ins-03':
    case 'installment-due-3d':
    case 'installment-due-in-3-days':
      return renderInstallmentDueIn3DaysEmail(payload, context);

    // INS-04: Installment Due Today
    case 'ins-04':
    case 'installment-due-today':
    case 'installment-due-0d':
      return renderInstallmentDueTodayEmail(payload, context);

    // INS-05: Installment Overdue (T+1)
    case 'ins-05':
    case 'installment-overdue':
    case 'installment-od-1d':
      return renderInstallmentOverdueEmail(payload, context);

    // INS-06: Arrears Escalation and Academic Access Warning (T+7)
    case 'ins-06':
    case 'arrears-warning':
    case 'installment-arrears-7d':
    case 'installment-arrears-escalation':
      return renderArrearsWarningEmail(payload, context);

    // INS-07: Installment Plan Completed
    case 'ins-07':
    case 'installment-plan-completed':
    case 'installment-completed':
      return renderInstallmentPlanCompletedEmail(payload, context);

    // INS-08: Installment Due Date Rescheduled
    case 'ins-08':
    case 'installment-rescheduled':
    case 'installment-due-date-rescheduled':
      return renderInstallmentRescheduledEmail(payload, context);

    // INS-10: Arrears Cleared and Course Access Restored
    case 'ins-10':
    case 'arrears-cleared':
    case 'arrears-restored':
      return renderArrearsClearedEmail(payload, context);

    // ACC-01: Student Welcome Email
    case 'acc-01':
    case 'student-welcome':
    case 'welcome':
      return renderStudentWelcomeEmail(payload, context);

    // ACC-03: New/Untrusted Device Security Alert
    case 'acc-03':
    case 'device-security-alert':
    case 'device-alert':
    case 'untrusted-device-alert':
      return renderNewDeviceAlertEmail(payload, context);

    // ACC-04: Account Deletion Confirmation
    case 'acc-04':
    case 'account-deleted':
    case 'account-deletion-confirmation':
    case 'acct-delete':
      return renderAccountDeletedEmail(payload, context);

    // EXM-01: Official Mock Test Result Published
    case 'exm-01':
    case 'mock-test-result-published':
    case 'exam-result-published':
      return renderMockTestResultPublishedEmail(payload, context);

    // Test email
    case 'test-email':
    case 'test':
      return renderTestEmail(payload, context);

    default: {
      // Generic fallback for templates not explicitly mapped
      const fallbackTitle = (payload.subject as string) || (payload.title as string) || `Notification from Make Me Topper`;
      const fallbackMsg = (payload.message as string) || (payload.body as string) || JSON.stringify(payload, null, 2);
      const recipientName = context.recipientName || 'Student';

      const contentHtml = `
        <h2 style="margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 700;">Hello ${escapeHtml(recipientName)},</h2>
        <p>${escapeHtml(fallbackMsg)}</p>
      `;

      const html = renderBaseLayout({
        title: fallbackTitle,
        preheader: fallbackTitle,
        contentHtml,
        recipientEmail: (payload.recipientEmail as string) || context?.recipientEmail,
      });

      return {
        subject: fallbackTitle,
        html,
        text: htmlToPlainText(html),
      };
    }
  }
}
