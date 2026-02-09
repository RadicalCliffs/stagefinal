import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Inlined userId utilities (bundler doesn't support shared module imports)
function isWalletAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(identifier);
}

function isPrizePid(identifier: string): boolean {
  return identifier.startsWith('prize:pid:');
}

function extractPrizePid(prizePid: string): string {
  if (!isPrizePid(prizePid)) return prizePid;
  return prizePid.substring('prize:pid:'.length);
}

function toPrizePid(inputUserId: string | null | undefined): string {
  if (!inputUserId || inputUserId.trim() === '') {
    return `prize:pid:${crypto.randomUUID()}`;
  }
  const trimmedId = inputUserId.trim();
  if (isPrizePid(trimmedId)) {
    const extracted = extractPrizePid(trimmedId);
    if (isWalletAddress(extracted)) {
      return `prize:pid:${extracted.toLowerCase()}`;
    }
    return trimmedId.toLowerCase();
  }
  if (isWalletAddress(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }
  // For any other identifier format, generate a new UUID
  return `prize:pid:${crypto.randomUUID()}`;
}

function normalizeWalletAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (isWalletAddress(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * BACKUP Reserve Tickets Function (reserve_tickets - underscore version)
 *
 * This is a redundant backup of the primary reserve-tickets function.
 * If the primary function fails, the frontend will automatically fallback to this one.
 * Both functions are identical in functionality to ensure maximum reliability.
 *
 * This ensures tickets can ALWAYS be reserved even if one function has deployment issues.
 */

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

// Note: isWalletAddress and normalizeWalletAddress imported from shared userId module

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

console.info("reserve_tickets (backup) function ready");

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
  console.log(`[${requestId}][BACKUP] Reserve tickets request started`);

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
    // Priority: userId > userIdentifier (camelCase) > user_identifier (snake_case) > privy_user_id > user_id
    const userIdentifier = userId || body.userIdentifier || body.user_identifier || body.privy_user_id || body.user_id;

    // Accept both camelCase and snake_case parameter names for backwards compatibility
    // Some clients may send competition_id/tickets instead of competitionId/selectedTickets
    // Also accept ticket_numbers or ticketIds for flexibility
    const resolvedCompetitionId = competitionId || body.competition_id;
    const resolvedSelectedTickets = selectedTickets || body.ticket_numbers || body.ticketIds || body.ticketNumbers || body.tickets;

    // Log all body keys for debugging payload issues
    console.log(`[${requestId}][BACKUP] Request body keys:`, Object.keys(body));
    console.log(`[${requestId}][BACKUP] Parsed request body:`, {
      hasUserId: !!userId,
      hasUserIdentifier: !!userIdentifier,
      hasCompetitionId: !!resolvedCompetitionId,
      hasSelectedTickets: !!resolvedSelectedTickets && Array.isArray(resolvedSelectedTickets),
      ticketCount: Array.isArray(resolvedSelectedTickets) ? resolvedSelectedTickets.length : 0,
      hasTicketPrice: ticketPrice !== undefined,
      hasSessionId: !!sessionId,
      isWalletAddress: userIdentifier ? isWalletAddress(String(userIdentifier)) : false,
      // Log if client sent ticketCount instead of array (common mistake)
      sentTicketCountInstead: body.ticketCount !== undefined && !resolvedSelectedTickets,
    });

    // Validate required fields
    if (!userIdentifier || typeof userIdentifier !== 'string') {
      console.error(`[${requestId}] Missing or invalid user identifier`);
      return errorResponse("userId (wallet address or Privy ID) is required and must be a string", 400, corsHeaders);
    }

    if (!resolvedCompetitionId || typeof resolvedCompetitionId !== 'string') {
      console.error(`[${requestId}] Missing or invalid competitionId`);
      return errorResponse("competitionId is required and must be a string", 400, corsHeaders);
    }

    if (!resolvedSelectedTickets || !Array.isArray(resolvedSelectedTickets) || resolvedSelectedTickets.length === 0) {
      console.error(`[${requestId}] Missing or invalid selectedTickets. Body keys: ${Object.keys(body).join(', ')}`);
      // Provide clear error message explaining what's expected vs what was received
      const receivedKeys = Object.keys(body).join(', ');
      const hasTicketCount = body.ticketCount !== undefined;
      const errorMsg = hasTicketCount
        ? "ticket_numbers/selectedTickets array is required; ticketCount (number) is not accepted. Please send the actual ticket numbers array."
        : `selectedTickets array is required and must not be empty. Received keys: ${receivedKeys}`;
      return errorResponse(errorMsg, 400, corsHeaders, {
        hint: "Send body with: { userId, competitionId, selectedTickets: [1, 2, 3, ...] }",
        receivedKeys: Object.keys(body),
      });
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
    const { data: competition, error: compError } = await supabase
      .from("competitions")
      .select("id, uid, status, total_tickets, end_date, ticket_price")
      .eq("id", resolvedCompetitionId)
      .single();

    console.log(`[${requestId}][BACKUP] Competition row:`, competition);
    console.log(`[${requestId}][BACKUP] Competition error:`, compError);

    // Use ticket_price from competition if available, otherwise use provided ticketPrice or default to 1
    const competitionTicketPrice = competition?.ticket_price;
    const validTicketPrice = typeof ticketPrice === 'number' && ticketPrice > 0 
      ? ticketPrice 
      : (typeof competitionTicketPrice === 'number' && competitionTicketPrice > 0 ? competitionTicketPrice : 1);

    console.log(`[${requestId}][BACKUP] Attempting reservation:`, {
      userIdentifier: userIdentifier.substring(0, 15) + '...',
      isWalletAddress: isWalletAddress(userIdentifier),
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

    // Database stores status as "active" (not "live")
    if (competition.status !== "active") {
      console.error(`[${requestId}] Competition not active: ${competition.status}`);
      return errorResponse("Competition is not currently active", 400, corsHeaders);
    }

    // Check if competition has ended
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

    // Validate total_tickets
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
    // ==========================================================================
    const canonicalUserId = toPrizePid(userIdentifier);
    console.log(`[${requestId}][BACKUP] Canonical user ID: ${canonicalUserId}`);

    const resolvedUserId = canonicalUserId;
    console.log(`[${requestId}][BACKUP] Using canonical user ID for reservation`);

    console.log(`[${requestId}][BACKUP] Resolved user:`, {
      originalIdentifier: userIdentifier.substring(0, 15) + '...',
      resolvedUserId: resolvedUserId.substring(0, 20) + '...',
      isWalletAddress: isWalletAddress(userIdentifier)
    });

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
    const competitionUid = competition.uid || resolvedCompetitionId;
    const { data: soldData, error: soldError } = await supabase
      .from("joincompetition")
      .select("ticketnumbers")
      .or(`competitionid.eq.${resolvedCompetitionId},competitionid.eq.${competitionUid}`);

    if (soldError) {
      console.error(`[${requestId}] Error fetching sold tickets:`, soldError);
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

      // Check for unique constraint violation (race condition)
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
    console.log(`[${requestId}][BACKUP] Reservation successful:`, {
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
      message: `Successfully reserved ${resolvedSelectedTickets.length} tickets. Complete payment within 15 minutes.`,
      source: 'backup_function' // Indicator that backup function was used
    }, corsHeaders);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${requestId}][BACKUP] Unexpected error:`, errorMessage);

    return errorResponse(
      "An unexpected error occurred. Please try again.",
      500,
      corsHeaders,
      { retryable: true }
    );
  }
});
