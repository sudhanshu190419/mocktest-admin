import { describe, it, expect } from 'vitest';
import {
  convertPaiseToRupeesStrict,
  convertPaiseToRupees,
  InvalidCurrencyValueError,
  determineWebhookResponsePolicy,
} from '../../../../supabase/functions/razorpay-webhook/currency';

describe('Razorpay Strict INR Currency Unit Conversion & Webhook Policy (Revision 34)', () => {
  describe('Valid INR conversions at single ingestion boundary', () => {
    it('converts 50000 paise to ₹500.00 decimal rupees', () => {
      const result = convertPaiseToRupeesStrict(50000);
      expect(result).toBe(500.00);
    });

    it('converts 39000 paise to ₹390.00 decimal rupees', () => {
      const result = convertPaiseToRupeesStrict(39000);
      expect(result).toBe(390.00);
    });

    it('converts 40000 paise to ₹400.00 decimal rupees', () => {
      const result = convertPaiseToRupeesStrict(40000);
      expect(result).toBe(400.00);
    });

    it('executes single conversion boundary (does not produce 50000.00 or 5.00)', () => {
      const minorUnits = 50000;
      const rupees = convertPaiseToRupeesStrict(minorUnits);
      expect(rupees).toBe(500.00);
      expect(rupees).not.toBe(50000);
      expect(rupees).not.toBe(5.00);
    });

    it('converts zero paise to ₹0.00 when allowZero is explicitly enabled (e.g. dispute amount_deducted = 0)', () => {
      const result = convertPaiseToRupeesStrict(0, 'INR', { allowZero: true });
      expect(result).toBe(0.00);
    });
  });

  describe('Strict rejection of zero amounts when allowZero is false (refunds)', () => {
    it('rejects zero minor units by default (refund operation)', () => {
      expect(() => convertPaiseToRupeesStrict(0)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(0)).toThrow('zero is not permitted');
    });

    it('rejects zero minor units when allowZero is explicitly false', () => {
      expect(() => convertPaiseToRupeesStrict(0, 'INR', { allowZero: false })).toThrow(
        InvalidCurrencyValueError
      );
    });
  });

  describe('Strict rejection of malformed numeric values (no silent substitution of zero)', () => {
    it('rejects null input explicitly', () => {
      expect(() => convertPaiseToRupeesStrict(null)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(null)).toThrow('must be a finite number');
    });

    it('rejects undefined input explicitly', () => {
      expect(() => convertPaiseToRupeesStrict(undefined)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(undefined)).toThrow('must be a finite number');
    });

    it('rejects NaN input explicitly', () => {
      expect(() => convertPaiseToRupeesStrict(NaN)).toThrow(InvalidCurrencyValueError);
    });

    it('rejects Infinity and -Infinity explicitly', () => {
      expect(() => convertPaiseToRupeesStrict(Infinity)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(-Infinity)).toThrow(InvalidCurrencyValueError);
    });

    it('rejects non-numeric string and object types explicitly', () => {
      expect(() => convertPaiseToRupeesStrict('50000' as unknown as number)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict({} as unknown as number)).toThrow(InvalidCurrencyValueError);
    });
  });

  describe('Strict rejection of fractional paise and non-safe integers', () => {
    it('rejects fractional paise amounts (e.g. 50000.5 paise)', () => {
      expect(() => convertPaiseToRupeesStrict(50000.5)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(50000.5)).toThrow('must be a safe integer');
    });
  });

  describe('Strict rejection of negative amounts', () => {
    it('rejects negative amounts (-500 paise)', () => {
      expect(() => convertPaiseToRupeesStrict(-500)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(-500)).toThrow('cannot be negative');
    });

    it('rejects negative unit (-1 paise)', () => {
      expect(() => convertPaiseToRupeesStrict(-1)).toThrow(InvalidCurrencyValueError);
    });
  });

  describe('Strict validation of currency code and maximum limits', () => {
    it('rejects non-INR currency codes', () => {
      expect(() => convertPaiseToRupeesStrict(50000, 'USD')).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(50000, 'USD')).toThrow('expected INR, got USD');
    });

    it('rejects amounts exceeding maximum supported limit', () => {
      const overLimit = 100_000_001; // > ₹10,00,000
      expect(() => convertPaiseToRupeesStrict(overLimit)).toThrow(InvalidCurrencyValueError);
      expect(() => convertPaiseToRupeesStrict(overLimit)).toThrow('exceeds maximum supported limit');
    });
  });

  describe('Backward compatibility alias convertPaiseToRupees', () => {
    it('alias adheres to strict validation rules', () => {
      expect(convertPaiseToRupees(50000)).toBe(500.00);
      expect(() => convertPaiseToRupees(null)).toThrow(InvalidCurrencyValueError);
    });
  });

  describe('Webhook Delivery Reliability & Response Policy (Revision 34, Issue 3)', () => {
    it('rejects unauthenticated requests with HTTP 401; Razorpay provider will retry delivery for 24h', () => {
      const policy = determineWebhookResponsePolicy(false, true, true, true);
      expect(policy.category).toBe('UNAUTHENTICATED');
      expect(policy.httpStatus).toBe(401);
      expect(policy.retryable).toBe(false); // local application does not invite retry of unauthenticated requests
      expect(policy.providerWillRetry).toBe(true); // Razorpay retries any non-2xx status code
      expect(policy.quarantineRequired).toBe(false);
      expect(policy.claimFinancialProcessed).toBe(false);
    });

    it('rejects unparseable JSON payload syntax with HTTP 400; Razorpay provider will retry delivery for 24h', () => {
      const policy = determineWebhookResponsePolicy(true, false, true, true);
      expect(policy.category).toBe('MALFORMED_PAYLOAD_SYNTAX');
      expect(policy.httpStatus).toBe(400);
      expect(policy.retryable).toBe(false);
      expect(policy.providerWillRetry).toBe(true); // Razorpay retries all 4xx/5xx responses
      expect(policy.quarantineRequired).toBe(false);
      expect(policy.claimFinancialProcessed).toBe(false);
    });

    it('quarantines authenticated malformed financial data with HTTP 200 without claiming financial effect; provider will NOT retry', () => {
      // Signature valid, JSON valid, financial data invalid (e.g. paise = -100), DB available for quarantine
      const policy = determineWebhookResponsePolicy(true, true, false, true);
      expect(policy.category).toBe('AUTHENTICATED_MALFORMED_FINANCIAL_DATA');
      expect(policy.httpStatus).toBe(200);
      expect(policy.retryable).toBe(false);
      expect(policy.providerWillRetry).toBe(false); // HTTP 200 halts provider delivery retry loop
      expect(policy.quarantineRequired).toBe(true);
      expect(policy.claimFinancialProcessed).toBe(false);
    });

    it('preserves retryable HTTP 500 when durable quarantine recording fails due to database failure; provider will retry', () => {
      // Signature valid, JSON valid, financial data invalid, BUT database unavailable
      const policy = determineWebhookResponsePolicy(true, true, false, false);
      expect(policy.category).toBe('DATABASE_FAILURE');
      expect(policy.httpStatus).toBe(500);
      expect(policy.retryable).toBe(true);
      expect(policy.providerWillRetry).toBe(true); // Provider retries HTTP 500
      expect(policy.quarantineRequired).toBe(true);
      expect(policy.claimFinancialProcessed).toBe(false);
    });

    it('preserves retryable HTTP 500 when database fails during valid event processing; provider will retry', () => {
      // Signature valid, JSON valid, financial data valid, DB fails
      const policy = determineWebhookResponsePolicy(true, true, true, false);
      expect(policy.category).toBe('DATABASE_FAILURE');
      expect(policy.httpStatus).toBe(500);
      expect(policy.retryable).toBe(true);
      expect(policy.providerWillRetry).toBe(true);
      expect(policy.claimFinancialProcessed).toBe(false);
    });

    it('processes and acknowledges valid financial event with HTTP 200; provider will NOT retry', () => {
      const policy = determineWebhookResponsePolicy(true, true, true, true);
      expect(policy.category).toBe('VALID_EVENT');
      expect(policy.httpStatus).toBe(200);
      expect(policy.retryable).toBe(false);
      expect(policy.providerWillRetry).toBe(false);
      expect(policy.quarantineRequired).toBe(false);
      expect(policy.claimFinancialProcessed).toBe(true);
    });
  });
});
