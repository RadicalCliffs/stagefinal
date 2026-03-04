import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * User ID Utilities (inlined)
 */
function isWalletAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(identifier);
}
function isPrizePid(identifier: string): boolean {
  return identifier.startsWith("prize:pid:");
}
function extractPrizePid(prizePid: string): string {
  if (!isPrizePid(prizePid)) return prizePid;
  return prizePid.substring("prize:pid:".length);
}
function toPrizePid(inputUserId: string | null | undefined): string {
  if (!inputUserId || inputUserId.trim() === "") {
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

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmedId)) {
    throw new Error(
      `UUID cannot be used as canonical_user_id: ${trimmedId}. ` +
        `Use allocate_temp_canonical_user() for users without wallets, ` +
        `or provide a wallet address to create prize:pid:0x{wallet} format.`,
    );
  }

  throw new Error(
    `Invalid user identifier format: ${trimmedId}. ` +
      `Must be wallet address (0x...) or already in prize:pid: format.`,
  );
}

/**
 * CORS
 */
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://stage.theprize.io";
const ALLOWED_ORIGINS = [
  SITE_URL,
  "https://stage.theprize.io",
  "https://theprize.io",
  "https://theprizeio.netlify.app",
  "https://www.theprize.io",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8888",
];

function getCorsOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return SITE_URL;
}
function buildCorsHeaders(
  requestOrigin: string | null,
): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  if (!origin)
    throw new Error("CORS origin cannot be empty when using credentials");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 200, headers: buildCorsHeaders(origin) });
}

/**
 * Responses
 */
