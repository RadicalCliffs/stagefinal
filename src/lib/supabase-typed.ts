/**
 * Type-safe Supabase API wrappers
 * 
 * This module provides fully typed wrappers for Supabase views and RPC functions.
 * All functions use the generated Database types for compile-time safety.
 * 
 * Environment setup (Vite + React + Netlify):
 * - Local: Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env
 * - Netlify: Add same variables in Site settings → Environment variables
 * - Restart dev server after .env changes
 */

import { supabase } from '@/lib/supabase';
import type { Database } from '@/supabase/types';

// ============================================================================
// Type Aliases for Better Ergonomics
// ============================================================================

/** Row type for the v_joincompetition_active view */
export type ActiveEntry = Database['public']['Views']['v_joincompetition_active']['Row'];

/** Arguments for reserve_tickets RPC */
export type ReserveTicketsArgs = Database['public']['Functions']['reserve_tickets']['Args'];

/** Return type for reserve_tickets RPC */
export type ReserveTicketsReturn = Database['public']['Functions']['reserve_tickets']['Returns'];

/** Arguments for finalize_order RPC */
export type FinalizeOrderArgs = Database['public']['Functions']['finalize_order']['Args'];

/** Return type for finalize_order RPC */
export type FinalizeOrderReturn = Database['public']['Functions']['finalize_order']['Returns'];

/** Arguments for release_reservation RPC */
export type ReleaseReservationArgs = Database['public']['Functions']['release_reservation']['Args'];

/** Return type for release_reservation RPC */
export type ReleaseReservationReturn = Database['public']['Functions']['release_reservation']['Returns'];

/** Arguments for get_unavailable_tickets RPC */
export type GetUnavailableTicketsArgs = Database['public']['Functions']['get_unavailable_tickets']['Args'];

/** Return type for get_unavailable_tickets RPC */
export type GetUnavailableTicketsReturn = Database['public']['Functions']['get_unavailable_tickets']['Returns'];

/** Arguments for get_user_tickets_for_competition RPC */
export type GetUserTicketsArgs = Database['public']['Functions']['get_user_tickets_for_competition']['Args'];

/** Return type for get_user_tickets_for_competition RPC */
export type GetUserTicketsReturn = Database['public']['Functions']['get_user_tickets_for_competition']['Returns'];

// ============================================================================
// Detailed Return Type Interfaces
// ============================================================================

