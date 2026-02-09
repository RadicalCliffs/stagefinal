import type { Context, Config } from "@netlify/functions";

/**
 * Coinbase Onramp/Offramp Function
 *
 * This serverless function handles Coinbase Onramp and Offramp operations.
 * It provides:
 * - Session token generation for secure widget initialization
 * - Onramp URL generation with proper parameters
 * - Offramp URL generation with proper parameters
 * - Transaction status checking
 *
 * Routes:
 * - POST /api/coinbase-onramp/session - Generate a session token
 * - POST /api/coinbase-onramp/url - Generate an onramp URL
 * - POST /api/coinbase-offramp/url - Generate an offramp URL
 * - GET /api/coinbase-onramp/config - Get onramp configuration
 */

// Coinbase Onramp API endpoint for session tokens
const ONRAMP_TOKEN_API = "https://api.developer.coinbase.com/onramp/v1/token";

/**
 * Generate a JWT for Coinbase API authentication
 * Uses ES256 algorithm with the CDP API key
 *
 * The CDC_SECRET_API_KEY MUST be in PKCS8 PEM format for P-256 curve:
 * -----BEGIN PRIVATE KEY-----
 * Base64-encoded key data with proper line breaks (64 chars per line)
 * -----END PRIVATE KEY-----
 *
 * If you have a SEC1 format key (BEGIN EC PRIVATE KEY), convert it using:
 * openssl pkcs8 -topk8 -nocrypt -in ec-key.pem -out ec-key-pkcs8.pem
 */
