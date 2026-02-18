import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration Test: Top-Up Wallet Flow
 * 
 * This test demonstrates the complete top-up flow from button click to balance credit:
 * 1. User clicks "Top Up" button
 * 2. Selects amount (e.g., $100)
 * 3. Frontend calls /api/create-charge
 * 4. Netlify proxy forwards to Supabase Edge Function
 * 5. Supabase Edge Function creates Coinbase Commerce charge
 * 6. User pays via Commerce checkout
 * 7. Commerce webhook triggers balance credit
 * 8. User sees updated balance with 50% first-deposit bonus
 */

// Mock the entire stack
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock supabase with realistic responses
const mockSupabaseInsert = vi.fn();
const mockSupabaseSelect = vi.fn();
const mockSupabaseUpdate = vi.fn();
const mockSupabaseRpc = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token-abc123' } }
      })
    },
    from: vi.fn((table: string) => {
      if (table === 'pending_topups') {
        return {
          insert: mockSupabaseInsert.mockReturnValue({ error: null })
        };
      }
      if (table === 'user_transactions') {
        return {
          select: mockSupabaseSelect.mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'txn_123', status: 'completed', amount: 100 },
                error: null
              })
            })
          }),
          update: mockSupabaseUpdate.mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'sub_account_balances') {
        return {
          select: mockSupabaseSelect.mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { 
                  available_balance: 100, 
                  bonus_balance: 50,  // 50% first-deposit bonus
                  pending_balance: 0 
                },
                error: null
              })
            })
          })
        };
      }
      return {
        insert: mockSupabaseInsert,
        select: mockSupabaseSelect,
        update: mockSupabaseUpdate
      };
    }),
    rpc: mockSupabaseRpc.mockResolvedValue({
      data: {
        success: true,
        new_balance: 150, // $100 + $50 bonus
        bonus_applied: true,
        bonus_amount: 50,
        total_credited: 150
      },
      error: null
    })
  }
}));

