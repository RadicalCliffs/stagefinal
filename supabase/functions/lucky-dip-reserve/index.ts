import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid } from "../_shared/userId.ts";

// Inlined CORS configuration (bundler doesn't support shared module imports)
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://substage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8888',
];

function getCorsOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return SITE_URL;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

/**
 * Lucky Dip Reserve Function - Atomic Random Ticket Allocation
 *
 * This function handles the "Lucky Dip" flow where users request a specific COUNT
 * of tickets rather than specific ticket numbers. The function:
 *
 * 1. For small requests (<=100): Uses allocate_lucky_dip_tickets RPC
 * 2. For large requests (>100): Uses allocate_lucky_dip_tickets_batch RPC
 *    with batching and retry logic for up to 10,000+ tickets
 *
 * The approach ensures no race conditions by doing selection + reservation
 * in database transactions with proper locking.
 *
 * Flow:
 * 1. User sets Lucky Dip slider (e.g., "I want 5000 random tickets")
 * 2. Frontend calls this function with competition_id and count
 * 3. Function splits into batches and calls atomic RPC for each
 * 4. Returns aggregated ticket numbers + reservation IDs
 *
 * Error Codes:
 * - 400: Invalid input (missing fields, invalid count)
 * - 404: Competition not found
 * - 409: Insufficient availability (returns available_count)
 * - 500: Server error
 */

// ============================================================================
// Response Helpers
// ============================================================================

function errorResponse(
  message: string,
  statusCode: number,
  corsHeaders: Record<string, string>,
  additionalData: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
      errorCode: statusCode,
      ...additionalData
    }),
    {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  );
}

