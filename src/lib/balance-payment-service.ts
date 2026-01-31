/**
 * Balance Payment Service
 * 
 * Simplified balance payment system that uses the straightforward RPC flow:
 * 1. Optional: Reserve tickets via POST /functions/v1/reserve-tickets (for frontend UX)
 * 2. Purchase with balance via POST /functions/v1/purchase-tickets-with-bonus
 *    - This calls purchase_tickets_with_balance RPC which:
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
 */
function generateIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
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
      const idempotencyKey = generateIdempotencyKey(`reserve-${userId}-${competitionId}`);

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
   * Uses the simplified purchase-tickets-with-bonus edge function which calls
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
    const { competitionId, ticketNumbers, userId, ticketPrice } = params;

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

    if (ticketPrice === null || ticketPrice === undefined || ticketPrice <= 0) {
      return {
        success: false,
        error: 'Valid ticket price is required'
      };
    }

    try {
      // Convert userId to canonical format
      const canonicalUserId = toCanonicalUserId(userId);
      
      // Build request body with all required parameters
      // The edge function expects: userId/walletAddress, competitionId, numberOfTickets, ticketPrice, tickets
      const requestBody = {
        userId: canonicalUserId,
        competition_id: competitionId,
        numberOfTickets: ticketNumbers.length,
        ticketPrice: ticketPrice,
        tickets: ticketNumbers.map(num => ({ ticket_number: num })),
        idempotent: true
      };

      console.log('[BalancePayment] Purchasing with balance (simplified system):', { 
        userId: canonicalUserId.substring(0, 20) + '...',
        competitionId: competitionId.substring(0, 10) + '...',
        ticketCount: ticketNumbers.length,
        ticketPrice: ticketPrice,
        tickets: ticketNumbers
      });

      const { data, error } = await supabase.functions.invoke('purchase-tickets-with-bonus', {
        body: requestBody
      });

      // CRITICAL: Log the full response for debugging
      console.log('[BalancePayment] Edge function response:', {
        hasData: !!data,
        hasError: !!error,
        dataKeys: data ? Object.keys(data) : [],
        dataStatus: data?.status,
        dataError: data?.error,
        errorMessage: error?.message,
        fullData: data,
        fullError: error
      });

      if (error) {
        const parsedError = parseError(error);
        console.error('[BalancePayment] Purchase error:', parsedError);
        return {
          success: false,
          error: getUserFriendlyError(parsedError),
          errorDetails: parsedError
        };
      }

      // Check for error response format: { status: 'error', error, errorCode }
      if (data && data.status === 'error') {
        console.error('[BalancePayment] Purchase failed - error response:', {
          error: data.error,
          errorCode: data.errorCode
        });
        return {
          success: false,
          error: data.error || 'Purchase failed'
        };
      }

      // Check for success response format: { status: 'ok', competition_id, tickets, idempotent }
      if (!data || data.status !== 'ok') {
        console.error('[BalancePayment] Purchase failed - invalid response:', {
          hasData: !!data,
          status: data?.status,
          fullResponse: data
        });
        return {
          success: false,
          error: 'Invalid response from server'
        };
      }

      console.log('[BalancePayment] Purchase successful:', {
        competitionId: data.competition_id,
        ticketCount: data.tickets?.length
      });

      // Transform response to match PurchaseResponse interface
      // The simplified system returns: { status: 'ok', competition_id, tickets, entry_id, total_cost, new_balance }
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

      // Dispatch balance-updated event for UI refresh with balance data
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
