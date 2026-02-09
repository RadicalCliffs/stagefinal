import type { Context, Config } from "@netlify/functions";

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
    // Resolve env vars inside the handler to avoid module-level boot issues
    const supabaseFunctionsBase =
      Netlify.env.get("SUPABASE_FUNCTIONS_URL") ||
      Netlify.env.get("VITE_SUPABASE_URL")?.replace(
        ".supabase.co",
        ".supabase.co/functions/v1"
      ) ||
      "https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1";

    const purchaseUrl = `${supabaseFunctionsBase}/purchase-tickets-with-bonus`;

    const supabaseAnonKey =
      Netlify.env.get("SUPABASE_ANON_KEY") ||
      Netlify.env.get("VITE_SUPABASE_ANON_KEY") ||
      "";

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

    if (!supabaseAnonKey) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] Missing SUPABASE_ANON_KEY`
      );
      return errorResponse(
        "CONFIG_ERROR",
        "Service configuration error",
        500
      );
    }

    // Get auth token from the incoming request if present
    const authHeader = req.headers.get("Authorization") || "";
    const origin = req.headers.get("origin") || "";

    // Forward to Supabase Edge Function
    console.log(
      `[purchase-with-balance-proxy][${requestId}] Forwarding to: ${purchaseUrl}`
    );

    const response = await fetch(purchaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        apikey: supabaseAnonKey,
        Authorization: authHeader || `Bearer ${supabaseAnonKey}`,
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
