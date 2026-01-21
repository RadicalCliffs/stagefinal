import type { Context, Config } from "@netlify/functions";

// Export config at the top for reliable Netlify function registration
export const config: Config = {
  path: "/api/create-charge",
  method: ["POST", "OPTIONS"],
};

/**
 * Create Charge Proxy Function
 *
 * This function proxies requests to the Supabase Edge Function for creating
 * Coinbase Commerce charges. It handles CORS issues that can occur with
 * cross-origin requests to external Supabase functions.
 *
 * Routes:
 * - POST /api/create-charge - Create a Coinbase Commerce charge
 * - OPTIONS /api/create-charge - Handle CORS preflight
 */

const SUPABASE_FUNCTIONS_BASE =
  Netlify.env.get("SUPABASE_FUNCTIONS_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL")?.replace(".supabase.co", ".supabase.co/functions/v1") ||
  "https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1";

const CREATE_CHARGE_URL = `${SUPABASE_FUNCTIONS_BASE}/create-charge`;

// Supabase anon key for authenticating with Edge Functions
const SUPABASE_ANON_KEY =
  Netlify.env.get("SUPABASE_ANON_KEY") ||
  Netlify.env.get("VITE_SUPABASE_ANON_KEY") ||
  "";

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

// Response helpers
function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function errorResponse(code: string, message: string, status: number = 400, debug?: object): Response {
  return jsonResponse({
    success: false,
    error: { code, message },
    ...(debug ? { debug } : {})
  }, status);
}

export default async (req: Request, context: Context): Promise<Response> => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  try {
    // Parse the request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_JSON", "Invalid JSON body", 400);
    }

    // Enhanced logging for debugging
    console.log(`[create-charge-proxy][${requestId}] Request body:`, JSON.stringify(body));

    // Validate required fields before forwarding to Supabase
    const { userId, competitionId, totalAmount, type } = body;

    // Validate userId
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      console.error(`[create-charge-proxy][${requestId}] Validation failed: missing or invalid userId`);
      return errorResponse(
        "VALIDATION_ERROR",
        "Missing required field: userId",
        400,
        { receivedValue: userId, receivedType: typeof userId }
      );
    }

    // Validate type
    if (!type || (type !== 'entry' && type !== 'topup')) {
      console.error(`[create-charge-proxy][${requestId}] Validation failed: invalid type=${type}`);
      return errorResponse(
        "VALIDATION_ERROR",
        "Missing or invalid field: type (must be 'entry' or 'topup')",
        400,
        { receivedValue: type }
      );
    }

    // Validate competitionId for entry type
    if (type === 'entry' && (!competitionId || typeof competitionId !== 'string' || competitionId.trim() === '')) {
      console.error(`[create-charge-proxy][${requestId}] Validation failed: missing competitionId for entry type`);
      return errorResponse(
        "VALIDATION_ERROR",
        "Missing required field: competitionId (required for entry type)",
        400,
        { receivedValue: competitionId, receivedType: typeof competitionId }
      );
    }

    // Validate and normalize totalAmount
    const normalizedAmount = Number(totalAmount);
    if (!totalAmount || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      console.error(`[create-charge-proxy][${requestId}] Validation failed: invalid totalAmount=${totalAmount} (type: ${typeof totalAmount}), normalized=${normalizedAmount}`);
      return errorResponse(
        "VALIDATION_ERROR",
        "Missing or invalid field: totalAmount (must be a positive number)",
        400,
        { receivedValue: totalAmount, receivedType: typeof totalAmount, normalizedValue: normalizedAmount }
      );
    }

    // Ensure totalAmount is sent as a proper number
    // Also include 'amount' field for compatibility with legacy Supabase Edge Function deployments
    // that may expect 'amount' instead of 'totalAmount'
    const sanitizedBody = {
      ...body,
      totalAmount: normalizedAmount,
      amount: normalizedAmount,
    };

    console.log(`[create-charge-proxy][${requestId}] Validated request: userId=${userId}, type=${type}, competitionId=${competitionId || 'N/A'}, totalAmount=${normalizedAmount}`);

    // Get the origin from the incoming request to pass through
    const origin = req.headers.get("origin") || "";

    // Check if we have the Supabase anon key
    if (!SUPABASE_ANON_KEY) {
      console.error(`[create-charge-proxy][${requestId}] Missing SUPABASE_ANON_KEY environment variable`);
      return errorResponse("CONFIG_ERROR", "Payment service configuration error", 500);
    }

    // Forward the request to the Supabase Edge Function with the required apikey header
    console.log(`[create-charge-proxy][${requestId}] Forwarding to Supabase: ${CREATE_CHARGE_URL}`);

    const response = await fetch(CREATE_CHARGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": origin,
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(sanitizedBody),
    });

    const responseText = await response.text();

    console.log(`[create-charge-proxy][${requestId}] Supabase response: status=${response.status}, body_length=${responseText.length}`);

    // Parse the response
    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      // If it's not JSON, return as error
      console.error(`[create-charge-proxy][${requestId}] Non-JSON response: ${responseText.substring(0, 500)}`);
      return errorResponse("UPSTREAM_ERROR", "Invalid response from payment service", 502);
    }

    // Log the response for debugging
    if (!response.ok || responseData.success === false) {
      console.error(`[create-charge-proxy][${requestId}] Supabase error response:`, JSON.stringify(responseData));
    }

    // Normalize error responses to consistent format
    // Handle legacy error format from older Supabase Edge Function deployments
    if (responseData.error && typeof responseData.error === 'object') {
      // Already in {error: {code, message}} format - return as-is but ensure success: false
      return jsonResponse({
        success: false,
        ...responseData
      }, response.ok ? 200 : response.status);
    }

    // Handle {success: false, error: "message", code: "CODE", details: "..."} format
    if (responseData.success === false && typeof responseData.error === 'string') {
      // Include details if present (contains actual DB error message for debugging)
      const details = responseData.details as string | undefined;
      const errorMessage = details
        ? `${responseData.error}: ${details}`
        : responseData.error as string;

      console.log(`[create-charge-proxy][${requestId}] Normalized error: code=${responseData.code}, message=${errorMessage}`);

      return jsonResponse({
        success: false,
        error: {
          code: (responseData.code as string) || 'UNKNOWN_ERROR',
          message: errorMessage
        },
        // Preserve details separately for debugging
        ...(details ? { details } : {})
      }, response.ok ? 200 : response.status);
    }

    // Return the response with proper CORS headers
    return jsonResponse(responseData, response.ok ? 200 : response.status);
  } catch (error) {
    console.error(`[create-charge-proxy] Unhandled error:`, error);
    return errorResponse(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
};
