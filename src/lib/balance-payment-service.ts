/**
 * Balance Payment Service
 * 
 * Simplified balance payment system that uses the Netlify proxy + RPC flow:
 * 1. Optional: Reserve tickets via Supabase edge function (for frontend UX)
 * 2. Purchase with balance via POST /api/purchase-with-balance (Netlify proxy)
 *    - The proxy calls purchase_tickets_with_balance RPC which:
 *      - Checks sub_account_balances for available_balance
 *      - Matches by canonical_user_id or wallet_address
 *      - Deducts balance atomically
 *      - Allocates tickets (selected or lucky dip)
 *      - Returns success with balance and ticket info
 * 
 * This replaces all previous complex balance payment logic.
 */

import { supabase } from './supabase';
import { toCanonicalUserId } from './canonicalUserId';
import { idempotencyKeyManager } from './idempotency-keys';

// ============================================================================
// Types
// ============================================================================

export interface ReservationRequest {
  competition_id: string;
  canonical_user_id: string;
  ticket_numbers?: number[];
  ticket_count?: number;
  idempotency_key: string;
}

export interface ReservationResponse {
  reservation_id: string;
  competition_id: string;
  ticket_numbers: number[];
  ticket_count: number;
  ticket_price: string;
  total_amount: string;
  expires_at: string;
}

export interface PurchaseRequest {
  reservation_id: string;
  idempotency_key: string;
  // Best practice: include all required data directly, don't rely on lookups
  competition_id?: string;
  canonical_user_id?: string;
  ticket_numbers?: number[];
  ticket_count?: number;
  ticket_price?: number;
}

/**
 * Purchase request body for /api/purchase-with-balance (Netlify proxy)
 */
export interface EdgeFunctionPurchaseRequest {
  userId: string;
  competition_id: string;
  numberOfTickets: number;
  ticketPrice: number;
  tickets: Array<{ ticket_number: number }>;
  idempotent: boolean;
  reservation_id?: string;
  idempotency_key?: string;  // Explicit idempotency key for proper tracking
  payment_provider?: string;  // For balance_ledger tracking
  type?: string;              // For balance_ledger: 'purchase', 'entry', etc.
}

export interface PurchaseResponse {
  payment_id: string;
  status: 'succeeded';
  amount: string;
  currency: string;
  new_balance: string;
  competition_id: string;
  tickets: Array<{ id: string; ticket_number: number }>;
}

export interface VerifyRequest {
  reservation_id?: string;
  payment_id?: string;
}

