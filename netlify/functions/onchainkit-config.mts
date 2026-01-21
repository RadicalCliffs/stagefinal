import type { Context, Config } from "@netlify/functions";

/**
 * OnchainKit Configuration Function
 *
 * This serverless function provides secure server-side configuration for OnchainKit.
 * It returns the OnchainKit/CDP API key that's stored securely in Netlify environment variables.
 *
 * Why server-side?
 * - API keys stored in VITE_* variables are exposed in the client bundle
 * - This function returns the key securely without exposing it in client code
 * - The key is still "public" (used for RPC calls) but not hardcoded in JS
 *
 * Routes:
 * - GET /api/onchainkit/config - Get OnchainKit configuration including API key
 * - POST /api/onchainkit/config - Same as GET (for flexibility)
 */

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
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({ success: false, error: { code, message } }, status);
}

/**
 * Get the OnchainKit API key from environment variables
 *
 * Precedence order:
 * 1. ONCHAINKIT_API_KEY - Dedicated OnchainKit key (recommended)
 * 2. CDP_CLIENT_API_KEY - CDP Client API key
 * 3. VITE_CDP_API_KEY - Legacy/frontend key (fallback)
 */
function getOnchainKitApiKey(): string | null {
  // Primary: Dedicated OnchainKit API key
  const onchainKitKey = Netlify.env.get("ONCHAINKIT_API_KEY");
  if (onchainKitKey) {
    console.log("[onchainkit-config] Using ONCHAINKIT_API_KEY");
    return onchainKitKey;
  }

  // Secondary: CDP Client API key
  const cdpClientKey = Netlify.env.get("CDP_CLIENT_API_KEY");
  if (cdpClientKey) {
    console.log("[onchainkit-config] Using CDP_CLIENT_API_KEY");
    return cdpClientKey;
  }

  // Tertiary: VITE_CDP_API_KEY (frontend key, but can be used)
  const viteCdpKey = Netlify.env.get("VITE_CDP_API_KEY");
  if (viteCdpKey) {
    console.log("[onchainkit-config] Using VITE_CDP_API_KEY");
    return viteCdpKey;
  }

  console.error("[onchainkit-config] No OnchainKit API key found in environment variables");
  return null;
}

/**
 * Get the CDP Project ID from environment variables
 */
function getProjectId(): string | null {
  const projectId = Netlify.env.get("CDP_PROJECT_ID") ||
                    Netlify.env.get("VITE_CDP_PROJECT_ID") ||
                    Netlify.env.get("VITE_ONCHAINKIT_PROJECT_ID");

  if (!projectId) {
    console.warn("[onchainkit-config] No CDP Project ID found");
  }

  return projectId || null;
}

/**
 * Determine if mainnet should be used
 */
function isMainnet(): boolean {
  return Netlify.env.get("VITE_BASE_MAINNET") === "true";
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Only allow GET and POST
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  try {
    const apiKey = getOnchainKitApiKey();
    const projectId = getProjectId();
    const useMainnet = isMainnet();

    if (!apiKey) {
      return errorResponse(
        "CONFIG_ERROR",
        "OnchainKit API key is not configured. Please set ONCHAINKIT_API_KEY, CDP_CLIENT_API_KEY, or VITE_CDP_API_KEY in Netlify environment variables.",
        500
      );
    }

    // Return configuration
    return jsonResponse({
      success: true,
      config: {
        apiKey,
        projectId,
        network: useMainnet ? "base" : "base-sepolia",
        chainId: useMainnet ? 8453 : 84532,
      },
    });
  } catch (error) {
    console.error("[onchainkit-config] Error:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
};

export const config: Config = {
  path: "/api/onchainkit/config",
};
