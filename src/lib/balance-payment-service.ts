/**
 * Balance Payment Service
 * 
 * Implements the new 3-endpoint flow for balance-funded ticket purchases:
 * 1. Reserve tickets via POST /functions/v1/reserve-tickets
 * 2. Purchase with balance via POST /functions/v1/purchase-tickets-with-bonus
 * 3. Verify status (optional) via POST /functions/v1/process-balance-payments
 * 
 * This replaces all previous balance payment logic and omnipotent data service checks.
 * Keep it simple, use the exact flow.
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
   * Step 2: Purchase with balance
   * 
   * Deducts balance, marks tickets as paid, and finalizes reservation.
   * Best practice: Pass all required data directly to avoid backend lookups.
   * 
   * @param params.reservationId - Reservation UUID from the reserve step
   * @param params.competitionId - Competition UUID (recommended for reliability)
   * @param params.userId - User identifier (recommended for reliability)
   * @param params.ticketNumbers - Specific ticket numbers (recommended for reliability)
   * @param params.ticketCount - Number of tickets (recommended for reliability)
   * @param params.ticketPrice - Price per ticket (recommended for reliability)
   * @returns Promise with purchase data including tickets, new balance, and payment ID
   */
  static async purchaseWithBalance(params: {
    reservationId: string;
    competitionId?: string;
    userId?: string;
    ticketNumbers?: number[];
    ticketCount?: number;
    ticketPrice?: number;
  }): Promise<{
    success: boolean;
    data?: PurchaseResponse;
    error?: string;
    errorDetails?: BalancePaymentError;
  }> {
    const { reservationId, competitionId, userId, ticketNumbers, ticketCount, ticketPrice } = params;

    if (!reservationId) {
      return {
        success: false,
        error: 'Reservation ID is required'
      };
    }

    try {
      const idempotencyKey = generateIdempotencyKey(`purchase-${reservationId}`);

      // Best practice: include all required data directly in the request
      const requestBody: PurchaseRequest = {
        reservation_id: reservationId,
        idempotency_key: idempotencyKey
      };

      // Add optional but recommended fields for reliability
      if (competitionId) {
        requestBody.competition_id = competitionId;
      }
      if (userId) {
        requestBody.canonical_user_id = toCanonicalUserId(userId);
      }
      if (ticketNumbers && ticketNumbers.length > 0) {
        requestBody.ticket_numbers = ticketNumbers;
      }
      if (ticketCount !== undefined && ticketCount > 0) {
        requestBody.ticket_count = ticketCount;
      }
      if (ticketPrice !== undefined && ticketPrice > 0) {
        requestBody.ticket_price = ticketPrice;
      }

      console.log('[BalancePayment] Purchasing with balance:', { 
        reservationId,
        hasCompetitionId: !!competitionId,
        hasUserId: !!userId,
        ticketCount: ticketNumbers?.length || ticketCount,
        requestBody: {
          ...requestBody,
          canonical_user_id: requestBody.canonical_user_id?.substring(0, 20) + '...'
        }
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

      if (!data || data.status !== 'succeeded') {
        console.error('[BalancePayment] Purchase failed - invalid response:', {
          hasData: !!data,
          status: data?.status,
          error: data?.error,
          errorCode: data?.errorCode,
          fullResponse: data
        });
        return {
          success: false,
          error: data?.error || 'Purchase failed'
        };
      }

      console.log('[BalancePayment] Purchase successful:', data.payment_id);

      // Dispatch balance-updated event for UI refresh
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('balance-updated', {
          detail: {
            newBalance: data.new_balance,
            purchaseAmount: data.amount,
            tickets: data.tickets,
            competitionId: data.competition_id
          }
        }));
      }

      return {
        success: true,
        data: data as PurchaseResponse
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

    // Step 2: Purchase
    const purchaseResult = await this.purchaseWithBalance({
      reservationId: reservationData.reservation_id
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
