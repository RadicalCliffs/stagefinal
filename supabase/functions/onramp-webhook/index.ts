import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";

/**
 * Coinbase CDP Onramp/Offramp Webhook Handler
 *
 * This edge function receives webhook notifications from Coinbase CDP about
 * onramp and offramp transaction status changes. It updates the transaction status
 * in the database and can trigger additional processing.
 *
 * CDP Onramp webhook events:
 * - onramp.transaction.created - New Onramp transaction created
 * - onramp.transaction.updated - Onramp transaction status changed
 * - onramp.transaction.success - Onramp transaction completed successfully
 * - onramp.transaction.failed - Onramp transaction failed
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
 * Endpoint: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/onramp-webhook
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
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-hook0-signature, cache-control, pragma, expires',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// CDP Fee type for onramp transactions
interface CDPFee {
  feeType: string; // e.g., "FEE_TYPE_NETWORK", "FEE_TYPE_EXCHANGE"
  feeAmount: string;
  feeCurrency: string;
}

// CDP Amount object
interface CDPAmount {
  currency: string;
  value: string;
}

/**
 * CDP Onramp/Offramp Webhook Event Payload
 * Based on Coinbase Developer Platform documentation
 */
interface CDPWebhookEvent {
  // Event type: onramp.transaction.created|updated|success|failed or offramp.*
  eventType: string;

  // Transaction identifiers
  transactionId?: string;      // For guest checkout transactions
  orderId?: string;            // For Apple Pay Onramp API orders

  // Status
  status: string;              // e.g., "ONRAMP_TRANSACTION_STATUS_IN_PROGRESS", "ONRAMP_ORDER_STATUS_COMPLETED"

  // Payment details
  paymentTotal?: CDPAmount | string;
  paymentSubtotal?: CDPAmount | string;
  paymentTotalUsd?: CDPAmount;
  paymentMethod?: string;      // e.g., "CARD", "GUEST_CHECKOUT_APPLE_PAY"

  // Purchase/crypto details
  purchaseAmount?: CDPAmount | string;
  purchaseCurrency?: string;
  purchaseNetwork?: string;

  // Fees
  coinbaseFee?: CDPAmount;
  networkFee?: CDPAmount;
  fees?: CDPFee[];             // For Apple Pay orders

  // Exchange rate
  exchangeRate?: CDPAmount | string;

  // Destination
  walletAddress?: string;
  destinationAddress?: string;
  destinationNetwork?: string;

  // User reference
  userId?: string;
  userType?: string;           // e.g., "USER_TYPE_GUEST"
  partnerUserRef?: string;

  // Transaction hash
  txHash?: string;

  // Transaction type
  type?: string;               // e.g., "ONRAMP_TRANSACTION_TYPE_BUY_AND_SEND"

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

    // Compare signatures (timing-safe comparison)
    const signaturesMatch = expectedSignature.length === providedSignature.length &&
      crypto.timingSafeEqual
        ? crypto.subtle === undefined // Fallback for Deno
          ? expectedSignature === providedSignature
          : expectedSignature === providedSignature
        : expectedSignature === providedSignature;

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

