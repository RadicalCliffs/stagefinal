import { describe, it, expect } from 'vitest';
import { toCanonicalUserId, isCanonicalUserId } from '../canonicalUserId';

describe('toCanonicalUserId', () => {
  // ============================================================
  // CRITICAL: Null/undefined handling tests
  // These are the root cause of the missing_competition bug pattern
  // ============================================================

  describe('null/undefined handling - CRITICAL', () => {
    it('should THROW when input is null', () => {
      expect(() => toCanonicalUserId(null)).toThrow('User ID required');
    });

    it('should THROW when input is undefined', () => {
      expect(() => toCanonicalUserId(undefined)).toThrow('User ID required');
    });

    it('should THROW when input is empty string', () => {
      expect(() => toCanonicalUserId('')).toThrow('User ID required');
    });
  });

  // ============================================================
  // Already canonical format tests
  // ============================================================

  describe('already canonical format', () => {
    it('should return unchanged if already in prize:pid: format', () => {
      const input = 'prize:pid:0x123abc';
      expect(toCanonicalUserId(input)).toBe('prize:pid:0x123abc');
    });

    it('should handle prize:pid: with various suffixes', () => {
      expect(toCanonicalUserId('prize:pid:test-user-123')).toBe('prize:pid:test-user-123');
      expect(toCanonicalUserId('prize:pid:did:privy:abc')).toBe('prize:pid:did:privy:abc');
    });
  });

  // ============================================================
  // Wallet address conversion tests
  // ============================================================

  describe('wallet address conversion', () => {
    it('should convert wallet address to lowercase with prefix', () => {
      const input = '0xABCDEF123456789';
      expect(toCanonicalUserId(input)).toBe('prize:pid:0xabcdef123456789');
    });

    it('should handle already lowercase wallet address', () => {
      const input = '0xabcdef123456789';
      expect(toCanonicalUserId(input)).toBe('prize:pid:0xabcdef123456789');
    });

    it('should handle mixed case wallet address', () => {
      const input = '0xAbCdEf123456789';
      expect(toCanonicalUserId(input)).toBe('prize:pid:0xabcdef123456789');
    });

    it('should handle full Ethereum address', () => {
      const input = '0x0ff51Ec0ecC9ae1e5e6048976Ba307C849781363';
      expect(toCanonicalUserId(input)).toBe('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363');
    });
  });

  // ============================================================
  // Privy DID conversion tests
  // ============================================================

  describe('Privy DID conversion', () => {
    it('should convert Privy DID to canonical format', () => {
      const input = 'did:privy:abc123xyz';
      expect(toCanonicalUserId(input)).toBe('prize:pid:abc123xyz');
    });

    it('should strip did:privy: prefix and add prize:pid:', () => {
      const input = 'did:privy:user-identifier-456';
      expect(toCanonicalUserId(input)).toBe('prize:pid:user-identifier-456');
    });
  });

  // ============================================================
  // Generic identifier conversion tests
  // ============================================================

  describe('generic identifier conversion', () => {
    it('should wrap unknown identifier with prize:pid: prefix', () => {
      const input = 'some-random-user-id';
      expect(toCanonicalUserId(input)).toBe('prize:pid:some-random-user-id');
    });

    it('should handle email-like identifiers', () => {
      const input = 'user@example.com';
      expect(toCanonicalUserId(input)).toBe('prize:pid:user@example.com');
    });

    it('should handle numeric string identifiers', () => {
      const input = '123456789';
      expect(toCanonicalUserId(input)).toBe('prize:pid:123456789');
    });
  });
});

describe('isCanonicalUserId', () => {
  it('should return true for valid canonical format', () => {
    expect(isCanonicalUserId('prize:pid:0x123')).toBe(true);
    expect(isCanonicalUserId('prize:pid:test')).toBe(true);
    expect(isCanonicalUserId('prize:pid:did:privy:abc')).toBe(true);
  });

  it('should return false for non-canonical formats', () => {
    expect(isCanonicalUserId('0x123')).toBe(false);
    expect(isCanonicalUserId('did:privy:abc')).toBe(false);
    expect(isCanonicalUserId('test-user')).toBe(false);
    expect(isCanonicalUserId('')).toBe(false);
  });
});
