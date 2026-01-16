import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";

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
 * Reserve Tickets Function - Standalone Version with Flexible Authentication
 *
 * Updated to handle both Base wallet addresses and legacy Privy IDs without
 * requiring users to exist in canonical_users table.
 *
 * This function reserves specific ticket numbers for a user BEFORE payment.
 * Performs availability check and reservation directly using service role key
 * to bypass RLS restrictions - no RPC function required.
 *
 * User Identifier Handling:
 * - For Base auth: wallet address (0x...) is used directly as the user ID
 * - For legacy Privy: DID (did:privy:xxx) is used
 * - NO lookup in canonical_users required - just uses the ID as-is
 *
 * Flow:
 * 1. User selects tickets → Frontend calls this function
 * 2. Function checks availability of tickets (pending + sold)
 * 3. Creates reservation in pending_tickets table with 15-minute expiry
 * 4. User completes payment
 * 5. Payment webhook calls confirm-pending-tickets to finalize
 * 6. If payment fails/expires, cleanup job releases the tickets
 *
 * Error Codes:
 * - 400: Invalid input (missing fields, invalid ticket numbers, competition not active)
 * - 404: Competition not found
 * - 409: Tickets no longer available (conflict)
 * - 500: Server error
 */

// Helper to create consistent error responses
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

