import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Coinbase Onramp Quote Handler
 *
 * This edge function fetches quotes from the Coinbase Onramp Quote API.
 * It provides real-time pricing information for converting fiat to crypto.
 *
 * Coinbase Quote API:
 * POST https://api.developer.coinbase.com/onramp/v1/buy/quote
 *
 * Endpoint: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/onramp-quote
 */

// CORS configuration
const ALLOWED_ORIGINS = [
  'https://vocal-cascaron-bcef9b.netlify.app',
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, cache-control, pragma, expires',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// Coinbase API endpoints
const COINBASE_QUOTE_API = "https://api.developer.coinbase.com/onramp/v1/buy/quote";

interface QuoteRequest {
  purchaseCurrency: string;  // Crypto asset (e.g., "ETH", "USDC")
  purchaseNetwork?: string;  // Network (e.g., "base", "ethereum")
  paymentCurrency: string;   // Fiat currency (e.g., "USD")
  paymentAmount: string;     // Fiat amount as string
  paymentMethod?: string;    // Payment method (e.g., "CARD", "ACH_BANK_ACCOUNT")
  country?: string;          // Country code (e.g., "US")
}

interface QuoteResponse {
  quoteId: string;
  purchaseAmount: {
    value: string;
    currency: string;
  };
  paymentSubtotal: {
    value: string;
    currency: string;
  };
  paymentTotal: {
    value: string;
    currency: string;
  };
  coinbaseFee: {
    value: string;
    currency: string;
  };
  networkFee: {
    value: string;
    currency: string;
  };
  exchangeRate: string;
  expiresAt: string;
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
 * Generate a JWT for Coinbase CDP API authentication
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
    throw new Error("Missing CDC API credentials");
  }

  // Generate a random nonce (16 bytes as hex string per Coinbase spec)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  const header = {
    alg: "ES256",
    kid: apiKeyId,
    typ: "JWT",
    nonce: nonce,
  };

  // Parse the URI to extract host and path
  const urlObj = new URL(uri);
  const requestHost = urlObj.host;
  const requestPath = urlObj.pathname;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "coinbase-cloud",
    sub: apiKeyId,
    nbf: now,
    exp: now + 120,
    uri: `POST ${requestHost}${requestPath}`,
  };

  const headerEncoded = base64UrlEncode(header);
  const payloadEncoded = base64UrlEncode(payload);
  const message = `${headerEncoded}.${payloadEncoded}`;

  let privateKeyPem = apiKeySecret;
  if (privateKeyPem.includes("\\n")) {
    privateKeyPem = privateKeyPem.replace(/\\n/g, "\n");
  }

  const pemContents = privateKeyPem
    .replace("-----BEGIN EC PRIVATE KEY-----", "")
    .replace("-----END EC PRIVATE KEY-----", "")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    encoder.encode(message)
  );

  const signatureArray = new Uint8Array(signature);
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray));
  const signatureBase64Url = signatureBase64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${message}.${signatureBase64Url}`;
}

/**
 * Fetch quote from Coinbase API
 */
async function fetchQuote(params: QuoteRequest): Promise<QuoteResponse> {
  const jwt = await generateCdpJwt(COINBASE_QUOTE_API);

  const requestBody = {
    purchase_currency: params.purchaseCurrency,
    purchase_network: params.purchaseNetwork || 'base',
    payment_currency: params.paymentCurrency,
    payment_amount: params.paymentAmount,
    payment_method: params.paymentMethod || 'CARD',
    country: params.country || 'US',
  };

  console.log(`[onramp-quote] Fetching quote:`, JSON.stringify(requestBody));

  const response = await fetch(COINBASE_QUOTE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[onramp-quote] API error: ${response.status} ${errorText}`);
    throw new Error(`Coinbase Quote API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[onramp-quote][${requestId}] Incoming request: method=${req.method}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
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
    let body: QuoteRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const {
      purchaseCurrency,
      purchaseNetwork = 'base',
      paymentCurrency = 'USD',
      paymentAmount,
      paymentMethod = 'CARD',
      country = 'US',
    } = body;

    // Validate required fields
    if (!purchaseCurrency) {
      return new Response(
        JSON.stringify({ success: false, error: "purchaseCurrency is required (e.g., 'USDC', 'ETH')" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    if (!paymentAmount) {
      return new Response(
        JSON.stringify({ success: false, error: "paymentAmount is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // Validate amount is a valid number
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "paymentAmount must be a positive number" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    console.log(`[onramp-quote][${requestId}] Getting quote for ${paymentAmount} ${paymentCurrency} -> ${purchaseCurrency} on ${purchaseNetwork}`);

    // Fetch quote from Coinbase
    const quote = await fetchQuote({
      purchaseCurrency,
      purchaseNetwork,
      paymentCurrency,
      paymentAmount: String(paymentAmount),
      paymentMethod,
      country,
    });

    console.log(`[onramp-quote][${requestId}] Quote received:`, JSON.stringify(quote));

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          quoteId: quote.quoteId,
          purchaseAmount: quote.purchaseAmount,
          paymentSubtotal: quote.paymentSubtotal,
          paymentTotal: quote.paymentTotal,
          coinbaseFee: quote.coinbaseFee,
          networkFee: quote.networkFee,
          exchangeRate: quote.exchangeRate,
          expiresAt: quote.expiresAt,
          // Calculated convenience fields
          cryptoAmount: quote.purchaseAmount.value,
          cryptoCurrency: quote.purchaseAmount.currency,
          fiatAmount: quote.paymentTotal.value,
          fiatCurrency: quote.paymentTotal.currency,
          totalFees: String(
            parseFloat(quote.coinbaseFee?.value || '0') +
            parseFloat(quote.networkFee?.value || '0')
          ),
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[onramp-quote][${requestId}] Error:`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