export interface BalancePaymentError {
  statusCode: number;
  message: string;
  type: 'validation' | 'conflict' | 'expired' | 'insufficient_balance' | 'not_found' | 'network' | 'unknown';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique idempotency key using cryptographically secure random
 * @deprecated Use idempotencyKeyManager.getOrCreateKey() instead for automatic reuse on retries
 */
function generateIdempotencyKey(prefix: string): string {
  return crypto.randomUUID();
}

/**
 * Parse error response from edge function
 */
function parseError(error: any, statusCode?: number): BalancePaymentError {
  const message = error?.message || error?.error || String(error);
  const code = statusCode || error?.statusCode || 500;

  let type: BalancePaymentError['type'] = 'unknown';
  
  if (code === 400 || code === 422) {
    type = 'validation';
  } else if (code === 409) {
    type = 'conflict';
  } else if (code === 410) {
    type = 'expired';
  } else if (code === 402) {
    type = 'insufficient_balance';
  } else if (code === 404) {
    type = 'not_found';
  } else if (message.includes('network') || message.includes('Network')) {
    type = 'network';
  }

  return {
    statusCode: code,
    message,
    type
  };
}

/**
 * Get user-friendly error message
 */
function getUserFriendlyError(error: BalancePaymentError): string {
  switch (error.type) {
    case 'validation':
      return error.message || 'Invalid request. Please check your input and try again.';
    case 'conflict':
      return 'Some tickets are no longer available. Please select different tickets.';
    case 'expired':
      return 'Your reservation has expired. Please reserve tickets again.';
    case 'insufficient_balance':
      return 'Insufficient balance. Please top up your wallet and try again.';
    case 'not_found':
      return 'Reservation not found. Please reserve tickets again.';
    case 'network':
      return 'Network error. Please check your connection and try again.';
    default:
      return error.message || 'An unexpected error occurred. Please try again.';
  }
}

// ============================================================================
// Main Service Class
// ============================================================================

export class BalancePaymentService {
  /**
   * Step 1: Reserve tickets
   * 
   * Creates a hold via pending_tickets and pending_ticket_items.
   * Returns a reservation_id that expires after expires_at.
   * 
   * @param params.userId - User identifier (will be converted to canonical format)
   * @param params.competitionId - Competition UUID
   * @param params.ticketNumbers - Optional: Specific ticket numbers to reserve (e.g., [1, 5, 10])
   * @param params.ticketCount - Optional: Number of tickets to auto-select (cannot use with ticketNumbers)
   * @returns Promise with reservation data or error
   */
  static async reserveTickets(params: {
    userId: string;
    competitionId: string;
    ticketNumbers?: number[];
    ticketCount?: number;
  }): Promise<{
    success: boolean;
    data?: ReservationResponse;
    error?: string;
    errorDetails?: BalancePaymentError;
  }> {
    const { userId, competitionId, ticketNumbers, ticketCount } = params;

    // Validate inputs
    if (!userId || !competitionId) {
      return {
        success: false,
        error: 'User ID and Competition ID are required'
      };
    }

    if ((!ticketNumbers || ticketNumbers.length === 0) && !ticketCount) {
      return {
        success: false,
        error: 'Provide either ticket_numbers or ticket_count'
      };
    }

    if (ticketNumbers && ticketNumbers.length > 0 && ticketCount) {
      return {
        success: false,
        error: 'Send either ticket_numbers or ticket_count, not both'
      };
    }

    // Validate ticketCount is positive
    if (ticketCount !== undefined && (ticketCount <= 0 || !Number.isFinite(ticketCount))) {
      return {
        success: false,
        error: 'Ticket count must be a positive number'
      };
    }

    try {
      const canonicalUserId = toCanonicalUserId(userId);
      
      // Use idempotency manager for proper key management with automatic reuse on retries
      const idempotencyKey = idempotencyKeyManager.getOrCreateKey(`reserve-${competitionId}-${Date.now()}`);

      const requestBody: ReservationRequest = {
        competition_id: competitionId,
        canonical_user_id: canonicalUserId,
        idempotency_key: idempotencyKey
      };

      if (ticketNumbers && ticketNumbers.length > 0) {
        requestBody.ticket_numbers = ticketNumbers;
      } else if (ticketCount) {
        requestBody.ticket_count = ticketCount;
      }

      console.log('[BalancePayment] Reserving tickets:', requestBody);

      const { data, error } = await supabase.functions.invoke('reserve-tickets', {
        body: requestBody
      });

      if (error) {
        const parsedError = parseError(error);
        console.error('[BalancePayment] Reservation error:', parsedError);
        return {
          success: false,
          error: getUserFriendlyError(parsedError),
          errorDetails: parsedError
        };
      }

      if (!data || !data.reservation_id) {
        return {
          success: false,
          error: 'Invalid response from server'
        };
      }

      console.log('[BalancePayment] Reservation successful:', data.reservation_id);

      return {
        success: true,
        data: data as ReservationResponse
      };
    } catch (error) {
      console.error('[BalancePayment] Reservation exception:', error);
      const parsedError = parseError(error);
      return {
        success: false,
        error: getUserFriendlyError(parsedError),
        errorDetails: parsedError
      };
    }
  }

