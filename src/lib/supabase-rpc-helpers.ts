/**
 * Supabase RPC Helpers
 *
 * Centralized helpers for calling Supabase RPC functions with proper parameter names.
 * These helpers ensure that all RPC calls use the exact parameter names defined in SQL,
 * preventing 404/42883 errors from parameter mismatches.
 *
 * CRITICAL: Always pass non-empty parameter objects matching SQL function signatures exactly.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Finalize a purchase using the finalize_purchase2 RPC
 *
 * SQL Function: public.finalize_purchase2(p_reservation_id uuid, p_idempotency_key text, p_ticket_count int default null)
 *
 * This is the preferred method for balance payments as it:
 * - Is idempotent (same key = same result, no double-charges)
 * - Auto-allocates tickets from available inventory if needed
 * - Handles partial failures gracefully by topping up from available tickets
 * - Updates competition_entries and user_transactions atomically
 * - Stores and returns results for retrieval on retry
 *
 * @param supabaseClient - Supabase client instance
 * @param params - Finalize parameters
 * @returns Promise with RPC result containing success status and purchase details
 *
 * @example
 * const { data, error } = await finalizePurchase(supabase, {
 *   reservationId: 'uuid-here',
 *   idempotencyKey: 'uuid-or-payment-session-id',
 *   ticketCount: 5 // optional but recommended
 * });
 *
 * if (data?.success) {
 *   // data contains: entry_id, tickets_created[], total_cost, balance_before, balance_after, competition_id
 * } else {
 *   // data.error is a human-readable message
 * }
 */
export const finalizePurchase = (
  supabaseClient: SupabaseClient,
  params: {
    reservationId: string;
    idempotencyKey: string;
    ticketCount?: number | null;
  }
) => {
  const { reservationId, idempotencyKey, ticketCount } = params;

  // Validate required parameters
  if (!reservationId || typeof reservationId !== 'string' || reservationId.trim() === '') {
    throw new Error('reservationId is required for finalizePurchase');
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new Error('idempotencyKey is required for finalizePurchase');
  }

  return supabaseClient.rpc('finalize_purchase2', {
    p_reservation_id: reservationId,
    p_idempotency_key: idempotencyKey,
    p_ticket_count: ticketCount ?? null
  });
};

/**
 * Get user's comprehensive dashboard entries
 *
 * SQL Function: public.get_comprehensive_user_dashboard_entries(params jsonb)
 * Uses jsonb params to support both user_identifier and userId keys
 *
 * @param supabaseClient - Supabase client instance
 * @param canonicalId - User identifier (prize:pid:0x..., 0x wallet, canonical_user_id, or privy_user_id)
 * @returns Promise with RPC result containing user entries
 *
 * @example
 * const { data, error } = await getDashboardEntries(supabase, 'prize:pid:0x2137af5047526a1180...');
 */
export const getDashboardEntries = (
  supabaseClient: SupabaseClient,
  canonicalId: string
) => {
  if (!canonicalId || typeof canonicalId !== 'string' || canonicalId.trim() === '') {
    throw new Error('canonicalId is required for getDashboardEntries');
  }

  // Use correct parameter name: p_user_identifier (not wrapped in params object)
  return supabaseClient.rpc('get_comprehensive_user_dashboard_entries', {
    p_user_identifier: canonicalId
  });
};

/**
 * Get competition entries (by competition id or uid)
 * 
 * SQL Function: public.get_competition_entries(competition_identifier TEXT)
 * 
 * @param supabaseClient - Supabase client instance
 * @param compIdOrUid - Competition UUID or UID
 * @returns Promise with RPC result containing competition entries
 * 
 * @example
 * const { data, error } = await getCompetitionEntries(supabase, '88f3467c-747e-4231-bb2e-1869e227bb85');
 */
export const getCompetitionEntries = (
  supabaseClient: SupabaseClient,
  compIdOrUid: string
) => {
  if (!compIdOrUid || typeof compIdOrUid !== 'string' || compIdOrUid.trim() === '') {
    throw new Error('compIdOrUid is required for getCompetitionEntries');
  }
  
  return supabaseClient.rpc('get_competition_entries', {
    competition_identifier: compIdOrUid
  });
};

/**
 * Get ticket availability (text-friendly)
 * 
 * SQL Function: public.get_competition_ticket_availability_text(competition_id_text TEXT)
 * 
 * @param supabaseClient - Supabase client instance
 * @param compIdOrUid - Competition UUID or UID
 * @returns Promise with RPC result containing availability info
 * 
 * @example
 * const { data, error } = await getAvailability(supabase, '88f3467c-747e-4231-bb2e-1869e227bb85');
 */
export const getAvailability = (
  supabaseClient: SupabaseClient,
  compIdOrUid: string
) => {
  if (!compIdOrUid || typeof compIdOrUid !== 'string' || compIdOrUid.trim() === '') {
    throw new Error('compIdOrUid is required for getAvailability');
  }
  
  return supabaseClient.rpc('get_competition_ticket_availability_text', {
    competition_id_text: compIdOrUid
  });
};