function successResponse(data: Record<string, unknown>, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, corsHeaders);
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${requestId}] Lucky dip reserve request started`);

  try {
    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      console.error(`[${requestId}] Failed to parse request body`);
      return errorResponse("Invalid JSON body", 400, corsHeaders);
    }

    const {
      userId,
      competitionId,
      count,
      ticketPrice,
      sessionId,
      holdMinutes = 15
    } = body;

    // Validate required fields
    if (!userId || typeof userId !== 'string') {
      return errorResponse("userId is required and must be a string", 400, corsHeaders);
    }

    // Convert to canonical prize:pid: format
    const canonicalUserId = toPrizePid(userId);
    console.log(`[${requestId}] Canonical user ID: ${canonicalUserId}`);

    if (!competitionId || typeof competitionId !== 'string') {
      return errorResponse("competitionId is required and must be a string", 400, corsHeaders);
    }

    if (!count || typeof count !== 'number' || count < 1 || count > 10000) {
      return errorResponse("count is required and must be between 1 and 10000", 400, corsHeaders);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      return errorResponse("Invalid competition ID format", 400, corsHeaders);
    }

    // Get Supabase configuration
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Server configuration error", 500, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const holdMins = Math.min(Math.max(Number(holdMinutes) || 15, 1), 60);
    const validTicketPrice = typeof ticketPrice === 'number' && ticketPrice > 0 ? ticketPrice : 1;

    console.log(`[${requestId}] Allocating ${count} lucky dip tickets for competition:`, competitionId);

    // =========================================================================
    // Configuration for batch processing
    // =========================================================================
    const MAX_BATCH_SIZE = 500;
    const MAX_RETRIES = 3;
    const BASE_RETRY_DELAY_MS = 500;

    // Helper function to sleep
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // =========================================================================
    // For small requests (<=100), use the original atomic allocation
    // For large requests (>100), use batch allocation with retries
    // =========================================================================
    if (count <= 100) {
      // Original atomic allocation for small requests
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'allocate_lucky_dip_tickets',
        {
          p_user_id: canonicalUserId,
          p_competition_id: competitionId,
          p_count: count,
          p_ticket_price: validTicketPrice,
          p_hold_minutes: holdMins,
          p_session_id: sessionId || null
        }
      );

      if (rpcError) {
        console.error(`[${requestId}] RPC error:`, rpcError);
        return errorResponse(
          "Failed to allocate tickets",
          500,
          corsHeaders,
          { retryable: true, errorDetail: rpcError.message }
        );
      }

      const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

      if (!result?.success) {
        const errorMsg = result?.error || "Unknown error during allocation";
        console.error(`[${requestId}] RPC returned failure:`, errorMsg);

        if (errorMsg.includes('No tickets available') || errorMsg.includes('Insufficient availability')) {
          return errorResponse(errorMsg, 409, corsHeaders, {
            available_count: result?.available_count || 0,
            requested_count: result?.requested_count || count
          });
        }

        if (errorMsg.includes('Competition not found') || errorMsg.includes('not active')) {
          return errorResponse(errorMsg, 404, corsHeaders);
        }

        return errorResponse(errorMsg, 500, corsHeaders, { retryable: result?.retryable ?? true });
      }

      return successResponse({
        reservationId: result.reservation_id,
        ticketNumbers: result.ticket_numbers,
        ticketCount: result.ticket_count,
        totalAmount: result.total_amount,
        expiresAt: result.expires_at,
        algorithm: 'server-side-atomic-random',
        message: `Successfully reserved ${result.ticket_count} lucky dip tickets. Complete payment within ${holdMins} minutes.`
      }, corsHeaders);
    }

    // =========================================================================
    // BULK ALLOCATION: For large requests (>100 tickets)
    // Uses batching with retries and calls get_competition_unavailable_tickets
    // =========================================================================
    console.log(`[${requestId}] Using bulk allocation for ${count} tickets`);

    // Step 1: Fetch all unavailable tickets upfront
    let excludedTickets: number[] = [];
    try {
      const { data: unavailableData, error: unavailableError } = await supabase.rpc(
        'get_competition_unavailable_tickets',
        { p_competition_id: competitionId }
      );

      if (!unavailableError && unavailableData && Array.isArray(unavailableData)) {
        // FIXED: The RPC returns INTEGER[] directly, not array of objects
        // Filter and validate to ensure we only have valid integers
        excludedTickets = unavailableData
          .filter((num: any) => Number.isInteger(num) && num > 0);
        console.log(`[${requestId}] Found ${excludedTickets.length} unavailable tickets`);
      }
    } catch (err) {
      console.warn(`[${requestId}] Could not fetch unavailable tickets:`, err);
    }

    // Step 2: Calculate batches
    const numBatches = Math.ceil(count / MAX_BATCH_SIZE);
    const batches: number[] = [];
    let remaining = count;
    for (let i = 0; i < numBatches; i++) {
      const batchSize = Math.min(remaining, MAX_BATCH_SIZE);
      batches.push(batchSize);
      remaining -= batchSize;
    }

    console.log(`[${requestId}] Split into ${numBatches} batches:`, batches);

    // Step 3: Execute batches with retries
    const allTicketNumbers: number[] = [];
    const allReservationIds: string[] = [];
    let totalRetries = 0;
    let lastExpiresAt: string | null = null;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchSize = batches[batchIndex];
      let batchSuccess = false;
      let lastBatchError = '';

      for (let attempt = 0; attempt < MAX_RETRIES && !batchSuccess; attempt++) {
        if (attempt > 0) {
          totalRetries++;
          const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1), 5000);
          const jitter = delay * 0.3 * (Math.random() * 2 - 1);
          await sleep(Math.max(0, delay + jitter));
          console.log(`[${requestId}] Batch ${batchIndex + 1} retry ${attempt}...`);
        }

        try {
          // Combine pre-existing unavailable + newly allocated from previous batches
          const currentExcluded = [...excludedTickets, ...allTicketNumbers];

          const { data, error } = await supabase.rpc('allocate_lucky_dip_tickets_batch', {
            p_user_id: canonicalUserId,
            p_competition_id: competitionId,
            p_count: batchSize,
            p_ticket_price: validTicketPrice,
            p_hold_minutes: holdMins,
            p_session_id: sessionId || null,
            p_excluded_tickets: currentExcluded.length > 0 ? currentExcluded : null
          });

          if (error) {
            lastBatchError = error.message;
            console.warn(`[${requestId}] Batch ${batchIndex + 1} attempt ${attempt + 1} error:`, error.message);
            continue;
          }

          const result = typeof data === 'string' ? JSON.parse(data) : data;

          if (!result?.success) {
            lastBatchError = result?.error || 'Unknown error';
            const isRetryable = result?.retryable === true ||
              lastBatchError.includes('locked') ||
              lastBatchError.includes('temporarily');

            if (!isRetryable) break;
            continue;
          }

          // Batch succeeded
          batchSuccess = true;
          if (result.ticket_numbers) {
            allTicketNumbers.push(...result.ticket_numbers);
          }
          if (result.reservation_id) {
            allReservationIds.push(result.reservation_id);
          }
          if (result.expires_at) {
            lastExpiresAt = result.expires_at;
          }

          console.log(`[${requestId}] Batch ${batchIndex + 1} succeeded: ${result.ticket_count} tickets`);

        } catch (err) {
          lastBatchError = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[${requestId}] Batch ${batchIndex + 1} attempt ${attempt + 1} exception:`, lastBatchError);
        }
      }

      // If batch failed after all retries
      if (!batchSuccess) {
        console.error(`[${requestId}] Batch ${batchIndex + 1} failed after ${MAX_RETRIES} attempts`);

        // Return partial success if we have some tickets
        if (allTicketNumbers.length > 0) {
          return successResponse({
            reservationIds: allReservationIds,
            reservationId: allReservationIds[0],
            ticketNumbers: allTicketNumbers,
            ticketCount: allTicketNumbers.length,
            totalAmount: allTicketNumbers.length * validTicketPrice,
            expiresAt: lastExpiresAt,
            algorithm: 'server-side-batch-random',
            partial: true,
            requestedCount: count,
            batchCount: batchIndex,
            retryAttempts: totalRetries,
            error: `Partial allocation: ${allTicketNumbers.length}/${count} tickets. Batch ${batchIndex + 1} failed: ${lastBatchError}`,
            message: `Partially reserved ${allTicketNumbers.length}/${count} tickets. Some batches failed.`
          }, corsHeaders);
        }

        // Check for availability errors
        if (lastBatchError.includes('No tickets available') || lastBatchError.includes('Insufficient availability')) {
          return errorResponse(lastBatchError, 409, corsHeaders, {
            available_count: 0,
            requested_count: count
          });
        }

        if (lastBatchError.includes('Competition not found') || lastBatchError.includes('not active')) {
          return errorResponse(lastBatchError, 404, corsHeaders);
        }

        return errorResponse(
          lastBatchError || 'Failed to allocate tickets',
          500,
          corsHeaders,
          { retryable: true }
        );
      }
    }

    // All batches succeeded
    console.log(`[${requestId}] Bulk reservation successful: ${allTicketNumbers.length} tickets across ${numBatches} batches`);

    return successResponse({
      reservationIds: allReservationIds,
      reservationId: allReservationIds[0],
      ticketNumbers: allTicketNumbers,
      ticketCount: allTicketNumbers.length,
      totalAmount: allTicketNumbers.length * validTicketPrice,
      expiresAt: lastExpiresAt,
      algorithm: 'server-side-batch-random',
      batchCount: numBatches,
      retryAttempts: totalRetries,
      message: `Successfully reserved ${allTicketNumbers.length} lucky dip tickets across ${numBatches} batches. Complete payment within ${holdMins} minutes.`
    }, corsHeaders);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${requestId}] Unexpected error:`, errorMessage);

    return errorResponse(
      "An unexpected error occurred. Please try again.",
      500,
      corsHeaders,
      { retryable: true }
    );
  }
});
