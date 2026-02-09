import type { Context, Config } from "@netlify/functions";

/**
 * CDP Analytics Webhook Handler
 *
 * This Netlify function receives webhook notifications from Coinbase Developer Platform
 * for on-chain activity events (smart contract events like transfers).
 *
 * Features:
 * - X-Hook0-Signature verification for security
 * - Timestamp validation to prevent replay attacks
 * - Event logging for audit trail
 * - Support for Transfer and other ERC-20 events
 *
 * Endpoint: POST /api/cdp-analytics/webhook
 *
 * @see https://docs.cdp.coinbase.com/developer-platform/docs/webhooks-onchain-activity
 */

// CDP On-chain Activity Event interface
interface CDPOnchainActivityData {
  subscriptionId: string;
  networkId: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  contractAddress: string;
  eventName: string;
  [key: string]: unknown;
}

interface CDPWebhookEvent {
  id: string;
  type: string;
  createdAt: string;
  data: CDPOnchainActivityData;
}

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hook0-Signature, X-Hook0-Id",
  "Access-Control-Max-Age": "86400",
};

/**
 * Parse X-Hook0-Signature header
 * Format: t=timestamp,h=headers,v1=signature
 */
function parseSignatureHeader(signatureHeader: string): {
  timestamp: string;
  headerNames: string;
  signature: string;
} | null {
  try {
    const elements = signatureHeader.split(',');
    const timestampPart = elements.find(e => e.startsWith('t='));
    const headersPart = elements.find(e => e.startsWith('h='));
    const signaturePart = elements.find(e => e.startsWith('v1='));

    if (!timestampPart || !headersPart || !signaturePart) {
      return null;
    }

    return {
      timestamp: timestampPart.split('=')[1],
      headerNames: headersPart.split('=')[1],
      signature: signaturePart.split('=')[1],
    };
  } catch {
    return null;
  }
}

/**
 * Verify CDP webhook signature using X-Hook0-Signature header
 *
 * The signature is computed as:
 * HMAC-SHA256(secret, "${timestamp}.${headerNames}.${headerValues}.${body}")
 */
async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  headers: Headers,
  maxAgeMinutes: number = 5
): Promise<{ valid: boolean; error?: string }> {
  const parsed = parseSignatureHeader(signatureHeader);

  if (!parsed) {
    return { valid: false, error: 'Invalid signature header format' };
  }

  const { timestamp, headerNames, signature: providedSignature } = parsed;

  // Build header values string from the specified headers
  const headerNameList = headerNames.split(' ');
  const headerValues = headerNameList
    .map(name => headers.get(name) || '')
    .join('.');

  // Build signed payload: timestamp.headerNames.headerValues.body
  const signedPayload = `${timestamp}.${headerNames}.${headerValues}.${payload}`;

  // Compute expected signature using HMAC-SHA256
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureData = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );

  // Convert to hex
  const expectedSignature = Array.from(new Uint8Array(signatureData))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Timing-safe comparison
  if (expectedSignature.length !== providedSignature.length) {
    return { valid: false, error: 'Signature mismatch' };
  }

  let mismatch = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ providedSignature.charCodeAt(i);
  }

  if (mismatch !== 0) {
    return { valid: false, error: 'Signature mismatch' };
  }

  // Verify timestamp to prevent replay attacks
  const webhookTime = parseInt(timestamp) * 1000; // Convert to milliseconds
  const currentTime = Date.now();
  const ageMinutes = (currentTime - webhookTime) / (1000 * 60);

  if (ageMinutes > maxAgeMinutes) {
    return {
      valid: false,
      error: `Webhook timestamp exceeds maximum age: ${ageMinutes.toFixed(1)} minutes > ${maxAgeMinutes} minutes`,
    };
  }

  return { valid: true };
}

/**
 * Process on-chain activity event
 */
async function processOnchainActivityEvent(
  event: CDPWebhookEvent,
  requestId: string
): Promise<void> {
  const { data } = event;

  console.log(`[cdp-analytics][${requestId}] Processing on-chain activity:`);
  console.log(`  - Subscription: ${data.subscriptionId}`);
  console.log(`  - Network: ${data.networkId}`);
  console.log(`  - Contract: ${data.contractAddress}`);
  console.log(`  - Event: ${data.eventName}`);
  console.log(`  - Transaction: ${data.transactionHash}`);
  console.log(`  - Block: ${data.blockNumber}`);

  // Log specific event data based on event type
  if (data.eventName === 'Transfer') {
    console.log(`  - From: ${data.from}`);
    console.log(`  - To: ${data.to}`);
    console.log(`  - Value: ${data.value}`);
  }

  // Here you can add additional processing logic:
  // - Store events in database for analytics
  // - Trigger notifications for specific addresses
  // - Update user balances
  // - Track competition-related transactions

  // Example: Store in Supabase if needed
  // This is where you would integrate with your database
  // For now, we just log the event
}

// Response helpers
function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  console.log(`[cdp-analytics][${requestId}] Incoming webhook request`);

  try {
    // Get raw body for signature verification
    const rawBody = await req.text();

    // Get signature header
    const signatureHeader = req.headers.get("x-hook0-signature");
    const webhookId = req.headers.get("x-hook0-id");

    console.log(`[cdp-analytics][${requestId}] Webhook ID: ${webhookId || 'not provided'}`);
    console.log(`[cdp-analytics][${requestId}] Signature present: ${!!signatureHeader}`);

    // Get webhook secret from environment
    // This secret is provided when creating a webhook subscription (metadata.secret)
    const webhookSecret = Netlify.env.get("CDP_ANALYTICS_WEBHOOK_SECRET") ||
                          Netlify.env.get("CDP_WEBHOOK_SECRET");

    // Verify signature if secret is configured
    if (webhookSecret) {
      if (!signatureHeader) {
        console.error(`[cdp-analytics][${requestId}] Missing X-Hook0-Signature header`);
        return errorResponse("Missing signature", 401);
      }

      const verification = await verifyWebhookSignature(
        rawBody,
        signatureHeader,
        webhookSecret,
        req.headers
      );

      if (!verification.valid) {
        console.error(`[cdp-analytics][${requestId}] Signature verification failed: ${verification.error}`);
        return errorResponse("Invalid signature", 401);
      }

      console.log(`[cdp-analytics][${requestId}] ✅ Signature verified`);
    } else {
      console.warn(`[cdp-analytics][${requestId}] ⚠️ CDP_ANALYTICS_WEBHOOK_SECRET not configured - signature verification skipped`);
    }

    // Parse the webhook payload
    let event: CDPWebhookEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      console.error(`[cdp-analytics][${requestId}] Invalid JSON body`);
      return errorResponse("Invalid JSON body", 400);
    }

    console.log(`[cdp-analytics][${requestId}] Event type: ${event.type}`);
    console.log(`[cdp-analytics][${requestId}] Event ID: ${event.id}`);

    // Process based on event type
    if (event.type === 'onchain.activity.detected') {
      await processOnchainActivityEvent(event, requestId);

      return jsonResponse({
        success: true,
        message: "Event processed",
        eventId: event.id,
        eventType: event.type,
      });
    }

    // Unknown event type - acknowledge but log
    console.warn(`[cdp-analytics][${requestId}] Unknown event type: ${event.type}`);

    return jsonResponse({
      success: true,
      message: "Event acknowledged",
      eventId: event.id,
      eventType: event.type,
    });

  } catch (error) {
    console.error(`[cdp-analytics][${requestId}] Unhandled error:`, error);

    return jsonResponse(
      {
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

export const config: Config = {
  path: "/api/cdp-analytics/webhook",
};
