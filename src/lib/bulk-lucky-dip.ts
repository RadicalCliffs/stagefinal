/**
 * Bulk Lucky Dip Allocation Service
 *
 * This service handles large lucky dip purchases (up to 10,000+ tickets) by:
 *
 * 1. Fetching all unavailable tickets upfront via `get_competition_unavailable_tickets`
 * 2. Splitting the request into batches of max 500 tickets each
 * 3. Executing batches with 3x quiet retries and exponential backoff
 * 4. Aggregating results into a single response
 *
 * Usage:
 * ```typescript
 * const result = await allocateBulkLuckyDip({
 *   userId: 'prize:pid:0x...',
 *   competitionId: '123e4567-e89b-12d3-a456-426614174000',
 *   count: 5000,
 *   ticketPrice: 1,
 *   holdMinutes: 15,
 *   sessionId: 'session-123'
 * });
 *
 * if (result.success) {
 *   console.log('Reserved tickets:', result.ticketNumbers);
 * }
 * ```
 */

import { supabase } from './supabase';
import { toPrizePid } from '../utils/userId';

// ============================================================================
// Types
// ============================================================================

export interface BulkLuckyDipParams {
  userId: string;
  competitionId: string;
  count: number;
  ticketPrice?: number;
  holdMinutes?: number;
  sessionId?: string;
}

export interface BulkLuckyDipResult {
  success: boolean;
  reservationIds: string[];
  ticketNumbers: number[];
  ticketCount: number;
  totalAmount: number;
  expiresAt: string | null;
  availableCountAfter: number;
  error?: string;
  batchResults?: BatchResult[];
  retryAttempts?: number;
}

interface BatchResult {
  batchIndex: number;
  success: boolean;
  reservationId?: string;
  ticketNumbers?: number[];
  ticketCount?: number;
  error?: string;
  retryCount: number;
}

interface UnavailableTicket {
  ticket_number: number;
  source: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_BATCH_SIZE = 500;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5000;

// Jitter range for retry delays (to avoid thundering herd)
const JITTER_FACTOR = 0.3;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateRetryDelay(attempt: number): number {
  const baseDelay = Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, attempt),
    MAX_RETRY_DELAY_MS
  );
  const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, baseDelay + jitter);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Split an array into chunks of a given size
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch all unavailable tickets for a competition
 * This should be called ONCE before starting batch allocation
 */
export async function getCompetitionUnavailableTickets(
  competitionId: string
): Promise<Set<number>> {
  const unavailableSet = new Set<number>();

  try {
    const { data, error } = await (supabase.rpc as any)('get_competition_unavailable_tickets', {
      p_competition_id: competitionId
    });

    if (error) {
      console.error('[BulkLuckyDip] Error fetching unavailable tickets:', error);
      // Fall back to empty set - allocation will still work, just slightly less efficient
      return unavailableSet;
    }

    if (data && Array.isArray(data)) {
      (data as any as UnavailableTicket[]).forEach((row) => {
        if (row.ticket_number) {
          unavailableSet.add(row.ticket_number);
        }
      });
    }

    console.log(`[BulkLuckyDip] Found ${unavailableSet.size} unavailable tickets`);
    return unavailableSet;
  } catch (err) {
    console.error('[BulkLuckyDip] Exception fetching unavailable tickets:', err);
    return unavailableSet;
  }
}

/**
 * Allocate a single batch of tickets with retry logic
 */