/** Structure of reserve_tickets RPC response (JSONB) */
export interface ReserveTicketsResponse {
  success?: boolean;
  reservation_id?: string;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

/** Structure of finalize_order RPC response (JSONB) */
export interface FinalizeOrderResponse {
  success?: boolean;
  order_id?: string;
  transaction_id?: string;
  amount_charged?: number;
  ticket_count?: number;
  remaining_balance?: number;
  already_confirmed?: boolean;
  error?: string;
  message?: string;
  balance?: number;
  required?: number;
  [key: string]: unknown;
}

/** Structure of release_reservation RPC response (JSONB) */
export interface ReleaseReservationResponse {
  success?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

// ============================================================================
// View: v_joincompetition_active
// ============================================================================

/**
 * Fetch active competition entries by user identifier
 * 
 * @param userIdentifier - Can be canonical_user_id (prize:pid:0x...) or wallet address (0x...)
 * @returns Array of active entries for the user
 * @throws Error if the query fails
 */
export async function getActiveEntriesByUser(userIdentifier: string): Promise<ActiveEntry[]> {
  // Validate user identifier to prevent injection
  if (!userIdentifier || typeof userIdentifier !== 'string') {
    throw new Error('Invalid user identifier');
  }

  const { data, error } = await supabase
    .from('v_joincompetition_active')
    .select('*')
    .or(`userid.eq."${userIdentifier.replace(/"/g, '""')}",walletaddress.eq."${userIdentifier.replace(/"/g, '""')}"`)
    .order('purchasedate', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch active competition entries by competition UID
 * 
 * @param competitionUid - The competition's unique identifier
 * @returns Array of active entries for the competition
 * @throws Error if the query fails
 */
export async function getActiveEntriesByCompetition(competitionUid: string): Promise<ActiveEntry[]> {
  const { data, error } = await supabase
    .from('v_joincompetition_active')
    .select('*')
    .eq('competitionid', competitionUid)
    .order('purchasedate', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ============================================================================
// RPC: reserve_tickets
// ============================================================================

/**
 * Reserve tickets for a competition
 * 
 * Creates a temporary reservation that holds the specified ticket numbers
 * for a limited time (holdMinutes). The reservation must be finalized with
 * finalize_order() before it expires.
 * 
 * @param params - Reservation parameters
 * @param params.competitionId - Competition UUID
 * @param params.ticketNumbers - Array of ticket numbers to reserve
 * @param params.userIdentifier - User's canonical ID or wallet address
 * @param params.holdMinutes - How long to hold the reservation (default: 15)
 * @returns Reservation details including reservation_id
 * @throws Error if the RPC call fails
 */
export async function reserveTickets(params: {
  competitionId: string;
  ticketNumbers: number[];
  userIdentifier: string;
  holdMinutes?: number;
}): Promise<ReserveTicketsResponse> {
  const { data, error } = await supabase.rpc('reserve_tickets', {
    p_competition_id: params.competitionId,
    p_ticket_numbers: params.ticketNumbers,
    p_user_id: params.userIdentifier,
    p_hold_minutes: params.holdMinutes ?? 15,
  } satisfies ReserveTicketsArgs);

  if (error) throw error;
  return (data ?? {}) as ReserveTicketsResponse;
}

// ============================================================================
// RPC: finalize_order
// ============================================================================

/**
 * Finalize a ticket reservation
 * 
 * Atomically:
 * 1. Verifies the reservation is valid and not expired
 * 2. Calculates total amount (unitPrice × ticket count)
 * 3. Deducts balance from user's wallet
 * 4. Creates order, tickets, and transaction records
 * 5. Marks reservation as confirmed
 * 
 * @param params - Order finalization parameters
 * @param params.reservationId - The reservation ID from reserve_tickets()
 * @param params.userIdentifier - User's canonical ID or wallet address
 * @param params.competitionId - Competition UUID
 * @param params.unitPrice - Price per ticket (numeric)
 * @returns Result with success flag and order details
 * @throws Error if the RPC call fails
 */
export async function finalizeOrder(params: {
  reservationId: string;
  userIdentifier: string;
  competitionId: string;
  unitPrice: number;
}): Promise<FinalizeOrderResponse> {
  const { data, error } = await supabase.rpc('finalize_order', {
    p_reservation_id: params.reservationId,
    p_user_id: params.userIdentifier,
    p_competition_id: params.competitionId,
    p_unit_price: params.unitPrice,
  } satisfies FinalizeOrderArgs);

  if (error) throw error;
  return (data ?? {}) as FinalizeOrderResponse;
}

// ============================================================================
// RPC: release_reservation
// ============================================================================

/**
 * Cancel a pending ticket reservation
 * 
 * Releases a pending reservation so the tickets become available again.
 * Only works on reservations in 'pending' status.
 * 
 * @param params - Cancellation parameters
 * @param params.reservationId - The reservation ID to cancel
 * @param params.userIdentifier - User's canonical ID or wallet address
 * @returns Result with success flag
 * @throws Error if the RPC call fails
 */
export async function releaseReservation(params: {
  reservationId: string;
  userIdentifier: string;
}): Promise<ReleaseReservationResponse> {
  const { data, error } = await supabase.rpc('release_reservation', {
    p_reservation_id: params.reservationId,
    p_user_id: params.userIdentifier,
  } satisfies ReleaseReservationArgs);

  if (error) throw error;
  return (data ?? {}) as ReleaseReservationResponse;
}

// ============================================================================
// RPC: get_unavailable_tickets
// ============================================================================

/**
 * Get unavailable ticket numbers for a competition
 * 
 * Returns an array of ticket numbers that are already sold, reserved, or
 * otherwise unavailable for purchase.
 * 
 * @param competitionId - Competition UUID or UID
 * @returns Array of unavailable ticket numbers
 * @throws Error if the RPC call fails
 */
export async function getUnavailableTickets(competitionId: string): Promise<number[]> {
  const { data, error } = await supabase.rpc('get_unavailable_tickets', {
    p_competition_id: competitionId,
  } satisfies GetUnavailableTicketsArgs);

  if (error) throw error;
  return data ?? [];
}

// ============================================================================
// RPC: get_user_tickets_for_competition
// ============================================================================

/**
 * Get user's tickets for a specific competition
 * 
 * Returns detailed information about all tickets the user owns for a competition,
 * including ticket numbers, purchase source, timestamps, and wallet addresses.
 * 
 * @param competitionId - Competition UUID or UID
 * @param userIdentifier - User's canonical ID or wallet address
 * @returns Array of ticket details
 * @throws Error if the RPC call fails
 */
export async function getUserTicketsForCompetition(
  competitionId: string,
  userIdentifier: string
): Promise<GetUserTicketsReturn> {
  const { data, error } = await supabase.rpc('get_user_tickets_for_competition', {
    competition_id: competitionId,
    user_id: userIdentifier,
  } satisfies GetUserTicketsArgs);

  if (error) throw error;
  return data ?? [];
}

// ============================================================================
// End-to-End Purchase Flow
// ============================================================================

/**
 * Complete end-to-end ticket purchase with wallet balance
 * 
 * This is a convenience function that combines reserve → finalize in one call.
 * It handles the full purchase flow:
 * 1. Reserves the specified tickets
 * 2. Finalizes the order (deducts balance, creates records)
 * 3. Returns the result
 * 
 * If finalization fails, you may want to call releaseReservation() to free
 * the tickets, depending on your business logic.
 * 
 * @param params - Purchase parameters
 * @param params.competitionId - Competition UUID
 * @param params.ticketNumbers - Array of ticket numbers to purchase
 * @param params.unitPrice - Price per ticket
 * @param params.userIdentifier - User's canonical ID or wallet address
 * @returns Finalization result with order details
 * @throws Error if reservation or finalization fails
 * 
 * @example
 * ```typescript
 * try {
 *   const result = await purchaseTicketsWithBalance({
 *     competitionId: 'comp-uuid',
 *     ticketNumbers: [1, 2, 3],
 *     unitPrice: 5.0,
 *     userIdentifier: 'prize:pid:0xabc...'
 *   });
 *   
 *   if (result.success) {
 *     console.log('Order ID:', result.order_id);
 *   }
 * } catch (error) {
 *   console.error('Purchase failed:', error);
 * }
 * ```
 */
export async function purchaseTicketsWithBalance(params: {
  competitionId: string;
  ticketNumbers: number[];
  unitPrice: number;
  userIdentifier: string;
}): Promise<FinalizeOrderResponse> {
  // Step 1: Reserve tickets
  const reservation = await reserveTickets({
    competitionId: params.competitionId,
    ticketNumbers: params.ticketNumbers,
    userIdentifier: params.userIdentifier,
    holdMinutes: 15,
  });

  // Check if reservation succeeded
  if (!reservation.reservation_id) {
    throw new Error(reservation.error || 'Failed to reserve tickets');
  }

  // Step 2: Finalize the order
  const result = await finalizeOrder({
    reservationId: reservation.reservation_id,
    userIdentifier: params.userIdentifier,
    competitionId: params.competitionId,
    unitPrice: params.unitPrice,
  });

  // Check if finalization succeeded
  if (!result.success) {
    // Optional: Release the reservation on failure
    // await releaseReservation({
    //   reservationId: reservation.reservation_id,
    //   userIdentifier: params.userIdentifier
    // });
    
    throw new Error(result.error || 'Failed to finalize order');
  }

  return result;
}
