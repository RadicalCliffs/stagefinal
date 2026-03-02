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
 * Finalize a purchase using the finalize_purchase RPC (PRODUCTION)
 *
 * SQL Function: public.finalize_purchase(p_reservation_id uuid) RETURNS jsonb
 *
 * This finalizes a pending ticket reservation:
 * - Confirms the purchase
 * - Allocates tickets from the reservation
 * - Updates competition_entries and user_transactions
 *
 * @param supabaseClient - Supabase client instance
 * @param params - Finalize parameters
 * @returns Promise with RPC result containing success status and purchase details
 *
 * @example
 * const { data, error } = await finalizePurchase(supabase, {
 *   reservationId: 'uuid-here'
 * });
 *
 * Note: idempotencyKey and ticketCount are no longer used in production.
 * The reservation ID serves as the idempotency key.
 */
export const finalizePurchase = (
  supabaseClient: SupabaseClient,
  params: {
    reservationId: string;
    idempotencyKey?: string; // Kept for backward compatibility but not used
    ticketCount?: number | null; // Kept for backward compatibility but not used
  }
) => {
  const { reservationId } = params;

  // Validate required parameters
  if (!reservationId || typeof reservationId !== 'string' || reservationId.trim() === '') {
    throw new Error('reservationId is required for finalizePurchase');
  }

  // Call production function with only reservation_id
  return supabaseClient.rpc('finalize_purchase', {
    p_reservation_id: reservationId
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
 * SQL Function: public.get_competition_entries(p_competition_id TEXT, p_limit INT, p_offset INT)
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
    p_competition_id: compIdOrUid
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
  
  // Generate idempotency key if not provided - must be UUID format
  // to avoid "invalid input syntax for type uuid" errors in database triggers
  const finalIdempotencyKey = idempotencyKey || crypto.randomUUID();
  
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

/**
 * Get purchase status by idempotency key
 * 
 * SQL Function: public.get_purchase_status_by_key(p_idempotency_key text) RETURNS jsonb
 * 
 * Quick lookup of a previously stored purchase result using the idempotency key.
 * Use this to check if a purchase already succeeded before retrying.
 * 
 * @param supabaseClient - Supabase client instance
 * @param idempotencyKey - The idempotency key to look up
 * @returns Promise with purchase status details
 * 
 * @example
 * const { data, error } = await getPurchaseStatusByKey(supabase, 'uuid-idempotency-key');
 * if (data?.found && data?.result?.success) {
 *   // Purchase already succeeded
 * }
 */
export const getPurchaseStatusByKey = (
  supabaseClient: SupabaseClient,
  idempotencyKey: string
) => {
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new Error('idempotencyKey is required for getPurchaseStatusByKey');
  }

  return supabaseClient.rpc('get_purchase_status_by_key', {
    p_idempotency_key: idempotencyKey
  });
};

/**
 * Verify competition purchase
 * 
 * SQL Function: public.verify_competition_purchase(
 *   p_canonical_user_id text,
 *   p_competition_id text,
 *   p_expected_count int,
 *   p_idempotency_key text DEFAULT NULL,
 *   p_reservation_id uuid DEFAULT NULL
 * ) RETURNS jsonb
 * 
 * Verify if a purchase completed by reading either idempotency table or tickets 
 * ownership as source of truth. Use this to check if tickets were allocated
 * even if the initial purchase response was lost.
 * 
 * @param supabaseClient - Supabase client instance
 * @param params - Verification parameters
 * @returns Promise with verification result
 * 
 * @example
 * const { data, error } = await verifyCompetitionPurchase(supabase, {
 *   canonicalUserId: 'prize:pid:0x...',
 *   competitionId: 'uuid',
 *   expectedCount: 3,
 *   idempotencyKey: 'uuid-key',
 *   reservationId: 'uuid-reservation'
 * });
 * if (data?.meets_expected) {
 *   // Purchase verified!
 * }
 */
export const verifyCompetitionPurchase = (
  supabaseClient: SupabaseClient,
  params: {
    canonicalUserId: string;
    competitionId: string;
    expectedCount: number;
    idempotencyKey?: string;
    reservationId?: string;
  }
) => {
  const { canonicalUserId, competitionId, expectedCount, idempotencyKey, reservationId } = params;

  if (!canonicalUserId || typeof canonicalUserId !== 'string' || canonicalUserId.trim() === '') {
    throw new Error('canonicalUserId is required for verifyCompetitionPurchase');
  }
  if (!competitionId || typeof competitionId !== 'string' || competitionId.trim() === '') {
    throw new Error('competitionId is required for verifyCompetitionPurchase');
  }
  if (typeof expectedCount !== 'number' || expectedCount <= 0) {
    throw new Error('expectedCount must be a positive number for verifyCompetitionPurchase');
  }

  return supabaseClient.rpc('verify_competition_purchase', {
    p_canonical_user_id: canonicalUserId,
    p_competition_id: competitionId,
    p_expected_count: expectedCount,
    p_idempotency_key: idempotencyKey ?? null,
    p_reservation_id: reservationId ?? null
  });
};

/**
 * Rescue purchase attempt
 * 
 * SQL Function: public.rescue_purchase_attempt(
 *   p_user_identifier text,
 *   p_competition_id text,
 *   p_ticket_price numeric,
 *   p_expected_count int,
 *   p_idempotency_key text,
 *   p_reservation_id uuid
 * ) RETURNS jsonb
 * 
 * Safely re-invoke the main purchase RPC using the same idempotency_key and 
 * reservation_id. Use this if verification shows tickets aren't sold yet.
 * This is the final rescue attempt in the retry flow.
 * 
 * @param supabaseClient - Supabase client instance
 * @param params - Rescue parameters
 * @returns Promise with rescue attempt result
 * 
 * @example
 * const { data, error } = await rescuePurchaseAttempt(supabase, {
 *   userIdentifier: 'prize:pid:0x...',
 *   competitionId: 'uuid',
 *   ticketPrice: 1.50,
 *   expectedCount: 3,
 *   idempotencyKey: 'uuid-key',
 *   reservationId: 'uuid-reservation'
 * });
 * if (data?.success) {
 *   // Rescue successful!
 * }
 */
export const rescuePurchaseAttempt = (
  supabaseClient: SupabaseClient,
  params: {
    userIdentifier: string;
    competitionId: string;
    ticketPrice: number;
    expectedCount: number;
    idempotencyKey: string;
    reservationId: string;
  }
) => {
  const { userIdentifier, competitionId, ticketPrice, expectedCount, idempotencyKey, reservationId } = params;

  if (!userIdentifier || typeof userIdentifier !== 'string' || userIdentifier.trim() === '') {
    throw new Error('userIdentifier is required for rescuePurchaseAttempt');
  }
  if (!competitionId || typeof competitionId !== 'string' || competitionId.trim() === '') {
    throw new Error('competitionId is required for rescuePurchaseAttempt');
  }
  if (typeof ticketPrice !== 'number' || ticketPrice <= 0) {
    throw new Error('ticketPrice must be a positive number for rescuePurchaseAttempt');
  }
  if (typeof expectedCount !== 'number' || expectedCount <= 0) {
    throw new Error('expectedCount must be a positive number for rescuePurchaseAttempt');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new Error('idempotencyKey is required for rescuePurchaseAttempt');
  }
  if (!reservationId || typeof reservationId !== 'string' || reservationId.trim() === '') {
    throw new Error('reservationId is required for rescuePurchaseAttempt');
  }

  return supabaseClient.rpc('rescue_purchase_attempt', {
    p_user_identifier: userIdentifier,
    p_competition_id: competitionId,
    p_ticket_price: ticketPrice,
    p_expected_count: expectedCount,
    p_idempotency_key: idempotencyKey,
    p_reservation_id: reservationId
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
  finalizePurchase,
  getPurchaseStatusByKey,
  verifyCompetitionPurchase,
  rescuePurchaseAttempt
};
