import type { Context, Config } from "@netlify/functions";

/**
 * Onramp Session Token Generator - Netlify Function
 *
 * This function generates a session token for Coinbase Onramp by calling
 * the Coinbase API with server-side credentials. This keeps CDP secrets
 * secure on the server and prevents 401 errors from browser-based requests.
 *
 * Required Environment Variables:
 * - CDP_API_KEY_ID: Your Coinbase Developer Platform API key ID
 * - CDP_API_KEY_SECRET: Your CDP API secret (PKCS8 PEM format)
 *
 * Alternative Environment Variables (legacy naming):
 * - CDC_CLIENT_API_KEY: Legacy name for API key ID
 * - CDC_SECRET_API_KEY: Legacy name for API secret
 */

// Coinbase Onramp API endpoint for session tokens
const ONRAMP_TOKEN_API = "https://api.developer.coinbase.com/onramp/v1/token";

// CORS headers for cross-origin requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * Generate a JWT for Coinbase API authentication using ES256
 */
async function generateCdpJwt(requestHost: string, requestPath: string): Promise<string> {
  // Support both new naming (CDP_API_KEY_ID) and legacy naming (CDC_CLIENT_API_KEY)
  const apiKeyName = Netlify.env.get("CDP_API_KEY_ID") || Netlify.env.get("CDC_CLIENT_API_KEY");
  const apiKeySecret = Netlify.env.get("CDP_API_KEY_SECRET") || Netlify.env.get("CDC_SECRET_API_KEY");

  if (!apiKeyName) {
    console.error("Missing CDP_API_KEY_ID or CDC_CLIENT_API_KEY environment variable");
    throw new Error("Coinbase Onramp is not configured: missing API key ID");
  }

  if (!apiKeySecret) {
    console.error("Missing CDP_API_KEY_SECRET or CDC_SECRET_API_KEY environment variable");
    throw new Error("Coinbase Onramp is not configured: missing API secret");
  }

  // Generate a random nonce (16 bytes as hex string per Coinbase spec)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Create JWT header per Coinbase specification
  const header = {
    alg: "ES256",
    kid: apiKeyName,
    nonce: nonce,
    typ: "JWT",
  };

  // Create JWT payload per Coinbase specification
  const now = Math.floor(Date.now() / 1000);
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

  // Process the private key
  let privateKeyPem = apiKeySecret;

  // Handle escaped newlines in environment variable
  if (privateKeyPem.includes("\\n")) {
    privateKeyPem = privateKeyPem.replace(/\\n/g, "\n");
  }

  // Normalize line endings and trim
  privateKeyPem = privateKeyPem.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  // Validate key format
  if (privateKeyPem.includes("BEGIN EC PRIVATE KEY")) {
    throw new Error("Invalid key format: Convert SEC1 to PKCS8 using: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem");
  }

  if (!privateKeyPem.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Invalid key format: Key must be in PKCS8 PEM format (BEGIN PRIVATE KEY)");
  }

  // Extract key content and decode
  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const decoded = atob(pemContents);
  const binaryDer = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    binaryDer[i] = decoded.charCodeAt(i);
  }

  // Import the private key
  const keyBuffer = binaryDer.buffer.slice(binaryDer.byteOffset, binaryDer.byteOffset + binaryDer.byteLength) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

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
 * Get the client IP address from the request
 */
function getClientIp(req: Request): string {
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp;

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  const clientIp = req.headers.get("x-client-ip");
  if (clientIp) return clientIp;

  return "0.0.0.0";
}

/**
 * Create response helpers
 */
function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Main handler for the onramp session token endpoint
 */
export default async (req: Request, context: Context): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // Parse request body
    let body: { address?: string; chainId?: number } = {};
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const { address, chainId = 8453 } = body;

    if (!address) {
      return errorResponse("Missing address", 400);
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return errorResponse("Invalid Ethereum address format", 400);
    }

    // Get client IP for Coinbase API
    const clientIp = getClientIp(req);

    // Determine blockchain based on chainId
    const blockchain = chainId === 8453 ? "base" : chainId === 84532 ? "base-sepolia" : "base";

    // Generate JWT for Coinbase API authentication
    const requestHost = "api.developer.coinbase.com";
    const requestPath = "/onramp/v1/token";
    const jwt = await generateCdpJwt(requestHost, requestPath);

    // Call Coinbase Onramp API to create session token
    const response = await fetch(ONRAMP_TOKEN_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        addresses: [
          {
            address,
            blockchains: [blockchain],
          },
        ],
        clientIp,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Coinbase API error:", response.status, errorText);
      return jsonResponse(
        { error: "CDP error", details: errorText },
        response.status === 401 ? 401 : 500
      );
    }

    const data = await response.json();

    // Return the session token
    return jsonResponse({
      sessionToken: data.token,
      token: data.token, // Include both for compatibility
      address,
      chainId,
    });
  } catch (error) {
    console.error("Onramp session token error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
};

export const config: Config = {
  path: "/.netlify/functions/onramp-session-token",
};