  /**
   * Step 2: Purchase with balance (SIMPLIFIED SYSTEM)
   * 
   * Uses the Netlify proxy at /api/purchase-with-balance which calls
   * the purchase_tickets_with_balance RPC that:
   * - Checks sub_account_balances for available_balance
   * - Matches user by canonical_user_id or wallet_address
   * - Atomically deducts balance and creates tickets
   * - Returns: { status: 'ok', competition_id, tickets, entry_id, total_cost, new_balance }
   * 
   * @param params.competitionId - Competition UUID (REQUIRED)
   * @param params.ticketNumbers - Specific ticket numbers to purchase (REQUIRED)
   * @param params.userId - User identifier (REQUIRED)
   * @param params.ticketPrice - Ticket price (REQUIRED)
   * @param params.reservationId - Optional reservation ID (for backwards compatibility)
   * @param params.ticketCount - Optional count (for backwards compatibility)
   * @returns Promise with purchase data including new balance
   */
  static async purchaseWithBalance(params: {
    competitionId: string;
    ticketNumbers: number[];
    userId: string;
    ticketPrice: number;
    reservationId?: string;
    ticketCount?: number;
  }): Promise<{
    success: boolean;
    data?: PurchaseResponse;
    error?: string;
    errorDetails?: BalancePaymentError;
  }> {
    const { competitionId, ticketNumbers, userId, ticketPrice, reservationId } = params;

    // Validate required parameters
    if (!competitionId) {
      return {
        success: false,
        error: 'Competition ID is required'
      };
    }

    if (!ticketNumbers || ticketNumbers.length === 0) {
      return {
        success: false,
        error: 'Ticket numbers are required'
      };
    }

    if (!userId) {
      return {
        success: false,
        error: 'User ID is required'
      };
    }

    if (ticketPrice < 0.1 || ticketPrice > 100) {
      return {
        success: false,
        error: 'Ticket price must be between $0.10 and $100'
      };
    }

    try {
      // Convert userId to canonical format
      const canonicalUserId = toCanonicalUserId(userId);

      // Use idempotency manager for proper key management
      // If reservation exists, use it as base for key to enable proper retry logic
      const idempotencyKeyBase = reservationId || `purchase-${competitionId}-${Date.now()}`;
      const idempotencyKey = idempotencyKeyManager.getOrCreateKey(idempotencyKeyBase);

      // Build request body with all required parameters
      const requestBody: EdgeFunctionPurchaseRequest = {
        userId: canonicalUserId,
        competition_id: competitionId,
        numberOfTickets: ticketNumbers.length,
        ticketPrice: ticketPrice,
        tickets: ticketNumbers.map(num => ({ ticket_number: num })),
        idempotent: true,
        idempotency_key: idempotencyKey,
        payment_provider: 'base_account',
        type: 'purchase'
      };

      if (reservationId) {
        requestBody.reservation_id = reservationId;
      }

      console.log('[BalancePayment] Purchasing with balance (via proxy):', {
        userId: canonicalUserId.length > 20 ? canonicalUserId.substring(0, 20) + '...' : canonicalUserId,
        competitionId: competitionId.substring(0, 10) + '...',
        ticketCount: ticketNumbers.length,
        ticketPrice: ticketPrice,
        tickets: ticketNumbers,
        reservationId: reservationId || 'none',
        idempotencyKey: idempotencyKey,
        paymentProvider: requestBody.payment_provider,
        type: requestBody.type
      });

      let authHeader = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          authHeader = `Bearer ${session.access_token}`;
        }
      } catch (e) {
        console.warn('[BalancePayment] Could not get auth session:', e);
      }

      // =====================================================
      // SAFEGUARD 3: Client-side retry with exponential backoff
      // Try the proxy up to 3 times before giving up
      // =====================================================
      const MAX_CLIENT_RETRIES = 3;
      let lastProxyError: any = null;
      let proxySuccessData: any = null;

