import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid } from "../_shared/userId.ts";

// Inlined CORS configuration (bundler doesn't support shared module imports)
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://stage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://stage.theprize.io',
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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
 * 1. Calls the atomic `allocate_lucky_dip_tickets` RPC function
 * 2. The RPC atomically: locks rows, selects random tickets, creates reservation
 * 3. Returns selected ticket numbers + reservation ID for payment flow
 *
 * This approach ensures no race conditions by doing selection + reservation
 * in a single database transaction.
 *
 * Flow:
 * 1. User sets Lucky Dip slider (e.g., "I want 10 random tickets")
 * 2. Frontend calls this function with competition_id and count
 * 3. Function calls atomic RPC that selects + reserves in one transaction
 * 4. Returns selected ticket numbers + reservation ID for payment flow
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

    if (!count || typeof count !== 'number' || count < 1 || count > 100) {
      return errorResponse("count is required and must be between 1 and 100", 400, corsHeaders);
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
    // Use atomic allocation RPC - selects + reserves in single transaction
    // This prevents race conditions by doing everything server-side atomically
    // Pass canonical user ID to ensure consistent storage format
    // =========================================================================
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

    // Parse result (JSONB returned from RPC)
    const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

    if (!result?.success) {
      const errorMsg = result?.error || "Unknown error during allocation";
      console.error(`[${requestId}] RPC returned failure:`, errorMsg);

      // Check for availability errors
      if (errorMsg.includes('No tickets available') || errorMsg.includes('Insufficient availability')) {
        return errorResponse(
          errorMsg,
          409,
          corsHeaders,
          {
            available_count: result?.available_count || 0,
            requested_count: result?.requested_count || count
          }
        );
      }

      // Check for competition not found
      if (errorMsg.includes('Competition not found') || errorMsg.includes('not active')) {
        return errorResponse(errorMsg, 404, corsHeaders);
      }

      return errorResponse(errorMsg, 500, corsHeaders, { retryable: result?.retryable ?? true });
    }

    // =========================================================================
    // Success - return reservation details
    // =========================================================================
    console.log(`[${requestId}] Reservation successful:`, {
      reservationId: result.reservation_id,
      ticketCount: result.ticket_count,
      availableAfter: result.available_count_after
    });

    return successResponse({
      reservationId: result.reservation_id,
      ticketNumbers: result.ticket_numbers,
      ticketCount: result.ticket_count,
      totalAmount: result.total_amount,
      expiresAt: result.expires_at,
      algorithm: 'server-side-atomic-random',
      message: `Successfully reserved ${result.ticket_count} lucky dip tickets. Complete payment within ${holdMins} minutes.`
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
