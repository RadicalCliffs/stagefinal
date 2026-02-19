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
 * Request body for /api/purchase-with-balance (Netlify proxy)
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
  
  /** Explicit idempotency key for proper tracking and retry behavior */
  idempotency_key?: string;
  
  /** Payment provider for balance_ledger tracking (e.g., 'base_account', 'coinbase', 'balance') */
  payment_provider?: string;
  
  /** Transaction type for balance_ledger (e.g., 'purchase', 'entry', 'topup') */
  type?: string;
}

/**
 * Success response from /api/purchase-with-balance (Netlify proxy)
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
  
  /** User's previous balance before purchase in USD */
  previous_balance?: number;
  
  /** Whether this was an idempotent request */
  idempotent: boolean;
  
  /** Reservation ID that was used for this purchase (if any) */
  used_reservation_id?: string;
  
  /** Number of tickets upgraded from reservation */
  used_reserved_count?: number;
  
  /** Number of tickets topped up from available pool */
  topped_up_count?: number;
  
  /** Note describing the purchase source: reserved_upgraded | topped_up_from_available | reserved_upgraded_and_topped_up | lucky_dip_only */
  note?: string;
}

/**
 * Error response from /api/purchase-with-balance (Netlify proxy)
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
 * Response from get_purchase_status_by_key RPC
 */
export interface PurchaseStatusByKeyResponse {
  /** Whether a purchase result was found for this idempotency key */
  found: boolean;
  
  /** The stored purchase result (if found) */
  result?: any;
  
  /** When the purchase was created */
  created_at?: string;
  
  /** Reservation ID associated with the purchase */
  reservation_id?: string;
  
  /** Canonical user ID who made the purchase */
  canonical_user_id?: string;
  
  /** Competition ID for the purchase */
  competition_id?: string;
}

/**
 * Response from verify_competition_purchase RPC
 */
export interface VerifyCompetitionPurchaseResponse {
  /** Whether verification succeeded */
  success: boolean;
  
  /** Source of verification: "idempotency" or "tickets" */
  source: 'idempotency' | 'tickets';
  
  /** Purchase data if verified from idempotency table */
  data?: any;
  
  /** Ticket numbers if verified from tickets table */
  ticket_numbers?: number[];
  
  /** Number of tickets found */
  ticket_count: number;
  
  /** Whether the found count meets the expected count */
  meets_expected?: boolean | null;
}

/**
 * Response from rescue_purchase_attempt RPC
 */
export interface RescuePurchaseAttemptResponse {
  /** Whether the rescue attempt succeeded */
  success: boolean;
  
  /** Error code if rescue failed */
  error_code?: string;
  
  /** Error message if rescue failed */
  error?: string;
  
  /** Entry ID if successful */
  entry_id?: string;
  
  /** Ticket numbers allocated */
  ticket_numbers?: number[];
  
  /** Number of tickets */
  ticket_count?: number;
  
  /** Total cost of purchase */
  total_cost?: number;
  
  /** User's balance after purchase */
  available_balance?: number;
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
