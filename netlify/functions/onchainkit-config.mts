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
 * HARDCODED CDP RPC API KEY for OnchainKit
 *
 * This is the Coinbase CDP Project ID that goes in the RPC URL path:
 * https://api.developer.coinbase.com/rpc/v1/base/{CDP_RPC_API_KEY}
 *
 * IMPORTANT: OnchainKit uses the `apiKey` prop to construct RPC URLs.
 * The CDP RPC endpoint expects the Project ID (UUID format) in the URL path,
 * NOT a Base64-encoded private key or JWT.
 *
 * The environment variable secrets (CDP_API_KEY_SECRET) are used separately
 * for server-side JWT signing, NOT for RPC URL construction.
 */
const CDP_RPC_API_KEY = "QEcbaTIUVqvhvAVEh7D0jKXm6hztpgZQ";

/**
 * Get the OnchainKit API key for RPC URL construction
 *
 * Returns the CDP RPC API key that OnchainKit uses to build the RPC URL:
 * https://api.developer.coinbase.com/rpc/v1/base/{apiKey}
 *
 * Precedence order:
 * 1. CDP_RPC_API_KEY constant (hardcoded, recommended for OnchainKit RPC)
 * 2. ONCHAINKIT_API_KEY - Dedicated OnchainKit key (if set to override)
 * 3. CDP_PROJECT_ID - CDP Project ID (UUID format, same as RPC key)
 * 4. VITE_CDP_PROJECT_ID - Frontend project ID
 */
function getOnchainKitApiKey(): string | null {
  // Check if there's an override in environment variables
  // This allows deployment-specific configuration if needed
  const onchainKitKey = Netlify.env.get("ONCHAINKIT_API_KEY");
  if (onchainKitKey && !onchainKitKey.includes("+") && !onchainKitKey.includes("/")) {
    // Only use if it's NOT a Base64-encoded key (no + or / characters)
    console.log("[onchainkit-config] Using ONCHAINKIT_API_KEY from env");
    return onchainKitKey;
  }

  // Use the hardcoded CDP RPC API Key (Project ID format)
  // This is the correct format for OnchainKit RPC URL construction
  console.log("[onchainkit-config] Using hardcoded CDP_RPC_API_KEY");
  return CDP_RPC_API_KEY;
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
      status: 200,
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

    // apiKey is now hardcoded so this should never be null, but keep the check for safety
    if (!apiKey) {
      console.error("[onchainkit-config] Unexpected: apiKey is null despite hardcoded fallback");
      return errorResponse(
        "CONFIG_ERROR",
        "OnchainKit API key configuration error",
        500
      );
    }

    console.log("[onchainkit-config] Returning config with apiKey length:", apiKey.length);

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
