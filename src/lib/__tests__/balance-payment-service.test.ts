import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BalancePaymentService, type RPCPurchaseRequest } from '../balance-payment-service';
import { toCanonicalUserId } from '../canonicalUserId';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock crypto.randomUUID
const mockUUID = '550e8400-e29b-41d4-a716-446655440000';
vi.stubGlobal('crypto', {
  randomUUID: () => mockUUID,
});

// Mock supabase
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-access-token-123' } }
      })
    },
    rpc: vi.fn().mockResolvedValue({
      data: {
        success: true,
        entry_id: 'entry-123',
        competition_id: 'test-competition-id',
        ticket_numbers: [1, 2, 3],
        total_cost: 3,
        available_balance: 97,
      },
      error: null,
    }),
  }
}));

// Mock idempotency key manager
vi.mock('../idempotency-keys', () => ({
  idempotencyKeyManager: {
    getOrCreateKey: vi.fn().mockReturnValue('test-idempotency-key-123'),
    markTerminal: vi.fn(),
    clearKey: vi.fn(),
  }
}));

// Mock import.meta.env
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

describe('BalancePaymentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('purchaseWithBalance', () => {
    // ============================================================
    // CRITICAL: competitionId validation tests
    // These tests ensure the "missing_competition" error never happens again
    // ============================================================
    
    describe('competitionId validation - CRITICAL', () => {
      it('should REJECT when competitionId is undefined', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: undefined as any,
          ticketNumbers: [1, 2, 3],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Competition ID is required');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should REJECT when competitionId is null', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: null as any,
          ticketNumbers: [1, 2, 3],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Competition ID is required');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should REJECT when competitionId is empty string', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: '',
          ticketNumbers: [1, 2, 3],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Competition ID is required');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should ACCEPT valid UUID competitionId', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'ok',
            entry_id: 'entry-123',
            competition_id: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
            tickets: [{ ticket_number: 1 }, { ticket_number: 2 }, { ticket_number: 3 }],
            total_cost: 3,
            new_balance: 97,
          }),
        });

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2, 3],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    // ============================================================
    // ticketNumbers validation tests
    // ============================================================
    
    describe('ticketNumbers validation', () => {
      it('should REJECT when ticketNumbers is undefined', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: undefined as any,
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Ticket numbers are required');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should REJECT when ticketNumbers is null', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: null as any,
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Ticket numbers are required');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should REJECT when ticketNumbers is empty array', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Ticket numbers are required');
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    // ============================================================
    // userId validation tests
    // ============================================================
    
    describe('userId validation', () => {
      it('should REJECT when userId is undefined', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2, 3],
          userId: undefined as any,
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('User ID is required');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should REJECT when userId is null', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2, 3],
          userId: null as any,
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('User ID is required');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should REJECT when userId is empty string', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2, 3],
          userId: '',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('User ID is required');
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    // ============================================================
    // ticketPrice validation tests
    // ============================================================
    
    describe('ticketPrice validation', () => {
      it('should REJECT when ticketPrice is below 0.10', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2, 3],
          userId: '0x123abc',
          ticketPrice: 0.05,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Ticket price must be between $0.10 and $100');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should REJECT when ticketPrice is above 100', async () => {
        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2, 3],
          userId: '0x123abc',
          ticketPrice: 101,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Ticket price must be between $0.10 and $100');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should ACCEPT valid ticketPrice of 0.25', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'ok',
            entry_id: 'entry-123',
            competition_id: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
            tickets: [{ ticket_number: 1 }],
            total_cost: 0.25,
            new_balance: 99.75,
          }),
        });

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1],
          userId: '0x123abc',
          ticketPrice: 0.25,
        });

        expect(result.success).toBe(true);
      });
    });

    // ============================================================
    // Request body construction tests
    // ============================================================
    
    describe('request body construction', () => {
      it('should construct correct RPCPurchaseRequest payload', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'ok',
            entry_id: 'entry-123',
            competition_id: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
            tickets: [{ ticket_number: 1 }, { ticket_number: 2 }],
            total_cost: 2,
            new_balance: 98,
          }),
        });

        await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/functions/v1/purchase-with-balance'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
              'Authorization': expect.stringContaining('Bearer'),
            }),
          })
        );

        // Parse the body to verify structure
        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body) as RPCPurchaseRequest;

        expect(body.p_user_identifier).toBe('prize:pid:0x123abc');
        expect(body.p_competition_id).toBe('e2e04124-5ea9-4fb2-951a-26e6d0991615');
        expect(body.p_ticket_price).toBe(1);
        expect(body.p_ticket_count).toBe(2);
        expect(body.p_ticket_numbers).toEqual([1, 2]);
        expect(body.p_idempotency_key).toBeDefined();
      });

      it('should convert wallet address to canonical user ID', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'ok',
            entry_id: 'entry-123',
            competition_id: 'test-comp',
            tickets: [{ ticket_number: 1 }],
            total_cost: 1,
            new_balance: 99,
          }),
        });

        await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1],
          userId: '0xABCDEF123456789',
          ticketPrice: 1,
        });

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);

        // Should be lowercase and prefixed
        expect(body.p_user_identifier).toBe('prize:pid:0xabcdef123456789');
      });
    });

    // ============================================================
    // Error handling tests
    // ============================================================
    
    describe('error handling', () => {
      it('should handle HTTP 400 insufficient balance error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 402,
          json: async () => ({
            error: {
              code: 'INSUFFICIENT_BALANCE',
              message: 'Insufficient balance',
            },
          }),
        });

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1, 2, 3],
          userId: '0x123abc',
          ticketPrice: 100,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('balance');
      });

      it('should handle HTTP 404 no balance record error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 'NO_BALANCE_RECORD',
              message: 'No balance record found',
            },
          }),
        });

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(false);
      });

      it('should handle network errors gracefully', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        // Should fail after retries
        expect(result.success).toBe(false);
      });

      it('should handle invalid JSON responses', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => { throw new Error('Invalid JSON'); },
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => { throw new Error('Invalid JSON'); },
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => { throw new Error('Invalid JSON'); },
        });

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        // Proxy fails but RPC fallback might succeed
        // The key is that it doesn't crash
        expect(result).toBeDefined();
      });
    });

    // ============================================================
    // Success response handling tests
    // ============================================================
    
    describe('success response handling', () => {
      it('should parse success response correctly', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'ok',
            entry_id: 'entry-uuid-123',
            competition_id: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
            tickets: [
              { ticket_number: 100 },
              { ticket_number: 101 },
              { ticket_number: 102 },
            ],
            total_cost: 0.75,
            new_balance: 99.25,
            idempotent: false,
          }),
        });

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [100, 101, 102],
          userId: '0x123abc',
          ticketPrice: 0.25,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.payment_id).toBe('entry-uuid-123');
        expect(result.data?.tickets).toHaveLength(3);
        expect(result.data?.tickets[0].ticket_number).toBe(100);
      });

      it('should handle idempotent response (duplicate request)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'ok',
            entry_id: 'entry-uuid-123',
            competition_id: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
            tickets: [{ ticket_number: 1 }],
            total_cost: 1,
            new_balance: 99,
            idempotent: true, // This was a duplicate request
          }),
        });

        const result = await BalancePaymentService.purchaseWithBalance({
          competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
          ticketNumbers: [1],
          userId: '0x123abc',
          ticketPrice: 1,
        });

        expect(result.success).toBe(true);
      });
    });
  });
});