async function allocateBatchWithRetry(
  userId: string,
  competitionId: string,
  count: number,
  ticketPrice: number,
  holdMinutes: number,
  sessionId: string | null,
  excludedTickets: number[],
  batchIndex: number
): Promise<BatchResult> {
  let lastError: string | undefined;
  let retryCount = 0;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await (supabase.rpc as any)('allocate_lucky_dip_tickets_batch', {
        p_user_id: userId,
        p_competition_id: competitionId,
        p_count: count,
        p_ticket_price: ticketPrice,
        p_hold_minutes: holdMinutes,
        p_session_id: sessionId,
        p_excluded_tickets: excludedTickets.length > 0 ? excludedTickets : null
      });

      if (error) {
        lastError = error.message;
        console.warn(`[BulkLuckyDip] Batch ${batchIndex} attempt ${attempt + 1} RPC error:`, error.message);

        // Check if retryable
        if (attempt < MAX_RETRY_ATTEMPTS - 1) {
          retryCount++;
          const delay = calculateRetryDelay(attempt);
          await sleep(delay);
          continue;
        }
      }

      // Parse result
      const result = typeof data === 'string' ? JSON.parse(data) : data;

      if (!result?.success) {
        lastError = result?.error || 'Unknown error';

        // Check if this is a retryable error
        const isRetryable = result?.retryable === true ||
          (lastError && lastError.includes('locked')) ||
          (lastError && lastError.includes('temporarily'));

        if (isRetryable && attempt < MAX_RETRY_ATTEMPTS - 1) {
          retryCount++;
          const delay = calculateRetryDelay(attempt);
          console.warn(`[BulkLuckyDip] Batch ${batchIndex} retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }

        // Non-retryable error or exhausted retries
        return {
          batchIndex,
          success: false,
          error: lastError,
          retryCount
        };
      }

      // Success!
      return {
        batchIndex,
        success: true,
        reservationId: result.reservation_id,
        ticketNumbers: result.ticket_numbers,
        ticketCount: result.ticket_count,
        retryCount
      };

    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[BulkLuckyDip] Batch ${batchIndex} attempt ${attempt + 1} exception:`, lastError);

      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        retryCount++;
        const delay = calculateRetryDelay(attempt);
        await sleep(delay);
        continue;
      }
    }
  }

  return {
    batchIndex,
    success: false,
    error: lastError || 'Failed after retries',
    retryCount
  };
}

/**
 * Allocate bulk lucky dip tickets with batching and retries
 *
 * This is the main entry point for large ticket purchases.
 * It handles:
 * - Fetching unavailable tickets upfront
 * - Splitting into batches of max 500 tickets
 * - Executing batches with 3x quiet retries
 * - Aggregating results
 */
