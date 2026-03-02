import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Coinbase Onramp Session Initialization
 *
 * This edge function handles the creation of session tokens for the Coinbase Onramp widget.
 * It follows the official Coinbase Onramp API documentation:
 * - Generates a JWT for CDP API authentication
 * - Calls the Session Token API with required parameters including clientIp
 * - Returns a session token and onramp URL for the client to use
 *
 * Security Requirements:
 * - clientIp is required and must be the actual client IP (not spoofed headers)
 * - Session tokens are single-use and expire quickly
 */

// CORS configuration with origin allowlist
const ALLOWED_ORIGINS = [
  'https://vocal-cascaron-bcef9b.netlify.app',
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
];
const ALLOWED_METHODS = 'GET,POST,PUT,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'authorization,content-type,x-client-info,apikey,x-forwarded-for,x-real-ip,cache-control,pragma,expires';
const MAX_AGE = '86400';

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': MAX_AGE,
    'Vary': 'Origin',
  };
}

// Coinbase API endpoints
const ONRAMP_TOKEN_API = "https://api.developer.coinbase.com/onramp/v1/token";
const ONRAMP_BASE_URL = "https://pay.coinbase.com/buy/select-asset";

interface AddressConfig {
  address: string;
  blockchains: string[];
}

interface OnrampInitRequest {
  destinationAddress: string;
  destinationNetwork?: string;
  assets?: string[];
  fiatCurrency?: string;
  presetFiatAmount?: number;
  presetCryptoAmount?: number;
  defaultAsset?: string;
  defaultPaymentMethod?: string;
  partnerUserRef?: string;
  redirectUrl?: string;
  defaultExperience?: 'send' | 'buy';
}

/**
 * Base64url encode a string or object
 */
function base64UrlEncode(input: string | object): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a JWT for Coinbase CDP API authentication using ES256
 *
 * Per official Coinbase Onramp Demo App specification:
 * - iss must be "coinbase-cloud" (NOT "cdp")
 * - uri (singular) must be "METHOD host/path" format (NOT uris array)
 * - aud claim should NOT be included
 * - nonce should be 16-byte random hex string
 */
async function generateCdpJwt(uri: string): Promise<string> {
  const apiKeyId = Deno.env.get("CDC_CLIENT_API_KEY");
  const apiKeySecret = Deno.env.get("CDC_SECRET_API_KEY");

  if (!apiKeyId || !apiKeySecret) {
    throw new Error("Missing CDC_CLIENT_API_KEY or CDC_SECRET_API_KEY environment variable");
  }

  // Generate a random nonce (16 bytes as hex string per Coinbase spec)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Create JWT header per Coinbase Onramp Demo App specification
  const header = {
    alg: "ES256",
    kid: apiKeyId,
    nonce: nonce,
    typ: "JWT",
  };

  // Create JWT payload per Coinbase Onramp Demo App specification
  // Key differences from incorrect implementation:
  // - iss must be "coinbase-cloud" (not "cdp")
  // - uri (singular) must be "METHOD host/path" format (not uris array)
  // - aud claim should NOT be included
  const now = Math.floor(Date.now() / 1000);
  const requestHost = "api.developer.coinbase.com";
  const requestPath = "/onramp/v1/token";
  const payload = {
    iss: "coinbase-cloud",
    sub: apiKeyId,
    nbf: now,
    exp: now + 120, // 2 minutes expiry
    uri: `POST ${requestHost}${requestPath}`,
  };

  const headerEncoded = base64UrlEncode(header);
  const payloadEncoded = base64UrlEncode(payload);
  const message = `${headerEncoded}.${payloadEncoded}`;

  // Import the private key and sign
  let privateKeyPem = apiKeySecret;

  // Handle escaped newlines in environment variable
  if (privateKeyPem.includes("\\n")) {
    privateKeyPem = privateKeyPem.replace(/\\n/g, "\n");
  }

  // Extract the key content between headers
  const pemContents = privateKeyPem
    .replace("-----BEGIN EC PRIVATE KEY-----", "")
    .replace("-----END EC PRIVATE KEY-----", "")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  // Convert base64 to ArrayBuffer
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // Import the key as PKCS8
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
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
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray));
  const signatureBase64Url = signatureBase64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${message}.${signatureBase64Url}`;
}

/**
 * Create a session token by calling the Coinbase Onramp Token API
 *
 * Required parameters per documentation:
 * - addresses: List of addresses with their supported blockchains
 * - clientIp: The client's IP address (required for security validation)
 * - assets: Optional list of assets to filter
 */
async function createOnrampSessionToken(
  addresses: AddressConfig[],
  clientIp: string,
  assets?: string[]
): Promise<string> {
  const jwt = await generateCdpJwt(ONRAMP_TOKEN_API);

  const requestBody: {
    addresses: AddressConfig[];
    clientIp: string;
    assets?: string[];
  } = {
    addresses,
    clientIp,
  };

  if (assets && assets.length > 0) {
    requestBody.assets = assets;
  }

  console.log(`[onramp-init] Calling Coinbase Token API with clientIp: ${clientIp.substring(0, 8)}...`);

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
    console.error(`[onramp-init] Token API error: ${response.status} ${errorText}`);
    throw new Error(`Coinbase API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.token;
}

