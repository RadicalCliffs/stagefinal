import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ============================================================================
// Inlined User ID Utilities (bundler doesn't support shared module imports)
// ============================================================================

/**
 * Checks if a string is a valid Ethereum wallet address
 */
function isWalletAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(identifier);
}

/**
 * Checks if a string is already in prize:pid: format
 */
function isPrizePid(identifier: string): boolean {
  return identifier.startsWith('prize:pid:');
}

/**
 * Extracts the actual ID from a prize:pid: formatted string
 */
function extractPrizePid(prizePid: string): string {
  if (!isPrizePid(prizePid)) {
    return prizePid;
  }
  return prizePid.substring('prize:pid:'.length);
}

/**
 * Returns a canonical user ID in the form of prize:pid:<id>
 * Handles wallets, existing prize:pid format, and generates UUID for empty values
 */
function toPrizePid(inputUserId: string | null | undefined): string {
  // Handle null/undefined/empty
  if (!inputUserId || inputUserId.trim() === '') {
    return `prize:pid:${crypto.randomUUID()}`;
  }

  const trimmedId = inputUserId.trim();

  // Already in prize:pid: format - normalize and return
  if (isPrizePid(trimmedId)) {
    const extracted = extractPrizePid(trimmedId);
    // If it's a wallet address, ensure lowercase
    if (isWalletAddress(extracted)) {
      return `prize:pid:${extracted.toLowerCase()}`;
    }
    return trimmedId.toLowerCase();
  }

  // Wallet address - normalize to lowercase
  if (isWalletAddress(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }

  // Check if it's a UUID pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmedId)) {
    throw new Error(
      `UUID cannot be used as canonical_user_id: ${trimmedId}. ` +
      `Use allocate_temp_canonical_user() for users without wallets, ` +
      `or provide a wallet address to create prize:pid:0x{wallet} format.`
    );
  }

  // For any other identifier format, this is an error
  throw new Error(
    `Invalid user identifier format: ${trimmedId}. ` +
    `Must be wallet address (0x...) or already in prize:pid: format.`
  );
}

// ============================================================================
// Inlined CORS configuration (bundler doesn't support shared module imports)
// ============================================================================
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
  // Validate request origin is in allowed list
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Always return a specific origin (never empty string or wildcard)
  // This is required when using Access-Control-Allow-Credentials: true
  return SITE_URL;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  
  // Ensure we never return empty string (required for credentials: true)
  if (!origin) {
    throw new Error('CORS origin cannot be empty when using credentials');
  }
  
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
    status: 200,  // Use 200 instead of 204 for better compatibility
    headers: buildCorsHeaders(origin),
  });
}

/**
 * Lucky Dip Reserve Function - Atomic Random Ticket Allocation
 *
 * This function handles the "Lucky Dip" flow where users request a specific COUNT
 * of tickets rather than specific ticket numbers. 
 *
 * Uses the allocate_lucky_dip_tickets_batch RPC that handles:
 * - Atomic transaction with expiry cleanup
 * - Ticket locking with FOR UPDATE SKIP LOCKED
 * - Updates ticket status to 'reserved'
 * - Creates pending_tickets and pending_ticket_items
 *
 * Flow:
 * 1. User sets Lucky Dip slider (e.g., "I want 5000 random tickets")
 * 2. Frontend calls this function with competition_id and count
 * 3. Function calls allocate_lucky_dip_tickets_batch RPC
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
  // CRITICAL: Wrap EVERYTHING in try-catch to ensure CORS headers are ALWAYS returned
  // This prevents CORS errors when the function has runtime errors
  try {
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
      if (!Number.isInteger(normalizedCount) || normalizedCount < 1 || normalizedCount > 999) {
        return errorResponse("count is required and must be between 1 and 999", 400, corsHeaders);
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
      // Use allocate_lucky_dip_tickets_batch RPC for ticket allocation
      // This RPC handles expiry atomically and updates ticket status to 'reserved'
      // =========================================================================
      
      console.log(`[${requestId}] Calling allocate_lucky_dip_tickets_batch RPC`, {
        user_id: canonicalUserId,
        competition_id: competitionId,
        ticket_count: normalizedCount,
        ticket_price: validTicketPrice,
        hold_minutes: holdMins
      });

      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'allocate_lucky_dip_tickets_batch',
        {
          p_user_id: canonicalUserId,
          p_competition_id: competitionId,
          p_count: normalizedCount,
          p_ticket_price: validTicketPrice,
          p_hold_minutes: holdMins,
          p_session_id: sessionId || null,
          p_excluded_tickets: null
        }
      );

      if (rpcError) {
        console.error(`[${requestId}] allocate_lucky_dip_tickets_batch RPC error:`, rpcError);
        return errorResponse(
          "Failed to reserve tickets",
          500,
          corsHeaders,
          { retryable: true, errorDetail: rpcError.message }
        );
      }

      // The RPC returns JSON with { success, reservation_id, ticket_numbers, ticket_count, error }
      let result;
      try {
        result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
      } catch (parseError) {
        console.error(`[${requestId}] Failed to parse RPC result:`, parseError);
        return errorResponse(
          "Invalid response format from reservation system",
          500,
          corsHeaders,
          { retryable: true }
        );
      }

      if (!result || !result.success) {
        const errorMsg = result?.error || 'Unknown error from allocation RPC';
        const errorDetail = result?.error_detail || result?.error || 'allocation_failed';
        console.error(`[${requestId}] Allocation RPC failed:`, errorMsg, result);
        return errorResponse(
          "Failed to reserve tickets",
          500,
          corsHeaders,
          { retryable: result?.retryable ?? true, errorDetail }
        );
      }

      if (!result.reservation_id || !result.ticket_numbers) {
        console.error(`[${requestId}] Invalid response from allocate_lucky_dip_tickets_batch:`, result);
        return errorResponse(
          "Invalid response from reservation system",
          500,
          corsHeaders,
          { retryable: true }
        );
      }

      const allocatedNumbers = Array.isArray(result.ticket_numbers) ? result.ticket_numbers : [];
      
      console.log(`[${requestId}] Successfully reserved ${allocatedNumbers.length} tickets`);

      return successResponse({
        reservationId: result.reservation_id,
        ticketNumbers: allocatedNumbers,
        ticketCount: allocatedNumbers.length,
        totalAmount: allocatedNumbers.length * validTicketPrice,
        expiresAt: new Date(Date.now() + holdMins * MINUTES_TO_MS).toISOString(),
        algorithm: 'allocate-lucky-dip-batch',
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
  } catch (topLevelError) {
    // CRITICAL: Last resort error handler that ALWAYS returns CORS headers
    // This catches errors that occur before corsHeaders can be built
    console.error('[FATAL] Top-level error in lucky-dip-reserve:', topLevelError);
    
    // Build CORS headers safely, even if request is malformed
    const origin = req.headers.get('origin');
    const safeCorsHeaders = buildCorsHeaders(origin);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error. Please try again.",
        errorCode: 500,
        retryable: true,
        errorDetail: topLevelError instanceof Error ? topLevelError.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...safeCorsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});

// Optional: If the client needs to read custom headers (like a request id),
// consider adding the following to buildCorsHeaders:
// 'Access-Control-Expose-Headers': 'request-id',
// and set it on responses:
// headers: { ...corsHeaders, "Content-Type": "application/json", "request-id": requestId }