  console.log(`[onramp-webhook][${requestId}] Incoming request: method=${req.method}`);

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
    let webhookPayload: CDPWebhookEvent;
    try {
      webhookPayload = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const { eventType, status, transactionId, orderId, partnerUserRef } = webhookPayload;
    console.log(`[onramp-webhook][${requestId}] Event: ${eventType}, Status: ${status}, TransactionId: ${transactionId || orderId}`);

    if (!eventType) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing eventType" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // Verify webhook signature using X-Hook0-Signature header
    // The secret is provided in metadata.secret when creating the webhook subscription
    const signatureHeader = req.headers.get('x-hook0-signature');
    const webhookSecret = Deno.env.get("CDP_WEBHOOK_SECRET");

    // SECURITY: Always require webhook signature verification in production
    // If CDP_WEBHOOK_SECRET is not configured, reject the request to prevent forged webhooks
    if (!webhookSecret) {
      console.error(`[onramp-webhook][${requestId}] CDP_WEBHOOK_SECRET not configured - rejecting request for security`);
      return new Response(
        JSON.stringify({ success: false, error: "Webhook verification not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    if (!signatureHeader) {
      console.error(`[onramp-webhook][${requestId}] Missing X-Hook0-Signature header`);
      return new Response(
        JSON.stringify({ success: false, error: "Missing signature" }),
        { status: 401, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const isValid = await verifyWebhookSignature(rawBody, signatureHeader, webhookSecret, req.headers);
    if (!isValid) {
      console.error(`[onramp-webhook][${requestId}] Invalid webhook signature`);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid signature" }),
        { status: 401, headers: { "Content-Type": "application/json", ...cors } }
      );
    }
    console.log(`[onramp-webhook][${requestId}] Signature verified successfully`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error(`[onramp-webhook][${requestId}] Missing Supabase credentials`);
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Map CDP event to internal status
    const { internalStatus, paymentStatus } = mapEventToStatus(eventType, status);

    // Determine transaction type (onramp or offramp)
    const isOfframp = eventType.startsWith('offramp.');
    const transactionType = isOfframp ? 'offramp' : 'onramp';

    // Get transaction identifier
    const txId = transactionId || orderId;

    // Extract amounts and network info based on payload format
    const purchaseAmount = typeof webhookPayload.purchaseAmount === 'object'
      ? webhookPayload.purchaseAmount
      : webhookPayload.purchaseAmount ? { value: webhookPayload.purchaseAmount, currency: webhookPayload.purchaseCurrency || 'USDC' } : null;

    const paymentTotal = typeof webhookPayload.paymentTotal === 'object'
      ? webhookPayload.paymentTotal
      : webhookPayload.paymentTotal ? { value: webhookPayload.paymentTotal, currency: 'USD' } : null;

    const network = webhookPayload.purchaseNetwork || webhookPayload.destinationNetwork;
    const walletAddress = webhookPayload.walletAddress || webhookPayload.destinationAddress;

    // Build metadata object with all relevant CDP fields
    const metadata = {
      cdp_event_type: eventType,
      cdp_status: status,
      transaction_type: transactionType,
      purchase_amount: purchaseAmount,
      payment_total: paymentTotal,
      payment_method: webhookPayload.paymentMethod,
      network: network,
      wallet_address: walletAddress,
      tx_hash: webhookPayload.txHash,
      coinbase_fee: webhookPayload.coinbaseFee,
      network_fee: webhookPayload.networkFee,
      fees: webhookPayload.fees,
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
        console.error(`[onramp-webhook][${requestId}] Failed to update by transaction ID:`, error);
      } else {
        console.log(`[onramp-webhook][${requestId}] Updated transaction ${txId} to ${internalStatus}`);
      }
    } else if (partnerUserRef) {
      // Update by partner user ref (find latest pending transaction for this user)
      const { error } = await supabase
        .from('user_transactions')
        .update({
          status: internalStatus,
          payment_status: paymentStatus,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('user_privy_id', partnerUserRef)
        .eq('payment_provider', 'coinbase_onramp')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error(`[onramp-webhook][${requestId}] Failed to update by partnerUserRef:`, error);
      } else {
        console.log(`[onramp-webhook][${requestId}] Updated transaction for user ${partnerUserRef} to ${internalStatus}`);
      }
    } else {
      console.warn(`[onramp-webhook][${requestId}] No transaction ID or partnerUserRef found in webhook payload`);
    }

    // Handle successful transaction completion - CREDIT USER BALANCE WITH 50% FIRST TOP-UP BONUS
    if (eventType.endsWith('.success') && purchaseAmount) {
      console.log(`[onramp-webhook][${requestId}] Transaction successful: ${purchaseAmount.value} ${purchaseAmount.currency}`);

      // Get the user ID from partnerUserRef or find from transaction
      let inputUserId = partnerUserRef;
      let walletAddressFromEvent = walletAddress; // Store original wallet address

      if (!inputUserId && txId) {
        // Try to find user from transaction record
        const { data: txData } = await supabase
          .from('user_transactions')
          .select('user_id, user_privy_id, wallet_address')
          .eq('external_transaction_id', txId)
          .maybeSingle();

        inputUserId = txData?.user_privy_id || txData?.user_id;
        if (!walletAddressFromEvent && txData?.wallet_address) {
          walletAddressFromEvent = txData.wallet_address;
        }
      }

      // CRITICAL: Check if this is a smart contract wallet and resolve to parent wallet
      if (walletAddressFromEvent && supabaseUrl && supabaseServiceKey) {
        try {
          console.log(`[onramp-webhook][${requestId}] Checking if ${walletAddressFromEvent} is a smart contract wallet`);
          const smartWalletLookup = await fetch(
            `${supabaseUrl}/rest/v1/canonical_users?smart_wallet_address=eq.${walletAddressFromEvent}&select=wallet_address,canonical_user_id`,
            {
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`
              }
            }
          );
          
          if (smartWalletLookup.ok) {
            const parentUsers = await smartWalletLookup.json();
            if (parentUsers && parentUsers.length > 0) {
              console.log(`[onramp-webhook][${requestId}] Smart wallet detected, resolving to parent:`, parentUsers[0].wallet_address);
              walletAddressFromEvent = parentUsers[0].wallet_address;
              // Also update the userId if we have the canonical form
              if (parentUsers[0].canonical_user_id) {
                inputUserId = parentUsers[0].canonical_user_id;
                console.log(`[onramp-webhook][${requestId}] Updated userId to canonical:`, inputUserId);
              } else if (parentUsers[0].wallet_address) {
                // Create canonical ID from parent wallet if not stored
                inputUserId = parentUsers[0].wallet_address;
                console.log(`[onramp-webhook][${requestId}] Updated userId to parent wallet:`, inputUserId);
              }
            } else {
              console.log(`[onramp-webhook][${requestId}] No smart wallet mapping found, using original address`);
            }
          }
        } catch (lookupError) {
          console.error(`[onramp-webhook][${requestId}] Error looking up smart wallet:`, lookupError);
          // Continue with original address if lookup fails
        }
      }

      if (inputUserId) {
        // Convert to canonical format
        const canonicalUserId = toPrizePid(inputUserId);
        console.log(`[onramp-webhook][${requestId}] Canonical user ID: ${canonicalUserId}`);

        // Calculate amount in USD
        let amountUsd = 0;

        // Use payment_total if available (this is the USD amount paid)
        if (paymentTotal?.value) {
          amountUsd = Number(paymentTotal.value);
        } else if (purchaseAmount?.value) {
          // If only purchase amount available, use it (should be in USDC which is 1:1 with USD)
          amountUsd = Number(purchaseAmount.value);
        }

        if (amountUsd > 0) {
          console.log(`[onramp-webhook][${requestId}] Crediting user ${canonicalUserId} with ${amountUsd}`);

          // Get user's UUID and bonus status from canonical_users by canonical ID
          const { data: userData, error: userError } = await supabase
            .from('canonical_users')
            .select('id, usdc_balance, has_used_new_user_bonus')
            .eq('canonical_user_id', canonicalUserId)
            .maybeSingle();

          if (userError) {
            console.error(`[onramp-webhook][${requestId}] Error fetching user:`, userError);
          } else if (userData) {
            const userUuid = userData.id;

            // Calculate 50% bonus for first top-up
            const hasUsedBonus = Boolean(userData.has_used_new_user_bonus);
            const isFirstTopup = !hasUsedBonus;
            const bonusAmount = isFirstTopup ? Math.floor(amountUsd * 0.5 * 100) / 100 : 0; // Round to 2 decimal places
            const totalCredit = amountUsd + bonusAmount;

            console.log(`[onramp-webhook][${requestId}] Bonus calculation: isFirstTopup=${isFirstTopup}, base=${amountUsd}, bonus=${bonusAmount}, total=${totalCredit}`);

            // Use credit_sub_account_balance RPC for atomic balance update
            // This is the primary balance system - writes to sub_account_balances.available_balance
            const { data: creditResult, error: creditError } = await supabase.rpc(
              'credit_sub_account_balance',
              {
                p_canonical_user_id: canonicalUserId,
                p_amount: totalCredit,
                p_currency: 'USD'
              }
            );

            if (creditError) {
              console.error(`[onramp-webhook][${requestId}] Error crediting balance:`, creditError);
            } else {
              const newBalance = creditResult?.[0]?.new_balance ?? totalCredit;
              const previousBalance = creditResult?.[0]?.previous_balance ?? 0;
              const creditSuccess = creditResult?.[0]?.success ?? false;

              if (creditSuccess) {
                console.log(`[onramp-webhook][${requestId}] ✅ Balance credited: ${totalCredit} (${previousBalance} → ${newBalance}, includes ${bonusAmount} bonus)`);

                // Update bonus flag in canonical_users if this was first top-up
                if (isFirstTopup) {
                  await supabase
                    .from('canonical_users')
                    .update({
                      has_used_new_user_bonus: true,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', userUuid);
                }

                // Record in balance_ledger for audit trail - real amount
                // balance_ledger.user_id is UUID type, balance_ledger.transaction_id is also UUID
                await supabase
                  .from('balance_ledger')
                  .insert({
                    user_id: userUuid, // UUID from canonical_users.id
                    amount: amountUsd,
                    balance_type: 'real',
                    source: 'topup_onramp',
                    transaction_id: txId || null, // This should be a UUID or null
                    metadata: {
                      is_first_topup: isFirstTopup,
                      bonus_amount: bonusAmount,
                    },
                    created_at: new Date().toISOString(),
                  });

                // Record bonus in balance_ledger if applicable
                if (bonusAmount > 0) {
                  await supabase
                    .from('balance_ledger')
                    .insert({
                      user_id: userUuid,
                      amount: bonusAmount,
                      balance_type: 'bonus',
                      source: 'first_topup_bonus',
                      transaction_id: txId || null,
                      metadata: {
                        base_topup_amount: amountUsd,
                        bonus_percentage: 50,
                      },
                      created_at: new Date().toISOString(),
                    });
                  console.log(`[onramp-webhook][${requestId}] ✅ Bonus ledger entry created: ${bonusAmount}`);
                }

                // Mark transaction as wallet_credited
                if (txId) {
                  await supabase
                    .from('user_transactions')
                    .update({
                      wallet_credited: true,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('external_transaction_id', txId);
                }
              } else {
                console.error(`[onramp-webhook][${requestId}] Balance credit failed:`, creditResult?.[0]?.error_message);
              }
            }
          } else {
            console.warn(`[onramp-webhook][${requestId}] User not found for identifier: ${canonicalUserId}`);
          }
        } else {
          console.warn(`[onramp-webhook][${requestId}] Could not determine USD amount from webhook payload`);
        }
      } else {
        console.warn(`[onramp-webhook][${requestId}] Could not determine user ID for balance credit`);
      }
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
    console.error(`[onramp-webhook][${requestId}] Error:`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
