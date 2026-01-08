import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";

/**
 * Coinbase CDP Offramp Webhook Handler
 *
 * This edge function receives webhook notifications from Coinbase CDP about
 * offramp transaction status changes. It updates the transaction status
 * in the database and can trigger additional processing.
 *
 * CDP Offramp webhook events:
 * - offramp.transaction.created - New Offramp transaction created
 * - offramp.transaction.updated - Offramp transaction status changed
 * - offramp.transaction.success - Offramp transaction completed successfully
 * - offramp.transaction.failed - Offramp transaction failed
 *
 * Webhook signature verification uses X-Hook0-Signature header
 * Format: t=timestamp,h=headers,v1=signature
 *
 * Endpoint: https://cyxjzycxnfqctxocolwr.supabase.co/functions/v1/offramp-webhook
 */

// CORS configuration (webhooks may not need CORS, but we keep it for flexibility)
const ALLOWED_ORIGINS = [
  'https://vocal-cascaron-bcef9b.netlify.app',
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  // Coinbase IPs/domains would be whitelisted in production
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-hook0-signature',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// CDP Amount object
interface CDPAmount {
  currency: string;
  value: string;
}

/**
 * CDP Offramp Webhook Event Payload
 * Based on Coinbase Developer Platform documentation
 */
interface CDPOfframpWebhookEvent {
  // Event type: offramp.transaction.created|updated|success|failed
  eventType: string;

  // Transaction identifiers
  transactionId?: string;
  payoutId?: string;

  // Status
  status: string;

  // Crypto details (what user is selling)
  sellAmount?: CDPAmount | string;
  sellCurrency?: string;
  sellNetwork?: string;

  // Fiat details (what user is receiving)
  cashoutAmount?: CDPAmount | string;
  cashoutCurrency?: string;

  // Fees
  coinbaseFee?: CDPAmount;
  networkFee?: CDPAmount;

  // Exchange rate
  exchangeRate?: CDPAmount | string;

  // Source wallet
  walletAddress?: string;
  sourceAddress?: string;
  sourceNetwork?: string;

  // User reference
  userId?: string;
  userType?: string;
  partnerUserRef?: string;

  // Transaction hash
  txHash?: string;

  // Payout destination
  payoutMethod?: string;
  payoutDestination?: string;

  // Country
  country?: string;

  // Timestamps
  createdAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

/**
 * Verify CDP webhook signature using X-Hook0-Signature header
 *
 * The signature header format is: t=timestamp,h=headers,v1=signature
 * - t: Unix timestamp
 * - h: Space-separated list of header names included in the signature
 * - v1: HMAC-SHA256 signature in hex format
 *
 * Signed payload format: timestamp.headerNames.headerValues.body
 */
async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  headers: Headers,
  maxAgeMinutes: number = 5
): Promise<boolean> {
  try {
    // Parse signature header: t=timestamp,h=headers,v1=signature
    const elements = signatureHeader.split(',');
    const timestampPart = elements.find(e => e.startsWith('t='));
    const headersPart = elements.find(e => e.startsWith('h='));
    const signaturePart = elements.find(e => e.startsWith('v1='));

    if (!timestampPart || !headersPart || !signaturePart) {
      console.error('Webhook verification: Missing signature components');
      return false;
    }

    const timestamp = timestampPart.split('=')[1];
    const headerNames = headersPart.split('=')[1];
    const providedSignature = signaturePart.split('=')[1];

    // Build header values string from the specified headers
    const headerNameList = headerNames.split(' ');
    const headerValues = headerNameList.map(name => headers.get(name) || '').join('.');

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

    // Compare signatures
    const signaturesMatch = expectedSignature.length === providedSignature.length &&
      expectedSignature === providedSignature;

    // Verify timestamp to prevent replay attacks
    const webhookTime = parseInt(timestamp) * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const ageMinutes = (currentTime - webhookTime) / (1000 * 60);

    if (ageMinutes > maxAgeMinutes) {
      console.error(`Webhook timestamp exceeds maximum age: ${ageMinutes.toFixed(1)} minutes > ${maxAgeMinutes} minutes`);
      return false;
    }

    return signaturesMatch;
  } catch (error) {
    console.error('Webhook verification error:', error);
    return false;
  }
}

/**
 * Map CDP event type to internal status
 */
function mapEventToStatus(eventType: string, status: string): { internalStatus: string; paymentStatus: string } {
  // Handle by event type first
  if (eventType.endsWith('.success')) {
    return { internalStatus: 'complete', paymentStatus: 'confirmed' };
  }
  if (eventType.endsWith('.failed')) {
    return { internalStatus: 'failed', paymentStatus: 'failed' };
  }
  if (eventType.endsWith('.created')) {
    return { internalStatus: 'pending', paymentStatus: 'waiting' };
  }
  if (eventType.endsWith('.updated')) {
    // For updates, check the status field
    if (status.includes('COMPLETED') || status.includes('SUCCESS')) {
      return { internalStatus: 'complete', paymentStatus: 'confirmed' };
    }
    if (status.includes('FAILED')) {
      return { internalStatus: 'failed', paymentStatus: 'failed' };
    }
    if (status.includes('IN_PROGRESS')) {
      return { internalStatus: 'processing', paymentStatus: 'processing' };
    }
    return { internalStatus: 'pending', paymentStatus: 'waiting' };
  }

  // Fallback based on status string
  if (status.includes('COMPLETED') || status.includes('SUCCESS')) {
    return { internalStatus: 'complete', paymentStatus: 'confirmed' };
  }
  if (status.includes('FAILED')) {
    return { internalStatus: 'failed', paymentStatus: 'failed' };
  }

  return { internalStatus: 'pending', paymentStatus: 'waiting' };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[offramp-webhook][${requestId}] Incoming request: method=${req.method}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // Only accept POST requests for webhooks
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } }
    );
  }

  try {
    // Get raw body for signature verification
    const rawBody = await req.text();

    // Parse webhook payload
    let webhookPayload: CDPOfframpWebhookEvent;
    try {
      webhookPayload = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const { eventType, status, transactionId, payoutId, partnerUserRef } = webhookPayload;
    console.log(`[offramp-webhook][${requestId}] Event: ${eventType}, Status: ${status}, TransactionId: ${transactionId || payoutId}`);

    if (!eventType) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing eventType" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // Verify webhook signature using X-Hook0-Signature header
    const signatureHeader = req.headers.get('x-hook0-signature');
    const webhookSecret = Deno.env.get("CDP_WEBHOOK_SECRET");

    if (webhookSecret) {
      if (!signatureHeader) {
        console.error(`[offramp-webhook][${requestId}] Missing X-Hook0-Signature header`);
        return new Response(
          JSON.stringify({ success: false, error: "Missing signature" }),
          { status: 401, headers: { "Content-Type": "application/json", ...cors } }
        );
      }

      const isValid = await verifyWebhookSignature(rawBody, signatureHeader, webhookSecret, req.headers);
      if (!isValid) {
        console.error(`[offramp-webhook][${requestId}] Invalid webhook signature`);
        return new Response(
          JSON.stringify({ success: false, error: "Invalid signature" }),
          { status: 401, headers: { "Content-Type": "application/json", ...cors } }
        );
      }
      console.log(`[offramp-webhook][${requestId}] Signature verified successfully`);
    } else {
      console.warn(`[offramp-webhook][${requestId}] CDP_WEBHOOK_SECRET not configured - skipping signature verification`);
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error(`[offramp-webhook][${requestId}] Missing Supabase credentials`);
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Map CDP event to internal status
    const { internalStatus, paymentStatus } = mapEventToStatus(eventType, status);

    // Get transaction identifier
    const txId = transactionId || payoutId;

    // Extract amounts and network info based on payload format
    const sellAmount = typeof webhookPayload.sellAmount === 'object'
      ? webhookPayload.sellAmount
      : webhookPayload.sellAmount ? { value: webhookPayload.sellAmount, currency: webhookPayload.sellCurrency || 'USDC' } : null;

    const cashoutAmount = typeof webhookPayload.cashoutAmount === 'object'
      ? webhookPayload.cashoutAmount
      : webhookPayload.cashoutAmount ? { value: webhookPayload.cashoutAmount, currency: webhookPayload.cashoutCurrency || 'USD' } : null;

    const network = webhookPayload.sellNetwork || webhookPayload.sourceNetwork;
    const walletAddress = webhookPayload.walletAddress || webhookPayload.sourceAddress;

    // Build metadata object with all relevant CDP fields
    const metadata = {
      cdp_event_type: eventType,
      cdp_status: status,
      transaction_type: 'offramp',
      sell_amount: sellAmount,
      cashout_amount: cashoutAmount,
      payout_method: webhookPayload.payoutMethod,
      payout_destination: webhookPayload.payoutDestination,
      network: network,
      wallet_address: walletAddress,
      tx_hash: webhookPayload.txHash,
      coinbase_fee: webhookPayload.coinbaseFee,
      network_fee: webhookPayload.networkFee,
      exchange_rate: webhookPayload.exchangeRate,
      user_type: webhookPayload.userType,
      country: webhookPayload.country,
      completed_at: webhookPayload.completedAt,
      updated_at: webhookPayload.updatedAt,
    };

    if (txId) {
      // Update by transaction ID
      const { error } = await supabase
        .from('user_transactions')
        .update({
          status: internalStatus,
          payment_status: paymentStatus,
          external_transaction_id: txId,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('external_transaction_id', txId);

      if (error) {
        console.error(`[offramp-webhook][${requestId}] Failed to update by transaction ID:`, error);
      } else {
        console.log(`[offramp-webhook][${requestId}] Updated transaction ${txId} to ${internalStatus}`);
      }
    } else if (partnerUserRef) {
      // Convert to canonical format for lookup
      const canonicalUserId = toPrizePid(partnerUserRef);
      console.log(`[offramp-webhook][${requestId}] Canonical user ID: ${canonicalUserId}`);

      // Try canonical lookup first, then fallback to legacy user_privy_id
      let updateQuery = supabase
        .from('user_transactions')
        .update({
          status: internalStatus,
          payment_status: paymentStatus,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', canonicalUserId)
        .eq('payment_provider', 'coinbase_offramp')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1);

      const { error, count } = await updateQuery;

      // If no rows updated with canonical ID, try legacy user_privy_id
      if (!error && (!count || count === 0)) {
        console.log(`[offramp-webhook][${requestId}] No match with canonical ID, trying legacy lookup`);
        const { error: legacyError } = await supabase
          .from('user_transactions')
          .update({
            status: internalStatus,
            payment_status: paymentStatus,
            metadata,
            updated_at: new Date().toISOString(),
          })
          .eq('user_privy_id', partnerUserRef)
          .eq('payment_provider', 'coinbase_offramp')
          .in('status', ['pending', 'processing'])
          .order('created_at', { ascending: false })
          .limit(1);

        if (legacyError) {
          console.error(`[offramp-webhook][${requestId}] Failed to update by partnerUserRef (legacy):`, legacyError);
        } else {
          console.log(`[offramp-webhook][${requestId}] Updated transaction for user ${partnerUserRef} to ${internalStatus} (legacy lookup)`);
        }
      } else if (error) {
        console.error(`[offramp-webhook][${requestId}] Failed to update by partnerUserRef:`, error);
      } else {
        console.log(`[offramp-webhook][${requestId}] Updated transaction for user ${canonicalUserId} to ${internalStatus}`);
      }
    } else {
      console.warn(`[offramp-webhook][${requestId}] No transaction ID or partnerUserRef found in webhook payload`);
    }

    // Handle successful transaction completion
    if (eventType.endsWith('.success') && cashoutAmount) {
      console.log(`[offramp-webhook][${requestId}] Offramp successful: ${sellAmount?.value} ${sellAmount?.currency} -> ${cashoutAmount.value} ${cashoutAmount.currency}`);

      // TODO: Additional processing for successful offramp
      // e.g., send confirmation email, update user balance, etc.
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Webhook processed',
        eventType,
        status: internalStatus,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[offramp-webhook][${requestId}] Error:`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
