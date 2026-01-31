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
 * Now uses the aggressive reservation method from omnipotent-data-service
 * for improved reliability with automatic retries and cleanup.
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

  console.log('[ReserveTickets] Starting aggressive reservation');
  console.log('[ReserveTickets] Params:', {
    userId: params.userId.substring(0, 15) + '...',
    competitionId: params.competitionId,
    ticketCount: params.selectedTickets.length,
  });

  // Import omnipotent data service dynamically to avoid circular dependencies
  const { omnipotentData } = await import('./omnipotent-data-service');

  try {
    // Use aggressive reservation with automatic retry and cleanup
    const result = await omnipotentData.reserveTicketsAggressive(
      params.userId,
      params.competitionId,
      params.selectedTickets,
      3 // max 3 retries
    );

    if (result.success) {
      console.log('[ReserveTickets] Aggressive reservation succeeded!', {
        reservationId: result.reservationId,
        retried: result.retried
      });
      
      return {
        data: {
          success: true,
          reservationId: result.reservationId,
          competitionId: params.competitionId,
          selectedTickets: params.selectedTickets,
          ticketNumbers: params.selectedTickets,
          ticketCount: params.selectedTickets.length,
          message: result.retried 
            ? 'Tickets reserved successfully after retry' 
            : 'Tickets reserved successfully',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 minutes
        },
        error: null,
      };
    } else {
      console.error('[ReserveTickets] Aggressive reservation failed:', result.error);
      return {
        data: {
          success: false,
          error: result.error || 'Failed to reserve tickets',
          errorCode: 500,
          retryable: true,
        },
        error: new Error(result.error || 'Failed to reserve tickets'),
      };
    }
  } catch (err) {
    console.error('[ReserveTickets] Exception during reservation:', err);
    return {
      data: {
        success: false,
        error: err instanceof Error ? err.message : 'Network error during reservation',
        errorCode: 500,
        retryable: true,
      },
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