// Helper to create success responses
function successResponse(data: Record<string, unknown>, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Validate ticket numbers are valid integers
function validateTicketNumbers(tickets: unknown[]): { valid: boolean; invalidTickets: unknown[] } {
  const invalidTickets = tickets.filter(t =>
    typeof t !== 'number' ||
    !Number.isInteger(t) ||
    t < 1
  );
  return { valid: invalidTickets.length === 0, invalidTickets };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight - no auth required
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Get origin for CORS headers on all responses
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  // Only allow POST
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, corsHeaders);
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${requestId}] Reserve tickets request started`);

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
      selectedTickets,
      ticketPrice,
      sessionId
    } = body;

    // Accept flexible user identifiers (wallet address or Privy ID)
    // Priority: userId > userIdentifier > user_identifier > privy_user_id > user_id
    const inputUserId = userId || body.userIdentifier || body.user_identifier || body.privy_user_id || body.user_id;

    // Convert to canonical prize:pid: format
    const canonicalUserId = toPrizePid(inputUserId);
    console.log(`[${requestId}] Canonical user ID: ${canonicalUserId}`);

    // Accept both camelCase and snake_case parameter names for backwards compatibility
    // Some clients may send competition_id/tickets instead of competitionId/selectedTickets
    const resolvedCompetitionId = competitionId || body.competition_id;
    const resolvedSelectedTickets = selectedTickets || body.tickets;

    console.log(`[${requestId}] Parsed request body:`, {
      hasUserId: !!userId,
      hasInputUserId: !!inputUserId,
      hasCompetitionId: !!resolvedCompetitionId,
      hasSelectedTickets: !!resolvedSelectedTickets && Array.isArray(resolvedSelectedTickets),
      ticketCount: Array.isArray(resolvedSelectedTickets) ? resolvedSelectedTickets.length : 0,
      hasTicketPrice: ticketPrice !== undefined,
      hasSessionId: !!sessionId,
      canonicalUserId: canonicalUserId.substring(0, 20) + '...'
    });

    // Validate required fields
    if (!inputUserId || typeof inputUserId !== 'string') {
      console.error(`[${requestId}] Missing or invalid user identifier`);
      return errorResponse("userId (wallet address or Privy ID) is required and must be a string", 400, corsHeaders);
    }

    if (!resolvedCompetitionId || typeof resolvedCompetitionId !== 'string') {
      console.error(`[${requestId}] Missing or invalid competitionId`);
      return errorResponse("competitionId is required and must be a string", 400, corsHeaders);
    }

    if (!resolvedSelectedTickets || !Array.isArray(resolvedSelectedTickets) || resolvedSelectedTickets.length === 0) {
      console.error(`[${requestId}] Missing or invalid selectedTickets`);
      return errorResponse("selectedTickets array is required and must not be empty", 400, corsHeaders);
    }

    // Validate ticket numbers are valid integers
    const { valid, invalidTickets } = validateTicketNumbers(resolvedSelectedTickets);
    if (!valid) {
      console.error(`[${requestId}] Invalid ticket numbers:`, invalidTickets);
      return errorResponse(
        "All ticket numbers must be positive integers",
        400,
        corsHeaders,
        { invalidTickets }
      );
    }

    // Validate UUID format for competitionId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(resolvedCompetitionId)) {
      console.error(`[${requestId}] Invalid competitionId format: ${resolvedCompetitionId}`);
      return errorResponse("Invalid competition ID format", 400, corsHeaders);
    }

    // Get Supabase configuration
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${requestId}] Missing Supabase configuration`);
      return errorResponse("Server configuration error", 500, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Generate reservation details
    const reservationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Step 1: Verify competition exists and is active
    // Fetch both id (UUID) and uid (legacy text) since joincompetition stores competitionid
    // which may match either field depending on when the entry was created
    const { data: competition, error: compError } = await supabase
      .from("competitions")
      .select("id, uid, status, total_tickets, end_date, ticket_price")
      .eq("id", resolvedCompetitionId)
      .single();

    // DEBUG: Log competition query results to diagnose schema mismatches
    console.log(`[${requestId}] Competition row:`, competition);
    console.log(`[${requestId}] Competition error:`, compError);

    // Use ticket_price from competition if available, otherwise use provided ticketPrice or default to 1
    const competitionTicketPrice = competition?.ticket_price;
    const validTicketPrice = typeof ticketPrice === 'number' && ticketPrice > 0 
      ? ticketPrice 
      : (typeof competitionTicketPrice === 'number' && competitionTicketPrice > 0 ? competitionTicketPrice : 1);

    console.log(`[${requestId}] Attempting reservation:`, {
      canonicalUserId: canonicalUserId.substring(0, 20) + '...',
      competitionId: resolvedCompetitionId,
      ticketCount: resolvedSelectedTickets.length,
      tickets: resolvedSelectedTickets.slice(0, 10), // Log first 10 tickets
      ticketPrice: validTicketPrice,
      reservationId: reservationId.slice(0, 8)
    });

    if (compError || !competition) {
      console.error(`[${requestId}] Competition lookup error:`, compError);
      return errorResponse("Competition not found", 404, corsHeaders);
    }

    // IMPORTANT: Database stores status as "active" (not "live")
    // The frontend displays "live" but the DB value is "active"
    // All other edge functions only check for "active" so we must be consistent
    if (competition.status !== "active") {
      console.error(`[${requestId}] Competition not active: ${competition.status}`);
      return errorResponse("Competition is not currently active", 400, corsHeaders);
    }

    // Check if competition has ended - fail loudly on invalid date
    if (competition.end_date) {
      const endDate = new Date(competition.end_date);
      if (isNaN(endDate.getTime())) {
        console.error(`[${requestId}] Invalid end_date format:`, competition.end_date);
        return errorResponse("Competition configuration error: invalid end_date", 500, corsHeaders);
      }
      if (endDate < new Date()) {
        console.error(`[${requestId}] Competition has ended`);
        return errorResponse("Competition has ended", 400, corsHeaders);
      }
    }

    // Fail loudly if total_tickets is missing or invalid - don't silently default to 1000
    if (typeof competition.total_tickets !== "number" || !Number.isFinite(competition.total_tickets) || competition.total_tickets <= 0) {
      console.error(`[${requestId}] Missing or invalid total_tickets on competition row:`, competition);
      return errorResponse(
        "Competition configuration error: total_tickets missing or invalid",
        500,
        corsHeaders,
        { retryable: false }
      );
    }
    const maxTicket = competition.total_tickets;
    const outOfRange = (resolvedSelectedTickets as number[]).filter(t => t > maxTicket);
    if (outOfRange.length > 0) {
      console.error(`[${requestId}] Tickets out of range:`, outOfRange);
      return errorResponse(
        `Tickets out of range (max ${maxTicket}): ${outOfRange.join(", ")}`,
        400,
        corsHeaders
      );
    }

    // ==========================================================================
    // CANONICAL USER ID: Use prize:pid: format for all user operations
    //
    // The canonical format ensures consistency across the entire platform:
    // 1. All user IDs are stored as prize:pid:<id>
    // 2. Wallet addresses are normalized to lowercase
    // 3. Legacy Privy DIDs are converted to prize:pid: format
    //
    // This ensures the entire flow uses a consistent identifier:
    //   Frontend sends: 0x1234... or did:privy:xxx
    //   reserve-tickets stores: prize:pid:0x1234... (lowercase)
    //   confirm-pending-tickets queries: prize:pid:0x1234... -> MATCH!
    // ==========================================================================
    const resolvedUserId = canonicalUserId;
    console.log(`[${requestId}] Using canonical user ID: ${resolvedUserId}`);

    // Step 2: Get currently unavailable tickets
    const unavailableSet = new Set<number>();
    const now = new Date();

    // Get pending tickets (reserved but not yet paid)
    const { data: pendingData, error: pendingError } = await supabase
      .from("pending_tickets")
      .select("ticket_numbers, user_id, expires_at")
      .eq("competition_id", resolvedCompetitionId)
      .in("status", ["pending", "confirming"]);

    if (pendingError) {
      console.error(`[${requestId}] Error fetching pending tickets:`, pendingError);
      // Continue anyway - we'll still check sold tickets
    } else if (pendingData) {
      pendingData.forEach((row: { ticket_numbers: number[]; user_id: string; expires_at: string }) => {
        // Convert row user_id to canonical format for comparison
        const rowCanonicalUserId = toPrizePid(row.user_id);

        // Exclude the current user's own expired reservations
        if (rowCanonicalUserId === resolvedUserId && row.expires_at && new Date(row.expires_at) < now) {
          return;
        }
        // Include other users' pending tickets (and this user's non-expired ones)
        if (rowCanonicalUserId !== resolvedUserId && Array.isArray(row.ticket_numbers)) {
          row.ticket_numbers.forEach((n: number) => {
            if (Number.isFinite(n)) unavailableSet.add(n);
          });
        }
      });
    }

    // Get sold tickets from joincompetition
    // CRITICAL: joincompetition.competitionid is a TEXT field that may contain either:
    // - The competition.id (UUID) for newer entries
    // - The competition.uid (legacy text) for older entries
    // We must check BOTH to get accurate sold ticket counts
    const competitionUid = competition.uid || resolvedCompetitionId;
    const { data: soldData, error: soldError } = await supabase
      .from("joincompetition")
      .select("ticketnumbers")
      .or(`competitionid.eq.${resolvedCompetitionId},competitionid.eq.${competitionUid}`);

    if (soldError) {
      console.error(`[${requestId}] Error fetching sold tickets:`, soldError);
      // Continue anyway
    } else if (soldData) {
      soldData.forEach((row: { ticketnumbers: string | null }) => {
        const nums = String(row.ticketnumbers || "")
          .split(",")
          .map((x: string) => parseInt(x.trim(), 10))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        nums.forEach((n: number) => unavailableSet.add(n));
      });
    }

    // Step 3: Check if requested tickets are available
    const conflictingTickets = (resolvedSelectedTickets as number[]).filter(t => unavailableSet.has(t));
    if (conflictingTickets.length > 0) {
      console.error(`[${requestId}] Conflicting tickets:`, conflictingTickets);
      return errorResponse(
        "Some selected tickets are no longer available",
        409,
        corsHeaders,
        {
          unavailableTickets: conflictingTickets,
          retryable: true
        }
      );
    }

    // Step 4: Create reservation
    const totalAmount = validTicketPrice * resolvedSelectedTickets.length;

    // Use the resolved user ID (already normalized for wallet addresses)
    const { data: reservation, error: insertError } = await supabase
      .from("pending_tickets")
      .insert({
        id: reservationId,
        user_id: resolvedUserId,
        competition_id: resolvedCompetitionId,
        ticket_numbers: resolvedSelectedTickets,
        ticket_count: resolvedSelectedTickets.length,
        ticket_price: validTicketPrice,
        total_amount: totalAmount,
        status: "pending",
        expires_at: expiresAt.toISOString(),
        session_id: typeof sessionId === "string" ? sessionId : null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error(`[${requestId}] Error creating reservation:`, insertError);

      // Check for unique constraint violation (race condition - someone else got the tickets)
      if (insertError.code === "23505") {
        return errorResponse(
          "Some tickets were reserved by another user. Please try again.",
          409,
          corsHeaders,
          { retryable: true }
        );
      }

      return errorResponse(
        `Failed to create reservation: ${insertError.message}`,
        500,
        corsHeaders,
        { retryable: true }
      );
    }

    // SUCCESS: Reservation created
    console.log(`[${requestId}] Reservation successful:`, {
      reservationId,
      ticketCount: resolvedSelectedTickets.length,
      resolvedUserId: resolvedUserId.substring(0, 15) + '...'
    });

    return successResponse({
      reservationId,
      competitionId: resolvedCompetitionId,
      selectedTickets: resolvedSelectedTickets,
      ticketNumbers: resolvedSelectedTickets,
      ticketCount: resolvedSelectedTickets.length,
      ticketPrice: validTicketPrice,
      totalAmount,
      expiresAt: expiresAt.toISOString(),
      userIdentifier: resolvedUserId.substring(0, 15) + '...',
      message: `Successfully reserved ${resolvedSelectedTickets.length} tickets. Complete payment within 15 minutes.`
    }, corsHeaders);

  } catch (error) {
    // Catch-all for unexpected errors
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