export async function allocateBulkLuckyDip(
  params: BulkLuckyDipParams
): Promise<BulkLuckyDipResult> {
  const {
    userId,
    competitionId,
    count,
    ticketPrice = 1,
    holdMinutes = 15,
    sessionId
  } = params;

  // Validate inputs
  if (!userId || userId.trim() === '') {
    return {
      success: false,
      reservationIds: [],
      ticketNumbers: [],
      ticketCount: 0,
      totalAmount: 0,
      expiresAt: null,
      availableCountAfter: 0,
      error: 'User ID is required'
    };
  }

  if (!competitionId || competitionId.trim() === '') {
    return {
      success: false,
      reservationIds: [],
      ticketNumbers: [],
      ticketCount: 0,
      totalAmount: 0,
      expiresAt: null,
      availableCountAfter: 0,
      error: 'Competition ID is required'
    };
  }

  if (count < 1) {
    return {
      success: false,
      reservationIds: [],
      ticketNumbers: [],
      ticketCount: 0,
      totalAmount: 0,
      expiresAt: null,
      availableCountAfter: 0,
      error: 'Count must be at least 1'
    };
  }

  // Normalize user ID to canonical format
  const canonicalUserId = toPrizePid(userId);
  console.log(`[BulkLuckyDip] Starting allocation of ${count} tickets for user ${canonicalUserId.slice(0, 20)}...`);

  // Step 1: Fetch unavailable tickets
  const unavailableTickets = await getCompetitionUnavailableTickets(competitionId);
  const excludedArray = Array.from(unavailableTickets);
  console.log(`[BulkLuckyDip] Excluding ${excludedArray.length} unavailable tickets`);

  // Step 2: Calculate batches
  const numBatches = Math.ceil(count / MAX_BATCH_SIZE);
  const batches: number[] = [];

  let remainingCount = count;
  for (let i = 0; i < numBatches; i++) {
    const batchSize = Math.min(remainingCount, MAX_BATCH_SIZE);
    batches.push(batchSize);
    remainingCount -= batchSize;
  }

  console.log(`[BulkLuckyDip] Split into ${numBatches} batches:`, batches);

  // Step 3: Execute batches sequentially
  // (Sequential to avoid race conditions and to accumulate excluded tickets)
  const batchResults: BatchResult[] = [];
  const allTicketNumbers: number[] = [];
  const allReservationIds: string[] = [];
  let lastExpiresAt: string | null = null;
  let totalRetries = 0;

  // Track newly allocated tickets to exclude in subsequent batches
  const newlyAllocatedTickets = new Set<number>();

  for (let i = 0; i < batches.length; i++) {
    const batchSize = batches[i];
    console.log(`[BulkLuckyDip] Executing batch ${i + 1}/${numBatches} (${batchSize} tickets)...`);

    // Combine pre-existing unavailable + newly allocated from previous batches
    const currentExcluded = [
      ...excludedArray,
      ...Array.from(newlyAllocatedTickets)
    ];

    const result = await allocateBatchWithRetry(
      canonicalUserId,
      competitionId,
      batchSize,
      ticketPrice,
      holdMinutes,
      sessionId || null,
      currentExcluded,
      i
    );

    batchResults.push(result);
    totalRetries += result.retryCount;

    if (result.success && result.ticketNumbers) {
      allTicketNumbers.push(...result.ticketNumbers);
      if (result.reservationId) {
        allReservationIds.push(result.reservationId);
      }

      // Add to excluded set for next batch
      result.ticketNumbers.forEach(t => newlyAllocatedTickets.add(t));

      // Track expiration (use latest)
      if (result.reservationId) {
        // We don't have expires_at in BatchResult, so we'll query for it or estimate
        // For now, just note that we have reservations
      }
    } else {
      // Batch failed - stop processing further batches
      console.error(`[BulkLuckyDip] Batch ${i + 1} failed: ${result.error}`);

      // Return partial success if we have some tickets
      if (allTicketNumbers.length > 0) {
        return {
          success: false,
          reservationIds: allReservationIds,
          ticketNumbers: allTicketNumbers,
          ticketCount: allTicketNumbers.length,
          totalAmount: allTicketNumbers.length * ticketPrice,
          expiresAt: lastExpiresAt,
          availableCountAfter: 0, // Unknown after failure
          error: `Partial allocation: ${allTicketNumbers.length}/${count} tickets reserved. Batch ${i + 1} failed: ${result.error}`,
          batchResults,
          retryAttempts: totalRetries
        };
      }

      return {
        success: false,
        reservationIds: [],
        ticketNumbers: [],
        ticketCount: 0,
        totalAmount: 0,
        expiresAt: null,
        availableCountAfter: 0,
        error: result.error || 'Failed to allocate tickets',
        batchResults,
        retryAttempts: totalRetries
      };
    }
  }

  // All batches succeeded
  console.log(`[BulkLuckyDip] Successfully allocated ${allTicketNumbers.length} tickets across ${numBatches} batches`);

  return {
    success: true,
    reservationIds: allReservationIds,
    ticketNumbers: allTicketNumbers,
    ticketCount: allTicketNumbers.length,
    totalAmount: allTicketNumbers.length * ticketPrice,
    expiresAt: lastExpiresAt,
    availableCountAfter: 0, // Would need another query to determine
    batchResults,
    retryAttempts: totalRetries
  };
}

/**
 * Get the number of available tickets for a competition
 * Uses the count-based RPC for efficiency
 */
export async function getAvailableTicketCount(
  competitionId: string
): Promise<{
  success: boolean;
  availableCount: number;
  totalTickets: number;
  soldCount: number;
  pendingCount: number;
  error?: string;
}> {
  try {
    const { data, error } = await (supabase.rpc as any)('get_available_ticket_count_v2', {
      p_competition_id: competitionId
    });

    if (error) {
      console.error('[BulkLuckyDip] Error getting available count:', error);
      return {
        success: false,
        availableCount: 0,
        totalTickets: 0,
        soldCount: 0,
        pendingCount: 0,
        error: error.message
      };
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;

    if (!result?.success) {
      return {
        success: false,
        availableCount: 0,
        totalTickets: 0,
        soldCount: 0,
        pendingCount: 0,
        error: result?.error || 'Unknown error'
      };
    }

    return {
      success: true,
      availableCount: result.available_count || 0,
      totalTickets: result.total_tickets || 0,
      soldCount: result.sold_count || 0,
      pendingCount: result.pending_count || 0
    };
  } catch (err) {
    return {
      success: false,
      availableCount: 0,
      totalTickets: 0,
      soldCount: 0,
      pendingCount: 0,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

// ============================================================================
// Re-export for convenience
// ============================================================================

export { MAX_BATCH_SIZE, MAX_RETRY_ATTEMPTS };