async function generateCdpJwt(): Promise<string> {
  // Support multiple naming conventions for environment variables
  // Legacy names: CDC_CLIENT_API_KEY, CDC_SECRET_API_KEY
  // New names: CDP_API_KEY_ID, CDP_WALLET_SECRET, CDP_API_KEY_SECRET
  const apiKeyName = Netlify.env.get("CDP_API_KEY_ID") ||
                     Netlify.env.get("CDC_CLIENT_API_KEY") ||
                     Netlify.env.get("VITE_CDP_API_KEY");

  // CDP_WALLET_SECRET contains the PEM-encoded private key from CDP Portal
  const apiKeySecret = Netlify.env.get("CDP_API_KEY_SECRET") ||
                       Netlify.env.get("CDC_SECRET_API_KEY") ||
                       Netlify.env.get("CDP_WALLET_SECRET");

  if (!apiKeyName) {
    console.error("Missing CDP API Key ID - set CDP_API_KEY_ID, CDC_CLIENT_API_KEY, or VITE_CDP_API_KEY");
    throw new Error("Coinbase Onramp is not configured: missing API key name");
  }

  if (!apiKeySecret) {
    console.error("Missing CDP API Secret - set CDP_API_KEY_SECRET, CDC_SECRET_API_KEY, or CDP_WALLET_SECRET");
    throw new Error("Coinbase Onramp is not configured: missing API secret");
  }

  // Generate a random nonce (16 bytes as hex string per Coinbase spec)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Create JWT header per Coinbase Onramp Demo App specification
  // Reference: https://github.com/coinbase/onramp-demo-app/blob/main/pages/api/helpers.ts
  const header = {
    alg: "ES256",
    kid: apiKeyName,
    nonce: nonce,
    typ: "JWT",
  };

  // Create JWT payload per Coinbase Onramp Demo App specification
  // Key differences from previous implementation:
  // - iss must be "coinbase-cloud" (not "cdp")
  // - uri (singular) must be "METHOD host/path" format (not uris array)
  // - aud claim should NOT be included
  const now = Math.floor(Date.now() / 1000);
  const requestHost = "api.developer.coinbase.com";
  const requestPath = "/onramp/v1/token";
  const payload = {
    iss: "coinbase-cloud",
    sub: apiKeyName,
    nbf: now,
    exp: now + 120, // 2 minutes expiry
    uri: `POST ${requestHost}${requestPath}`,
  };

  // Base64url encode
  const base64UrlEncode = (obj: object): string => {
    const json = JSON.stringify(obj);
    const base64 = btoa(json);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  };

  const headerEncoded = base64UrlEncode(header);
  const payloadEncoded = base64UrlEncode(payload);
  const message = `${headerEncoded}.${payloadEncoded}`;

  // Import the private key and sign
  // The API key secret is in PEM format for ES256
  let privateKeyPem = apiKeySecret;

  // Handle escaped newlines in environment variable (common when pasting into env var UIs)
  if (privateKeyPem.includes("\\n")) {
    privateKeyPem = privateKeyPem.replace(/\\n/g, "\n");
  }

  // Normalize line endings
  privateKeyPem = privateKeyPem.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Trim whitespace
  privateKeyPem = privateKeyPem.trim();

  // Determine key format - SEC1 (EC PRIVATE KEY) vs PKCS8 (PRIVATE KEY)
  const isSecOneFormat = privateKeyPem.includes("BEGIN EC PRIVATE KEY");
  const isPkcs8Format = privateKeyPem.includes("BEGIN PRIVATE KEY");

  if (isSecOneFormat) {
    console.error("CDC_SECRET_API_KEY is in SEC1 format (BEGIN EC PRIVATE KEY)");
    console.error("WebCrypto requires PKCS8 format. Convert using:");
    console.error("  openssl pkcs8 -topk8 -nocrypt -in ec-key.pem -out ec-key-pkcs8.pem");
    throw new Error("Invalid keyData: CDC_SECRET_API_KEY must be in PKCS8 format (BEGIN PRIVATE KEY). SEC1 format (BEGIN EC PRIVATE KEY) is not supported by WebCrypto. Convert using: openssl pkcs8 -topk8 -nocrypt -in your-key.pem -out your-key-pkcs8.pem");
  }

  if (!isPkcs8Format) {
    console.error("Invalid key format detected. Key should start with '-----BEGIN PRIVATE KEY-----'");
    console.error("Key preview (first 50 chars):", privateKeyPem.substring(0, 50));
    throw new Error("Invalid keyData: CDC_SECRET_API_KEY must be a PEM formatted PKCS8 private key starting with '-----BEGIN PRIVATE KEY-----'");
  }

  // Extract the key content between headers
  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  if (!pemContents || pemContents.length < 50) {
    console.error("Key content appears to be empty or too short. Expected at least 50 base64 characters.");
    console.error("Extracted content length:", pemContents.length);
    throw new Error("Invalid keyData: CDC_SECRET_API_KEY appears to be malformed - key content is too short");
  }

  // Convert base64 to ArrayBuffer
  let binaryDer: Uint8Array;
  try {
    const decoded = atob(pemContents);
    binaryDer = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      binaryDer[i] = decoded.charCodeAt(i);
    }
  } catch (e) {
    console.error("Failed to decode base64 key content:", e);
    console.error("This usually means the key has invalid base64 characters or formatting issues.");
    throw new Error("Invalid keyData: CDC_SECRET_API_KEY contains invalid base64 encoding. Ensure the key content between BEGIN/END markers is valid base64.");
  }

  // Import the key - PKCS8 format only
  let cryptoKey: CryptoKey;
  try {
    // Create a proper ArrayBuffer from the Uint8Array
    const keyBuffer = binaryDer.buffer.slice(binaryDer.byteOffset, binaryDer.byteOffset + binaryDer.byteLength) as ArrayBuffer;

    // PKCS8 format (BEGIN PRIVATE KEY)
    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    console.log("Successfully imported EC P-256 private key");
  } catch (importError) {
    console.error("Failed to import private key:", importError);
    console.error("Key length (bytes):", binaryDer.length);
    console.error("This error typically occurs when:");
    console.error("  1. The key is not a P-256 (secp256r1/prime256v1) EC key");
    console.error("  2. The key is corrupted or has formatting issues");
    console.error("  3. The key is in wrong format (use PKCS8, not SEC1)");
    console.error("");
    console.error("To generate a valid key:");
    console.error("  openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt");
    throw new Error("Invalid keyData: failed to import EC private key. Ensure CDC_SECRET_API_KEY is a valid P-256 (prime256v1) EC private key in PKCS8 PEM format.");
  }

  // Sign the message
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    encoder.encode(message)
  );

  // Convert signature to base64url
  const signatureArray = new Uint8Array(signature);
  let signatureBase64 = "";
  for (let i = 0; i < signatureArray.length; i++) {
    signatureBase64 += String.fromCharCode(signatureArray[i]);
  }
  signatureBase64 = btoa(signatureBase64);
  const signatureBase64Url = signatureBase64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${message}.${signatureBase64Url}`;
}

/**
 * Generate a session token by calling the Coinbase Onramp API
 *
 * Per Coinbase documentation, clientIp is REQUIRED:
 * "The client IP address of the end user. This parameter is required for security
 * validation to ensure the quote can only be used by the requesting user."
 */
async function createOnrampToken(params: {
  addresses: Array<{ address: string; blockchains: string[] }>;
  assets?: string[];
  clientIp: string;
}): Promise<string> {
  const jwt = await generateCdpJwt();

  const requestBody: {
    addresses: Array<{ address: string; blockchains: string[] }>;
    clientIp: string;
    assets?: string[];
  } = {
    addresses: params.addresses,
    clientIp: params.clientIp,
  };

  if (params.assets && params.assets.length > 0) {
    requestBody.assets = params.assets;
  }

  console.log(`Creating onramp token with clientIp: ${params.clientIp.substring(0, 8)}...`);

  const response = await fetch(ONRAMP_TOKEN_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Onramp token API error:", response.status, errorText);
    throw new Error(`Failed to generate session token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.token;
}

