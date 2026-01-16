// Ticket Purchase Service
// NOTE: 50% first-time bonus is now applied on WALLET TOP-UPS, not ticket purchases
// Users get bonus credits when they top up their wallet, which they can then spend on tickets
import { supabase } from './supabase';
import { withRetry, isNetworkError, parseSupabaseFunctionError, getUserFriendlyErrorMessage } from './error-handler';
import { toPrizePid, isPrizePid } from '../utils/userId';
import { toCanonicalUserId } from './canonicalUserId';
import { notificationService } from './notification-service';

// Re-export supabase for backwards compatibility
export { supabase };

/**
 * Purchase tickets using wallet balance
 * NOTE: Bonus credits are now applied on wallet top-ups, not on ticket purchases
 * Includes retry logic for network failures
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
  // CRITICAL: Validate userId before making the request
  // This prevents the "userIdentifier is required" error
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    console.error('[purchaseTicketsWithBalance] Invalid userId provided:', userId);
    return {
      success: false,
      error: 'User identifier is missing. Please log in again and try once more.'
    };
  }

  // NOTE: 'type' field is NOT sent - the server infers type from competitionId:
  //   - competitionId IS NOT NULL → entry purchase
  //   - competitionId IS NULL → wallet top-up
  // Ensure userId is always in canonical format
  const canonicalUserId = toCanonicalUserId(userId);

  const purchaseBody = {
    userId: canonicalUserId,
    idempotencyKey: `${userId}-${competitionId}-${numberOfTickets}-${Date.now()}`,
    competitionId,
    numberOfTickets,
    ticketPrice,
    selectedTickets: selectedTickets || [],
    reservationId: reservationId || null, // Pass reservation for atomic ticket allocation
  };

  try {
    // Use retry logic for network failures
    const { data, error } = await withRetry(
      async () => {
        const result = await supabase.functions.invoke('purchase-tickets-with-bonus', {
          body: purchaseBody
        });

        // Check for network-level errors that should trigger retry
        if (result.error) {
          const errorMessage = result.error?.message || String(result.error);
          if (errorMessage.includes('Failed to send a request') ||
              errorMessage.includes('FunctionsFetchError') ||
              isNetworkError(result.error)) {
            // Network error - throw to trigger retry
            console.warn('Purchase tickets network error, will retry:', errorMessage);
            throw new Error(`Network error during purchase: ${errorMessage}`);
          }
        }

        return result;
      },
      {
        maxRetries: 3,
        delayMs: 1500,
        context: 'purchase-tickets-with-bonus',
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
      // Parse the Supabase function error for better error messages
      const parsedError = parseSupabaseFunctionError(error);
      const friendlyMessage = getUserFriendlyErrorMessage(parsedError.statusCode, parsedError.message);

      console.error('Purchase tickets error:', {
        originalMessage: error.message,
        statusCode: parsedError.statusCode,
        friendlyMessage
      });

      return {
        success: false,
        error: friendlyMessage
      };
    }

    // Handle response based on edge function format
    if (data?.success === false) {
      // The edge function returned an error - provide user-friendly message
      const errorMsg = data.error || 'Failed to purchase tickets';
      return {
        success: false,
        error: getUserFriendlyErrorMessage(data.statusCode, errorMsg)
      };
    }

    // Dispatch balance-updated event so dashboard components refresh
    // This ensures entries and orders appear immediately after purchase
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('balance-updated', {
        detail: {
          newBalance: data.balanceAfterPurchase,
          purchaseAmount: data.totalCost,
          ticketsCreated: data.ticketsCreated,
          competitionId
        }
      }));

      // Trigger in-app notification for the successful purchase
      // Do this asynchronously so it doesn't block the return
      try {
        const ticketNumbers = data.tickets?.map((t: { ticket_number: number }) => t.ticket_number) || [];
        // Get competition title if available (we need to fetch it)
        supabase
          .from('competitions')
          .select('title')
          .eq('uid', competitionId)
          .maybeSingle()
          .then(({ data: compData }) => {
            const competitionTitle = compData?.title || 'Competition';
            // Send entry notification
            notificationService.notifyEntry(userId, competitionTitle, ticketNumbers, competitionId).catch(err => {
              console.warn('[purchaseTicketsWithBalance] Failed to send entry notification:', err);
            });
          })
          .catch(err => {
            console.warn('[purchaseTicketsWithBalance] Failed to fetch competition for notification:', err);
          });
      } catch (notifyErr) {
        console.warn('[purchaseTicketsWithBalance] Notification error (non-blocking):', notifyErr);
      }
    }

    return {
      success: true,
      ticketsCreated: data.ticketsCreated,
      ticketsPurchased: data.ticketsPurchased,
      totalCost: data.totalCost,
      balanceAfterPurchase: data.balanceAfterPurchase,
      message: data.message,
      tickets: data.tickets,
      entryId: data.entryId,
      transactionId: data.transactionId,
      transactionRef: data.transactionRef
    };
  } catch (err) {
    // Parse any caught errors for better messages
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

    if (subAccountData && subAccountData.length > 0 && !subAccountError && Number(subAccountData[0].available_balance) > 0) {
      return {
        success: true,
        data: {
          usdc_balance: Number(subAccountData[0].available_balance) || 0
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
        error: getUserFriendlyErrorMessage(null, errorMsg)
      };
    }

    // Dispatch balance-updated event for any local listeners
    // Note: The realtime-balance-broadcaster also sends wallet_balance_changed via Supabase broadcast
    if (typeof window !== 'undefined' && data?.result) {
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