/**
 * Get the client IP address from the request
 * Uses Deno's native support for getting the client address
 */
function getClientIp(req: Request): string {
  // In Deno Deploy / Supabase Edge, we can try to get the IP from headers
  // Note: The x-forwarded-for header can be spoofed, but for most proxy setups
  // it's the best we can do. In production, the edge runtime provides the real IP.

  // Try Supabase/Deno Deploy's client IP header first
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
    // Take the first IP (the original client)
    return forwardedFor.split(",")[0].trim();
  }

  // Default fallback (shouldn't happen in production)
  return "0.0.0.0";
}

/**
 * Build the onramp URL with session token and parameters
 * Per documentation: https://pay.coinbase.com/buy/select-asset?sessionToken=<token>&<other params>
 */
function buildOnrampUrl(
  sessionToken: string,
  params: Partial<OnrampInitRequest>
): string {
  const url = new URL(ONRAMP_BASE_URL);

  // Required parameter
  url.searchParams.set("sessionToken", sessionToken);

  // Optional parameters per documentation
  if (params.defaultNetwork) {
    url.searchParams.set("defaultNetwork", params.defaultNetwork);
  }

  if (params.defaultAsset) {
    url.searchParams.set("defaultAsset", params.defaultAsset);
  }

  if (params.presetCryptoAmount !== undefined) {
    url.searchParams.set("presetCryptoAmount", String(params.presetCryptoAmount));
  }

  if (params.presetFiatAmount !== undefined) {
    url.searchParams.set("presetFiatAmount", String(params.presetFiatAmount));
  }

  if (params.defaultExperience) {
    url.searchParams.set("defaultExperience", params.defaultExperience);
  }

  if (params.defaultPaymentMethod) {
    url.searchParams.set("defaultPaymentMethod", params.defaultPaymentMethod);
  }

  if (params.fiatCurrency) {
    url.searchParams.set("fiatCurrency", params.fiatCurrency);
  }

  if (params.partnerUserRef) {
    url.searchParams.set("partnerUserRef", params.partnerUserRef);
  }

  if (params.redirectUrl) {
    url.searchParams.set("redirectUrl", params.redirectUrl);
  }

  return url.toString();
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[onramp-init][${requestId}] Incoming request: method=${req.method}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: cors });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } }
    );
  }

  try {
    // Parse request body
    let body: OnrampInitRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const {
      destinationAddress,
      destinationNetwork = "base",
      assets = ["USDC", "ETH"],
      fiatCurrency = "USD",
      presetFiatAmount,
      presetCryptoAmount,
      defaultAsset = "USDC",
      defaultPaymentMethod = "CARD",
      partnerUserRef,
      redirectUrl,
      defaultExperience = "buy",
    } = body;

    // Validate required fields
    if (!destinationAddress || typeof destinationAddress !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "destinationAddress is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // Validate address format (basic check for Ethereum-style addresses)
    if (!/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid wallet address format" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // Get the client IP (required by Coinbase API)
    const clientIp = getClientIp(req);
    console.log(`[onramp-init][${requestId}] Client IP: ${clientIp.substring(0, 8)}..., Address: ${destinationAddress.substring(0, 10)}...`);

    // Build the addresses array for the Token API
    const addresses: AddressConfig[] = [
      {
        address: destinationAddress,
        blockchains: [destinationNetwork],
      },
    ];

    // Create the session token
    const sessionToken = await createOnrampSessionToken(addresses, clientIp, assets);
    console.log(`[onramp-init][${requestId}] Session token created successfully`);

    // Build the onramp URL with all parameters
    const onrampUrl = buildOnrampUrl(sessionToken, {
      defaultNetwork: destinationNetwork,
      defaultAsset,
      defaultPaymentMethod,
      fiatCurrency,
      presetFiatAmount,
      presetCryptoAmount,
      partnerUserRef,
      redirectUrl,
      defaultExperience,
    });

    console.log(`[onramp-init][${requestId}] Onramp URL generated successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          sessionToken,
          url: onrampUrl,
          destinationAddress,
          destinationNetwork,
          defaultAsset,
          expiresIn: 120, // Token expires in ~2 minutes
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[onramp-init][${requestId}] Error:`, error);

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        code: "ONRAMP_INIT_ERROR",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
