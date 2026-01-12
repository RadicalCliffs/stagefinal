/**
 * Ticket Reservation Service
 *
 * This module provides ticket reservation by calling the reserve_tickets
 * Supabase edge function with proper authentication and error handling.
 *
 * Endpoint: POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/reserve_tickets
 */

import { supabase } from './supabase';

export interface ReserveTicketsParams {
  userId: string;
  competitionId: string;
  selectedTickets: number[];
}

export interface ReserveTicketsResponse {
  success: boolean;
  reservationId?: string;
  competitionId?: string;
  selectedTickets?: number[];
  ticketNumbers?: number[];
  ticketCount?: number;
  ticketPrice?: number;
  totalAmount?: number;
  expiresAt?: string;
  message?: string;
  error?: string;
  errorCode?: number;
  unavailableTickets?: number[];
  retryable?: boolean;
  ok?: boolean;
  reserved?: number[];
}

export interface ReserveTicketsResult {
  data: ReserveTicketsResponse | null;
  error: Error | null;
}

/**
 * Invoke the reserve_tickets function with authentication
 */
async function invokeReserveFunction(
  params: ReserveTicketsParams
): Promise<{ data: any; error: any }> {
  try {
    // Get current session for authorization
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;

    // Prepare headers with authorization if available
    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    // Log outgoing payload for debugging
    console.log('[reserveTickets] outgoing', {
      userId: params.userId?.substring(0, 15) + '...',
      competitionId: params.competitionId,
      selectedTickets: params.selectedTickets,
      len: params.selectedTickets.length,
    });

    const result = await supabase.functions.invoke('reserve_tickets', {
      headers,
      body: {
        userId: params.userId,
        competitionId: params.competitionId,
        selectedTickets: params.selectedTickets, // Send as selectedTickets array (required by Edge Function)
      },
    });

    return { data: result.data, error: result.error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Reserve tickets using the reserve_tickets edge function.
 *
 * This function calls the reserve_tickets endpoint with proper authentication
 * and handles errors appropriately. On HTTP 409 (conflict), it extracts
 * unavailable tickets for the caller to handle.
 *
 * @param params - The reservation parameters
 * @returns Result object with data and error
 */
export async function reserveTicketsWithRedundancy(
  params: ReserveTicketsParams
): Promise<ReserveTicketsResult> {
  // CRITICAL: Validate userId before proceeding
  // This prevents crashes when userId is undefined/null/empty
  if (!params.userId || typeof params.userId !== 'string' || params.userId.trim() === '') {
    console.error('[ReserveTickets] Invalid userId provided:', params.userId);
    return {
      data: {
        success: false,
        error: 'User identifier is missing. Please log in again.',
        errorCode: 400,
      },
      error: new Error('User identifier is missing'),
    };
  }

  console.log('[ReserveTickets] Starting reservation');
  console.log('[ReserveTickets] Params:', {
    userId: params.userId.substring(0, 15) + '...',
    competitionId: params.competitionId,
    ticketCount: params.selectedTickets.length,
  });

  const { data, error } = await invokeReserveFunction(params);

  // Check for successful response (HTTP 200 with success: true)
  if (!error && data && data.success === true) {
    console.log('[ReserveTickets] Reservation succeeded!');
    return {
      data,
      error: null,
    };
  }

  // Handle errors - log and return
  if (error) {
    console.error('[ReserveTickets] Function error:', error);
  } else if (data) {
    console.error('[ReserveTickets] Function returned error response:', data);
  }

  return {
    data: data || null,
    error: error instanceof Error ? error : new Error(String(error || 'Failed to reserve tickets')),
  };
}
