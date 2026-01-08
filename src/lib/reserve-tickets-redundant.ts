/**
 * Redundant Ticket Reservation Service
 *
 * This module provides a highly reliable ticket reservation mechanism by calling
 * two separate Supabase edge functions with automatic fallback. If the primary
 * function fails for ANY reason, the backup function is automatically called.
 *
 * Functions:
 * - Primary: reserve-tickets (hyphen)
 * - Backup: reserve_tickets (underscore)
 *
 * Both functions are deployed independently and are identical in functionality.
 * This ensures maximum reliability for ticket reservations.
 */

import { supabase } from './supabase';

export interface ReserveTicketsParams {
  userId: string;
  competitionId: string;
  selectedTickets: number[];
  ticketPrice: number;
  reservationId?: string;
  expiresAt?: string;
  sessionId?: string;
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
  source?: 'primary' | 'backup';
  ok?: boolean;
  reserved?: number[];
}

export interface ReserveTicketsResult {
  data: ReserveTicketsResponse | null;
  error: Error | null;
  functionUsed: 'primary' | 'backup' | 'none';
}

/**
 * Invoke a single reserve function by name
 */
async function invokeReserveFunction(
  functionName: string,
  params: ReserveTicketsParams
): Promise<{ data: any; error: any }> {
  const clientReservationId = params.reservationId ||
    (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
  const expiresAt = params.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString();

  try {
    const result = await supabase.functions.invoke(functionName, {
      body: {
        // Primary camelCase parameters (new API format)
        userId: params.userId,
        userIdentifier: params.userId, // Also send as userIdentifier for backward compatibility
        competitionId: params.competitionId,
        selectedTickets: params.selectedTickets,
        ticketPrice: params.ticketPrice,
        reservationId: clientReservationId,
        expiresAt: expiresAt,
        sessionId: params.sessionId,
        // Also include snake_case for backward compatibility
        user_id: params.userId,
        competition_id: params.competitionId,
        tickets: params.selectedTickets,
      },
    });

    return { data: result.data, error: result.error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Extract error body from Supabase function error
 */
async function extractErrorBody(error: any): Promise<string | null> {
  try {
    const resp = error?.context as Response | undefined;
    if (resp && typeof resp.text === 'function') {
      return await resp.text();
    }
  } catch {
    // Ignore extraction errors
  }
  return null;
}

/**
 * Reserve tickets with redundant function calls.
 *
 * This function attempts to reserve tickets using the primary function first.
 * If that fails for ANY reason (network error, function error, timeout, etc.),
 * it automatically falls back to the backup function.
 *
 * @param params - The reservation parameters
 * @returns Result object with data, error, and which function was used
 */
export async function reserveTicketsWithRedundancy(
  params: ReserveTicketsParams
): Promise<ReserveTicketsResult> {
  const PRIMARY_FUNCTION = 'reserve-tickets';
  const BACKUP_FUNCTION = 'reserve_tickets';

  // CRITICAL: Validate userId before proceeding
  // This prevents crashes when userId is undefined/null/empty
  if (!params.userId || typeof params.userId !== 'string' || params.userId.trim() === '') {
    console.error('[ReserveRedundant] Invalid userId provided:', params.userId);
    return {
      data: {
        success: false,
        error: 'User identifier is missing. Please log in again.',
        errorCode: 400,
      },
      error: new Error('User identifier is missing'),
      functionUsed: 'none',
    };
  }

  console.log('[ReserveRedundant] Starting redundant reservation attempt');
  console.log('[ReserveRedundant] Params:', {
    userId: params.userId.substring(0, 15) + '...',
    competitionId: params.competitionId,
    ticketCount: params.selectedTickets.length,
    ticketPrice: params.ticketPrice,
  });

  // Try primary function first
  console.log(`[ReserveRedundant] Attempting primary function: ${PRIMARY_FUNCTION}`);
  const primaryStart = Date.now();

  const { data: primaryData, error: primaryError } = await invokeReserveFunction(
    PRIMARY_FUNCTION,
    params
  );

  const primaryDuration = Date.now() - primaryStart;
  console.log(`[ReserveRedundant] Primary function completed in ${primaryDuration}ms`);

  // Check if primary was successful
  if (!primaryError && primaryData && (primaryData.success || primaryData.ok)) {
    console.log('[ReserveRedundant] Primary function succeeded!');
    return {
      data: { ...primaryData, source: 'primary' as const },
      error: null,
      functionUsed: 'primary',
    };
  }

  // Primary failed - log the error
  if (primaryError) {
    console.log('[ReserveRedundant] Primary function error:', primaryError);
    const errorBody = await extractErrorBody(primaryError);
    if (errorBody) {
      console.log('[ReserveRedundant] Primary error body:', errorBody);
    }
  } else if (primaryData) {
    console.log('[ReserveRedundant] Primary function returned error response:', primaryData);
  }

  // Check if error is a 4xx client error (not retryable on backup)
  // 400 = bad request (invalid data)
  // 409 = conflict (tickets unavailable - should retry but won't help on backup)
  // For 4xx errors, we still try the backup in case it's a deployment issue
  const primaryStatusCode = primaryData?.errorCode || primaryError?.status;

  // ALWAYS try backup function regardless of error type
  // The backup function may have different deployment state
  console.log(`[ReserveRedundant] Attempting backup function: ${BACKUP_FUNCTION}`);
  const backupStart = Date.now();

  const { data: backupData, error: backupError } = await invokeReserveFunction(
    BACKUP_FUNCTION,
    params
  );

  const backupDuration = Date.now() - backupStart;
  console.log(`[ReserveRedundant] Backup function completed in ${backupDuration}ms`);

  // Check if backup was successful
  if (!backupError && backupData && (backupData.success || backupData.ok)) {
    console.log('[ReserveRedundant] Backup function succeeded!');
    return {
      data: { ...backupData, source: 'backup' as const },
      error: null,
      functionUsed: 'backup',
    };
  }

  // Backup also failed - log and return the best available error
  if (backupError) {
    console.log('[ReserveRedundant] Backup function error:', backupError);
    const errorBody = await extractErrorBody(backupError);
    if (errorBody) {
      console.log('[ReserveRedundant] Backup error body:', errorBody);
    }
  } else if (backupData) {
    console.log('[ReserveRedundant] Backup function returned error response:', backupData);
  }

  // Both functions failed - return the most informative error
  // Prefer primary error if both are similar, prefer backup if it has more detail
  const finalError = backupError || primaryError ||
    new Error(backupData?.error || primaryData?.error || 'Both reservation functions failed');

  const finalData = backupData || primaryData;

  console.log('[ReserveRedundant] Both functions failed. Final error:', finalError);

  return {
    data: finalData,
    error: finalError instanceof Error ? finalError : new Error(String(finalError)),
    functionUsed: 'none',
  };
}

/**
 * Parse a reservation response to extract the reservation ID and ticket numbers.
 * Handles multiple response formats from different function versions.
 */
export function parseReservationResponse(response: ReserveTicketsResponse | null): {
  reservationId: string | null;
  ticketNumbers: number[];
  ticketCount: number;
  success: boolean;
} {
  if (!response) {
    return { reservationId: null, ticketNumbers: [], ticketCount: 0, success: false };
  }

  const success = response.success === true || response.ok === true;
  const reservationId = response.reservationId || null;
  const ticketNumbers = response.reserved || response.ticketNumbers || response.selectedTickets || [];
  const ticketCount = response.ticketCount || ticketNumbers.length;

  return { reservationId, ticketNumbers, ticketCount, success };
}
