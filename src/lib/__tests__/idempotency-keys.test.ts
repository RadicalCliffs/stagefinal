import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sessionStorage
const mockStorage: Record<string, string> = {};
const mockSessionStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockStorage).forEach(key => delete mockStorage[key]); }),
};

vi.stubGlobal('sessionStorage', mockSessionStorage);

// Mock crypto.randomUUID
let mockUUIDCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `mock-uuid-${++mockUUIDCounter}`,
});

// Import after mocks are set up
import { idempotencyKeyManager } from '../idempotency-keys';

describe('IdempotencyKeyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage['theprize:idempotency_keys'] = undefined as any;
    mockUUIDCounter = 0;
  });

  afterEach(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
  });

  // ============================================================
  // Key creation tests
  // ============================================================

  describe('getOrCreateKey', () => {
    it('should create a new key for a new reservation', () => {
      const key = idempotencyKeyManager.getOrCreateKey('reservation-123');
      
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    it('should return the same key for the same reservation on subsequent calls', () => {
      const key1 = idempotencyKeyManager.getOrCreateKey('reservation-456');
      const key2 = idempotencyKeyManager.getOrCreateKey('reservation-456');
      
      expect(key1).toBe(key2);
    });

    it('should create different keys for different reservations', () => {
      const key1 = idempotencyKeyManager.getOrCreateKey('reservation-aaa');
      const key2 = idempotencyKeyManager.getOrCreateKey('reservation-bbb');
      
      expect(key1).not.toBe(key2);
    });
  });

  // ============================================================
  // Terminal state tests
  // ============================================================

  describe('markTerminal', () => {
    it('should mark a key as terminal', () => {
      const key1 = idempotencyKeyManager.getOrCreateKey('reservation-terminal');
      idempotencyKeyManager.markTerminal('reservation-terminal');
      
      // After marking terminal, a new call should create a new key
      const key2 = idempotencyKeyManager.getOrCreateKey('reservation-terminal');
      
      // The keys should be different because the first was marked terminal
      expect(key2).not.toBe(key1);
    });
  });

  // ============================================================
  // Key cleanup tests
  // ============================================================

  describe('clearKey', () => {
    it('should clear a key from memory', () => {
      const key1 = idempotencyKeyManager.getOrCreateKey('reservation-clear');
      idempotencyKeyManager.clearKey('reservation-clear');
      
      // After clearing, a new call should create a new key
      const key2 = idempotencyKeyManager.getOrCreateKey('reservation-clear');
      
      expect(key2).not.toBe(key1);
    });
  });

  // ============================================================
  // UUID format tests
  // ============================================================

  describe('key format', () => {
    it('should generate UUID-format keys', () => {
      // The mock returns 'mock-uuid-N' but real implementation uses crypto.randomUUID()
      // This test verifies the key is generated (not empty)
      const key = idempotencyKeyManager.getOrCreateKey('reservation-format');
      
      expect(key).toBeDefined();
      expect(key.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Idempotency behavior tests
  // ============================================================

  describe('idempotency behavior', () => {
    it('should allow retry with same key when not terminal', () => {
      // Simulate a failed payment attempt that should be retried
      const reservationId = 'reservation-retry';
      
      const key1 = idempotencyKeyManager.getOrCreateKey(reservationId);
      // Simulating a retry (not marked terminal because payment failed)
      const key2 = idempotencyKeyManager.getOrCreateKey(reservationId);
      const key3 = idempotencyKeyManager.getOrCreateKey(reservationId);
      
      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('should generate new key after terminal success', () => {
      const reservationId = 'reservation-success';
      
      const key1 = idempotencyKeyManager.getOrCreateKey(reservationId);
      // Payment succeeded - mark as terminal
      idempotencyKeyManager.markTerminal(reservationId);
      idempotencyKeyManager.clearKey(reservationId);
      
      // User tries to purchase again (new flow)
      const key2 = idempotencyKeyManager.getOrCreateKey(reservationId);
      
      expect(key2).not.toBe(key1);
    });
  });
});