/**
 * Get unavailable tickets (used in availability calc)
 * 
 * SQL Function: public.get_unavailable_tickets(p_competition_id TEXT)
 * 
 * @param supabaseClient - Supabase client instance
 * @param compIdOrUid - Competition UUID or UID
 * @returns Promise with RPC result containing unavailable ticket numbers
 * 
 * @example
 * const { data, error } = await getUnavailableTickets(supabase, '88f3467c-747e-4231-bb2e-1869e227bb85');
 */
export const getUnavailableTickets = (
  supabaseClient: SupabaseClient,
  compIdOrUid: string
) => {
  if (!compIdOrUid || typeof compIdOrUid !== 'string' || compIdOrUid.trim() === '') {
    throw new Error('compIdOrUid is required for getUnavailableTickets');
  }
  
  return supabaseClient.rpc('get_unavailable_tickets', {
    p_competition_id: compIdOrUid
  });
};

/**
 * Get a user's entries for a specific competition (e.g., post-purchase confirmation)
 *
 * SQL Function: public.get_user_competition_entries(p_user_identifier TEXT)
 *
 * Returns: id, competition_id, user_id, canonical_user_id, wallet_address, ticket_numbers,
 *          ticket_count, amount_paid, currency, transaction_hash, payment_provider,
 *          entry_status, is_winner, prize_claimed, created_at, updated_at,
 *          competition_title, competition_description, competition_image_url,
 *          competition_status, competition_end_date, competition_prize_value, competition_is_instant_win
 *
 * @param supabaseClient - Supabase client instance
 * @param userIdentifier - User identifier (prize:pid:0x..., 0x wallet, canonical_user_id, or privy_user_id)
 * @returns Promise with RPC result containing user's competition entries
 *
 * @example
 * // Get all entries for a user
 * const { data, error } = await getUserCompetitionEntries(supabase, 'prize:pid:0x2137af5047526a1180...');
 */
export const getUserCompetitionEntries = (
  supabaseClient: SupabaseClient,
  userIdentifier: string
) => {
  if (!userIdentifier || typeof userIdentifier !== 'string' || userIdentifier.trim() === '') {
    throw new Error('userIdentifier is required for getUserCompetitionEntries');
  }

  // The SQL function expects p_user_identifier parameter
  return supabaseClient.rpc('get_user_competition_entries', {
    p_user_identifier: userIdentifier
  });
};

/**
 * Execute balance payment using the unified RPC
 * 
 * SQL Function: public.execute_balance_payment(
 *   p_competition_id TEXT,
 *   p_user_identifier TEXT,
 *   p_amount NUMERIC,
 *   p_ticket_count INTEGER,
 *   p_selected_tickets INTEGER[],
 *   p_idempotency_key TEXT,
 *   p_reservation_id UUID
 * )
 * 
 * @param params - Payment parameters
 * @returns Promise with RPC result containing payment details
 * 
 * @example
 * const { data, error } = await executeBalancePayment(supabase, {
 *   competitionId: '88f3467c-747e-4231-bb2e-1869e227bb85',
 *   userIdentifier: 'prize:pid:0x2137af5047526a1180...',
 *   amount: 10.50,
 *   ticketCount: 5,
 *   selectedTickets: [1, 2, 3, 4, 5],
 *   idempotencyKey: 'uuid-v4-here',
 *   reservationId: 'reservation-uuid-here'
 * });
 */
export const executeBalancePayment = (
  supabaseClient: SupabaseClient,
  params: {
    competitionId: string;
    userIdentifier: string;
    amount: number;
    ticketCount: number;
    selectedTickets?: number[] | null;
    idempotencyKey?: string;
    reservationId?: string | null;
  }
) => {
  const {
    competitionId,
    userIdentifier,
    amount,
    ticketCount,
    selectedTickets,
    idempotencyKey,
    reservationId
  } = params;
  
  // Validate required parameters
  if (!competitionId || typeof competitionId !== 'string' || competitionId.trim() === '') {
    throw new Error('competitionId is required for executeBalancePayment');
  }
  
  if (!userIdentifier || typeof userIdentifier !== 'string' || userIdentifier.trim() === '') {
    throw new Error('userIdentifier is required for executeBalancePayment');
  }
  
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number for executeBalancePayment');
  }
  
  if (!Number.isFinite(ticketCount) || ticketCount <= 0) {
    throw new Error('ticketCount must be a positive integer for executeBalancePayment');
  }
  
  // Generate idempotency key if not provided
  const finalIdempotencyKey = idempotencyKey || 
    `${userIdentifier.substring(0, 20)}-${competitionId.substring(0, 8)}-${Date.now()}`;
  
  return supabaseClient.rpc('execute_balance_payment', {
    p_competition_id: competitionId,
    p_user_identifier: userIdentifier,
    p_amount: amount,
    p_ticket_count: ticketCount,
    p_selected_tickets: selectedTickets ?? null,
    p_idempotency_key: finalIdempotencyKey,
    p_reservation_id: reservationId ?? null
  });
};

// Export a default object with all helpers for convenience
export default {
  getDashboardEntries,
  getCompetitionEntries,
  getAvailability,
  getUnavailableTickets,
  getUserCompetitionEntries,
  executeBalancePayment,
  finalizePurchase
};