/**
 * Get the client IP address from the request
 * Uses various headers that may be set by proxies/load balancers
 */
function getClientIp(req: Request): string {
  // Try Cloudflare's header first
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // Try x-real-ip (commonly set by nginx)
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fall back to x-forwarded-for (first IP in the chain)
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  // Try x-client-ip
  const clientIp = req.headers.get("x-client-ip");
  if (clientIp) {
    return clientIp;
  }

  // Default fallback
  return "0.0.0.0";
}

// Response helpers with CORS support
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

// Coinbase Onramp base URL - per documentation: https://pay.coinbase.com/buy/select-asset
const ONRAMP_BASE_URL = "https://pay.coinbase.com/buy/select-asset";
const OFFRAMP_BASE_URL = "https://pay.coinbase.com/v3/sell";

/**
 * Generate a session token for Onramp/Offramp widget
 *
 * The session token provides secure authentication for the Coinbase widget.
 * This calls the Coinbase Onramp API directly with JWT authentication.
 */
async function handleGenerateSessionToken(
  body: Record<string, unknown>,
  req: Request
): Promise<Response> {
  const { destinationAddress, destinationAssets, destinationNetwork } = body;

  if (!destinationAddress || typeof destinationAddress !== "string") {
    return errorResponse("destinationAddress is required");
  }

  try {
    // Get client IP - required by Coinbase API
    const clientIp = getClientIp(req);

    // Call Coinbase Onramp API to create a session token
    const token = await createOnrampToken({
      addresses: [
        {
          address: destinationAddress,
          blockchains: destinationNetwork ? [destinationNetwork as string] : ["base"],
        },
      ],
      assets: Array.isArray(destinationAssets) ? destinationAssets as string[] : undefined,
      clientIp,
    });

    return jsonResponse({
      success: true,
      sessionToken: token,
      destinationAddress,
    });
  } catch (error) {
    console.error("Error generating session token:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate session token",
      500
    );
  }
}

/**
 * Generate an Onramp URL with the proper parameters
 *
 * This creates a one-click-buy URL that users can be directed to.
 * Per documentation, the URL format is:
 * https://pay.coinbase.com/buy/select-asset?sessionToken=<token>&<other params>
 */
async function handleGenerateOnrampUrl(
  body: Record<string, unknown>,
  req: Request
): Promise<Response> {
  const {
    destinationAddress,
    destinationAsset = "USDC",
    destinationNetwork = "base",
    fiatCurrency = "USD",
    fiatAmount,
    partnerUserId,
    redirectUrl,
  } = body;

  if (!destinationAddress || typeof destinationAddress !== "string") {
    return errorResponse("destinationAddress is required");
  }

  try {
    // Get client IP - required by Coinbase API
    const clientIp = getClientIp(req);

    // Generate session token via Coinbase Onramp API
    const sessionToken = await createOnrampToken({
      addresses: [
        {
          address: destinationAddress as string,
          blockchains: [destinationNetwork as string],
        },
      ],
      assets: [destinationAsset as string],
      clientIp,
    });

    // Build the onramp URL with parameters per documentation
    const params = new URLSearchParams();
    params.set("sessionToken", sessionToken);
    params.set("defaultAsset", destinationAsset as string);
    params.set("defaultNetwork", destinationNetwork as string);
    params.set("defaultPaymentMethod", "CARD"); // Default to card for guest checkout

    if (fiatAmount) {
      params.set("presetFiatAmount", String(fiatAmount));
    }

    if (fiatCurrency) {
      params.set("fiatCurrency", fiatCurrency as string);
    }

    // partnerUserRef for tracking (per documentation, must be less than 50 chars)
    if (partnerUserId) {
      const partnerRef = String(partnerUserId).substring(0, 49);
      params.set("partnerUserRef", partnerRef);
    }

    if (redirectUrl) {
      params.set("redirectUrl", redirectUrl as string);
    }

    const onrampUrl = `${ONRAMP_BASE_URL}?${params.toString()}`;

    return jsonResponse({
      success: true,
      url: onrampUrl,
      sessionToken,
      destinationAddress,
      destinationAsset,
      destinationNetwork,
    });
  } catch (error) {
    console.error("Error generating onramp URL:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate onramp URL",
      500
    );
  }
}

