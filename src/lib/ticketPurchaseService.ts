// Ticket Purchase Service
// NOTE: Now uses the new 3-endpoint balance payment flow
// All balance payments go through: reserve -> purchase -> verify (optional)
import { supabase } from './supabase';
import { withRetry, isNetworkError, parseSupabaseFunctionError, getUserFriendlyErrorMessage } from './error-handler';
import { toPrizePid, isPrizePid } from '../utils/userId';
import { toCanonicalUserId } from './canonicalUserId';
import { notificationService } from './notification-service';
import { BalancePaymentService } from './balance-payment-service';

// Re-export supabase for backwards compatibility
export { supabase };

/**
 * Check if a competition is sold out and mark it for drawing if so.
 * This is called after ticket purchases to ensure timely status updates.
 */
export async function checkCompetitionSoldOut(competitionId: string): Promise<boolean> {
  if (!competitionId) return false;

  try {
    // Call the RPC function that checks and marks sold-out competitions
    // Note: This function is defined in the migration and may not exist yet in all environments
    const { data, error } = await supabase.rpc('check_and_mark_competition_sold_out' as any, {
      p_competition_id: competitionId
    });

    if (error) {
      // Function might not exist yet, log and continue
      console.log('[checkCompetitionSoldOut] RPC not available or failed:', error.message);
      return false;
    }

    if (data === true) {
      console.log('[checkCompetitionSoldOut] Competition marked as sold out:', competitionId);
      return true;
    }

    return false;
  } catch (err) {
    console.log('[checkCompetitionSoldOut] Error (non-blocking):', err);
    return false;
  }
}

/**
 * Purchase tickets using wallet balance - NEW FLOW
 * Uses the 3-endpoint balance payment system:
 * 1. Reserve tickets (if not already reserved)
 * 2. Purchase with balance
 * 3. Verify status (if needed)
 * 
 * This replaces all previous balance payment logic.
 */
