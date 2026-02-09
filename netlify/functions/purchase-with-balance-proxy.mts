import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { toPrizePid } from "./_shared/userId.mts";

export const config: Config = {
  path: "/api/purchase-with-balance",
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number = 400
): Response {
  return jsonResponse({ success: false, error: { code, message } }, status);
}

export default async (req: Request, context: Context) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  try {
    // Resolve env vars inside the handler (not at module scope)
    const supabaseUrl =
      Netlify.env.get("VITE_SUPABASE_URL") ||
      Netlify.env.get("SUPABASE_URL") ||
      "";
    const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] Missing env vars: url=${!!supabaseUrl}, key=${!!serviceRoleKey}`
      );
      return errorResponse(
        "CONFIG_ERROR",
        "Service configuration error",
        500
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_JSON", "Invalid JSON body", 400);
    }

    // Extract fields from the request body (support both camelCase and snake_case)
    const userId =
      (body.userId as string) ||
      (body.user_id as string) ||
      (body.userIdentifier as string) ||
      "";
    const competitionId =
      (body.competition_id as string) ||
      (body.competitionId as string) ||
      "";
    const ticketPrice = Number(
      body.ticketPrice ?? body.ticket_price ?? body.price ?? 0
    );
    const idempotencyKey =
      (body.idempotency_key as string) ||
      (body.idempotencyKey as string) ||
      null;
    const reservationId =
      (body.reservation_id as string) ||
      (body.reservationId as string) ||
      null;

    // Extract ticket numbers from the tickets array or direct ticket_numbers
    let ticketNumbers: number[] | null = null;
    let ticketCount: number | null = null;

    if (Array.isArray(body.tickets) && body.tickets.length > 0) {
      // Client sends tickets as [{ticket_number: N}, ...]
      ticketNumbers = (body.tickets as Array<{ ticket_number?: number }>).map(
        (t) => Number(t.ticket_number ?? t)
      );
    } else if (Array.isArray(body.ticket_numbers)) {
      ticketNumbers = (body.ticket_numbers as number[]).map(Number);
    }

    if (!ticketNumbers || ticketNumbers.length === 0) {
      ticketCount = Number(
        body.numberOfTickets ?? body.number_of_tickets ?? body.ticket_count ?? 0
      );
      if (ticketCount <= 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Must provide tickets or ticket count",
          400
        );
      }
    }

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Request:`,
      JSON.stringify({
        hasUserId: !!userId,
        competitionId: competitionId.substring(0, 10) + "...",
        ticketCount: ticketNumbers?.length || ticketCount,
        hasReservation: !!reservationId,
        hasIdempotencyKey: !!idempotencyKey,
      })
    );

    // Validate required fields
    if (!userId) {
      return errorResponse("VALIDATION_ERROR", "userId is required", 400);
    }
    if (!competitionId) {
      return errorResponse(
        "VALIDATION_ERROR",
        "competition_id is required",
        400
      );
    }
    if (!ticketPrice || ticketPrice <= 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "ticketPrice must be positive",
        400
      );
    }

    // Convert userId to canonical format
    const canonicalUserId = toPrizePid(userId);

    // Create Supabase client with service role (needed for SECURITY DEFINER RPC)
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Calling purchase_tickets_with_balance RPC`
    );

    // Call the atomic RPC directly instead of the edge function
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "purchase_tickets_with_balance",
      {
        p_user_identifier: canonicalUserId,
        p_competition_id: competitionId,
        p_ticket_price: ticketPrice,
        p_ticket_count: ticketCount,
        p_ticket_numbers: ticketNumbers,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (rpcError) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] RPC error:`,
        rpcError.message
      );
      return errorResponse(
        "RPC_ERROR",
        rpcError.message || "Purchase failed",
        500
      );
    }

    if (!rpcResult) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] RPC returned null`
      );
      return errorResponse(
        "RPC_ERROR",
        "No response from purchase function",
        500
      );
    }

    console.log(
      `[purchase-with-balance-proxy][${requestId}] RPC result:`,
      JSON.stringify({
        success: rpcResult.success,
        ticketCount: rpcResult.ticket_count,
        idempotent: rpcResult.idempotent,
        hasError: !!rpcResult.error,
      })
    );

    // The RPC returns {success, error, entry_id, ticket_numbers, ticket_count, total_cost, available_balance, ...}
    if (!rpcResult.success) {
      const errorCode = rpcResult.error_code || "PURCHASE_FAILED";
      const errorMessage = rpcResult.error || "Purchase failed";

      // Map specific error codes to HTTP status codes
      let httpStatus = 400;
      if (errorCode === "INSUFFICIENT_BALANCE") httpStatus = 402;
      if (errorCode === "NO_BALANCE_RECORD") httpStatus = 404;

      return errorResponse(errorCode, errorMessage, httpStatus);
    }

    // If reservation was used, update its status
    if (reservationId) {
      await supabase
        .from("pending_tickets")
        .update({
          status: "confirmed",
          payment_provider: "balance",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", reservationId)
        .then(({ error }) => {
          if (error) {
            console.warn(
              `[purchase-with-balance-proxy][${requestId}] Failed to update reservation:`,
              error.message
            );
          }
        });
    }

    // Transform RPC result to match the format the client expects:
    // { status: 'ok', competition_id, tickets: [{ticket_number}], entry_id, total_cost, available_balance }
    const ticketNumbersResult: number[] = rpcResult.ticket_numbers || [];
    const responseData = {
      status: "ok",
      success: true,
      competition_id: rpcResult.competition_id || competitionId,
      tickets: ticketNumbersResult.map((num: number) => ({
        ticket_number: num,
      })),
      entry_id: rpcResult.entry_id,
      total_cost: rpcResult.total_cost,
      new_balance: rpcResult.available_balance,
      available_balance: rpcResult.available_balance,
      idempotent: rpcResult.idempotent || false,
      message: `Successfully purchased ${ticketNumbersResult.length} tickets`,
    };

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Success: ${ticketNumbersResult.length} tickets purchased`
    );

    return jsonResponse(responseData);
  } catch (error) {
    console.error(
      `[purchase-with-balance-proxy][${requestId}] Error:`,
      error
    );
    return errorResponse(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
};
