import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid } from "../_shared/userId.ts";

/**
 * Coinbase Onramp Status Handler
 *
 * This edge function checks the status of an onramp transaction.
 * It can query both the local database and the Coinbase Transaction Status API
 * to provide real-time status updates.
 *
 * Coinbase Transaction Status API:
 * GET https://api.developer.coinbase.com/onramp/v1/buy/user/{partnerUserId}/transactions
 *
 * Endpoint: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/onramp-status
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, cache-control, pragma, expires',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// Coinbase API endpoints
const COINBASE_TRANSACTIONS_API = "https://api.developer.coinbase.com/onramp/v1/buy/user";

interface StatusRequest {
  transactionId?: string;
  partnerUserRef?: string;
  checkCoinbase?: boolean;
}

interface TransactionStatus {
  id: string;
  status: string;
  paymentStatus: string;
  amount?: number;
  currency?: string;
  cryptoAmount?: string;
  cryptoCurrency?: string;
  network?: string;
  createdAt?: string;
  updatedAt?: string;
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

  // Parse the URI to extract host and path for GET requests
  const urlObj = new URL(uri);
  const requestHost = urlObj.host;
  const requestPath = urlObj.pathname;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "coinbase-cloud",
    sub: apiKeyId,
    nbf: now,
    exp: now + 120,
    uri: `GET ${requestHost}${requestPath}`,
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
 * Fetch transactions from Coinbase API
 */
async function fetchCoinbaseTransactions(partnerUserId: string): Promise<unknown[]> {
  const apiUrl = `${COINBASE_TRANSACTIONS_API}/${encodeURIComponent(partnerUserId)}/transactions`;

  try {
    const jwt = await generateCdpJwt(apiUrl);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Coinbase API error: ${response.status} ${errorText}`);
      return [];
    }

    const data = await response.json();
    return data.transactions || [];
  } catch (error) {
    console.error("Error fetching Coinbase transactions:", error);
    return [];
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[onramp-status][${requestId}] Incoming request: method=${req.method}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    let params: StatusRequest = {};

    // Handle GET requests with query params
    if (req.method === "GET") {
      const url = new URL(req.url);
      params = {
        transactionId: url.searchParams.get('transactionId') || undefined,
        partnerUserRef: url.searchParams.get('partnerUserRef') || undefined,
        checkCoinbase: url.searchParams.get('checkCoinbase') === 'true',
      };
    }

    // Handle POST requests with JSON body
    if (req.method === "POST") {
      try {
        params = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid JSON body" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }
        );
      }
    }

    const { transactionId, partnerUserRef, checkCoinbase = false } = params;

    // Convert partnerUserRef to canonical format for database lookup
    const canonicalUserRef = partnerUserRef ? toPrizePid(partnerUserRef) : undefined;
    console.log(`[onramp-status][${requestId}] Canonical user ref: ${canonicalUserRef}`);

    if (!transactionId && !partnerUserRef) {
      return new Response(
        JSON.stringify({ success: false, error: "transactionId or partnerUserRef is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    console.log(`[onramp-status][${requestId}] Checking status for transactionId=${transactionId}, partnerUserRef=${partnerUserRef}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query local database for transaction status
    let dbTransaction: TransactionStatus | null = null;

    if (transactionId) {
      const { data, error } = await supabase
        .from('user_transactions')
        .select('id, status, payment_status, amount, currency, pay_currency, metadata, created_at, updated_at')
        .eq('id', transactionId)
        .single();

      if (!error && data) {
        dbTransaction = {
          id: data.id,
          status: data.status,
          paymentStatus: data.payment_status,
          amount: data.amount,
          currency: data.currency || 'USD',
          cryptoCurrency: data.pay_currency,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    } else if (canonicalUserRef) {
      // Query using canonical user ID for consistent matching
      // Also try legacy lookup with original partnerUserRef for backward compatibility
      let { data, error } = await supabase
        .from('user_transactions')
        .select('id, status, payment_status, amount, currency, pay_currency, metadata, created_at, updated_at')
        .eq('user_privy_id', canonicalUserRef)
        .eq('payment_provider', 'coinbase_onramp')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Fallback: try with original partnerUserRef if canonical lookup fails
      if (error && partnerUserRef && partnerUserRef !== canonicalUserRef) {
        const fallbackResult = await supabase
          .from('user_transactions')
          .select('id, status, payment_status, amount, currency, pay_currency, metadata, created_at, updated_at')
          .eq('user_privy_id', partnerUserRef)
          .eq('payment_provider', 'coinbase_onramp')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        data = fallbackResult.data;
        error = fallbackResult.error;
      }

      if (!error && data) {
        dbTransaction = {
          id: data.id,
          status: data.status,
          paymentStatus: data.payment_status,
          amount: data.amount,
          currency: data.currency || 'USD',
          cryptoCurrency: data.pay_currency,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    }

    // Optionally check Coinbase API for real-time status
    let coinbaseTransactions: unknown[] = [];
    if (checkCoinbase && partnerUserRef) {
      coinbaseTransactions = await fetchCoinbaseTransactions(partnerUserRef);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          transaction: dbTransaction,
          coinbaseTransactions: coinbaseTransactions.length > 0 ? coinbaseTransactions : undefined,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[onramp-status][${requestId}] Error:`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
