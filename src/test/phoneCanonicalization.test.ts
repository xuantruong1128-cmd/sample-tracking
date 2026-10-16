import { describe, it, expect } from 'vitest';
import { canonicalizeVietnamesePhone } from '../features/auth/authUtils';

describe('Vietnamese Phone Canonicalization Policy (F-06 Remediation)', () => {
  describe('Valid Phone Canonicalization & Equivalence', () => {
    it('canonicalizes local format 0912345678 to +84912345678 and deterministic alias', () => {
      const res = canonicalizeVietnamesePhone('0912345678');
      expect(res.isValid).toBe(true);
      expect(res.canonicalPhone).toBe('+84912345678');
      expect(res.localPhone).toBe('0912345678');
      expect(res.aliasEmail).toBe('84912345678@sampletracking.local');
    });

    it('canonicalizes international format +84912345678 to the exact same canonical identity', () => {
      const res = canonicalizeVietnamesePhone('+84912345678');
      expect(res.isValid).toBe(true);
      expect(res.canonicalPhone).toBe('+84912345678');
      expect(res.localPhone).toBe('0912345678');
      expect(res.aliasEmail).toBe('84912345678@sampletracking.local');
    });

    it('canonicalizes 84912345678 without plus sign identically', () => {
      const res = canonicalizeVietnamesePhone('84912345678');
      expect(res.isValid).toBe(true);
      expect(res.canonicalPhone).toBe('+84912345678');
      expect(res.aliasEmail).toBe('84912345678@sampletracking.local');
    });

    it('handles spaces, dashes, dots and parentheses consistently (collision prevention)', () => {
      const variants = [
        '0912 345 678',
        '0912-345-678',
        '(0912) 345.678',
        '+84 912 345 678',
        '+84-912-345-678',
      ];

      variants.forEach((v) => {
        const res = canonicalizeVietnamesePhone(v);
        expect(res.isValid).toBe(true);
        expect(res.canonicalPhone).toBe('+84912345678');
        expect(res.aliasEmail).toBe('84912345678@sampletracking.local');
      });
    });

    it('supports major Vietnamese mobile operator prefixes', () => {
      const prefixes = [
        '0381234567', // Viettel 038
        '0701234567', // Mobifone 070
        '0831234567', // Vinaphone 083
        '0561234567', // Vietnamobile 056
        '0991234567', // Gmobile 099
        '0871234567', // Wintel 087
      ];

      prefixes.forEach((phone) => {
        const res = canonicalizeVietnamesePhone(phone);
        expect(res.isValid).toBe(true);
        expect(res.canonicalPhone).toBe(`+84${phone.substring(1)}`);
      });
    });
  });

  describe('Rejection of Malformed & Invalid Numbers', () => {
    it('rejects empty or whitespace input', () => {
      expect(canonicalizeVietnamesePhone('').isValid).toBe(false);
      expect(canonicalizeVietnamesePhone('   ').isValid).toBe(false);
    });

    it('rejects input containing alphabetic or special characters', () => {
      const res = canonicalizeVietnamesePhone('09123abcde');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('chỉ được chứa các chữ số');
    });

    it('rejects numbers that are too short', () => {
      const res = canonicalizeVietnamesePhone('09123456');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('phải có đúng 10 chữ số');
    });

    it('rejects numbers that are too long', () => {
      const res = canonicalizeVietnamesePhone('091234567899');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('phải có đúng 10 chữ số');
    });

    it('rejects invalid Vietnamese prefixes like 00, 01, 02, 04', () => {
      const invalidPrefixes = ['0012345678', '0112345678', '0212345678', '0412345678'];
      invalidPrefixes.forEach((p) => {
        const res = canonicalizeVietnamesePhone(p);
        expect(res.isValid).toBe(false);
        expect(res.error).toContain('không phải là đầu số di động hợp lệ');
      });
    });
  });
});