function errorResponse(
  message: string,
  statusCode: number,
  corsHeaders: Record<string, string>,
  additionalData: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
      errorCode: statusCode,
      ...additionalData,
    }),
    {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
function successResponse(
  data: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ success: true, ...data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Constants
 */
const MINUTES_TO_MS = 60 * 1000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Main
 */
Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return handleCorsOptions(req);
    const corsHeaders = buildCorsHeaders(req.headers.get("origin"));
    const requestId = crypto.randomUUID().slice(0, 8);

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, corsHeaders);
    }

    console.log(`[${requestId}] Lucky dip reserve request started`);

    // Parse JSON body safely
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
      holdMinutes = 15,
      excludedTickets = null, // optional int[]
    } = body as {
      userId?: string;
      competitionId?: string;
      count?: number | string;
      ticketPrice?: number | string;
      sessionId?: string | null;
      holdMinutes?: number | string;
      excludedTickets?: number[] | null;
    };

    // Validate userId
    if (!userId || typeof userId !== "string") {
      return errorResponse(
        "userId is required and must be a string",
        400,
        corsHeaders,
      );
    }
    const canonicalUserId = toPrizePid(userId);
    console.log(`[${requestId}] Canonical user ID: ${canonicalUserId}`);

    // Validate competitionId (must be uuid-format string)
    if (!competitionId || typeof competitionId !== "string") {
      return errorResponse(
        "competitionId is required and must be a string",
        400,
        corsHeaders,
      );
    }
    if (!UUID_REGEX.test(competitionId)) {
      return errorResponse("Invalid competition ID format", 400, corsHeaders);
    }

    // Validate count
    const normalizedCount = Number(count);
    if (
      !Number.isInteger(normalizedCount) ||
      normalizedCount < 1 ||
      normalizedCount > 999
    ) {
      return errorResponse(
        "count is required and must be between 1 and 999",
        400,
        corsHeaders,
      );
    }

    // Normalize minutes and price
    const holdMins = Math.min(Math.max(Number(holdMinutes) || 15, 1), 60);
    const normalizedPrice = Number(ticketPrice);
    const validTicketPrice =
      Number.isFinite(normalizedPrice) && normalizedPrice > 0
        ? normalizedPrice
        : 1;

    // Supabase admin client (Service Role)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Server configuration error", 500, corsHeaders);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log(`[${requestId}] Calling allocate_lucky_dip_tickets_batch RPC`, {
      user_id: canonicalUserId,
      competition_id: competitionId,
      ticket_count: normalizedCount,
      ticket_price: validTicketPrice,
      hold_minutes: holdMins,
      session_id: sessionId || null,
      excluded: Array.isArray(excludedTickets)
        ? excludedTickets.slice(0, 5000)
        : null,
    });

    /**
     * IMPORTANT:
     * The DB function must accept/handle p_competition_id as UUID.
     * If its arg is TEXT, cast once at the top:
     *   DECLARE
     *     v_competition_id uuid := p_competition_id::uuid;
     *   BEGIN
     *     ... WHERE tickets.competition_id = v_competition_id ...
     */
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "allocate_lucky_dip_tickets_batch",
      {
        p_user_id: canonicalUserId, // TEXT
        p_competition_id: competitionId, // SHOULD BE UUID in SQL (or cast immediately)
        p_count: normalizedCount, // INT
        p_ticket_price: validTicketPrice, // NUMERIC
        p_hold_minutes: holdMins, // INT
        p_session_id: sessionId || null, // TEXT
        p_excluded_tickets: Array.isArray(excludedTickets)
          ? excludedTickets.slice(0, 5000)
          : null, // INT[]
      },
    );

    if (rpcError) {
      console.error(
        `[${requestId}] allocate_lucky_dip_tickets_batch RPC error:`,
        rpcError,
      );
      return errorResponse("Failed to reserve tickets", 500, corsHeaders, {
        retryable: true,
        errorDetail: rpcError.message ?? "rpc_error",
      });
    }

    let result: any;
    try {
      result =
        typeof rpcResult === "string" ? JSON.parse(rpcResult) : rpcResult;
    } catch (parseError) {
      console.error(`[${requestId}] Failed to parse RPC result:`, parseError);
      return errorResponse(
        "Invalid response format from reservation system",
        500,
        corsHeaders,
        { retryable: true },
      );
    }

    if (!result || !result.success) {
      const errorMsg = result?.error || "Unknown error from allocation RPC";
      const errorDetail =
        result?.error_detail || result?.error || "allocation_failed";
      console.error(`[${requestId}] Allocation RPC failed:`, errorMsg, result);
      return errorResponse("Failed to reserve tickets", 500, corsHeaders, {
        retryable: result?.retryable ?? true,
        errorDetail,
      });
    }

    if (!result.reservation_id || !result.ticket_numbers) {
      console.error(
        `[${requestId}] Invalid response from allocate_lucky_dip_tickets_batch:`,
        result,
      );
      return errorResponse(
        "Invalid response from reservation system",
        500,
        corsHeaders,
        { retryable: true },
      );
    }

    const allocatedNumbers = Array.isArray(result.ticket_numbers)
      ? (result.ticket_numbers as number[])
      : [];

    console.log(
      `[${requestId}] Successfully reserved ${allocatedNumbers.length} tickets`,
    );

    return successResponse(
      {
        reservationId: result.reservation_id,
        ticketNumbers: allocatedNumbers,
        ticketCount: allocatedNumbers.length,
        totalAmount: allocatedNumbers.length * validTicketPrice,
        expiresAt: new Date(
          Date.now() + holdMins * MINUTES_TO_MS,
        ).toISOString(),
        algorithm: "allocate-lucky-dip-batch",
        message: `Successfully reserved ${allocatedNumbers.length} lucky dip tickets. Complete payment within ${holdMins} minutes.`,
      },
      corsHeaders,
    );
  } catch (topLevelError) {
    console.error(
      "[FATAL] Top-level error in lucky-dip-reserve:",
      topLevelError,
    );
    const origin = req.headers.get("origin");
    const safeCorsHeaders = buildCorsHeaders(origin);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error. Please try again.",
        errorCode: 500,
        retryable: true,
        errorDetail:
          topLevelError instanceof Error
            ? topLevelError.message
            : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...safeCorsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