export async function purchaseTicketsWithBalance({
  userId,
  competitionId,
  numberOfTickets,
  ticketPrice,
  selectedTickets,
  reservationId
}: {
  userId: string;
  competitionId: string;
  numberOfTickets: number;
  ticketPrice: number;
  selectedTickets?: number[];
  reservationId?: string | null;
}) {
  // Validate userId
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    console.error('[purchaseTicketsWithBalance] Invalid userId provided:', userId);
    return {
      success: false,
      error: 'User identifier is missing. Please log in again and try once more.'
    };
  }

  try {
    const canonicalUserId = toCanonicalUserId(userId);
    let currentReservationId = reservationId;
    let reservationData;

    // If no reservation provided, create one first
    if (!currentReservationId) {
      console.log('[purchaseTicketsWithBalance] No reservation provided, creating one...');
      
      const reserveResult = await BalancePaymentService.reserveTickets({
        userId: canonicalUserId,
        competitionId,
        ticketNumbers: selectedTickets,
        ticketCount: !selectedTickets || selectedTickets.length === 0 ? numberOfTickets : undefined
      });

      if (!reserveResult.success || !reserveResult.data) {
        console.error('[purchaseTicketsWithBalance] Reservation failed:', reserveResult.error);
        return {
          success: false,
          error: reserveResult.error || 'Failed to reserve tickets'
        };
      }

      currentReservationId = reserveResult.data.reservation_id;
      reservationData = reserveResult.data;
      console.log('[purchaseTicketsWithBalance] Reservation created:', currentReservationId);
    }

    // Purchase with balance using rolled-back contract
    // Need to get ticket numbers from reservation or use selectedTickets
    const ticketsToSend = reservationData ? reservationData.ticket_numbers : (selectedTickets || []);
    
    console.log('[purchaseTicketsWithBalance] Purchasing with rolled-back contract:', {
      competitionId: competitionId.substring(0, 10) + '...',
      ticketCount: ticketsToSend.length
    });
    
    const purchaseResult = await BalancePaymentService.purchaseWithBalance({
      competitionId: competitionId,
      ticketNumbers: ticketsToSend
    });

    if (!purchaseResult.success || !purchaseResult.data) {
      console.error('[purchaseTicketsWithBalance] Purchase failed:', purchaseResult.error);
      return {
        success: false,
        error: purchaseResult.error || 'Failed to purchase tickets'
      };
    }

    const purchaseData = purchaseResult.data;
    console.log('[purchaseTicketsWithBalance] Purchase successful:', purchaseData.payment_id);

    // Trigger in-app notification for the successful purchase
    try {
      const ticketNumbers = purchaseData.tickets?.map(t => t.ticket_number) || [];
      supabase
        .from('competitions')
        .select('title')
        .eq('id', competitionId)
        .maybeSingle()
        .then(({ data: compData }) => {
          const competitionTitle = compData?.title || 'Competition';
          notificationService.notifyEntry(userId, competitionTitle, ticketNumbers, competitionId).catch(err => {
            console.warn('[purchaseTicketsWithBalance] Failed to send entry notification:', err);
          });
        });
    } catch (notifyErr) {
      console.warn('[purchaseTicketsWithBalance] Notification error (non-blocking):', notifyErr);
    }

    // Check if competition is now sold out
    checkCompetitionSoldOut(competitionId).catch((err: any) => {
      console.log('[purchaseTicketsWithBalance] Sold-out check (non-blocking):', err);
    });

    // Return in expected format
    return {
      success: true,
      ticketsCreated: purchaseData.tickets.length,
      ticketsPurchased: purchaseData.tickets.length,
      totalCost: parseFloat(purchaseData.amount),
      balanceAfterPurchase: parseFloat(purchaseData.new_balance),
      message: 'Tickets purchased successfully',
      tickets: purchaseData.tickets,
      paymentId: purchaseData.payment_id,
      reservationId: currentReservationId
    };
  } catch (err) {
    console.error('[purchaseTicketsWithBalance] Exception:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Get active competitions
 */
export async function getActiveCompetitions() {
  try {
    const { data, error } = await supabase
      .from('competitions')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      success: true,
      data: data || []
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load competitions',
      data: []
    };
  }
}

/**
 * Helper to determine if identifier is a wallet address
 */
function isWalletAddress(identifier: string): boolean {
  return identifier.startsWith('0x') && identifier.length === 42;
}

/**
 * Get user's tickets in a specific competition
 * Uses canonical prize:pid: format first, with fallback to legacy formats
 */
export async function getUserTicketsInCompetition(userId: string, competitionId: string) {
  try {
    // Convert to canonical format for primary lookup
    const canonicalUserId = toPrizePid(userId);

    // Try canonical lookup first
    let { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('user_id', canonicalUserId)
      .eq('competition_id', competitionId);

    // If no results with canonical, try with original ID (fallback for legacy data)
    if (!error && (!data || data.length === 0) && !isPrizePid(userId)) {
      const fallbackResult = await supabase
        .from('tickets')
        .select('*')
        .eq('user_id', userId)
        .eq('competition_id', competitionId);
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) throw error;

    return {
      success: true,
      data: {
        tickets: data || [],
        count: data?.length || 0
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load tickets',
      data: { tickets: [], count: 0 }
    };
  }
}

/**
 * Get user's total tickets across all competitions
 * Uses canonical prize:pid: format first, with fallback to legacy formats
 */
export async function getUserTotalTickets(userId: string) {
  try {
    // Convert to canonical format for primary lookup
    const canonicalUserId = toPrizePid(userId);

    // Try canonical lookup first
    let { data, error } = await supabase
      .from('tickets')
      .select('id')
      .eq('user_id', canonicalUserId);

    // If no results with canonical, try with original ID (fallback for legacy data)
    if (!error && (!data || data.length === 0) && !isPrizePid(userId)) {
      const fallbackResult = await supabase
        .from('tickets')
        .select('id')
        .eq('user_id', userId);
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) throw error;

    return {
      success: true,
      data: {
        totalTickets: data?.length || 0
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load ticket count',
      data: { totalTickets: 0 }
    };
  }
}

/**
 * Get user's USDC balance
 * Uses get_user_balance RPC which reads from sub_account_balances, wallet_balances, and canonical_users
 */
export async function getUserBalance(userId: string) {
  try {
    // Convert to canonical format for RPC lookup
    const canonicalUserId = toPrizePid(userId);
    const normalizedUserId = isWalletAddress(userId) ? userId.toLowerCase() : userId;

    // Primary: Use get_user_balance RPC for consistent balance lookups
    // The RPC now checks sub_account_balances, wallet_balances, and canonical_users
    const { data: rpcBalance, error: rpcError } = await supabase.rpc('get_user_balance', {
      p_canonical_user_id: canonicalUserId
    });

    // Check for type mismatch error (can occur if database migration not applied)
    const isTypeMismatchError = rpcError?.message?.includes('operator does not exist') ||
      rpcError?.message?.includes('type cast') ||
      rpcError?.code === '42883' ||
      rpcError?.code === '42846';

    if (!rpcError && rpcBalance !== null && Number(rpcBalance) > 0) {
      return {
        success: true,
        data: {
          usdc_balance: Number(rpcBalance) || 0
        }
      };
    }

    // Fallback 1: Direct query to sub_account_balances if RPC fails or returns 0
    if (isTypeMismatchError) {
      console.warn('[ticketPurchaseService] RPC type mismatch error - database migration may need to be applied. Falling back to direct query.');
    } else {
      console.log('[ticketPurchaseService] RPC returned 0 or failed, trying fallback queries:', rpcError?.message);
    }

    const { data: subAccountData, error: subAccountError } = await supabase
      .from('sub_account_balances')
      .select('available_balance, canonical_user_id')
      .eq('currency', 'USD')
      .or(`canonical_user_id.eq.${canonicalUserId},user_id.eq.${normalizedUserId},privy_user_id.eq.${normalizedUserId}`)
      .limit(1);

    if (subAccountData && subAccountData.length > 0 && !subAccountError && Number((subAccountData[0] as any).available_balance) > 0) {
      return {
        success: true,
        data: {
          usdc_balance: Number((subAccountData[0] as any).available_balance) || 0
        }
      };
    }

    // If no balance found in sub_account_balances, the user has no balance yet
    // This is expected for new users who haven't topped up
    console.log('[ticketPurchaseService] No balance record found for user:', canonicalUserId.substring(0, 25) + '...');
    return {
      success: true,
      data: {
        usdc_balance: 0
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load balance',
      data: { usdc_balance: 0 }
    };
  }
}

/**
 * Check if user has used their first-time top-up bonus
 * The 50% bonus is applied on the first wallet top-up, not on ticket purchases
 * Uses canonical prize:pid: format first, with fallback to legacy formats
 */
export async function getUserBonusStatus(userId: string) {
  try {
    // Convert to canonical format for primary lookup
    const canonicalUserId = toPrizePid(userId);

    // Try canonical lookup first
    let { data, error } = await supabase
      .from('canonical_users')
      .select('has_used_new_user_bonus, wallet_address')
      .eq('canonical_user_id', canonicalUserId)
      .maybeSingle();

    // If no results with canonical, try fallback lookups for legacy data
    if (!error && !data) {
      if (isWalletAddress(userId)) {
        // Try by wallet address (case-insensitive)
        const { data: walletData, error: walletError } = await supabase
          .from('canonical_users')
          .select('has_used_new_user_bonus, wallet_address')
          .ilike('wallet_address', userId)
          .maybeSingle();

        if (walletData) {
          data = walletData;
          error = walletError;
        } else {
          // Try base_wallet_address
          const { data: baseData, error: baseError } = await supabase
            .from('canonical_users')
            .select('has_used_new_user_bonus, wallet_address')
            .ilike('base_wallet_address', userId)
            .maybeSingle();

          if (baseData) {
            data = baseData;
            error = baseError;
          }
        }
      } else {
        // Try by privy_user_id for legacy DIDs
        const result = await supabase
          .from('canonical_users')
          .select('has_used_new_user_bonus, wallet_address')
          .eq('privy_user_id', userId)
          .maybeSingle();
        data = result.data;
        error = result.error;
      }
    }

    if (error) throw error;

    return {
      success: true,
      data: {
        hasUsedBonus: data?.has_used_new_user_bonus || false
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load bonus status',
      data: { hasUsedBonus: true } // Default to true if error (don't show bonus)
    };
  }
}

/**
 * Pay with balance using the new pay-with-balance Edge Function
 * This function calls the debit_balance_and_finalize_order RPC and triggers
 * the realtime-balance-broadcaster for instant UI updates via wallet_balance_changed events
 *
 * @param params - Payment parameters
 * @param params.canonical_user_id - User's canonical ID (prize:pid: format)
 * @param params.order_id - Order UUID
 * @param params.entries - Number of entries to purchase
 * @param params.currency - Currency code (defaults to 'USD')
 * @returns Payment result with success status and balance info
 */
export async function payWithBalance({
  canonical_user_id,
  order_id,
  entries,
  currency = 'USD'
}: {
  canonical_user_id: string;
  order_id: string;
  entries: number;
  currency?: string;
}) {
  // Validate required fields
  if (!canonical_user_id || typeof canonical_user_id !== 'string' || canonical_user_id.trim() === '') {
    console.error('[payWithBalance] Invalid canonical_user_id provided:', canonical_user_id);
    return {
      success: false,
      error: 'User identifier is missing. Please log in again and try once more.'
    };
  }

  if (!order_id || typeof order_id !== 'string' || order_id.trim() === '') {
    console.error('[payWithBalance] Invalid order_id provided:', order_id);
    return {
      success: false,
      error: 'Order ID is missing.'
    };
  }

  if (!Number.isFinite(entries) || entries <= 0) {
    console.error('[payWithBalance] Invalid entries provided:', entries);
    return {
      success: false,
      error: 'Invalid number of entries.'
    };
  }

  // Ensure canonical_user_id is in prize:pid: format
  const normalizedUserId = isPrizePid(canonical_user_id)
    ? canonical_user_id
    : toPrizePid(canonical_user_id);

  const paymentBody = {
    canonical_user_id: normalizedUserId,
    order_id,
    entries,
    currency
  };

  try {
    // Use retry logic for network failures
    const { data, error } = await withRetry(
      async () => {
        const result = await supabase.functions.invoke('pay-with-balance', {
          body: paymentBody
        });

        // Check for network-level errors that should trigger retry
        if (result.error) {
          const errorMessage = result.error?.message || String(result.error);
          if (errorMessage.includes('Failed to send a request') ||
              errorMessage.includes('FunctionsFetchError') ||
              isNetworkError(result.error)) {
            console.warn('[payWithBalance] Network error, will retry:', errorMessage);
            throw new Error(`Network error during payment: ${errorMessage}`);
          }
        }

        return result;
      },
      {
        maxRetries: 3,
        delayMs: 1500,
        context: 'pay-with-balance',
        shouldRetry: (error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return errorMessage.includes('Network error') ||
                 errorMessage.includes('Failed to send') ||
                 errorMessage.includes('FunctionsFetchError') ||
                 isNetworkError(error);
        }
      }
    );

    if (error) {
      const parsedError = parseSupabaseFunctionError(error);
      const friendlyMessage = getUserFriendlyErrorMessage(parsedError.statusCode, parsedError.message);

      console.error('[payWithBalance] Error:', {
        originalMessage: error.message,
        statusCode: parsedError.statusCode,
        friendlyMessage
      });

      return {
        success: false,
        error: friendlyMessage
      };
    }

    // Handle response - the Edge Function returns { ok: true/false, result, broadcast }
    if (data?.ok === false) {
      const errorMsg = data.error || 'Payment failed';
      return {
        success: false,
        error: getUserFriendlyErrorMessage(undefined, errorMsg)
      };
    }

    // Dispatch balance-updated event for any local listeners
    // Note: The realtime-balance-broadcaster also sends wallet_balance_changed via Supabase broadcast
    // Only dispatch if we have valid balance data
    if (typeof window !== 'undefined' && data?.result?.new_balance !== undefined) {
      window.dispatchEvent(new CustomEvent('balance-updated', {
        detail: {
          newBalance: data.result.new_balance,
          previousBalance: data.result.previous_balance,
          debitedAmount: data.result.debited_amount,
          orderId: order_id
        }
      }));
    }

    return {
      success: true,
      result: data.result,
      broadcast: data.broadcast
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const parsedError = parseSupabaseFunctionError(err);
    const friendlyMessage = getUserFriendlyErrorMessage(parsedError.statusCode, errorMessage);

    return {
      success: false,
      error: friendlyMessage
    };
  }
}

/**
 * Execute balance payment using the GODLIKE RPC
 * This calls the unified execute_balance_payment RPC directly,
 * bypassing Edge Functions entirely for maximum reliability.
 *
 * Features:
 * - Handles ALL user ID formats (wallet, prize:pid:, did:privy:, UUID)
 * - Atomic transaction (all-or-nothing)
 * - Idempotent (same request = same result)
 * - Updates ALL balance tables in sync
 * - Creates entries in tickets, joincompetition, user_transactions
 *
 * @param params - Payment parameters
 * @returns Payment result with detailed success/error info
 */
export async function executeBalancePaymentRPC({
  userId,
  competitionId,
  amount,
  ticketCount,
  selectedTickets,
  idempotencyKey,
  reservationId
}: {
  userId: string;
  competitionId: string;
  amount: number;
  ticketCount: number;
  selectedTickets?: number[];
  idempotencyKey?: string;
  reservationId?: string | null;
}) {
  // Validate required fields
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    console.error('[executeBalancePaymentRPC] Invalid userId provided:', userId);
    return {
      success: false,
      error: 'User identifier is missing. Please log in again and try once more.',
      error_code: 'INVALID_USER'
    };
  }

  if (!competitionId || typeof competitionId !== 'string' || competitionId.trim() === '') {
    console.error('[executeBalancePaymentRPC] Invalid competitionId provided:', competitionId);
    return {
      success: false,
      error: 'Competition ID is missing.',
      error_code: 'INVALID_COMPETITION'
    };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('[executeBalancePaymentRPC] Invalid amount provided:', amount);
    return {
      success: false,
      error: 'Invalid payment amount.',
      error_code: 'INVALID_AMOUNT'
    };
  }

  if (!Number.isFinite(ticketCount) || ticketCount <= 0) {
    console.error('[executeBalancePaymentRPC] Invalid ticketCount provided:', ticketCount);
    return {
      success: false,
      error: 'Invalid number of tickets.',
      error_code: 'INVALID_TICKET_COUNT'
    };
  }

  // Generate idempotency key if not provided
  const finalIdempotencyKey = idempotencyKey ||
    `${userId}-${competitionId}-${amount}-${ticketCount}-${Date.now()}`;

  try {
    console.log('[executeBalancePaymentRPC] Calling execute_balance_payment RPC with:', {
      userId: userId.substring(0, 20) + '...',
      competitionId,
      amount,
      ticketCount,
      selectedTicketsCount: selectedTickets?.length || 0
    });

    // Call the GODLIKE RPC using the centralized helper
    const { data, error } = await withRetry(
      async () => {
        return await executeBalancePayment(supabase, {
          competitionId,
          userIdentifier: userId,
          amount,
          ticketCount,
          selectedTickets: selectedTickets && selectedTickets.length > 0 ? selectedTickets : null,
          idempotencyKey: finalIdempotencyKey,
          reservationId: reservationId || null
        });
      },
      {
        maxRetries: 3,
        delayMs: 1500,
        context: 'execute_balance_payment_rpc',
        shouldRetry: (error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Retry on network errors but not on validation errors
          return errorMessage.includes('Network') ||
                 errorMessage.includes('Failed to send') ||
                 errorMessage.includes('FunctionsFetchError') ||
                 errorMessage.includes('network') ||
                 isNetworkError(error);
        }
      }
    );

    if (error) {
      console.error('[executeBalancePaymentRPC] RPC error:', error);
      return {
        success: false,
        error: getUserFriendlyErrorMessage(undefined, error.message || 'Payment failed'),
        error_code: 'RPC_ERROR',
        error_detail: error.message
      };
    }

    // The RPC returns a JSONB object
    if (!data) {
      return {
        success: false,
        error: 'No response from payment service',
        error_code: 'EMPTY_RESPONSE'
      };
    }

    // Check if the RPC returned an error
    if (data.success === false) {
      console.error('[executeBalancePaymentRPC] RPC returned error:', data);
      return {
        success: false,
        error: getUserFriendlyErrorMessage(undefined, data.error || 'Payment failed'),
        error_code: data.error_code || 'PAYMENT_FAILED',
        ...data
      };
    }

    // Success!
    console.log('[executeBalancePaymentRPC] Payment successful:', {
      entryUid: data.entry_uid,
      ticketsCreated: data.tickets_created,
      newBalance: data.new_balance
    });

    // Dispatch balance-updated event
    if (typeof window !== 'undefined' && data.new_balance !== undefined) {
      window.dispatchEvent(new CustomEvent('balance-updated', {
        detail: {
          newBalance: data.new_balance,
          previousBalance: data.previous_balance,
          purchaseAmount: data.amount_debited,
          ticketsCreated: data.tickets_created,
          competitionId
        }
      }));
    }

    // Check if competition is now sold out (non-blocking)
    checkCompetitionSoldOut(competitionId).catch((err: Error) => {
      console.log('[executeBalancePaymentRPC] Sold-out check (non-blocking):', err);
    });

    return {
      success: true,
      ticketsCreated: data.tickets_created,
      ticketNumbers: data.ticket_numbers,
      totalCost: data.amount_debited,
      balanceAfterPurchase: data.new_balance,
      previousBalance: data.previous_balance,
      entryId: data.entry_uid,
      transactionId: data.transaction_id,
      competitionTitle: data.competition_title,
      idempotent: data.idempotent || false,
      message: `Successfully purchased ${data.tickets_created} tickets`
    };

  } catch (err) {
    console.error('[executeBalancePaymentRPC] Unexpected error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    return {
      success: false,
      error: getUserFriendlyErrorMessage(undefined, errorMessage),
      error_code: 'UNEXPECTED_ERROR',
      error_detail: errorMessage
    };
  }
}

/**
 * Finalize a balance payment using the finalize_purchase2 RPC
 *
 * This is the preferred method for balance payments as it:
 * - Is idempotent (same key = same result, no double-charges or double-allocations)
 * - Works even if reservation expired or ticket list is missing
 * - Auto-allocates from available tickets up to ticket_count if needed
 * - Handles partial failures by topping up from available inventory
 * - Upserts competition_entries, inserts user_transactions (one-per-idempotency)
 * - Balance updates are soft-idempotent using balance_ledger.reference_id='entry:{key}'
 * - Always returns the same success payload for the same idempotency key
 * - On failure, stores and returns an error payload; retried calls return stored result
 *
 * @param params - Payment parameters
 * @returns Payment result with detailed success/error info surfaced to frontend
 */
export async function finalizeBalancePayment({
  reservationId,
  idempotencyKey,
  ticketCount,
  competitionId
}: {
  reservationId: string;
  idempotencyKey?: string;
  ticketCount?: number;
  competitionId?: string;
}) {
  // Validate required fields
  if (!reservationId || typeof reservationId !== 'string' || reservationId.trim() === '') {
    console.error('[finalizeBalancePayment] Invalid reservationId provided:', reservationId);
    return {
      success: false,
      error: 'Reservation ID is missing. Please try again.',
      error_code: 'INVALID_RESERVATION'
    };
  }

  // Use reservationId as idempotency key if not provided (recommended pattern)
  const finalIdempotencyKey = idempotencyKey || reservationId;

  try {
    console.log('[finalizeBalancePayment] Calling finalize_purchase2 RPC with:', {
      reservationId,
      idempotencyKey: finalIdempotencyKey,
      ticketCount: ticketCount || 'auto'
    });

    // Call the finalize_purchase2 RPC using the centralized helper
    const { data, error } = await withRetry(
      async () => {
        return await finalizePurchase(supabase, {
          reservationId,
          idempotencyKey: finalIdempotencyKey,
          ticketCount: ticketCount ?? null
        });
      },
      {
        maxRetries: 3,
        delayMs: 1500,
        context: 'finalize_purchase2_rpc',
        shouldRetry: (error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Retry on network errors but not on validation errors
          return errorMessage.includes('Network') ||
                 errorMessage.includes('Failed to send') ||
                 errorMessage.includes('FunctionsFetchError') ||
                 errorMessage.includes('network') ||
                 isNetworkError(error);
        }
      }
    );

    if (error) {
      console.error('[finalizeBalancePayment] RPC error:', error);
      return {
        success: false,
        error: getUserFriendlyErrorMessage(undefined, error.message || 'Payment finalization failed'),
        error_code: 'RPC_ERROR',
        error_detail: error.message
      };
    }

    // The RPC returns a JSONB object
    if (!data) {
      return {
        success: false,
        error: 'No response from payment service',
        error_code: 'EMPTY_RESPONSE'
      };
    }

    // Check if the RPC returned an error
    if (data.success === false) {
      console.error('[finalizeBalancePayment] RPC returned error:', data);
      return {
        success: false,
        error: data.error || 'Payment finalization failed',
        error_code: data.error_code || 'FINALIZE_FAILED',
        ...data
      };
    }

    // Success! Extract and format the response for frontend consumption
    console.log('[finalizeBalancePayment] Payment finalized successfully:', {
      entryId: data.entry_id,
      ticketsCreated: data.tickets_created?.length || 0,
      totalCost: data.total_cost,
      balanceAfter: data.balance_after
    });

    // Dispatch balance-updated event to update UI immediately
    if (typeof window !== 'undefined' && data.balance_after !== undefined) {
      window.dispatchEvent(new CustomEvent('balance-updated', {
        detail: {
          newBalance: data.balance_after,
          previousBalance: data.balance_before,
          purchaseAmount: data.total_cost,
          ticketsCreated: data.tickets_created?.length || 0,
          competitionId: data.competition_id || competitionId
        }
      }));
    }

    // Check if competition is now sold out (non-blocking)
    const finalCompetitionId = data.competition_id || competitionId;
    if (finalCompetitionId) {
      checkCompetitionSoldOut(finalCompetitionId).catch((err: Error) => {
        console.log('[finalizeBalancePayment] Sold-out check (non-blocking):', err);
      });
    }

    // Return structured success response that surfaces to frontend
    return {
      success: true,
      entryId: data.entry_id,
      ticketsCreated: data.tickets_created || [],
      ticketNumbers: data.tickets_created || [],
      totalCost: data.total_cost,
      balanceBeforePurchase: data.balance_before,
      balanceAfterPurchase: data.balance_after,
      competitionId: data.competition_id || competitionId,
      idempotent: data.idempotent || false,
      message: `Successfully purchased ${data.tickets_created?.length || ticketCount || 0} tickets`
    };

  } catch (err) {
    console.error('[finalizeBalancePayment] Unexpected error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    return {
      success: false,
      error: getUserFriendlyErrorMessage(undefined, errorMessage),
      error_code: 'UNEXPECTED_ERROR',
      error_detail: errorMessage
    };
  }
}
