import type { Context, Config } from "@netlify/functions";

export const config: Config = {
  path: "/api/purchase-with-balance",
  method: ["POST", "OPTIONS"],
};

/**
 * Purchase With Balance Proxy Function
 *
 * Proxies balance payment requests to the Supabase Edge Function
 * `purchase-tickets-with-bonus`. This eliminates CORS issues because
 * the browser talks to the same origin (Netlify) and the server-side
 * function forwards the request to Supabase.
 */

const SUPABASE_FUNCTIONS_BASE =
  Netlify.env.get("SUPABASE_FUNCTIONS_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL")?.replace(
    ".supabase.co",
    ".supabase.co/functions/v1"
  ) ||
  "https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1";

const PURCHASE_URL = `${SUPABASE_FUNCTIONS_BASE}/purchase-tickets-with-bonus`;

const SUPABASE_ANON_KEY =
  Netlify.env.get("SUPABASE_ANON_KEY") ||
  Netlify.env.get("VITE_SUPABASE_ANON_KEY") ||
  "";

const corsHeaders = {
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

export default async (req: Request, context: Context): Promise<Response> => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_JSON", "Invalid JSON body", 400);
    }

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Request:`,
      JSON.stringify({
        hasUserId: !!body.userId,
        competitionId: body.competition_id || body.competitionId,
        ticketCount:
          (body.tickets as unknown[])?.length || body.numberOfTickets,
        hasReservation: !!body.reservation_id,
      })
    );

    if (!SUPABASE_ANON_KEY) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] Missing SUPABASE_ANON_KEY`
      );
      return errorResponse("CONFIG_ERROR", "Service configuration error", 500);
    }

    // Get auth token from the incoming request if present
    const authHeader = req.headers.get("Authorization") || "";
    const origin = req.headers.get("origin") || "";

    // Forward to Supabase Edge Function
    console.log(
      `[purchase-with-balance-proxy][${requestId}] Forwarding to: ${PURCHASE_URL}`
    );

    const response = await fetch(PURCHASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        apikey: SUPABASE_ANON_KEY,
        Authorization: authHeader || `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Supabase response: status=${response.status}, length=${responseText.length}`
    );

    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] Non-JSON response: ${responseText.substring(0, 500)}`
      );
      return errorResponse(
        "UPSTREAM_ERROR",
        "Invalid response from payment service",
        502
      );
    }

    // Return the edge function response with proper CORS headers
    return jsonResponse(responseData, response.ok ? 200 : response.status);
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
