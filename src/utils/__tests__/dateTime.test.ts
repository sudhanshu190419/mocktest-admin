import { describe, it, expect } from 'vitest';
import { toUtcIsoString, toLocalDatetime } from '../dateTime';

describe('dateTime utilities', () => {
  describe('toUtcIsoString', () => {
    it('returns null for null, undefined, or empty string', () => {
      expect(toUtcIsoString(null)).toBeNull();
      expect(toUtcIsoString(undefined)).toBeNull();
      expect(toUtcIsoString('')).toBeNull();
      expect(toUtcIsoString('   ')).toBeNull();
    });

    it('returns null for invalid date strings', () => {
      expect(toUtcIsoString('not-a-date')).toBeNull();
      expect(toUtcIsoString('2026-99-99T99:99')).toBeNull();
    });

    it('converts a local datetime-local string to UTC ISO-8601 string', () => {
      const input = '2026-08-21T23:06';
      const result = toUtcIsoString(input);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify the parsed epoch timestamp equals the local date's timestamp
      const expectedTime = new Date('2026-08-21T23:06').getTime();
      expect(new Date(result!).getTime()).toBe(expectedTime);
    });

    it('handles ISO strings without modifying the epoch moment', () => {
      const iso = '2026-08-21T17:36:00.000Z';
      const result = toUtcIsoString(iso);
      expect(result).toBe(iso);
    });
  });

  describe('toLocalDatetime', () => {
    it('returns empty string for null, undefined, or empty string', () => {
      expect(toLocalDatetime(null)).toBe('');
      expect(toLocalDatetime(undefined)).toBe('');
      expect(toLocalDatetime('')).toBe('');
      expect(toLocalDatetime('   ')).toBe('');
    });

    it('returns empty string for invalid date strings', () => {
      expect(toLocalDatetime('not-a-date')).toBe('');
    });

    it('converts a UTC ISO string to local YYYY-MM-DDTHH:mm format', () => {
      const iso = '2026-08-21T17:36:00.000Z';
      const localStr = toLocalDatetime(iso);

      expect(localStr).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

      // Parse back in local timezone and check epoch equality
      const expectedLocal = new Date(iso);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const expectedStr = `${expectedLocal.getFullYear()}-${pad(expectedLocal.getMonth() + 1)}-${pad(expectedLocal.getDate())}T${pad(expectedLocal.getHours())}:${pad(expectedLocal.getMinutes())}`;
      expect(localStr).toBe(expectedStr);
    });
  });

  describe('round-trip consistency (Database UTC <-> Local UI)', () => {
    it('preserves the exact UTC moment through local format and back', () => {
      // Given a stored UTC timestamp
      const storedUtc = '2026-08-21T17:36:00.000Z';

      // When loaded into the edit form
      const formInput = toLocalDatetime(storedUtc);

      // And saved back without user modification
      const savedUtc = toUtcIsoString(formInput);

      // Then the timestamp remains unchanged (no 5h30m drift)
      expect(savedUtc).toBe(storedUtc);
    });
  });
});
