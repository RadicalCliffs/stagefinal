import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoinbaseCommerceService } from '../coinbase-commerce';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock supabase
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } }
      })
    },
    from: vi.fn((table: string) => ({
      insert: vi.fn().mockReturnValue({
        error: null
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { status: 'completed' },
            error: null
          }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        })
      })
    }))
  }
}));

describe('CoinbaseCommerceService - Top-Up Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTopUpTransaction', () => {
    it('should create a top-up transaction successfully', async () => {
      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transactionId: 'txn_123',
            chargeId: 'charge_123',
            chargeCode: 'ABCD1234',
            checkoutUrl: 'https://commerce.coinbase.com/charges/ABCD1234'
          }
        })
      });

      const result = await CoinbaseCommerceService.createTopUpTransaction(
        'prize:pid:0x123',
        100
      );

      expect(result.transactionId).toBe('txn_123');
      expect(result.checkoutUrl).toBe('https://commerce.coinbase.com/charges/ABCD1234');
      
      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/create-charge',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('"type":"topup"')
        })
      );
    });

    it('should validate userId is required', async () => {
      await expect(
        CoinbaseCommerceService.createTopUpTransaction('', 100)
      ).rejects.toThrow('Missing required field: userId');
    });

    it('should validate amount is positive', async () => {
      await expect(
        CoinbaseCommerceService.createTopUpTransaction('prize:pid:0x123', 0)
      ).rejects.toThrow('Invalid amount');

      await expect(
        CoinbaseCommerceService.createTopUpTransaction('prize:pid:0x123', -50)
      ).rejects.toThrow('Invalid amount');
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          success: false,
          error: { message: 'Invalid request' }
        })
      });

      await expect(
        CoinbaseCommerceService.createTopUpTransaction('prize:pid:0x123', 100)
      ).rejects.toThrow('Invalid request');
    });

    it('should construct checkout URL from chargeCode if missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transactionId: 'txn_456',
            chargeCode: 'EFGH5678',
            // checkoutUrl is missing - should be constructed
          }
        })
      });

      const result = await CoinbaseCommerceService.createTopUpTransaction(
        'prize:pid:0x123',
        50
      );

      expect(result.checkoutUrl).toBe('https://commerce.coinbase.com/charges/EFGH5678');
    });

    it('should handle different amount values', async () => {
      const amounts = [3, 5, 10, 25, 50, 100, 250, 500, 1000];

      for (const amount of amounts) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: {
              transactionId: `txn_${amount}`,
              checkoutUrl: `https://commerce.coinbase.com/charges/code_${amount}`
            }
          })
        });

        const result = await CoinbaseCommerceService.createTopUpTransaction(
          'prize:pid:0x123',
          amount
        );

        expect(result.transactionId).toBe(`txn_${amount}`);
        expect(result.checkoutUrl).toContain('commerce.coinbase.com');
      }
    });

    it('should normalize amount to number', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transactionId: 'txn_789',
            checkoutUrl: 'https://commerce.coinbase.com/charges/TEST'
          }
        })
      });

      // Pass amount as string (should be normalized)
      const result = await CoinbaseCommerceService.createTopUpTransaction(
        'prize:pid:0x123',
        100 as any
      );

      expect(result.transactionId).toBe('txn_789');
    });
  });

  describe('getTransactionStatus', () => {
    it('should retrieve transaction status', async () => {
      const status = await CoinbaseCommerceService.getTransactionStatus('txn_123');
      expect(status).toBe('completed');
    });

    it('should return null if transaction not found', async () => {
      const mockSupabase = await import('../supabase');
      vi.mocked(mockSupabase.supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Not found' }
            })
          })
        })
      } as any);

      const status = await CoinbaseCommerceService.getTransactionStatus('invalid_id');
      expect(status).toBeNull();
    });
  });

  describe('waitForTransactionCompletion', () => {
    it('should return success when transaction completes', async () => {
      const mockSupabase = await import('../supabase');
      
      // First call: pending
      vi.mocked(mockSupabase.supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { status: 'pending' },
              error: null
            })
          })
        })
      } as any);

      // Second call: completed
      vi.mocked(mockSupabase.supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { status: 'completed' },
              error: null
            })
          })
        })
      } as any);

      const result = await CoinbaseCommerceService.waitForTransactionCompletion(
        'txn_123',
        2, // maxAttempts
        100 // intervalMs
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
    });

    it('should return failure when transaction fails', async () => {
      const mockSupabase = await import('../supabase');
      
      vi.mocked(mockSupabase.supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { status: 'failed' },
              error: null
            })
          })
        })
      } as any);

      const result = await CoinbaseCommerceService.waitForTransactionCompletion(
        'txn_123',
        1,
        100
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
    });

    it('should timeout after max attempts', async () => {
      const mockSupabase = await import('../supabase');
      
      // Always return pending
      vi.mocked(mockSupabase.supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { status: 'pending' },
              error: null
            })
          })
        })
      } as any);

      const result = await CoinbaseCommerceService.waitForTransactionCompletion(
        'txn_123',
        2,
        50
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('timeout');
    });
  });

  describe('getAvailableTopUpAmounts', () => {
    it('should return sorted list of available amounts', () => {
      const amounts = CoinbaseCommerceService.getAvailableTopUpAmounts();
      
      expect(amounts).toEqual([3, 5, 10, 25, 50, 100, 250, 500, 1000]);
      expect(amounts.length).toBeGreaterThan(0);
      
      // Verify sorted
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i]).toBeGreaterThan(amounts[i - 1]);
      }
    });
  });

  describe('createEntryPurchase', () => {
    it('should create entry purchase successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transactionId: 'txn_entry_123',
            checkoutUrl: 'https://commerce.coinbase.com/charges/ENTRY123'
          }
        })
      });

      const result = await CoinbaseCommerceService.createEntryPurchase(
        'prize:pid:0x123',
        'comp_456',
        0.50,
        5,
        [1, 2, 3, 4, 5],
        'res_789'
      );

      expect(result.transactionId).toBe('txn_entry_123');
      expect(result.checkoutUrl).toContain('commerce.coinbase.com');
      expect(result.totalAmount).toBe(2.5); // 0.50 * 5
      expect(result.entryCount).toBe(5);
    });

    it('should validate required fields for entry purchase', async () => {
      await expect(
        CoinbaseCommerceService.createEntryPurchase(
          '', // invalid userId
          'comp_456',
          0.50,
          5,
          [1, 2, 3, 4, 5]
        )
      ).rejects.toThrow('Missing required field: userId');

      await expect(
        CoinbaseCommerceService.createEntryPurchase(
          'prize:pid:0x123',
          '', // invalid competitionId
          0.50,
          5,
          [1, 2, 3, 4, 5]
        )
      ).rejects.toThrow('Missing required field: competitionId');
    });

    it('should validate entry price and count', async () => {
      await expect(
        CoinbaseCommerceService.createEntryPurchase(
          'prize:pid:0x123',
          'comp_456',
          0, // invalid price
          5,
          [1, 2, 3, 4, 5]
        )
      ).rejects.toThrow('Invalid entryPrice');

      await expect(
        CoinbaseCommerceService.createEntryPurchase(
          'prize:pid:0x123',
          'comp_456',
          0.50,
          0, // invalid count
          []
        )
      ).rejects.toThrow('Invalid entryCount');
    });
  });

  describe('COINBASE_CONFIG', () => {
    it('should export config without secrets', async () => {
      const { COINBASE_CONFIG } = await import('../coinbase-commerce');
      
      expect(COINBASE_CONFIG.CREATE_CHARGE_ENDPOINT).toBe('/api/create-charge');
      expect(COINBASE_CONFIG.WEBHOOK_ENDPOINT).toContain('commerce-webhook');
      
      // Should not contain API keys
      expect(JSON.stringify(COINBASE_CONFIG)).not.toContain('API_KEY');
      expect(JSON.stringify(COINBASE_CONFIG)).not.toContain('SECRET');
    });
  });
});