/**
 * Generate an Offramp URL with the proper parameters
 *
 * This creates an offramp URL for users to convert crypto to fiat.
 */
async function handleGenerateOfframpUrl(
  body: Record<string, unknown>,
  req: Request
): Promise<Response> {
  const {
    sourceAddress,
    sourceAsset = "USDC",
    sourceNetwork = "base",
    fiatCurrency = "USD",
    partnerUserId,
    redirectUrl,
  } = body;

  if (!sourceAddress || typeof sourceAddress !== "string") {
    return errorResponse("sourceAddress is required");
  }

  try {
    // Get client IP - required by Coinbase API
    const clientIp = getClientIp(req);

    // Generate session token via Coinbase Onramp API
    const sessionToken = await createOnrampToken({
      addresses: [
        {
          address: sourceAddress as string,
          blockchains: [sourceNetwork as string],
        },
      ],
      assets: [sourceAsset as string],
      clientIp,
    });

    // Build the offramp URL with parameters
    const params = new URLSearchParams();
    params.set("sessionToken", sessionToken);
    params.set("defaultAsset", sourceAsset as string);
    params.set("defaultNetwork", sourceNetwork as string);

    if (partnerUserId) {
      const partnerRef = String(partnerUserId).substring(0, 49);
      params.set("partnerUserRef", partnerRef);
    }

    if (redirectUrl) {
      params.set("redirectUrl", redirectUrl as string);
    }

    if (fiatCurrency) {
      params.set("cashoutCurrency", fiatCurrency as string);
    }

    const offrampUrl = `${OFFRAMP_BASE_URL}/input?${params.toString()}`;

    return jsonResponse({
      success: true,
      url: offrampUrl,
      sessionToken,
      sourceAddress,
      sourceAsset,
      sourceNetwork,
    });
  } catch (error) {
    console.error("Error generating offramp URL:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate offramp URL",
      500
    );
  }
}

/**
 * Get onramp configuration (supported countries, payment methods, etc.)
 */
async function handleGetConfig(): Promise<Response> {
  try {
    // Return static configuration for now
    // In a production environment, this could fetch live data from Coinbase API
    return jsonResponse({
      success: true,
      config: {
        supportedNetworks: ["base", "base-sepolia", "ethereum"],
        supportedAssets: ["USDC", "ETH", "WETH"],
        supportedFiatCurrencies: ["USD", "EUR", "GBP"],
        // Card payment limits - increased to support full Coinbase Onramp capabilities
        // Apple Pay, debit cards, credit cards, and Coinbase account all supported
        cardPayments: {
          enabled: true,
          minAmount: 1,
          maxAmount: 10000,
          weeklyLimit: 10000,
          supportedMethods: ["APPLE_PAY", "CARD", "ACH_BANK_ACCOUNT", "COINBASE_BALANCE"],
        },
        coinbaseAccount: {
          enabled: true,
          paymentMethods: ["bank_account", "debit_card", "crypto_balance", "fiat_balance", "apple_pay"],
        },
      },
    });
  } catch (error) {
    console.error("Error getting config:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to get configuration",
      500
    );
  }
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

  const url = new URL(req.url);
  const pathParts = url.pathname.replace("/api/coinbase-onramp", "").split("/").filter(Boolean);
  const route = pathParts.join("/");

  try {
    // Handle GET requests
    if (req.method === "GET") {
      if (route === "config" || route === "") {
        return handleGetConfig();
      }
      return errorResponse("Not found", 404);
    }

    // Handle POST requests
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body");
      }

      switch (route) {
        case "session":
          return handleGenerateSessionToken(body, req);

        case "url":
          return handleGenerateOnrampUrl(body, req);

        case "offramp":
        case "offramp/url":
          return handleGenerateOfframpUrl(body, req);

        default:
          return errorResponse(`Unknown route: ${route}`, 404);
      }
    }

    return errorResponse("Method not allowed", 405);
  } catch (err) {
    console.error("Coinbase onramp function error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500
    );
  }
};

export const config: Config = {
  path: "/api/coinbase-onramp/*",
};
