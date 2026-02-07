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
 * of tickets rather than specific ticket numbers. 
 *
 * Uses the new reserve_lucky_dip RPC that handles:
 * - Atomic transaction with expiry cleanup
 * - Ticket locking with FOR UPDATE SKIP LOCKED
 * - Updates ticket status to 'reserved'
 * - Creates pending_tickets and pending_ticket_items
 *
 * Flow:
 * 1. User sets Lucky Dip slider (e.g., "I want 5000 random tickets")
 * 2. Frontend calls this function with competition_id and count
 * 3. Function calls reserve_lucky_dip RPC
 * 4. Returns allocated ticket numbers + reservation ID
 *
 * Error Codes:
 * - 400: Invalid input (missing fields, invalid count)
 * - 404: Competition not found
 * - 409: Insufficient availability
 * - 500: Server error
 */

// ============================================================================
// Constants
// ============================================================================

const PRIZE_PID_PREFIX = 'prize:pid:';
const ETHEREUM_WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const MINUTES_TO_MS = 60 * 1000; // Convert minutes to milliseconds

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
  
  // Attach a short-lived request id to correlate logs and responses
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, corsHeaders);
  }

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

    // Normalize numeric inputs (defensive against string inputs)
    const normalizedCount = Number(count);
    if (!Number.isInteger(normalizedCount) || normalizedCount < 1 || normalizedCount > 10000) {
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

    // Admin client (service role) for privileged RPCs
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const holdMins = Math.min(Math.max(Number(holdMinutes) || 15, 1), 60);
    const normalizedPrice = Number(ticketPrice);
    const validTicketPrice = Number.isFinite(normalizedPrice) && normalizedPrice > 0 ? normalizedPrice : 1;

    console.log(`[${requestId}] Allocating ${normalizedCount} lucky dip tickets for competition:`, competitionId);

    // =========================================================================
    // Use new reserve_lucky_dip RPC for all requests (replaces allocate_lucky_dip_tickets)
    // This RPC handles expiry atomically and updates ticket status to 'reserved'
    // =========================================================================
    
    // Extract wallet address from canonical user ID if available
    const extractedId = canonicalUserId.startsWith(PRIZE_PID_PREFIX) 
      ? canonicalUserId.substring(PRIZE_PID_PREFIX.length)
      : canonicalUserId;
    
    // Use extracted ID as wallet_address if it's a wallet, otherwise empty string
    const walletAddress = ETHEREUM_WALLET_REGEX.test(extractedId) ? extractedId : '';
    
    console.log(`[${requestId}] Calling reserve_lucky_dip RPC`, {
      canonical_user_id: canonicalUserId,
      wallet_address: walletAddress,
      ticket_count: normalizedCount
    });

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'reserve_lucky_dip',
      {
        p_competition_id: competitionId,
        p_canonical_user_id: canonicalUserId,
        p_wallet_address: walletAddress,
        p_ticket_count: normalizedCount,
        p_hold_minutes: holdMins
      }
    );

    if (rpcError) {
      console.error(`[${requestId}] reserve_lucky_dip RPC error:`, rpcError);
      return errorResponse(
        "Failed to reserve tickets",
        500,
        corsHeaders,
        { retryable: true, errorDetail: rpcError.message }
      );
    }

    // The RPC returns { pending_ticket_id, allocated_numbers }
    const result = Array.isArray(rpcResult) && rpcResult.length > 0 ? rpcResult[0] : rpcResult;

    if (!result || !result.pending_ticket_id || !result.allocated_numbers) {
      console.error(`[${requestId}] Invalid response from reserve_lucky_dip:`, result);
      return errorResponse(
        "Invalid response from reservation system",
        500,
        corsHeaders,
        { retryable: true }
      );
    }

    const allocatedNumbers = Array.isArray(result.allocated_numbers) ? result.allocated_numbers : [];
    
    console.log(`[${requestId}] Successfully reserved ${allocatedNumbers.length} tickets`);

    return successResponse({
      reservationId: result.pending_ticket_id,
      ticketNumbers: allocatedNumbers,
      ticketCount: allocatedNumbers.length,
      totalAmount: allocatedNumbers.length * validTicketPrice,
      expiresAt: new Date(Date.now() + holdMins * MINUTES_TO_MS).toISOString(),
      algorithm: 'reserve-lucky-dip-atomic',
      message: `Successfully reserved ${allocatedNumbers.length} lucky dip tickets. Complete payment within ${holdMins} minutes.`
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

// Optional: If the client needs to read custom headers (like a request id),
// consider adding the following to buildCorsHeaders:
// 'Access-Control-Expose-Headers': 'request-id',
// and set it on responses:
// headers: { ...corsHeaders, "Content-Type": "application/json", "request-id": requestId }
