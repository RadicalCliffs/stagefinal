/**
 * TypeScript Types for Purchase Tickets with Balance
 * 
 * Import these types in your frontend code for type safety:
 * 
 * ```typescript
 * import type { 
 *   PurchaseTicketsRequest,
 *   PurchaseTicketsResponse
 * } from '@/types/purchase-tickets';
 * ```
 */

/**
 * Request body for purchase-tickets-with-bonus edge function
 */
export interface PurchaseTicketsRequest {
  /** Canonical user ID (required) - use toCanonicalUserId() to convert */
  userId: string;
  
  /** Competition UUID (required) */
  competition_id: string;
  
  /** Total number of tickets being purchased (required) */
  numberOfTickets: number;
  
  /** Price per ticket in USD (required) */
  ticketPrice: number;
  
  /** Array of ticket objects with ticket numbers (required) */
  tickets: Array<{
    ticket_number: number;
  }>;
  
  /** Enable idempotency protection (recommended: true) */
  idempotent: boolean;
  
  /** Optional: reservation ID from prior reserve-tickets call */
  reservation_id?: string;
}

/**
 * Success response from purchase-tickets-with-bonus edge function
 */
export interface PurchaseTicketsSuccessResponse {
  /** Status indicator - 'ok' for success */
  status: 'ok';
  
  /** Competition UUID */
  competition_id: string;
  
  /** Array of purchased tickets */
  tickets: Array<{
    ticket_number: number;
  }>;
  
  /** Entry ID for tracking this purchase */
  entry_id: string;
  
  /** Total cost of the purchase in USD */
  total_cost: number;
  
  /** User's new balance after purchase in USD */
  new_balance: number;
  
  /** Whether this was an idempotent request */
  idempotent: boolean;
}

/**
 * Error response from purchase-tickets-with-bonus edge function
 */
export interface PurchaseTicketsErrorResponse {
  /** Status indicator - 'error' for failures */
  status: 'error';
  
  /** Human-readable error message */
  error: string;
  
  /** HTTP status code */
  errorCode: number;
}

/**
 * Union type for all possible responses
 */
export type PurchaseTicketsResponse = 
  | PurchaseTicketsSuccessResponse 
  | PurchaseTicketsErrorResponse;

/**
 * Type guard to check if response is an error
 */
export function isPurchaseError(
  response: PurchaseTicketsResponse
): response is PurchaseTicketsErrorResponse {
  return response.status === 'error';
}

/**
 * Type guard to check if response is success
 */
export function isPurchaseSuccess(
  response: PurchaseTicketsResponse
): response is PurchaseTicketsSuccessResponse {
  return response.status === 'ok';
}

/**
 * Result wrapper with typed error handling
 */
export interface PurchaseResult<T = PurchaseTicketsSuccessResponse> {
  success: boolean;
  data?: T;
  error?: string;
  errorDetails?: {
    statusCode: number;
    message: string;
    type: 'validation' | 'conflict' | 'expired' | 'insufficient_balance' | 'not_found' | 'network' | 'unknown';
  };
}

/**
 * Options for purchaseWithBalance service method
 */
export interface PurchaseWithBalanceOptions {
  /** Competition UUID (required) */
  competitionId: string;
  
  /** Array of specific ticket numbers to purchase (required) */
  ticketNumbers: number[];
  
  /** User identifier (required) */
  userId: string;
  
  /** Price per ticket in USD (required) */
  ticketPrice: number;
  
  /** Optional: reservation ID from prior reservation */
  reservationId?: string;
  
  /** Optional: ticket count (for backwards compatibility) */
  ticketCount?: number;
}

/**
 * Options for reserveTickets service method
 */
export interface ReserveTicketsOptions {
  /** User identifier (required) */
  userId: string;
  
  /** Competition UUID (required) */
  competitionId: string;
  
  /** Optional: specific ticket numbers to reserve */
  ticketNumbers?: number[];
  
  /** Optional: number of tickets to auto-select */
  ticketCount?: number;
}

/**
 * Reservation response
 */
export interface ReservationResponse {
  reservation_id: string;
  competition_id: string;
  ticket_numbers: number[];
  ticket_count: number;
  ticket_price: string;
  total_amount: string;
  expires_at: string;
}

/**
 * Example usage:
 * 
 * ```typescript
 * import type { 
 *   PurchaseWithBalanceOptions, 
 *   PurchaseResult 
 * } from '@/types/purchase-tickets';
 * 
 * async function handlePurchase(
 *   options: PurchaseWithBalanceOptions
 * ): Promise<PurchaseResult> {
 *   const result = await BalancePaymentService.purchaseWithBalance(options);
 *   
 *   if (result.success && result.data) {
 *     console.log('New balance:', result.data.new_balance);
 *     console.log('Tickets:', result.data.tickets);
 *   } else {
 *     console.error('Error:', result.error);
 *   }
 *   
 *   return result;
 * }
 * ```
 */