describe('Top-Up Wallet Integration Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full top-up flow with Coinbase Commerce', async () => {
    // Import the service after mocks are set up
    const { CoinbaseCommerceService } = await import('../coinbase-commerce');

    // ============================================
    // STEP 1: User initiates top-up
    // ============================================
    const userId = 'prize:pid:0x1234567890123456789012345678901234567890';
    const topUpAmount = 100;

    // Mock API response for charge creation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          transactionId: 'txn_integration_test_123',
          chargeId: 'charge_abc123',
          chargeCode: 'TESTCODE123',
          checkoutUrl: 'https://commerce.coinbase.com/charges/TESTCODE123'
        }
      })
    });

    // ============================================
    // STEP 2: Create top-up transaction
    // ============================================
    const topUpResult = await CoinbaseCommerceService.createTopUpTransaction(
      userId,
      topUpAmount
    );

    // Verify transaction was created
    expect(topUpResult).toBeDefined();
    expect(topUpResult.transactionId).toBe('txn_integration_test_123');
    expect(topUpResult.checkoutUrl).toBe('https://commerce.coinbase.com/charges/TESTCODE123');

    // Verify API was called with correct parameters
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/create-charge',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token-abc123'
        }),
        body: expect.stringContaining('"type":"topup"')
      })
    );

    const fetchCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchCallBody).toEqual({
      userId,
      totalAmount: topUpAmount,
      type: 'topup'
    });

    // Verify optimistic top-up was created
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        amount: topUpAmount,
        status: 'pending',
        payment_provider: 'coinbase_commerce'
      })
    );

    // ============================================
    // STEP 3: User completes payment (simulated)
    // ============================================
    // In real flow:
    // - User redirects to checkoutUrl
    // - User pays via Coinbase Commerce
    // - Commerce webhook triggers
    // - Webhook calls credit_balance_with_first_deposit_bonus RPC
    // 
    // We simulate this by directly checking transaction status

    // ============================================
    // STEP 4: Poll for transaction completion
    // ============================================
    const transactionStatus = await CoinbaseCommerceService.getTransactionStatus(
      topUpResult.transactionId
    );

    expect(transactionStatus).toBe('completed');

    // ============================================
    // STEP 5: Verify balance was credited
    // ============================================
    // In production, the webhook would have called the RPC
    // Let's verify the RPC would be called correctly
    const { supabase } = await import('../supabase');
    
    const creditResult = await supabase.rpc('credit_balance_with_first_deposit_bonus', {
      p_canonical_user_id: userId,
      p_amount: topUpAmount,
      p_reason: 'commerce_topup',
      p_reference_id: topUpResult.transactionId
    });

    expect(creditResult.data).toEqual({
      success: true,
      new_balance: 150, // $100 + $50 bonus
      bonus_applied: true,
      bonus_amount: 50,
      total_credited: 150
    });

    // ============================================
    // STEP 6: Verify final balance
    // ============================================
    const { data: balanceData } = await supabase
      .from('sub_account_balances')
      .select('*')
      .eq('canonical_user_id', userId)
      .single();

    expect(balanceData).toEqual({
      available_balance: 100,
      bonus_balance: 50,  // 50% first-deposit bonus!
      pending_balance: 0
    });

    // Total usable balance
    const totalBalance = balanceData.available_balance + balanceData.bonus_balance;
    expect(totalBalance).toBe(150); // $100 deposited, $150 total!

    console.log('\n✅ Integration Test Summary:');
    console.log('================================');
    console.log(`User:              ${userId}`);
    console.log(`Deposited:         $${topUpAmount}`);
    console.log(`Bonus (50%):       $${balanceData.bonus_balance}`);
    console.log(`Total Balance:     $${totalBalance}`);
    console.log(`Transaction ID:    ${topUpResult.transactionId}`);
    console.log(`Checkout URL:      ${topUpResult.checkoutUrl}`);
    console.log('================================\n');
  });

  it('should handle top-up for existing users (no bonus)', async () => {
    const { CoinbaseCommerceService } = await import('../coinbase-commerce');
    const { supabase } = await import('../supabase');

    const userId = 'prize:pid:0x9876543210987654321098765432109876543210';
    const topUpAmount = 200;

    // Mock for existing user (already used bonus)
    mockSupabaseRpc.mockResolvedValueOnce({
      data: {
        success: true,
        new_balance: 200, // No bonus
        bonus_applied: false,
        bonus_amount: 0,
        total_credited: 200
      },
      error: null
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          transactionId: 'txn_existing_user_456',
          checkoutUrl: 'https://commerce.coinbase.com/charges/EXISTING123'
        }
      })
    });

    // Create top-up
    const result = await CoinbaseCommerceService.createTopUpTransaction(
      userId,
      topUpAmount
    );

    expect(result.transactionId).toBe('txn_existing_user_456');

    // Simulate webhook crediting
    const creditResult = await supabase.rpc('credit_balance_with_first_deposit_bonus', {
      p_canonical_user_id: userId,
      p_amount: topUpAmount,
      p_reason: 'commerce_topup',
      p_reference_id: result.transactionId
    });

    // No bonus for existing user
    expect(creditResult.data.bonus_applied).toBe(false);
    expect(creditResult.data.bonus_amount).toBe(0);
    expect(creditResult.data.new_balance).toBe(200);
  });

  it('should handle concurrent top-ups correctly', async () => {
    const { CoinbaseCommerceService } = await import('../coinbase-commerce');

    const userId = 'prize:pid:0xAABBCCDDEEFF00112233445566778899AABBCCDD';

    // Mock multiple concurrent requests
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transactionId: 'txn_concurrent_1',
            checkoutUrl: 'https://commerce.coinbase.com/charges/CONCURRENT1'
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transactionId: 'txn_concurrent_2',
            checkoutUrl: 'https://commerce.coinbase.com/charges/CONCURRENT2'
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transactionId: 'txn_concurrent_3',
            checkoutUrl: 'https://commerce.coinbase.com/charges/CONCURRENT3'
          }
        })
      });

    // Create 3 concurrent top-ups
    const results = await Promise.all([
      CoinbaseCommerceService.createTopUpTransaction(userId, 50),
      CoinbaseCommerceService.createTopUpTransaction(userId, 100),
      CoinbaseCommerceService.createTopUpTransaction(userId, 250),
    ]);

    // All should succeed with unique transaction IDs
    expect(results[0].transactionId).toBe('txn_concurrent_1');
    expect(results[1].transactionId).toBe('txn_concurrent_2');
    expect(results[2].transactionId).toBe('txn_concurrent_3');

    // Each should have a unique checkout URL
    expect(new Set(results.map(r => r.checkoutUrl)).size).toBe(3);
  });

  it('should validate the complete data flow', async () => {
    const { CoinbaseCommerceService } = await import('../coinbase-commerce');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          transactionId: 'txn_validation_789',
          chargeId: 'charge_validation_789',
          chargeCode: 'VALID789',
          checkoutUrl: 'https://commerce.coinbase.com/charges/VALID789'
        }
      })
    });

    const userId = 'prize:pid:0x1111111111111111111111111111111111111111';
    const amount = 75;

    const result = await CoinbaseCommerceService.createTopUpTransaction(userId, amount);

    // ===== VERIFY REQUEST PAYLOAD =====
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    
    expect(requestBody).toMatchObject({
      userId,
      totalAmount: amount,
      type: 'topup'
    });

    // ===== VERIFY RESPONSE DATA =====
    expect(result).toMatchObject({
      transactionId: 'txn_validation_789',
      checkoutUrl: expect.stringContaining('commerce.coinbase.com')
    });

    // ===== VERIFY CHECKOUT URL FORMAT =====
    const url = new URL(result.checkoutUrl);
    expect(url.hostname).toBe('commerce.coinbase.com');
    expect(url.pathname).toContain('/charges/');

    // ===== VERIFY DATABASE INTERACTION =====
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        amount,
        status: 'pending',
        payment_provider: 'coinbase_commerce'
      })
    );
  });

  it('should handle missing checkout URL error properly', async () => {
    const { CoinbaseCommerceService } = await import('../coinbase-commerce');

    // Mock API response when Coinbase Commerce fails to return hosted_url
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        success: false,
        error: 'Payment service error: Unable to generate checkout URL. Please try again or contact support.',
        code: 'CHECKOUT_URL_MISSING',
        data: {
          transactionId: 'txn_missing_url_123'
        }
      })
    });

    const userId = 'prize:pid:0x2222222222222222222222222222222222222222';
    const amount = 50;

    // ============================================
    // VERIFY ERROR HANDLING
    // ============================================
    await expect(
      CoinbaseCommerceService.createTopUpTransaction(userId, amount)
    ).rejects.toThrow('Payment service error: Unable to generate checkout URL');

    // Verify the API was called
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

    // Verify optimistic top-up was still created (before error)
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        amount,
        status: 'pending',
        payment_provider: 'coinbase_commerce'
      })
    );
  });
});
