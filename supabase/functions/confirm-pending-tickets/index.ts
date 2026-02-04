import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Inlined userId utilities (bundler doesn't support shared module imports)
function isWalletAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(identifier);
}

function isPrizePid(identifier: string): boolean {
  return identifier.startsWith('prize:pid:');
}

function extractPrizePid(prizePid: string): string {
  if (!isPrizePid(prizePid)) {
    return prizePid;
  }
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

// Inlined ticket assignment helpers (bundler doesn't support shared module imports)
interface AssignTicketsParams {
  supabase: SupabaseClient;
  userIdentifier: string;
  privyUserId?: string;
  competitionId: string;
  orderId?: string | null;
  ticketCount: number;
  preferredTicketNumbers?: number[];
}

interface AssignTicketsResult {
  ticketNumbers: number[];
}

function pickRandomUnique<T>(arr: T[], count: number): T[] {
  const result: T[] = [];
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  for (let i = 0; i < count && i < copy.length; i++) {
    result.push(copy[i]);
  }
  return result;
}

async function assignTickets(params: AssignTicketsParams): Promise<AssignTicketsResult> {
  const { supabase, competitionId, orderId, ticketCount, preferredTicketNumbers } = params;
  const inputIdentifier = params.userIdentifier || params.privyUserId;
  
  // Convert to canonical format
  const userIdentifier = toPrizePid(inputIdentifier);

  if (!userIdentifier) throw new Error("assignTickets: userIdentifier (wallet address or privy_user_id) is required");
  if (!competitionId) throw new Error("assignTickets: competitionId is required");
  if (!Number.isFinite(ticketCount) || ticketCount <= 0) throw new Error("assignTickets: ticketCount must be > 0");

  if (orderId) {
    const { data: existingOrderTickets, error: existingOrderTicketsError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("order_id", orderId);

    if (existingOrderTicketsError) {
      console.error("assignTickets: error reading existing order tickets", existingOrderTicketsError);
    } else if (existingOrderTickets && existingOrderTickets.length > 0) {
      return { ticketNumbers: existingOrderTickets.map((t: any) => Number(t.ticket_number)) };
    }
  }

  const { data: competition, error: competitionError } = await supabase
    .from("competitions")
    .select("total_tickets, status")
    .eq("id", competitionId)
    .maybeSingle();

  if (competitionError) {
    console.warn("assignTickets: unable to read competition", competitionError);
    throw new Error("assignTickets: competition not found or error reading competition");
  }

  if (competition?.status && competition.status !== "active") {
    throw new Error(`assignTickets: competition is not active (status: ${competition.status})`);
  }

  const maxTickets = Number(competition?.total_tickets) || 0;
  if (maxTickets === 0) {
    throw new Error("assignTickets: competition has no tickets configured");
  }

  const { data: usedTickets, error: usedError } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("competition_id", competitionId);

  if (usedError) {
    console.error("assignTickets: error reading used tickets", usedError);
    throw usedError;
  }

  const usedSet = new Set<number>((usedTickets || []).map((t: any) => Number(t.ticket_number)));

  const availableCount = maxTickets - usedSet.size;
  if (availableCount <= 0) {
    throw new Error("assignTickets: competition is sold out - no tickets available");
  }

  if (ticketCount > availableCount) {
    throw new Error(`assignTickets: cannot allocate ${ticketCount} tickets, only ${availableCount} available`);
  }

  let finalTicketNumbers: number[] = [];
  const preferred: number[] = Array.isArray(preferredTicketNumbers)
    ? preferredTicketNumbers.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1 && n <= maxTickets)
    : [];

  for (const n of preferred) {
    if (!usedSet.has(n)) {
      finalTicketNumbers.push(n);
      usedSet.add(n);
      if (finalTicketNumbers.length >= ticketCount) break;
    }
  }

  const remainingCount = ticketCount - finalTicketNumbers.length;
  if (remainingCount > 0) {
    const available: number[] = [];
    for (let n = 1; n <= maxTickets; n++) {
      if (!usedSet.has(n)) available.push(n);
      if (available.length >= remainingCount * 5) break;
    }

    if (available.length < remainingCount) {
      throw new Error(`assignTickets: not enough available tickets - need ${remainingCount}, found ${available.length}`);
    }

    const picked = pickRandomUnique(available, remainingCount);
    finalTicketNumbers.push(...picked);
  }

  const maxRetries = 3;
  let successfullyInserted: number[] = [];
  let remainingToInsert = [...finalTicketNumbers];

  for (let attempt = 0; attempt < maxRetries && remainingToInsert.length > 0; attempt++) {
    const rows = remainingToInsert.map(num => ({
      competition_id: competitionId,
      order_id: orderId ?? null,
      ticket_number: num,
      user_id: userIdentifier,
    }));

    const { error: insertError } = await supabase.from("tickets").insert(rows);

    if (!insertError) {
      successfullyInserted.push(...remainingToInsert);
      remainingToInsert = [];
      break;
    }

    const isConflictError = insertError.code === '23505' ||
      insertError.message?.includes('unique') ||
      insertError.message?.includes('duplicate');

    if (!isConflictError) {
      console.error("assignTickets: error inserting tickets", insertError);
      throw insertError;
    }

    console.warn(`assignTickets: conflict on attempt ${attempt + 1}, retrying with fresh ticket selection`);

    const { data: currentUsedTickets, error: refetchError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", competitionId);

    if (refetchError) {
      console.error("assignTickets: error re-fetching used tickets", refetchError);
      throw refetchError;
    }

    const currentUsedSet = new Set<number>((currentUsedTickets || []).map((t: any) => Number(t.ticket_number)));

    const currentAvailable = maxTickets - currentUsedSet.size;
    if (currentAvailable < remainingToInsert.length) {
      throw new Error(`assignTickets: competition became sold out during allocation - only ${currentAvailable} tickets remain`);
    }

    const stillAvailable = remainingToInsert.filter(n => !currentUsedSet.has(n));
    const needToReplace = remainingToInsert.length - stillAvailable.length;

    const newAvailable: number[] = [];
    for (let n = 1; n <= maxTickets && newAvailable.length < needToReplace * 5; n++) {
      if (!currentUsedSet.has(n) && !stillAvailable.includes(n)) {
        newAvailable.push(n);
      }
    }

    if (newAvailable.length < needToReplace) {
      throw new Error("assignTickets: not enough available tickets remain after conflict resolution");
    }

    const replacements = pickRandomUnique(newAvailable, needToReplace);
    remainingToInsert = [...stillAvailable, ...replacements];
    finalTicketNumbers = [...successfullyInserted, ...remainingToInsert];
  }

  if (remainingToInsert.length > 0) {
    throw new Error("assignTickets: failed to insert tickets after multiple retries");
  }

  return { ticketNumbers: finalTicketNumbers };
}

/**
 * Confirm Pending Tickets Function
 *
 * Called by payment webhooks after successful payment to:
 * 1. Move tickets from pending_tickets to joincompetition (confirmed) - for prescribed tickets
 * 2. Allocate random tickets - for lucky dips (when no reservation exists)
 * 3. Update pending_tickets status to "confirmed"
 * 4. Check for instant win prizes
 *
 * This is the "impossible to fail" confirmation step.
 */

Deno.serve(async (req: Request) => {
  // Handle CORS preflight - no auth required
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Get origin for CORS headers on all responses
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  // Health check endpoint: GET request returns health status
  if (req.method === "GET") {
    const incidentId = `health-check-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const timestamp = new Date().toISOString();
    
    const checks: Record<string, { status: "pass" | "fail" | "warn"; message: string; details?: any }> = {};
    let overallHealthy = true;

    // Check environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl) {
      checks.env_supabase_url = {
        status: "fail",
        message: "Missing SUPABASE_URL environment variable",
      };
      overallHealthy = false;
    } else {
      checks.env_supabase_url = {
        status: "pass",
        message: "Supabase URL configured",
        details: { url: supabaseUrl.substring(0, 30) + "..." },
      };
    }

    if (!serviceRoleKey) {
      checks.env_service_role_key = {
        status: "fail",
        message: "Missing SUPABASE_SERVICE_ROLE_KEY environment variable",
      };
      overallHealthy = false;
    } else {
      checks.env_service_role_key = {
        status: "pass",
        message: "Service role key configured",
        details: { keyLength: serviceRoleKey.length },
      };
    }

    // Test database connectivity
    if (supabaseUrl && serviceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        // Test basic query
        const { error: compError } = await supabase
          .from("competitions")
          .select("id")
          .limit(1);

        if (compError) {
          checks.database_connection = {
            status: "fail",
            message: "Failed to query database",
            details: { error: compError.message },
          };
          overallHealthy = false;
        } else {
          checks.database_connection = {
            status: "pass",
            message: "Database connection successful",
          };
        }

        // Test pending_tickets table
        const { error: ptError } = await supabase
          .from("pending_tickets")
          .select("id")
          .limit(1);

        if (ptError) {
          checks.pending_tickets_table = {
            status: "fail",
            message: "pending_tickets table not accessible",
            details: { error: ptError.message },
          };
          overallHealthy = false;
        } else {
          checks.pending_tickets_table = {
            status: "pass",
            message: "pending_tickets table accessible",
          };
        }

        // Test incident log table
        const { error: logError } = await supabase
          .from("confirmation_incident_log")
          .select("id")
          .limit(1);

        if (logError) {
          checks.incident_log_table = {
            status: "warn",
            message: "Incident log table not accessible - logging may not work",
            details: { error: logError.message },
          };
        } else {
          checks.incident_log_table = {
            status: "pass",
            message: "Incident log table accessible",
          };
        }

      } catch (e) {
        checks.database_connection = {
          status: "fail",
          message: "Exception testing database connection",
          details: { error: e instanceof Error ? e.message : String(e) },
        };
        overallHealthy = false;
      }
    }

    const response = {
      healthy: overallHealthy,
      timestamp,
      incidentId,
      source: "supabase_function",
      endpoint: "/confirm-pending-tickets",
      environment: {
        deno: true,
        denoVersion: Deno.version.deno,
        v8Version: Deno.version.v8,
        typescriptVersion: Deno.version.typescript,
      },
      checks,
    };

    const statusCode = overallHealthy ? 200 : 503;

    console.log(`[Health Check] ${overallHealthy ? "✅ PASS" : "❌ FAIL"} - ${timestamp} - incident: ${incidentId}`);

    return new Response(
      JSON.stringify(response, null, 2),
      { 
        status: statusCode, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  // Declare requestBody at top level for error handler access
  let requestBody: any = {};

  try {
    // Parse JSON with error handling
    try {
      requestBody = await req.json();
    } catch (jsonError) {
      console.error("Failed to parse request JSON:", jsonError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid JSON in request body",
          message: "Request must contain valid JSON"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const {
      reservationId,  // The pending ticket reservation ID
      userId,         // User ID (for fallback lookup)
      competitionId,  // Competition ID (for fallback lookup)
      transactionHash, // Payment transaction hash
      paymentProvider, // "privy_base_wallet" | "coinbase" | "balance" | "onchainkit_checkout"
      walletAddress,  // Wallet address that made the payment
      network,        // Network for the transaction (e.g., "base")
      sessionId,      // Payment session ID (for lookup)
      selectedTickets, // Direct selected tickets array (for non-reservation flows)
      ticketCount: requestedTicketCount // Ticket count passed from payment service
    } = requestBody;

    // Convert to canonical prize:pid: format IMMEDIATELY for consistent matching
    const canonicalUserId = toPrizePid(userId);
    console.log(`[Confirm Tickets] Canonical user ID: ${canonicalUserId}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // STEP 1: Find the pending reservation
    let reservation: any = null;
    let reservationAlreadyConfirming = false;

    console.log("[Confirm Tickets] Looking for reservation:", {
      reservationId,
      sessionId,
      canonicalUserId: canonicalUserId.substring(0, 20) + '...',
      competitionId,
      requestedTicketCount,
    });

    // Try by reservationId first
    if (reservationId) {
      const { data, error } = await supabase
        .from("pending_tickets")
        .select("*")
        .eq("id", reservationId)
        .eq("status", "pending")
        .maybeSingle();
      reservation = data;
      console.log("[Confirm Tickets] Lookup by reservationId result:", {
        found: !!data,
        error: error?.message,
        ticketCount: data?.ticket_numbers?.length,
      });

      // If not found with pending, check if it's in confirming/confirmed state
      if (!reservation) {
        const { data: existingRes } = await supabase
          .from("pending_tickets")
          .select("*")
          .eq("id", reservationId)
          .in("status", ["confirming", "confirmed"])
          .maybeSingle();

        if (existingRes) {
          reservationAlreadyConfirming = true;
          reservation = existingRes;
        }
      }
    }

    // Fallback: try by sessionId
    if (!reservation && sessionId) {
      const { data } = await supabase
        .from("pending_tickets")
        .select("*")
        .eq("session_id", sessionId)
        .eq("status", "pending")
        .maybeSingle();
      reservation = data;

      // If not found with pending, check if it's in confirming/confirmed state
      if (!reservation) {
        const { data: existingRes } = await supabase
          .from("pending_tickets")
          .select("*")
          .eq("session_id", sessionId)
          .in("status", ["confirming", "confirmed"])
          .maybeSingle();

        if (existingRes) {
          reservationAlreadyConfirming = true;
          reservation = existingRes;
        }
      }
    }

    // Fallback: try by userId + competitionId (most recent pending)
    // Use canonical userId for consistent matching
    if (!reservation && canonicalUserId && competitionId) {
      console.log(`[Confirm Tickets] Fallback lookup for canonical userId: ${canonicalUserId.substring(0, 20)}...`);

      // Try exact match with canonical ID
      let { data } = await supabase
        .from("pending_tickets")
        .select("*")
        .eq("user_id", canonicalUserId)
        .eq("competition_id", competitionId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // If not found, also try with the original userId for backward compatibility during transition
      if (!data && userId) {
        console.log(`[Confirm Tickets] Exact fallback failed, trying with original userId for backward compatibility`);
        const altCanonicalId = toPrizePid(userId);
        if (altCanonicalId !== canonicalUserId) {
          const { data: altData } = await supabase
            .from("pending_tickets")
            .select("*")
            .eq("user_id", userId)
            .eq("competition_id", competitionId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          data = altData;
        }
      }

      reservation = data;
    }

    // SAFEGUARD: If reservation was already in confirming/confirmed state, return existing entry
    if (reservationAlreadyConfirming && reservation) {
      const txHash = transactionHash || reservation.id;
      const { data: existingEntry } = await supabase
        .from("joincompetition")
        .select("uid, ticketnumbers, numberoftickets, amountspent")
        .eq("competitionid", reservation.competition_id)
        .eq("transactionhash", txHash)
        .maybeSingle();

      if (existingEntry) {
        console.log(`[Confirm Tickets] Reservation ${reservationId} already confirmed, returning existing entry`);
        const existingTicketNumbers = String(existingEntry.ticketnumbers || "")
          .split(",")
          .map((x: string) => parseInt(x.trim(), 10))
          .filter((n: number) => Number.isFinite(n));

        return new Response(
          JSON.stringify({
            success: true,
            reservationId: reservation.id,
            ticketNumbers: existingTicketNumbers,
            ticketCount: existingEntry.numberoftickets || existingTicketNumbers.length,
            totalAmount: existingEntry.amountspent || 0,
            message: `Already confirmed ${existingTicketNumbers.length} tickets.`,
            alreadyConfirmed: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Reservation is being processed, return in-progress response
      const resTicketNumbers = (reservation.ticket_numbers || []).map((n: any) => Number(n));
      console.log(`[Confirm Tickets] Reservation ${reservationId} in progress, returning pending success`);
      return new Response(
        JSON.stringify({
          success: true,
          reservationId: reservation.id,
          ticketNumbers: resTicketNumbers,
          ticketCount: resTicketNumbers.length,
          totalAmount: reservation.total_amount,
          message: `Confirmation in progress for ${resTicketNumbers.length} tickets.`,
          confirmationInProgress: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If no reservation found, this is a lucky dip (random allocation)
    if (!reservation) {
      console.log("No reservation found - handling as lucky dip (random allocation)");
      console.log("[Lucky Dip Debug] Input params:", {
        requestedTicketCount,
        requestedTicketCountType: typeof requestedTicketCount,
        sessionId,
        selectedTicketsLength: Array.isArray(selectedTickets) ? selectedTickets.length : 'not array',
        selectedTicketsSample: Array.isArray(selectedTickets) ? selectedTickets.slice(0, 5) : selectedTickets,
      });

      // Validate required fields for random allocation
      if (!canonicalUserId || !competitionId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Missing userId or competitionId for random ticket allocation"
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // SAFEGUARD 1: Check for existing joincompetition entry with same transactionHash or sessionId
      // This prevents duplicate entries from retry logic
      const lookupTxHash = transactionHash || sessionId;
      if (lookupTxHash) {
        const { data: existingEntry } = await supabase
          .from("joincompetition")
          .select("uid, ticketnumbers, numberoftickets, amountspent")
          .eq("competitionid", competitionId)
          .eq("transactionhash", lookupTxHash)
          .maybeSingle();

        if (existingEntry) {
          console.log(`[Confirm Tickets] Lucky Dip: Already confirmed entry found for txHash=${lookupTxHash}, returning existing`);
          const existingTicketNumbers = String(existingEntry.ticketnumbers || "")
            .split(",")
            .map((x: string) => parseInt(x.trim(), 10))
            .filter((n: number) => Number.isFinite(n));

          return new Response(
            JSON.stringify({
              success: true,
              ticketNumbers: existingTicketNumbers,
              ticketCount: existingEntry.numberoftickets || existingTicketNumbers.length,
              totalAmount: existingEntry.amountspent || 0,
              message: `Already confirmed ${existingTicketNumbers.length} tickets.`,
              alreadyConfirmed: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Get ticket count from request, transaction, or use default
      // Priority: requestedTicketCount > selectedTickets.length > transaction lookup > default of 1
      // IMPORTANT: requestedTicketCount can be 0, null, undefined, or a valid number
      // We need to handle these cases properly to avoid always defaulting to 1
      let ticketCount = 1; // Default fallback

      // First priority: use requestedTicketCount if it's a positive number
      const parsedRequestedCount = Number(requestedTicketCount);
      if (Number.isFinite(parsedRequestedCount) && parsedRequestedCount > 0) {
        ticketCount = parsedRequestedCount;
        console.log("[Lucky Dip Debug] Using requestedTicketCount:", ticketCount);
      } else if (Array.isArray(selectedTickets) && selectedTickets.length > 0) {
        // Second priority: use selectedTickets length if provided
        ticketCount = selectedTickets.length;
        console.log("[Lucky Dip Debug] Using selectedTickets.length:", ticketCount);
      }

      console.log("[Lucky Dip Debug] Initial ticketCount determined:", ticketCount);

      // If ticketCount is still the default (1), try to look it up from transaction
      // This is a fallback when neither requestedTicketCount nor selectedTickets were provided
      if (ticketCount === 1 && sessionId) {
        console.log("[Lucky Dip Debug] Looking up ticket_count from transaction:", sessionId);
        const { data: txData } = await supabase
          .from("user_transactions")
          .select("ticket_count")
          .eq("id", sessionId)
          .maybeSingle();
        const txTicketCount = txData?.ticket_count;
        console.log("[Lucky Dip Debug] Transaction lookup result:", { txTicketCount });
        if (txTicketCount && Number(txTicketCount) > 0) {
          ticketCount = Number(txTicketCount);
        }
      }

      // Parse selectedTickets if provided directly
      const preferredTickets = Array.isArray(selectedTickets) && selectedTickets.length > 0
        ? selectedTickets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
        : [];

      console.log("[Lucky Dip Debug] Parsed preferredTickets:", {
        length: preferredTickets.length,
        sample: preferredTickets.slice(0, 5),
      });

      // IMPORTANT: Only use preferredTickets.length if explicitly passed AND they are available
      // The ticketCount from request takes priority as it represents what the user paid for
      // preferredTickets are just hints for which specific numbers to try first
      // DO NOT override ticketCount with preferredTickets.length - the user paid for ticketCount tickets!
      console.log("[Lucky Dip Debug] Final ticketCount to allocate:", ticketCount);

      // Allocate tickets using shared helper (with preferred tickets if provided)
      // Use canonical user ID for consistent storage
      console.log(`Allocating ${ticketCount} tickets for user ${canonicalUserId} in competition ${competitionId}, preferred: ${preferredTickets.length}`);
      const assigned = await assignTickets({
        supabase,
        userIdentifier: canonicalUserId,
        competitionId: competitionId,
        orderId: sessionId || null,
        ticketCount,
        preferredTicketNumbers: preferredTickets.length > 0 ? preferredTickets : undefined,
      });

      const ticketNumbers = assigned.ticketNumbers;
      console.log(`Assigned tickets: ${ticketNumbers.join(", ")}`);

      // Get user's wallet address and email
      let userWalletAddress: string | null = null;

      // Extract wallet address from canonical ID if it's a wallet-based ID
      // Validate that canonicalUserId has the expected format
      if (canonicalUserId.startsWith('prize:pid:')) {
        const extractedId = canonicalUserId.substring('prize:pid:'.length);
        const isWalletBased = /^0x[a-fA-F0-9]{40}$/i.test(extractedId);
        
        if (isWalletBased) {
          userWalletAddress = extractedId.toLowerCase();
        }
      }

      // Look up user in canonical_users by canonical ID
      const { data: userData } = await supabase
        .from("canonical_users")
        .select("wallet_address, email, canonical_user_id")
        .eq("canonical_user_id", canonicalUserId)
        .maybeSingle();

      // Use stored wallet address if found
      if (userData?.wallet_address) {
        userWalletAddress = userData.wallet_address;
      }

      // Use wallet address found from lookup
      const walletAddress = userWalletAddress;

      // Get ticket price from competition
      const { data: compData } = await supabase
        .from("competitions")
        .select("ticket_price")
        .eq("id", competitionId)
        .maybeSingle();

      const ticketPrice = compData?.ticket_price || 1;
      const totalAmount = ticketPrice * ticketCount;

      // Create joincompetition entry
      // Note: userid stores the canonical user identifier (prize:pid: format)
      // This ensures consistent user ID format across all ticket purchases
      const joinCompetitionEntry = {
        uid: crypto.randomUUID(),
        competitionid: competitionId,
        userid: canonicalUserId,
        numberoftickets: ticketNumbers.length,
        ticketnumbers: ticketNumbers.join(","),
        amountspent: totalAmount,
        wallet_address: walletAddress,
        chain: paymentProvider || "USDC",
        transactionhash: transactionHash || sessionId || crypto.randomUUID(),
        purchasedate: new Date().toISOString(),
      };

      const { error: joinError } = await supabase
        .from("joincompetition")
        .insert(joinCompetitionEntry);

      if (joinError) {
        console.error("Error creating joincompetition entry:", joinError);
      }

      // NOTE: Individual ticket records are already created by assignTickets() above
      // Do NOT insert into tickets table again here - that would cause duplicates

      // Check for instant wins
      const instantWins: any[] = [];
      const { data: competition } = await supabase
        .from("competitions")
        .select("is_instant_win, total_tickets, status, title")
        .eq("id", competitionId)
        .maybeSingle();

      if (competition?.is_instant_win) {
        for (const ticketNum of ticketNumbers) {
          const { data: prize, error: prizeErr } = await supabase
            .from("Prize_Instantprizes")
            .select("*")
            .eq("competitionId", competitionId)
            .eq("winningTicket", ticketNum)
            .is("winningWalletAddress", null)
            .maybeSingle();

          if (!prizeErr && prize) {
            const { error: winUpdateErr } = await supabase
              .from("Prize_Instantprizes")
              .update({
                winningWalletAddress: walletAddress,
                winningUserId: userId,
                wonAt: new Date().toISOString()
              })
              .eq("UID", prize.UID);

            if (!winUpdateErr) {
              instantWins.push({
                ticketNumber: ticketNum,
                prize: prize.prize,
                prizeId: prize.UID
              });
            }
          }
        }
      }

      // Check if competition is now sold out and trigger drawing if so (Lucky Dip path)
      let soldOutTriggered = false;
      try {
        if (competition && competition.status === "active" && competition.total_tickets > 0) {
          // Count all sold tickets using RPC that handles both UUID and legacy uid
          const { data: ticketCountResult, error: countError } = await supabase
            .rpc('count_sold_tickets_for_competition', {
              p_competition_id: competitionId
            });

          let totalSoldTickets = 0;
          if (!countError && ticketCountResult !== null) {
            totalSoldTickets = Number(ticketCountResult);
          } else {
            // Fallback: Count from direct query (may miss entries with legacy uid)
            console.warn('[Sold Out Check - Lucky Dip] RPC count failed, using fallback:', countError?.message);
            const { data: soldEntries } = await supabase
              .from("joincompetition")
              .select("ticketnumbers")
              .eq("competitionid", competitionId);

            (soldEntries || []).forEach((entry: any) => {
              if (entry.ticketnumbers) {
                const nums = entry.ticketnumbers.split(",").filter((n: string) => n.trim() !== "");
                totalSoldTickets += nums.length;
              }
            });
          }

          console.log(`[Sold Out Check - Lucky Dip] Competition ${competitionId}: ${totalSoldTickets}/${competition.total_tickets} tickets sold`);

          // Check if all tickets are sold
          if (totalSoldTickets >= competition.total_tickets) {
            console.log(`[Sold Out - Lucky Dip] Competition ${competitionId} is SOLD OUT! Triggering draw...`);
            soldOutTriggered = true;

            if (competition.is_instant_win) {
              // For instant win: just mark as completed
              await supabase
                .from("competitions")
                .update({
                  status: "completed",
                  competitionended: 1,
                  draw_date: new Date().toISOString()
                })
                .eq("id", competitionId);
              console.log(`[Sold Out - Lucky Dip] Instant win competition ${competitionId} marked as completed`);
            } else {
              // For standard competitions: select a winner
              // Use RPC to get entries with both UUID and legacy uid
              const { data: entriesFromRpc, error: rpcError } = await supabase
                .rpc('get_joincompetition_entries_for_competition', {
                  p_competition_id: competitionId
                });

              let entriesWithUser = entriesFromRpc;
              if (rpcError || !entriesFromRpc) {
                console.warn('[Sold Out - Lucky Dip] RPC get entries failed, using fallback:', rpcError?.message);
                const { data: fallbackEntries } = await supabase
                  .from("joincompetition")
                  .select("*")
                  .eq("competitionid", competitionId);
                entriesWithUser = fallbackEntries;
              }

              const allTicketNumbers: number[] = [];
              const ticketToEntry = new Map<number, any>();
              (entriesWithUser || []).forEach((entry: any) => {
                if (entry.ticketnumbers) {
                  const nums = entry.ticketnumbers.split(",").map((n: string) => parseInt(n.trim())).filter((n: number) => !isNaN(n));
                  nums.forEach((num: number) => {
                    allTicketNumbers.push(num);
                    ticketToEntry.set(num, entry);
                  });
                }
              });

              // Use VRF pre-generated numbers to select winner
              try {
                const vrfResponse = await fetch(
                  `${supabaseUrl}/functions/v1/vrf-draw-winner`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${serviceRoleKey}`
                    },
                    body: JSON.stringify({ competition_id: competitionId })
                  }
                );
                
                if (!vrfResponse.ok) {
                  const errorText = await vrfResponse.text();
                  throw new Error(`VRF HTTP ${vrfResponse.status}: ${errorText}`);
                }
                
                const vrfResult = await vrfResponse.json();
                console.log(`[Sold Out - Lucky Dip] VRF draw winner result:`, vrfResult);
                
                if (!vrfResult.ok) {
                  throw new Error(vrfResult.error || 'VRF draw failed');
                }
              } catch (vrfErr) {
                console.error('[Sold Out - Lucky Dip] VRF draw winner failed:', vrfErr);
              }
            }
          }
        }
      } catch (soldOutErr) {
        console.error("Error checking/processing sold out competition (lucky dip):", soldOutErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          ticketNumbers,
          ticketCount: ticketNumbers.length,
          totalAmount,
          instantWins: instantWins.length > 0 ? instantWins : undefined,
          soldOut: soldOutTriggered,
          message: soldOutTriggered
            ? `Lucky dip tickets confirmed! Competition is now SOLD OUT - winner has been drawn!`
            : instantWins.length > 0
              ? `Lucky dip tickets confirmed! You won ${instantWins.length} instant prize(s)!`
              : `Successfully confirmed ${ticketNumbers.length} random tickets.`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if reservation has expired
    if (new Date(reservation.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from("pending_tickets")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", reservation.id);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Reservation has expired. Please select tickets again.",
          expiredAt: reservation.expires_at
        }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ticketNumbers: number[] = reservation.ticket_numbers || [];
    const finalUserId = reservation.user_id;
    const finalCompetitionId = reservation.competition_id;

    // Generate stable transaction hash for idempotency
    const finalTransactionHash = transactionHash || reservation.id;

    // SAFEGUARD 1: Atomically update reservation status to 'confirming' FIRST
    // This prevents race conditions where multiple requests try to confirm the same reservation
    // Only proceed if we successfully update from 'pending' to 'confirming'
    const { data: lockResult, error: lockError } = await supabase
      .from("pending_tickets")
      .update({
        status: "confirming",
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservation.id)
      .eq("status", "pending") // Only update if still pending (atomic lock)
      .select("id")
      .maybeSingle();

    if (lockError || !lockResult) {
      // Another request already started confirming this reservation
      // Check if it's already fully confirmed and return the existing entry
      const { data: currentReservation } = await supabase
        .from("pending_tickets")
        .select("status")
        .eq("id", reservation.id)
        .maybeSingle();

      if (currentReservation?.status === "confirmed" || currentReservation?.status === "confirming") {
        // Look up the existing joincompetition entry
        const { data: existingEntry } = await supabase
          .from("joincompetition")
          .select("uid, ticketnumbers, numberoftickets, amountspent")
          .eq("competitionid", finalCompetitionId)
          .eq("transactionhash", finalTransactionHash)
          .maybeSingle();

        if (existingEntry) {
          console.log(`[Confirm Tickets] Reservation already confirmed, returning existing entry`);
          const existingTicketNumbers = String(existingEntry.ticketnumbers || "")
            .split(",")
            .map((x: string) => parseInt(x.trim(), 10))
            .filter((n: number) => Number.isFinite(n));

          return new Response(
            JSON.stringify({
              success: true,
              reservationId: reservation.id,
              ticketNumbers: existingTicketNumbers,
              ticketCount: existingEntry.numberoftickets || existingTicketNumbers.length,
              totalAmount: existingEntry.amountspent || 0,
              message: `Already confirmed ${existingTicketNumbers.length} tickets.`,
              alreadyConfirmed: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Entry being processed by another request, return success
        console.log(`[Confirm Tickets] Reservation in progress by another request, returning pending success`);
        return new Response(
          JSON.stringify({
            success: true,
            reservationId: reservation.id,
            ticketNumbers,
            ticketCount: ticketNumbers.length,
            totalAmount: reservation.total_amount,
            message: `Confirmation in progress for ${ticketNumbers.length} tickets.`,
            confirmationInProgress: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Reservation is in unexpected state
      // Only return 409 for truly invalid states (expired, canceled, released)
      if (currentReservation?.status === 'expired' || currentReservation?.status === 'canceled' || currentReservation?.status === 'released') {
        console.error(`[Confirm Tickets] Reservation ${reservation.id} is in invalid state: ${currentReservation?.status}`);
        return new Response(
          JSON.stringify({ success: false, error: `Reservation has been ${currentReservation?.status}. Please create a new reservation.` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // For any other state, treat as "in progress" to avoid breaking retry logic
      console.log(`[Confirm Tickets] Reservation ${reservation.id} in state ${currentReservation?.status}, treating as in-progress`);
      return new Response(
        JSON.stringify({
          success: true,
          reservationId: reservation.id,
          ticketNumbers,
          ticketCount: ticketNumbers.length,
          totalAmount: reservation.total_amount,
          message: `Confirmation processing for ${ticketNumbers.length} tickets.`,
          confirmationInProgress: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Confirm Tickets] Acquired lock on reservation ${reservation.id}, using atomic RPC conversion`);

    // Convert finalUserId to canonical format
    const finalCanonicalUserId = toPrizePid(finalUserId);
    
    // Get user's wallet address for the RPC
    // Extract wallet from canonical ID if it's wallet-based
    const extractedFinalId = finalCanonicalUserId.substring('prize:pid:'.length);
    const isWalletBased = /^0x[a-fA-F0-9]{40}$/i.test(extractedFinalId);
    let userWalletAddress: string | null = null;

    if (isWalletBased) {
      userWalletAddress = extractedFinalId.toLowerCase();
    }

    // Look up user in canonical_users by canonical ID
    const { data: userData } = await supabase
      .from("canonical_users")
      .select("wallet_address, email, canonical_user_id")
      .eq("canonical_user_id", finalCanonicalUserId)
      .maybeSingle();

    // Use stored wallet address if found
    if (userData?.wallet_address) {
      userWalletAddress = userData.wallet_address;
    } else if (walletAddress) {
      // Fallback to provided wallet address
      userWalletAddress = walletAddress;
    }

    // Reset status back to pending for the atomic RPC to process
    await supabase
      .from("pending_tickets")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", reservation.id);

    // Choose RPC based on payment method:
    // - 'balance' payments: Use confirm_ticket_purchase (debits sub_account_balance)
    // - External payments (base_account, coinbase, etc): Use confirm_pending_to_sold (no debit - user already paid)
    // CRITICAL: Only explicit 'balance' payments should debit sub_account_balance
    // Crypto payments (Base, Coinbase, etc.) are already paid on-chain and should NOT touch sub_account_balance
    const isBalancePayment = paymentProvider === 'balance';
    
    let rpcResult: Record<string, unknown> | null = null;
    let rpcError: Error | null = null;

    if (isBalancePayment) {
      // Use confirm_ticket_purchase which debits from sub_account_balance
      console.log(`[Confirm Tickets] Using confirm_ticket_purchase for balance payment`);
      const { data, error } = await supabase.rpc(
        'confirm_ticket_purchase',
        {
          p_pending_ticket_id: reservation.id,
          p_payment_provider: 'balance'
        }
      );
      rpcResult = data as Record<string, unknown>;
      rpcError = error;
    } else {
      // Use confirm_pending_to_sold for external payments (no balance debit)
      console.log(`[Confirm Tickets] Using confirm_pending_to_sold for ${paymentProvider} payment`);
      const { data, error } = await supabase.rpc(
        'confirm_pending_to_sold',
        {
          p_reservation_id: reservation.id,
          p_transaction_hash: finalTransactionHash,
          p_payment_provider: paymentProvider,
          p_wallet_address: userWalletAddress
        }
      );
      rpcResult = data as Record<string, unknown>;
      rpcError = error;
    }

    if (rpcError) {
      console.error("[Confirm Tickets] RPC error:", rpcError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to confirm tickets: " + rpcError.message,
          retryable: true
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const conversionResult = rpcResult as Record<string, unknown>;

    // Check if already confirmed (idempotent)
    if (conversionResult?.already_confirmed) {
      console.log(`[Confirm Tickets] Reservation ${reservation.id} was already confirmed`);
      return new Response(
        JSON.stringify({
          success: true,
          reservationId: reservation.id,
          ticketNumbers,
          ticketCount: ticketNumbers.length,
          totalAmount: reservation.total_amount,
          message: `Already confirmed ${ticketNumbers.length} tickets.`,
          alreadyConfirmed: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for RPC-level errors
    if (!conversionResult?.success) {
      const errorMsg = (conversionResult?.error as string) || "Unknown conversion error";
      console.error("[Confirm Tickets] Conversion failed:", errorMsg);

      // Check if expired
      if (errorMsg.includes("expired")) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Reservation has expired. Please select tickets again.",
            expiredAt: conversionResult?.expired_at
          }),
          { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: errorMsg,
          retryable: (conversionResult?.retryable as boolean) || false
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Confirm Tickets] Atomic conversion successful for reservation ${reservation.id}:`, {
      ticketsInserted: conversionResult.tickets_inserted,
      ticketCount: conversionResult.ticket_count
    });

    // For external crypto payments (non-balance), mark as wallet_credited to prevent reconcile-payments from processing
    // This is critical for base_account, coinbase_commerce, and other external payment providers
    // to prevent them from being incorrectly credited as top-ups by the reconcile-payments function
    if (!isBalancePayment && sessionId) {
      console.log(`[Confirm Tickets] Marking external payment transaction ${sessionId} as wallet_credited to prevent double-processing`);
      const { error: updateError } = await supabase
        .from('user_transactions')
        .update({ 
          wallet_credited: true
        })
        .eq('id', sessionId);
      
      if (updateError) {
        console.error(`[Confirm Tickets] WARNING: Failed to mark transaction ${sessionId} as wallet_credited:`, updateError);
        console.error(`[Confirm Tickets] This transaction may be reprocessed by reconcile-payments!`);
        // Don't fail the entire operation, but log the warning for monitoring
      } else {
        console.log(`[Confirm Tickets] Successfully marked transaction ${sessionId} as wallet_credited`);
      }
    }

    // STEP 6: Check for instant win prizes
    const instantWins: any[] = [];
    
    // Get competition to check if it's instant win
    const { data: competition } = await supabase
      .from("competitions")
      .select("is_instant_win")
      .eq("id", finalCompetitionId)
      .maybeSingle();

    if (competition?.is_instant_win) {
      for (const ticketNum of ticketNumbers) {
        const { data: prize, error: prizeErr } = await supabase
          .from("Prize_Instantprizes")
          .select("*")
          .eq("competitionId", finalCompetitionId)
          .eq("winningTicket", ticketNum)
          .is("winningWalletAddress", null)
          .maybeSingle();

        if (!prizeErr && prize) {
          // Claim the prize
          const { error: winUpdateErr } = await supabase
            .from("Prize_Instantprizes")
            .update({ 
              winningWalletAddress: walletAddress,
              winningUserId: finalUserId,
              wonAt: new Date().toISOString()
            })
            .eq("UID", prize.UID);

          if (!winUpdateErr) {
            instantWins.push({ 
              ticketNumber: ticketNum, 
              prize: prize.prize, 
              prizeId: prize.UID 
            });
          }
        }
      }
    }

    // STEP 7: Create notification for user
    try {
      await supabase
        .from("notifications")
        .insert({
          user_id: finalUserId,
          type: instantWins.length > 0 ? "instant_win" : "purchase_confirmed",
          title: instantWins.length > 0
            ? `🎉 You won ${instantWins.length} instant prize(s)!`
            : "Purchase Confirmed",
          message: instantWins.length > 0
            ? `Congratulations! Your ticket(s) ${instantWins.map(w => w.ticketNumber).join(", ")} won: ${instantWins.map(w => w.prize).join(", ")}`
            : `Your ${ticketNumbers.length} ticket(s) have been confirmed: ${ticketNumbers.join(", ")}`,
          data: {
            competitionId: finalCompetitionId,
            ticketNumbers,
            instantWins
          },
          read: false,
          created_at: new Date().toISOString(),
        });
    } catch (notifErr) {
      console.error("Error creating notification:", notifErr);
    }

    // STEP 8: Check if competition is now sold out and trigger drawing if so
    let soldOutTriggered = false;
    try {
      // Get competition details including total tickets
      const { data: compDetails } = await supabase
        .from("competitions")
        .select("id, total_tickets, status, is_instant_win, title")
        .eq("id", finalCompetitionId)
        .maybeSingle();

      if (compDetails && compDetails.status === "active" && compDetails.total_tickets > 0) {
        // Count all sold tickets using RPC that handles both UUID and legacy uid
        const { data: ticketCountResult, error: countError } = await supabase
          .rpc('count_sold_tickets_for_competition', {
            p_competition_id: finalCompetitionId
          });

        let totalSoldTickets = 0;
        if (!countError && ticketCountResult !== null) {
          totalSoldTickets = Number(ticketCountResult);
        } else {
          // Fallback: Count from direct query (may miss entries with legacy uid)
          console.warn('[Sold Out Check] RPC count failed, using fallback:', countError?.message);
          const { data: soldEntries } = await supabase
            .from("joincompetition")
            .select("ticketnumbers")
            .eq("competitionid", finalCompetitionId);

          (soldEntries || []).forEach((entry: any) => {
            if (entry.ticketnumbers) {
              const nums = entry.ticketnumbers.split(",").filter((n: string) => n.trim() !== "");
              totalSoldTickets += nums.length;
            }
          });
        }

        console.log(`[Sold Out Check] Competition ${finalCompetitionId}: ${totalSoldTickets}/${compDetails.total_tickets} tickets sold`);

        // Check if all tickets are sold
        if (totalSoldTickets >= compDetails.total_tickets) {
          console.log(`[Sold Out] Competition ${finalCompetitionId} is SOLD OUT! Triggering draw...`);
          soldOutTriggered = true;

          if (compDetails.is_instant_win) {
            // For instant win: just mark as completed (winners already determined at purchase)
            await supabase
              .from("competitions")
              .update({
                status: "completed",
                competitionended: 1,
                draw_date: new Date().toISOString()
              })
              .eq("id", finalCompetitionId);
            console.log(`[Sold Out] Instant win competition ${finalCompetitionId} marked as completed`);
          } else {
            // For standard competitions: select a winner from all entries
            // Use RPC to get entries with both UUID and legacy uid
            const { data: entriesFromRpc, error: rpcError } = await supabase
              .rpc('get_joincompetition_entries_for_competition', {
                p_competition_id: finalCompetitionId
              });

            let entriesWithUser = entriesFromRpc;
            if (rpcError || !entriesFromRpc) {
              console.warn('[Sold Out] RPC get entries failed, using fallback:', rpcError?.message);
              const { data: fallbackEntries } = await supabase
                .from("joincompetition")
                .select("*")
                .eq("competitionid", finalCompetitionId);
              entriesWithUser = fallbackEntries;
            }

            // Get all ticket numbers and their owners
            const allTicketNumbers: number[] = [];
            const ticketToEntry = new Map<number, any>();

            (entriesWithUser || []).forEach((entry: any) => {
              if (entry.ticketnumbers) {
                const nums = entry.ticketnumbers.split(",").map((n: string) => parseInt(n.trim())).filter((n: number) => !isNaN(n));
                nums.forEach((num: number) => {
                  allTicketNumbers.push(num);
                  ticketToEntry.set(num, entry);
                });
              }
            });

            // Use VRF pre-generated numbers to select winner
            try {
              const vrfResponse = await fetch(
                `${supabaseUrl}/functions/v1/vrf-draw-winner`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serviceRoleKey}`
                  },
                  body: JSON.stringify({ competition_id: finalCompetitionId })
                }
              );
              
              if (!vrfResponse.ok) {
                const errorText = await vrfResponse.text();
                throw new Error(`VRF HTTP ${vrfResponse.status}: ${errorText}`);
              }
              
              const vrfResult = await vrfResponse.json();
              console.log(`[Sold Out] VRF draw winner result:`, vrfResult);
              
              if (!vrfResult.ok) {
                throw new Error(vrfResult.error || 'VRF draw failed');
              }
            } catch (vrfErr) {
              console.error('[Sold Out] VRF draw winner failed:', vrfErr);
            }
          }
        }
      }
    } catch (soldOutErr) {
      console.error("Error checking/processing sold out competition:", soldOutErr);
      // Don't fail the entire operation - tickets were still confirmed
    }

    return new Response(
      JSON.stringify({
        success: true,
        reservationId: reservation.id,
        ticketNumbers,
        ticketCount: ticketNumbers.length,
        totalAmount: reservation.total_amount,
        instantWins: instantWins.length > 0 ? instantWins : undefined,
        soldOut: soldOutTriggered,
        message: soldOutTriggered
          ? `Tickets confirmed! Competition is now SOLD OUT - winner has been drawn!`
          : instantWins.length > 0
            ? `Tickets confirmed! You won ${instantWins.length} instant prize(s)!`
            : `Successfully confirmed ${ticketNumbers.length} tickets.`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const incidentId = `supabase-func-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const errorMessage = (error as Error).message || "Failed to confirm tickets";
    const errorStack = (error as Error).stack;
    
    console.error("Confirm pending tickets error:", error);
    console.error(`Incident ID: ${incidentId}`);

    // Try to log incident to database (best effort)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await supabase.rpc("log_confirmation_incident", {
          p_incident_id: incidentId,
          p_source: "supabase_function",
          p_endpoint: "/confirm-pending-tickets",
          p_error_type: (error as Error).name || "Error",
          p_error_message: errorMessage,
          p_error_stack: errorStack,
          p_user_id: requestBody?.userId || null,
          p_competition_id: requestBody?.competitionId || null,
          p_reservation_id: requestBody?.reservationId || null,
          p_session_id: requestBody?.sessionId || null,
          p_transaction_hash: requestBody?.transactionHash || null,
          p_env_context: {
            deno: true,
            hasSupabaseUrl: !!supabaseUrl,
            hasServiceRoleKey: !!serviceRoleKey,
            denoVersion: Deno.version.deno,
          },
          p_metadata: {
            timestamp: new Date().toISOString(),
          },
        });
        console.log(`Logged incident to database: ${incidentId}`);
      }
    } catch (logErr) {
      console.error("Failed to log incident to database:", logErr);
    }

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        incidentId,
        message: "An error occurred during ticket confirmation. Please contact support with this incident ID if the issue persists.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