      for (let attempt = 0; attempt < MAX_CLIENT_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          console.log(`[BalancePayment] Proxy retry ${attempt}/${MAX_CLIENT_RETRIES - 1} after ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        }

        try {
          const proxyResponse = await fetch('/api/purchase-with-balance', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authHeader ? { 'Authorization': authHeader } : {}),
            },
            body: JSON.stringify(requestBody),
          });

          let data: any;
          try {
            data = await proxyResponse.json();
          } catch {
            lastProxyError = { message: 'Invalid response from server', statusCode: proxyResponse.status };
            console.warn(`[BalancePayment] Attempt ${attempt + 1}: Invalid JSON response`);
            continue;
          }

          // If we got a non-retriable error (validation, insufficient balance), stop retrying
          if (!proxyResponse.ok && data?.error) {
            const errObj = typeof data.error === 'object' ? data.error : { message: data.error, code: data.error?.code };
            const errCode = errObj.code || '';
            if (errCode === 'INSUFFICIENT_BALANCE' || errCode === 'NO_BALANCE_RECORD' || errCode === 'VALIDATION_ERROR' ||
                proxyResponse.status === 402 || proxyResponse.status === 404) {
              // Non-retriable error - return immediately
              const parsedError = parseError(errObj, proxyResponse.status);
              return {
                success: false,
                error: getUserFriendlyError(parsedError),
                errorDetails: parsedError
              };
            }
            lastProxyError = errObj;
            console.warn(`[BalancePayment] Attempt ${attempt + 1}: HTTP ${proxyResponse.status} - ${errObj.message || 'error'}`);
            continue;
          }

          // Check for success
          if (data && data.status === 'ok') {
            proxySuccessData = data;
            break;
          }

          // Error response format
          if (data && data.status === 'error') {
            lastProxyError = { message: data.error || 'Purchase failed' };
            console.warn(`[BalancePayment] Attempt ${attempt + 1}: Error response - ${data.error}`);
            continue;
          }

          // Unknown response format - might actually be success, check deeper
          if (data && data.success === true) {
            proxySuccessData = data;
            break;
          }

          lastProxyError = { message: 'Invalid response from server' };
          console.warn(`[BalancePayment] Attempt ${attempt + 1}: Unknown response format`, data);
        } catch (fetchErr) {
          lastProxyError = { message: fetchErr instanceof Error ? fetchErr.message : 'Network error' };
          console.warn(`[BalancePayment] Attempt ${attempt + 1}: Fetch error -`, lastProxyError.message);
        }
      }

      // =====================================================
      // SAFEGUARD 4: Direct Supabase RPC fallback
      // If all proxy attempts failed, try calling the RPC directly from client
      // =====================================================
      if (!proxySuccessData) {
        console.warn('[BalancePayment] All proxy attempts failed, trying direct Supabase RPC fallback');

        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc(
            'purchase_tickets_with_balance',
            {
              p_user_identifier: canonicalUserId,
              p_competition_id: competitionId,
              p_ticket_price: ticketPrice,
              p_ticket_count: null,
              p_ticket_numbers: ticketNumbers,
              p_idempotency_key: idempotencyKey,
              p_reservation_id: reservationId || null,
            }
          );

          if (!rpcError && rpcData && rpcData.success) {
            console.log('[BalancePayment] Direct RPC fallback succeeded!');
            // Convert RPC result to proxy format
            proxySuccessData = {
              status: 'ok',
              entry_id: rpcData.entry_id,
              competition_id: rpcData.competition_id || competitionId,
              tickets: (rpcData.ticket_numbers || []).map((num: number) => ({ ticket_number: num })),
              total_cost: rpcData.total_cost,
              new_balance: rpcData.available_balance,
              idempotent: rpcData.idempotent || false,
            };
          } else if (rpcData && !rpcData.success) {
            // RPC returned a business error
            const errCode = rpcData.error_code || '';
            if (errCode === 'INSUFFICIENT_BALANCE' || errCode === 'NO_BALANCE_RECORD') {
              const parsedError = parseError({ message: rpcData.error }, errCode === 'INSUFFICIENT_BALANCE' ? 402 : 404);
              return {
                success: false,
                error: getUserFriendlyError(parsedError),
                errorDetails: parsedError
              };
            }
            console.warn('[BalancePayment] Direct RPC fallback returned error:', rpcData.error);
          } else if (rpcError) {
            console.warn('[BalancePayment] Direct RPC fallback error:', rpcError.message);
          }
        } catch (rpcErr) {
          console.warn('[BalancePayment] Direct RPC fallback exception:', rpcErr);
        }
      }

      // If we still don't have success data, return error
      if (!proxySuccessData) {
        console.error('[BalancePayment] All purchase attempts failed:', lastProxyError);
        const parsedError = parseError(lastProxyError || { message: 'Purchase failed after all attempts' });
        return {
          success: false,
          error: getUserFriendlyError(parsedError),
          errorDetails: parsedError
        };
      }

      // We have success data - transform and return
      const data = proxySuccessData;
      console.log('[BalancePayment] Purchase successful:', {
        competitionId: data.competition_id,
        ticketCount: data.tickets?.length
      });

      const transformedData: PurchaseResponse = {
        payment_id: data.entry_id || 'purchase-' + Date.now() + '-' + crypto.randomUUID(),
        status: 'succeeded',
        amount: String(data.total_cost || ''),
        currency: 'USD',
        new_balance: String(data.new_balance || ''),
        competition_id: data.competition_id,
        tickets: (data.tickets || []).map((t: any, index: number) => ({
          id: data.entry_id ? `${data.entry_id}-${index}` : `ticket-${index}`,
          ticket_number: t.ticket_number
        }))
      };

      // Dispatch balance-updated event
      if (typeof window !== 'undefined' && data.new_balance !== undefined && data.new_balance !== null) {
        window.dispatchEvent(new CustomEvent('balance-updated', {
          detail: {
            newBalance: Number(data.new_balance),
            purchaseAmount: Number(data.total_cost || 0),
            tickets: transformedData.tickets,
            competitionId: data.competition_id
          }
        }));
      }

      // Mark idempotency key as terminal
      idempotencyKeyManager.markTerminal(idempotencyKeyBase);

      return {
        success: true,
        data: transformedData
      };
    } catch (error) {
      console.error('[BalancePayment] Purchase exception:', error);
      const parsedError = parseError(error);
      return {
        success: false,
        error: getUserFriendlyError(parsedError),
        errorDetails: parsedError
      };
    }
  }

  /**
   * Step 3: Verify status (optional)
   * 
   * Read-only status check for a reservation or payment.
   * Use only if the purchase response was lost/uncertain.
   */
  static async verifyPaymentStatus(params: {
    reservationId?: string;
    paymentId?: string;
  }): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    const { reservationId, paymentId } = params;

    if (!reservationId && !paymentId) {
      return {
        success: false,
        error: 'Provide either reservation_id or payment_id'
      };
    }

    try {
      const requestBody: VerifyRequest = {};
      if (reservationId) requestBody.reservation_id = reservationId;
      if (paymentId) requestBody.payment_id = paymentId;

      console.log('[BalancePayment] Verifying status:', requestBody);

      const { data, error } = await supabase.functions.invoke('process-balance-payments', {
        body: requestBody
      });

      if (error) {
        const parsedError = parseError(error);
        console.error('[BalancePayment] Verify error:', parsedError);
        return {
          success: false,
          error: getUserFriendlyError(parsedError)
        };
      }

      console.log('[BalancePayment] Verification result:', data);

      return {
        success: true,
        data
      };
    } catch (error) {
      console.error('[BalancePayment] Verify exception:', error);
      const parsedError = parseError(error);
      return {
        success: false,
        error: getUserFriendlyError(parsedError)
      };
    }
  }

  /**
   * Complete flow: Reserve and Purchase
   * 
   * Convenience method that combines reservation and purchase in one call.
   * Handles the common case of immediate purchase after reservation.
   */
  static async reserveAndPurchase(params: {
    userId: string;
    competitionId: string;
    ticketPrice: number;
    ticketNumbers?: number[];
    ticketCount?: number;
  }): Promise<{
    success: boolean;
    reservationData?: ReservationResponse;
    purchaseData?: PurchaseResponse;
    error?: string;
    step?: 'reserve' | 'purchase';
  }> {
    // Step 1: Reserve
    const reserveResult = await this.reserveTickets(params);
    
    if (!reserveResult.success || !reserveResult.data) {
      return {
        success: false,
        error: reserveResult.error,
        step: 'reserve'
      };
    }

    const reservationData = reserveResult.data;

    // Step 2: Purchase with required parameters
    const purchaseResult = await this.purchaseWithBalance({
      competitionId: params.competitionId,
      ticketNumbers: reservationData.ticket_numbers,
      userId: params.userId,
      ticketPrice: params.ticketPrice
    });

    if (!purchaseResult.success) {
      return {
        success: false,
        reservationData,
        error: purchaseResult.error,
        step: 'purchase'
      };
    }

    return {
      success: true,
      reservationData,
      purchaseData: purchaseResult.data
    };
  }
}

export default BalancePaymentService;
