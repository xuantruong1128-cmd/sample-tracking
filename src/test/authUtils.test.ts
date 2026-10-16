import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  phoneToAliasEmail,
  isValidPhone,
  translateAuthError,
} from '../features/auth/authUtils';

describe('Authentication Utilities & Phone Normalization', () => {
  it('normalizePhone: cleans spaces, dashes, dots and parentheses to local 10-digit format', () => {
    expect(normalizePhone('0912 345 678')).toBe('0912345678');
    expect(normalizePhone('0912-345-678')).toBe('0912345678');
    expect(normalizePhone('(091) 234.5678')).toBe('0912345678');
    expect(normalizePhone('+84 912 345 678')).toBe('0912345678');
  });

  it('isValidPhone: validates standard Vietnamese telephone digits count', () => {
    expect(isValidPhone('0912345678')).toBe(true);
    expect(isValidPhone('+84912345678')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('abcdefghijk')).toBe(false);
  });

  it('phoneToAliasEmail: deterministically transforms phone to internal canonical alias (F-06)', () => {
    // Both 0912345678 and +84912345678 map to the exact same canonical internal alias
    expect(phoneToAliasEmail('0912345678')).toBe('84912345678@sampletracking.local');
    expect(phoneToAliasEmail('+84912345678')).toBe('84912345678@sampletracking.local');
  });

  it('translateAuthError: maps Supabase errors to safe Vietnamese UI messages without enumeration', () => {
    expect(translateAuthError({ message: 'Invalid login credentials' })).toContain(
      'Số điện thoại hoặc mật khẩu không chính xác'
    );
    expect(translateAuthError({ message: 'User is disabled' })).toContain(
      'Tài khoản của bạn đã bị vô hiệu hóa'
    );
    expect(translateAuthError({ message: 'rate limit reached' })).toContain(
      'quá nhiều lần'
    );
  });
});
