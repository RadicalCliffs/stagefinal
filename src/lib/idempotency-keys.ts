/**
 * Idempotency Key Manager
 * 
 * Manages client-side idempotency keys for payment operations.
 * Ensures that retries use the same key until a terminal outcome is received.
 */


interface IdempotencyRecord {
  key: string;
  reservationId: string;
  createdAt: number;
  terminal: boolean;
}

const STORAGE_KEY = 'theprize:idempotency_keys';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class IdempotencyKeyManager {
  private storageAvailable: boolean;
  private memoryCache: Map<string, IdempotencyRecord> = new Map();

  constructor() {
    this.storageAvailable = this.checkStorageAvailable();
  }

  private checkStorageAvailable(): boolean {
    try {
      const test = '__storage_test__';
      sessionStorage.setItem(test, test);
      sessionStorage.removeItem(test);
      return true;
    } catch {
      console.warn('[IdempotencyKeyManager] sessionStorage is not available');
      return false;
    }
  }

  /**
   * Get or create an idempotency key for a reservation
   */
  getOrCreateKey(reservationId: string): string {
    // First check memory cache
    const cached = this.memoryCache.get(reservationId);
    if (cached && !cached.terminal) {
      return cached.key;
    }

    if (this.storageAvailable) {
      const stored = this.getFromStorage(reservationId);
      if (stored && !stored.terminal) {
        this.memoryCache.set(reservationId, stored);
        return stored.key;
      }
    }

    // Create new key - use UUID format to ensure compatibility with database
    // columns and triggers that may cast values to UUID type
    const key = crypto.randomUUID();
    const record: IdempotencyRecord = {
      key,
      reservationId,
      createdAt: Date.now(),
      terminal: false,
    };

    this.memoryCache.set(reservationId, record);
    if (this.storageAvailable) {
      this.saveToStorage(reservationId, record);
    }

    console.log('[IdempotencyKeyManager] Created new key for reservation:', reservationId);
    return key;
  }

  /**
   * Mark a key as terminal (success or permanent failure)
   */
  markTerminal(reservationId: string): void {
    const record = this.memoryCache.get(reservationId);
    if (record) {
      record.terminal = true;
      this.memoryCache.set(reservationId, record);
      if (this.storageAvailable) {
        this.saveToStorage(reservationId, record);
      }
    }
  }

  /**
   * Clear a key (after successful completion)
   */
  clearKey(reservationId: string): void {
    this.memoryCache.delete(reservationId);
    if (this.storageAvailable) {
      this.removeFromStorage(reservationId);
    }
  }

  /**
   * Clean up expired keys
   */
  cleanup(): void {
    const now = Date.now();
    
    // Clean memory cache
    for (const [reservationId, record] of this.memoryCache.entries()) {
      if (now - record.createdAt > TTL_MS) {
        this.memoryCache.delete(reservationId);
      }
    }

    // Clean storage
    if (this.storageAvailable) {
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
          const records: Record<string, IdempotencyRecord> = JSON.parse(stored);
          const filtered: Record<string, IdempotencyRecord> = {};
          
          for (const [key, record] of Object.entries(records)) {
            if (now - record.createdAt <= TTL_MS) {
              filtered[key] = record;
            }
          }
          
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        }
      } catch (err) {
        console.error('[IdempotencyKeyManager] Failed to cleanup storage:', err);
      }
    }
  }

  private getFromStorage(reservationId: string): IdempotencyRecord | null {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return null;

      const records: Record<string, IdempotencyRecord> = JSON.parse(stored);
      return records[reservationId] || null;
    } catch (err) {
      console.error('[IdempotencyKeyManager] Failed to get from storage:', err);
      return null;
    }
  }

  private saveToStorage(reservationId: string, record: IdempotencyRecord): void {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      const records: Record<string, IdempotencyRecord> = stored ? JSON.parse(stored) : {};
      records[reservationId] = record;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (err) {
      console.error('[IdempotencyKeyManager] Failed to save to storage:', err);
    }
  }

  private removeFromStorage(reservationId: string): void {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const records: Record<string, IdempotencyRecord> = JSON.parse(stored);
        delete records[reservationId];
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      }
    } catch (err) {
      console.error('[IdempotencyKeyManager] Failed to remove from storage:', err);
    }
  }
}

// Export singleton instance
export const idempotencyKeyManager = new IdempotencyKeyManager();

// Run cleanup on initialization and periodically (client-side only)
if (typeof window !== 'undefined') {
  idempotencyKeyManager.cleanup();
  
  setInterval(() => {
    idempotencyKeyManager.cleanup();
  }, 60 * 60 * 1000); // Every hour
}
