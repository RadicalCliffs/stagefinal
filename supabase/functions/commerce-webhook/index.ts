import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// Inlined from _shared/userId.ts to avoid bundler issues
// ============================================================================

function isWalletAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(identifier);
}

function isPrizePid(identifier: string): boolean {
  return identifier.startsWith("prize:pid:");
}

function extractPrizePid(prizePid: string): string {
  if (!isPrizePid(prizePid)) {
    return prizePid;
  }
  return prizePid.substring("prize:pid:".length);
}

function toPrizePid(inputUserId: string | null | undefined): string {
  if (!inputUserId || inputUserId.trim() === "") {
    return `prize:pid:${crypto.randomUUID()}`;
  }

  const trimmedId = inputUserId.trim();

  if (isPrizePid(trimmedId)) {
    const extracted = extractPrizePid(trimmedId);
    if (isWalletAddress(extracted)) {
      return `prize:pid:${extracted.toLowerCase()}`;
    }
    return trimmedId.toLowerCase();
  }

  if (isWalletAddress(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmedId)) {
    throw new Error(
      `UUID cannot be used as canonical_user_id: ${trimmedId}. ` +
        `Use allocate_temp_canonical_user() for users without wallets, ` +
        `or provide a wallet address to create prize:pid:0x{wallet} format.`,
    );
  }

  throw new Error(
    `Invalid user identifier format: ${trimmedId}. ` +
      `Must be wallet address (0x...) or already in prize:pid: format.`,
  );
}

function normalizeWalletAddress(
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (isWalletAddress(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

// ============================================================================

/**
 * Coinbase Commerce Webhook Handler
 *
 * Processes webhook notifications from Coinbase Commerce when payments are completed.
 * Handles:
 * - Transaction status updates
 * - Updating pending_tickets status to 'confirmed'
 * - Delegating ticket allocation to confirm-pending-tickets function
 * - Wallet top-ups
 *
 * Events processed:
 * - charge:confirmed - Payment confirmed
 * - charge:failed - Payment failed
 * - charge:delayed - Payment delayed
 * - charge:pending - Payment pending
 * - charge:resolved - Payment resolved
 *
 * Payment Provider Classification:
 * - Sets payment_provider to 'coinbase_commerce' (whitelisted)
 * - Also supports 'cdp_commerce' as alternate name (whitelisted)
 * - Ensures type='topup' for wallet top-up transactions
 *
 * Endpoint: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-CC-Webhook-Signature, Cache-Control, Pragma, Expires",
};

/**
 * Verify Coinbase Commerce webhook signature
 * https://docs.cloud.coinbase.com/commerce/docs/webhooks-security
 */
async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const expectedSignature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload),
    );

    const expectedHex = Array.from(new Uint8Array(expectedSignature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return signature === expectedHex;
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(
    `[commerce-webhook][${requestId}] Incoming request: method=${req.method}`,
  );

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Support multiple secret names for flexibility and compatibility:
    // - COINBASE_COMMERCE_WEBHOOK_SECRET (Coinbase Commerce standard)
    // - CDP_COMMERCE_WEBHOOK_SECRET (CDP Commerce alternate name)
    // - COMMERCE_WEBHOOK_SECRET (legacy fallback)
    const webhookSecret =
      Deno.env.get("COINBASE_COMMERCE_WEBHOOK_SECRET") ||
      Deno.env.get("CDP_COMMERCE_WEBHOOK_SECRET") ||
      Deno.env.get("COMMERCE_WEBHOOK_SECRET");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Read raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get("X-CC-Webhook-Signature");

    console.log(
      `[commerce-webhook][${requestId}] Received webhook, signature present: ${!!signature}, secret configured: ${!!webhookSecret}`,
    );

    // Verify signature if secret is configured
    if (webhookSecret && signature) {
      const isValid = await verifyWebhookSignature(
        rawBody,
        signature,
        webhookSecret,
      );
      if (!isValid) {
        console.error(
          `[commerce-webhook][${requestId}] ❌ Invalid webhook signature`,
        );
        console.error(
          `[commerce-webhook][${requestId}]    - Signature provided: ${signature?.substring(0, 16)}...`,
        );
        console.error(
          `[commerce-webhook][${requestId}]    - Secret configured: yes (${webhookSecret.length} chars)`,
        );
        console.error(
          `[commerce-webhook][${requestId}]    - Body length: ${rawBody.length} bytes`,
        );
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(
        `[commerce-webhook][${requestId}] ✅ Signature verified successfully`,
      );
    } else if (webhookSecret) {
      console.warn(
        `[commerce-webhook][${requestId}] ⚠️ Webhook secret configured but no signature header provided in request`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]    - Headers present: ${Array.from(req.headers.keys()).join(", ")}`,
      );
    } else {
      console.warn(
        `[commerce-webhook][${requestId}] ⚠️ COINBASE_COMMERCE_WEBHOOK_SECRET not configured - signature verification SKIPPED`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]    - This is a SECURITY RISK - configure webhook secret in Supabase Edge Functions environment`,
      );
    }

    // Parse the webhook payload
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      console.error(
        `[commerce-webhook][${requestId}] JSON parse error:`,
        parseError,
        `Raw body: ${rawBody.substring(0, 200)}`,
      );
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(
      `[commerce-webhook][${requestId}] Event type: ${payload.event?.type}`,
    );

    // Log webhook event for audit (with enhanced metadata for debugging)
    try {
      const eventData = payload.event?.data || {};
      const eventId = payload.event?.id || eventData.id || crypto.randomUUID();
      await supabase.from("payment_webhook_events").insert({
        event_id: eventId,
        provider: "coinbase_commerce",
        payload,
        status: "received",
        event_type: payload.event?.type || "unknown",
        received_at: new Date().toISOString(),
      });
      console.log(
        `[commerce-webhook][${requestId}] ✅ Webhook event logged to payment_webhook_events`,
      );
    } catch (logError) {
      console.error(
        `[commerce-webhook][${requestId}] ⚠️ Failed to log webhook event:`,
        logError,
      );
      // Continue processing even if logging fails
    }

    const eventType = payload.event?.type;
    const eventData = payload.event?.data;

    if (!eventType || !eventData) {
      console.error(
        `[commerce-webhook][${requestId}] Missing event type or data`,
      );
      return new Response(
        JSON.stringify({ error: "Invalid webhook payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Extract metadata from the charge
    const metadata = eventData.metadata || {};
    let inputUserId = metadata.user_id;
    const competitionId = metadata.competition_id;
    const transactionId = metadata.transaction_id;
    const reservationId = metadata.reservation_id;
    const selectedTicketsStr = metadata.selected_tickets;
    const entryCount = Number(metadata.entry_count) || 0;

    // Check if user_id is missing - this happens with static checkout links
    const hasUserIdInMetadata = !!inputUserId && inputUserId.trim() !== "";

    // Extract wallet address from metadata or canonical user_id format (prize:pid:0x...)
    let walletAddress = metadata.wallet_address;
    if (!walletAddress && inputUserId) {
      // Try to extract from prize:pid:0x... format
      if (
        typeof inputUserId === "string" &&
        inputUserId.startsWith("prize:pid:0x")
      ) {
        walletAddress = inputUserId.substring(10); // Remove 'prize:pid:' prefix
      } else if (
        typeof inputUserId === "string" &&
        inputUserId.startsWith("0x") &&
        inputUserId.length === 42
      ) {
        walletAddress = inputUserId;
      }
    }

    // CRITICAL: Check if this is a smart contract wallet and resolve to parent wallet
    if (walletAddress && supabaseUrl && supabaseServiceKey) {
      try {
        console.log(
          `[commerce-webhook][${requestId}] Checking if ${walletAddress} is a smart contract wallet`,
        );
        const smartWalletLookup = await fetch(
          `${supabaseUrl}/rest/v1/canonical_users?smart_wallet_address=eq.${walletAddress}&select=wallet_address,canonical_user_id`,
          {
            headers: {
              apikey: supabaseServiceKey,
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
          },
        );

        if (smartWalletLookup.ok) {
          const parentUsers = await smartWalletLookup.json();
          if (parentUsers && parentUsers.length > 0) {
            console.log(
              `[commerce-webhook][${requestId}] Smart wallet detected, resolving to parent:`,
              parentUsers[0].wallet_address,
            );
            walletAddress = parentUsers[0].wallet_address;
            // Also update the userId if we have the canonical form
            if (parentUsers[0].canonical_user_id) {
              inputUserId = parentUsers[0].canonical_user_id;
              console.log(
                `[commerce-webhook][${requestId}] Updated userId to canonical:`,
                inputUserId,
              );
            } else if (parentUsers[0].wallet_address) {
              // Create canonical ID from parent wallet if not stored
              inputUserId = parentUsers[0].wallet_address;
              console.log(
                `[commerce-webhook][${requestId}] Updated userId to parent wallet:`,
                inputUserId,
              );
            }
          } else {
            console.log(
              `[commerce-webhook][${requestId}] No smart wallet mapping found, using original address`,
            );
          }
        }
      } catch (lookupError) {
        console.error(
          `[commerce-webhook][${requestId}] Error looking up smart wallet:`,
          lookupError,
        );
        // Continue with original address if lookup fails
      }
    }

    // Only convert to canonical format if we have a real user ID
    // Don't generate random UUIDs for missing user IDs
    const userId = hasUserIdInMetadata ? toPrizePid(inputUserId) : null;
    console.log(
      `[commerce-webhook][${requestId}] Canonical user ID: ${userId || "(none - will match by amount/time)"}`,
    );

    console.log(
      `[commerce-webhook][${requestId}] Transaction: ${transactionId}, User: ${userId}, Competition: ${competitionId}`,
    );

    // Find the transaction in our database
    let transaction;
    if (transactionId) {
      const { data, error } = await supabase
        .from("user_transactions")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle();

      if (error) {
        console.error(
          `[commerce-webhook][${requestId}] Error fetching transaction:`,
          error,
        );
      } else {
        transaction = data;
      }
    }

    // If no transaction found by ID, try to find by charge ID in tx_id field
    if (!transaction && eventData.id) {
      console.log(
        `[commerce-webhook][${requestId}] Transaction not found by metadata.transaction_id, trying by tx_id field: ${eventData.id}`,
      );
      const { data, error } = await supabase
        .from("user_transactions")
        .select("*")
        .eq("tx_id", eventData.id)
        .maybeSingle();

      if (!error && data) {
        transaction = data;
        console.log(
          `[commerce-webhook][${requestId}] ✅ Found transaction by tx_id field: ${transaction.id}`,
        );
      } else if (error) {
        console.error(
          `[commerce-webhook][${requestId}] Error searching by tx_id:`,
          error,
        );
      }
    }

    // If still not found, try by charge_id column (for stuck topups after create-charge fix)
    if (!transaction && eventData.id) {
      console.log(
        `[commerce-webhook][${requestId}] Transaction not found by tx_id, trying by charge_id column: ${eventData.id}`,
      );
      const { data, error } = await supabase
        .from("user_transactions")
        .select("*")
        .eq("charge_id", eventData.id)
        .maybeSingle();

      if (!error && data) {
        transaction = data;
        console.log(
          `[commerce-webhook][${requestId}] ✅ Found transaction by charge_id column: ${transaction.id}`,
        );
      } else if (error) {
        console.error(
          `[commerce-webhook][${requestId}] Error searching by charge_id:`,
          error,
        );
      }
    }

    // FALLBACK: Try to find by user_id + competition_id + amount (for entry purchases)
    if (!transaction && userId && competitionId) {
      console.log(
        `[commerce-webhook][${requestId}] Trying fallback: user_id=${userId}, competition_id=${competitionId}`,
      );

      // Get the payment amount from Coinbase data
      const paymentAmount =
        eventData.pricing?.local?.amount ||
        eventData.pricing?.settlement?.amount ||
        eventData.pricing?.["USDC"]?.amount;

      if (paymentAmount) {
        // Find recent matching transactions (within last 30 minutes)
        const thirtyMinutesAgo = new Date(
          Date.now() - 30 * 60 * 1000,
        ).toISOString();

        let query = supabase
          .from("user_transactions")
          .select("*")
          .eq("user_id", userId)
          .eq("amount", Number(paymentAmount))
          .gte("created_at", thirtyMinutesAgo)
          .order("created_at", { ascending: false })
          .limit(1);

        // For topups (no competition), search for type=topup with null competition_id
        if (!competitionId) {
          query = query.eq("type", "topup").is("competition_id", null);
        } else {
          query = query.eq("competition_id", competitionId);
        }

        const { data, error } = await query.maybeSingle();

        if (!error && data) {
          transaction = data;
          console.log(
            `[commerce-webhook][${requestId}] ✅ Found transaction by fallback lookup: ${transaction.id}`,
          );

          // Update the tx_id to link this transaction to the Coinbase charge
          await supabase
            .from("user_transactions")
            .update({ tx_id: eventData.id })
            .eq("id", transaction.id);
        } else if (error) {
          console.error(
            `[commerce-webhook][${requestId}] Error in fallback lookup:`,
            error,
          );
        }
      }
    }

    // STATIC CHECKOUT FALLBACK: For topups without user_id in metadata (static checkout links)
    // Match by amount + type + status + no existing charge_id
    if (!transaction && !hasUserIdInMetadata && !competitionId) {
      const paymentAmount =
        eventData.pricing?.local?.amount ||
        eventData.pricing?.settlement?.amount ||
        eventData.pricing?.["USDC"]?.amount;

      if (paymentAmount) {
        console.log(
          `[commerce-webhook][${requestId}] 🔍 Static checkout fallback: searching for pending topup of $${paymentAmount}`,
        );

        const thirtyMinutesAgo = new Date(
          Date.now() - 30 * 60 * 1000,
        ).toISOString();

        // Find the OLDEST pending topup with matching amount that hasn't been matched yet
        const { data, error } = await supabase
          .from("user_transactions")
          .select("*")
          .eq("type", "topup")
          .eq("amount", Number(paymentAmount))
          .eq("status", "pending")
          .is("competition_id", null)
          .is("tx_id", null) // Not yet linked to a Coinbase charge
          .gte("created_at", thirtyMinutesAgo)
          .order("created_at", { ascending: true }) // Oldest first (FIFO)
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          transaction = data;
          console.log(
            `[commerce-webhook][${requestId}] ✅ Found pending topup by amount: ${transaction.id} for user ${transaction.user_id}`,
          );

          // Update the tx_id to link this transaction to the Coinbase charge
          await supabase
            .from("user_transactions")
            .update({
              tx_id: eventData.id,
              charge_id: eventData.id,
              charge_code: eventData.code,
            })
            .eq("id", transaction.id);
        } else if (error) {
          console.error(
            `[commerce-webhook][${requestId}] Error in static checkout fallback:`,
            error,
          );
        } else {
          console.log(
            `[commerce-webhook][${requestId}] No pending topup found for $${paymentAmount}`,
          );
        }
      }
    }

    if (!transaction) {
      console.warn(
        `[commerce-webhook][${requestId}] ⚠️ Transaction not found for charge ${eventData.id}`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]    - Searched by transaction_id: ${transactionId}`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]    - Searched by charge ID: ${eventData.id}`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]    - User ID from metadata: ${userId}`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]    - Competition ID: ${competitionId}`,
      );
      console.warn(`[commerce-webhook][${requestId}]    - This usually means:`);
      console.warn(
        `[commerce-webhook][${requestId}]      1. Charge was created outside of our system`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]      2. Transaction record was never created in user_transactions table`,
      );
      console.warn(
        `[commerce-webhook][${requestId}]      3. User paid before charge metadata was properly set`,
      );

      // Try to find ANY recent transaction for this user to help debugging
      if (userId) {
        const { data: recentTxns } = await supabase
          .from("user_transactions")
          .select("id, tx_id, status, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(3);

        if (recentTxns && recentTxns.length > 0) {
          console.log(
            `[commerce-webhook][${requestId}]    - Found ${recentTxns.length} recent transactions for user:`,
            recentTxns.map((t) => ({
              id: t.id,
              tx_id: t.tx_id,
              status: t.status,
            })),
          );
        } else {
          console.log(
            `[commerce-webhook][${requestId}]    - No transactions found for user ${userId} in database`,
          );
        }
      }

      // CRITICAL FIX: For top-ups (no competition_id), create the transaction record from webhook data
      // This handles cases where charges are created directly in Coinbase Commerce or via external flows
      // For top-ups specifically, pending is as good as confirmed - we can safely credit the balance
      if (
        !competitionId &&
        userId &&
        (eventType === "charge:confirmed" || eventType === "charge:pending")
      ) {
        console.log(
          `[commerce-webhook][${requestId}] 🔧 Creating transaction record for external top-up`,
        );

        // Extract payment amount and currency
        const paymentAmount = Number(
          eventData.pricing?.local?.amount ||
            eventData.pricing?.settlement?.amount ||
            0,
        );
        const currency =
          eventData.pricing?.local?.currency ||
          eventData.pricing?.settlement?.currency ||
          "USD";

        // Extract payer wallet address from first payment
        const payments = eventData.payments || [];
        const firstPayment = payments[0];
        const payerWallet =
          firstPayment?.payer_addresses?.[0] || walletAddress || "";
        const txHash =
          firstPayment?.transaction_id || firstPayment?.payment_id || "";

        if (paymentAmount > 0) {
          try {
            // For pending top-ups, we'll immediately credit the balance, so set posted_to_balance based on event type
            const shouldCreditImmediately = eventType === "charge:pending";

            const { data: newTransaction, error: insertError } = await supabase
              .from("user_transactions")
              .insert({
                user_id: userId,
                canonical_user_id: userId,
                amount: paymentAmount,
                currency: currency,
                status:
                  eventType === "charge:confirmed" ? "completed" : "pending",
                payment_status:
                  eventType === "charge:confirmed" ? "completed" : "pending",
                payment_provider: "coinbase_commerce",
                tx_id: txHash || eventData.id, // Use blockchain tx hash when available, fallback to charge ID
                wallet_address: payerWallet,
                competition_id: null,
                type: "topup",
                charge_id: eventData.id,
                charge_code: eventData.code,
                checkout_url: eventData.hosted_url,
                posted_to_balance: shouldCreditImmediately,
                created_at: eventData.created_at || new Date().toISOString(),
                completed_at:
                  eventData.confirmed_at ||
                  (eventType === "charge:confirmed"
                    ? new Date().toISOString()
                    : null),
                metadata: {
                  charge_name: eventData.name,
                  created_from_webhook: true,
                  webhook_event_type: eventType,
                  payment_tx_hash: txHash,
                },
              })
              .select()
              .single();

            if (insertError) {
              console.error(
                `[commerce-webhook][${requestId}] ❌ Failed to create transaction record:`,
                insertError,
              );
              return new Response(
                JSON.stringify({
                  success: false,
                  error: "Failed to create transaction record",
                  details: insertError.message,
                }),
                {
                  status: 500,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }

            transaction = newTransaction;
            console.log(
              `[commerce-webhook][${requestId}] ✅ Created transaction record: ${transaction.id} for top-up of ${paymentAmount} ${currency}`,
            );
          } catch (createError) {
            console.error(
              `[commerce-webhook][${requestId}] ❌ Exception creating transaction:`,
              createError,
            );
            return new Response(
              JSON.stringify({
                success: false,
                error: "Exception creating transaction",
                details: (createError as Error).message,
              }),
              {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
        } else {
          console.error(
            `[commerce-webhook][${requestId}] ❌ Cannot create transaction: invalid amount ${paymentAmount}`,
          );
          return new Response(
            JSON.stringify({ success: false, error: "Invalid payment amount" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      } else {
        // For competition entries, we can't auto-create the transaction as it requires more context
        return new Response(
          JSON.stringify({
            success: true,
            message: "Transaction not found - requires manual reconciliation",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    console.log(
      `[commerce-webhook][${requestId}] Found transaction: ${transaction.id}, current status: ${transaction.status}`,
    );

    // Handle different event types
    if (eventType === "charge:confirmed") {
      console.log(
        `[commerce-webhook][${requestId}] Processing confirmed payment`,
      );

      // Check if already processed (idempotency) - case-insensitive comparison
      const statusLower = (transaction.status || "").toLowerCase().trim();
      if (
        statusLower === "finished" ||
        statusLower === "completed" ||
        statusLower === "confirmed" ||
        statusLower === "success" ||
        statusLower === "paid"
      ) {
        console.log(
          `[commerce-webhook][${requestId}] Transaction already processed`,
        );
        return new Response(
          JSON.stringify({ success: true, message: "Already processed" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Update transaction status
      await supabase
        .from("user_transactions")
        .update({
          status: "finished",
          payment_status: "confirmed",
          tx_id: eventData.id,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", transaction.id);

      // Process competition entries OR top-ups
      if (transaction.competition_id) {
        console.log(
          `[commerce-webhook][${requestId}] Processing competition entry`,
        );

        // Check for idempotency - if tickets already allocated
        const { data: existingEntry } = await supabase
          .from("joincompetition")
          .select("id")
          .eq("competitionid", transaction.competition_id)
          .eq("userid", transaction.user_id)
          .eq("transactionhash", eventData.id)
          .maybeSingle();

        if (existingEntry) {
          console.log(
            `[commerce-webhook][${requestId}] Entry already exists, skipping`,
          );
          return new Response(
            JSON.stringify({
              success: true,
              message: "Entry already processed",
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // STEP 1: Update pending_tickets status to 'confirmed' if reservation exists
        let pendingTicketId: string | null = null;
        if (reservationId) {
          console.log(
            `[commerce-webhook][${requestId}] Updating pending_tickets status to 'confirmed' for reservation: ${reservationId}`,
          );
          const { error: updateError } = await supabase
            .from("pending_tickets")
            .update({
              status: "confirmed",
              transaction_hash: eventData.id,
              confirmed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", reservationId)
            .eq("status", "pending");

          if (updateError) {
            console.error(
              `[commerce-webhook][${requestId}] Error updating pending_tickets:`,
              updateError,
            );
          } else {
            console.log(
              `[commerce-webhook][${requestId}] ✅ Updated pending_tickets status to 'confirmed'`,
            );
            pendingTicketId = reservationId;
          }
        } else if (transactionId) {
          // Try to find pending ticket by session_id (transactionId)
          console.log(
            `[commerce-webhook][${requestId}] Looking for pending_tickets by session_id: ${transactionId}`,
          );
          const { data: pendingTicket, error: findError } = await supabase
            .from("pending_tickets")
            .select("id")
            .eq("session_id", transactionId)
            .eq("status", "pending")
            .maybeSingle();

          if (!findError && pendingTicket) {
            console.log(
              `[commerce-webhook][${requestId}] Found pending_tickets by session_id: ${pendingTicket.id}`,
            );
            const { error: updateError } = await supabase
              .from("pending_tickets")
              .update({
                status: "confirmed",
                transaction_hash: eventData.id,
                confirmed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", pendingTicket.id);

            if (!updateError) {
              console.log(
                `[commerce-webhook][${requestId}] ✅ Updated pending_tickets status to 'confirmed'`,
              );
              pendingTicketId = pendingTicket.id;
            }
          }
        }

        // STEP 2: Call confirm-pending-tickets function to handle ticket allocation
        console.log(
          `[commerce-webhook][${requestId}] Calling confirm-pending-tickets function`,
        );

        // Parse selected tickets if provided
        let selectedTickets: number[] | undefined;
        if (selectedTicketsStr) {
          try {
            const parsed = JSON.parse(selectedTicketsStr);
            if (Array.isArray(parsed)) {
              selectedTickets = parsed
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n));
            }
          } catch (e) {
            console.warn(
              `[commerce-webhook][${requestId}] Failed to parse selected_tickets:`,
              e,
            );
          }
        }

        const confirmPayload = {
          reservationId: pendingTicketId,
          userId: userId,
          competitionId: transaction.competition_id,
          transactionHash: eventData.id,
          paymentProvider: "coinbase_commerce",
          walletAddress:
            normalizeWalletAddress(transaction.wallet_address) ||
            normalizeWalletAddress(transaction.user_id),
          sessionId: transactionId,
          selectedTickets,
          ticketCount: transaction.ticket_count || entryCount,
        };

        // ROBUST ENTRY CONFIRMATION: Retry up to 3 times with exponential backoff
        let confirmSuccess = false;
        let confirmResult: Record<string, unknown> | null = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(
              `[commerce-webhook][${requestId}] Confirm tickets attempt ${attempt}/3`,
            );

            const confirmResponse = await fetch(
              `${supabaseUrl}/functions/v1/confirm-pending-tickets`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify(confirmPayload),
              },
            );

            confirmResult = await confirmResponse.json();

            if (confirmResponse.ok && confirmResult?.success) {
              confirmSuccess = true;
              console.log(
                `[commerce-webhook][${requestId}] ✅ Tickets confirmed on attempt ${attempt}:`,
                {
                  ticketCount: confirmResult.ticketCount,
                  ticketNumbers: (
                    confirmResult.ticketNumbers as number[]
                  )?.slice(0, 5),
                  instantWins:
                    (confirmResult.instantWins as unknown[])?.length || 0,
                },
              );
              break;
            } else if (confirmResult?.alreadyConfirmed) {
              // Already confirmed - that's fine, idempotent success
              confirmSuccess = true;
              console.log(
                `[commerce-webhook][${requestId}] Tickets already confirmed (idempotent)`,
              );
              break;
            } else {
              throw new Error(
                String(confirmResult?.error) || "Unknown confirmation error",
              );
            }
          } catch (confirmError) {
            console.error(
              `[commerce-webhook][${requestId}] Confirm attempt ${attempt} failed:`,
              confirmError,
            );

            if (attempt < 3) {
              // Exponential backoff: 1s, 2s, 4s
              const delay = Math.pow(2, attempt - 1) * 1000;
              console.log(
                `[commerce-webhook][${requestId}] Retrying in ${delay}ms...`,
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        // FALLBACK: If confirm-pending-tickets failed, mark for reconciliation
        if (!confirmSuccess) {
          console.error(
            `[commerce-webhook][${requestId}] ⚠️ ALL CONFIRM ATTEMPTS FAILED - marking for reconciliation`,
          );
          await supabase
            .from("user_transactions")
            .update({
              status: "needs_reconciliation",
              payment_status: "confirmed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", transaction.id);
        } else {
          // Mark transaction as fully completed
          await supabase
            .from("user_transactions")
            .update({
              status: "completed",
              payment_status: "completed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", transaction.id);
        }

        console.log(
          `[commerce-webhook][${requestId}] ✅ Payment processed ${confirmSuccess ? "successfully" : "with reconciliation needed"}`,
        );
      } else {
        // This is a top-up transaction - credit the user's balance with GUARANTEED delivery
        console.log(
          `[commerce-webhook][${requestId}] Processing wallet top-up for user ${transaction.user_id}`,
        );

        const topUpAmount = Number(transaction.amount) || 0;

        if (topUpAmount > 0 && transaction.user_id) {
          // ============================================================================
          // CRITICAL: Ensure user has a sub_account_balances record BEFORE crediting
          // This fixes "new user" issues where first top-up fails because no balance record exists
          // ============================================================================
          console.log(
            `[commerce-webhook][${requestId}] Ensuring user has balance record...`,
          );

          const { data: existingBalance, error: balanceCheckError } =
            await supabase
              .from("sub_account_balances")
              .select("id")
              .eq("canonical_user_id", transaction.user_id)
              .eq("currency", "USD")
              .maybeSingle();

          if (!existingBalance && !balanceCheckError) {
            console.log(
              `[commerce-webhook][${requestId}] 🆕 Creating initial balance record for new user`,
            );

            // Create the balance record with initial 0 balance
            const { error: createBalanceError } = await supabase
              .from("sub_account_balances")
              .insert({
                canonical_user_id: transaction.user_id,
                user_id: transaction.user_id,
                wallet_address: transaction.wallet_address,
                currency: "USD",
                available_balance: 0,
                pending_balance: 0,
                bonus_balance: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });

            if (createBalanceError) {
              console.error(
                `[commerce-webhook][${requestId}] ⚠️ Failed to create balance record:`,
                createBalanceError.message,
              );
              // Don't fail - the credit function will handle this
            } else {
              console.log(
                `[commerce-webhook][${requestId}] ✅ Created balance record for new user`,
              );
            }
          } else if (existingBalance) {
            console.log(
              `[commerce-webhook][${requestId}] ✅ User already has balance record`,
            );
          }

          // CORRECT IDEMPOTENCY CHECK - Only trust OUR flags, not payment provider status
          const alreadyCredited =
            transaction.posted_to_balance === true ||
            transaction.wallet_credited === true;

          // IMPORTANT: We do NOT check transaction.status here because:
          // - status="finished" means payment provider confirms payment
          // - But it does NOT mean our system has credited the user's balance
          // - Only posted_to_balance and wallet_credited indicate successful credit

          if (alreadyCredited) {
            console.log(
              `[commerce-webhook][${requestId}] ⚠️ Top-up already credited (posted_to_balance=${transaction.posted_to_balance}, wallet_credited=${transaction.wallet_credited}), skipping balance update`,
            );
          } else {
            // ROBUST CREDITING: Retry up to 3 times with exponential backoff
            let creditSuccess = false;
            let creditError: Error | null = null;
            let newBalance = 0;
            let bonusApplied = false;
            let bonusAmount = 0;
            let totalCredited = topUpAmount;

            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                console.log(
                  `[commerce-webhook][${requestId}] Credit attempt ${attempt}/3 for user ${transaction.user_id}`,
                );

                // CRITICAL: Use tx_id (blockchain hash) as reference_id if available
                // This ensures idempotency with instant-topup which also uses tx_id
                // Fallback to charge_id, then transaction.id
                const referenceId =
                  transaction.tx_id || eventData.id || transaction.id;
                console.log(
                  `[commerce-webhook][${requestId}] Using reference_id for idempotency: ${referenceId}`,
                );

                // COMPREHENSIVE IDEMPOTENCY CHECK: Check balance_ledger for MULTIPLE reference_ids
                // to catch duplicates even if manual scripts and webhook used different reference_ids
                const potentialReferenceIds = [
                  transaction.tx_id,
                  eventData.id,
                  transaction.id,
                ].filter(Boolean);

                const { data: existingCredits } = await supabase
                  .from("balance_ledger")
                  .select("reference_id, amount, created_at")
                  .eq("canonical_user_id", transaction.user_id)
                  .in("reference_id", potentialReferenceIds);

                if (existingCredits && existingCredits.length > 0) {
                  console.log(
                    `[commerce-webhook][${requestId}] ✅ Already credited - found ${existingCredits.length} matching ledger entries:`,
                    existingCredits,
                  );
                  creditSuccess = true;

                  // Get current balance
                  const { data: balanceData } = await supabase
                    .from("sub_account_balances")
                    .select("available_balance, bonus_balance")
                    .eq("canonical_user_id", transaction.user_id)
                    .eq("currency", "USD")
                    .maybeSingle();

                  newBalance =
                    (balanceData?.available_balance || 0) +
                    (balanceData?.bonus_balance || 0);
                  console.log(
                    `[commerce-webhook][${requestId}] Current balance: ${newBalance}`,
                  );
                  break;
                }

                // Use credit_balance_with_first_deposit_bonus for modern fidelity
                // This matches the instant-topup flow and ensures consistent bonus application
                const { data: creditResult, error: rpcError } =
                  await supabase.rpc(
                    "credit_balance_with_first_deposit_bonus",
                    {
                      p_canonical_user_id: transaction.user_id,
                      p_amount: topUpAmount,
                      p_reason: "commerce_topup",
                      p_reference_id: referenceId,
                    },
                  );

                if (rpcError) {
                  throw new Error(`RPC error: ${rpcError.message}`);
                }

                // Check if already credited (idempotency response from RPC)
                if (creditResult?.already_credited) {
                  console.log(
                    `[commerce-webhook][${requestId}] ✅ Credit already applied (idempotent): ${creditResult?.idempotency_note}`,
                  );
                  creditSuccess = true;
                  newBalance = creditResult?.new_balance ?? 0;
                  break;
                }

                // Extract bonus information from response
                newBalance = creditResult?.new_balance ?? topUpAmount;
                creditSuccess = creditResult?.success ?? false;
                bonusApplied = creditResult?.bonus_applied ?? false;
                bonusAmount = creditResult?.bonus_amount ?? 0;
                totalCredited = creditResult?.total_credited ?? topUpAmount;

                if (creditSuccess) {
                  console.log(
                    `[commerce-webhook][${requestId}] ✅ Credit succeeded on attempt ${attempt}`,
                  );
                  console.log(
                    `[commerce-webhook][${requestId}] Amount credited: ${topUpAmount}`,
                  );
                  console.log(
                    `[commerce-webhook][${requestId}] Bonus applied: ${bonusApplied}`,
                  );
                  console.log(
                    `[commerce-webhook][${requestId}] Bonus amount: ${bonusAmount}`,
                  );
                  console.log(
                    `[commerce-webhook][${requestId}] Total credited: ${totalCredited}`,
                  );
                  console.log(
                    `[commerce-webhook][${requestId}] New balance: ${newBalance}`,
                  );
                  break;
                } else {
                  throw new Error(
                    creditResult?.error_message || "Credit returned failure",
                  );
                }
              } catch (err) {
                creditError = err as Error;
                console.error(
                  `[commerce-webhook][${requestId}] Credit attempt ${attempt} failed:`,
                  err,
                );

                if (attempt < 3) {
                  // Exponential backoff: 1s, 2s, 4s
                  const delay = Math.pow(2, attempt - 1) * 1000;
                  console.log(
                    `[commerce-webhook][${requestId}] Retrying in ${delay}ms...`,
                  );
                  await new Promise((resolve) => setTimeout(resolve, delay));
                }
              }
            }

            // FALLBACK: If RPC failed, try direct table update as last resort
            if (!creditSuccess) {
              console.log(
                `[commerce-webhook][${requestId}] RPC failed, attempting direct balance update with bonus check...`,
              );
              try {
                // Check if user has already used their bonus
                const { data: userData } = await supabase
                  .from("canonical_users")
                  .select("has_used_new_user_bonus")
                  .eq("canonical_user_id", transaction.user_id)
                  .single();

                const hasUsedBonus = userData?.has_used_new_user_bonus ?? false;

                // Calculate bonus if eligible (50% first deposit)
                if (!hasUsedBonus) {
                  bonusApplied = true;
                  bonusAmount = topUpAmount * 0.5;
                  totalCredited = topUpAmount + bonusAmount;

                  console.log(
                    `[commerce-webhook][${requestId}] First deposit detected - applying 50% bonus`,
                  );
                  console.log(
                    `[commerce-webhook][${requestId}] Base amount: ${topUpAmount}, Bonus: ${bonusAmount}`,
                  );

                  // Mark bonus as used
                  await supabase
                    .from("canonical_users")
                    .update({
                      has_used_new_user_bonus: true,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("canonical_user_id", transaction.user_id);
                }

                // Check if user has a balance record
                const { data: existingBalance } = await supabase
                  .from("sub_account_balances")
                  .select("id, available_balance, bonus_balance")
                  .eq("canonical_user_id", transaction.user_id)
                  .eq("currency", "USD")
                  .maybeSingle();

                if (existingBalance) {
                  // Update existing record - credit both available and bonus balance
                  const newAvailableBalance =
                    (Number(existingBalance.available_balance) || 0) +
                    topUpAmount;
                  const newBonusBalance =
                    (Number(existingBalance.bonus_balance) || 0) + bonusAmount;

                  const { error: updateError } = await supabase
                    .from("sub_account_balances")
                    .update({
                      available_balance: newAvailableBalance,
                      bonus_balance: newBonusBalance,
                      last_updated: new Date().toISOString(),
                    })
                    .eq("id", existingBalance.id);

                  if (!updateError) {
                    creditSuccess = true;
                    newBalance = newAvailableBalance + newBonusBalance;
                    console.log(
                      `[commerce-webhook][${requestId}] ✅ Direct balance update succeeded`,
                    );
                    console.log(
                      `[commerce-webhook][${requestId}] Available balance: ${newAvailableBalance}`,
                    );
                    console.log(
                      `[commerce-webhook][${requestId}] Bonus balance: ${newBonusBalance}`,
                    );
                  }
                } else {
                  // Create new record with both available and bonus balance
                  const { error: insertError } = await supabase
                    .from("sub_account_balances")
                    .insert({
                      canonical_user_id: transaction.user_id,
                      canonical_user_id_norm: transaction.user_id.toLowerCase(),
                      user_id: transaction.user_id,
                      currency: "USD",
                      available_balance: topUpAmount,
                      bonus_balance: bonusAmount,
                      pending_balance: 0,
                      last_updated: new Date().toISOString(),
                    });

                  if (!insertError) {
                    creditSuccess = true;
                    newBalance = topUpAmount + bonusAmount;
                    console.log(
                      `[commerce-webhook][${requestId}] ✅ Created new balance record`,
                    );
                    console.log(
                      `[commerce-webhook][${requestId}] Available balance: ${topUpAmount}`,
                    );
                    console.log(
                      `[commerce-webhook][${requestId}] Bonus balance: ${bonusAmount}`,
                    );
                  }
                }
              } catch (directErr) {
                console.error(
                  `[commerce-webhook][${requestId}] Direct balance update also failed:`,
                  directErr,
                );
              }
            }

            // LAST RESORT: Mark transaction for manual reconciliation if all else fails
            if (!creditSuccess) {
              console.error(
                `[commerce-webhook][${requestId}] ⚠️ ALL CREDIT ATTEMPTS FAILED - marking for reconciliation`,
              );
              await supabase
                .from("user_transactions")
                .update({
                  status: "needs_reconciliation",
                  payment_status: "confirmed",
                  credit_synced: false,
                  posted_to_balance: false,
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", transaction.id);
            }

            if (creditSuccess) {
              console.log(
                `[commerce-webhook][${requestId}] ✅ Credited ${topUpAmount} USDC to user ${transaction.user_id}`,
              );
              if (bonusApplied) {
                console.log(
                  `[commerce-webhook][${requestId}] 🎁 First deposit bonus applied: ${bonusAmount} (50%)`,
                );
                console.log(
                  `[commerce-webhook][${requestId}] 💰 Total credited (base + bonus): ${totalCredited}`,
                );
              }
              console.log(
                `[commerce-webhook][${requestId}] New total balance: ${newBalance}`,
              );

              // Also confirm any pending_topups record (from optimistic crediting)
              try {
                await supabase
                  .from("pending_topups")
                  .update({
                    status: "confirmed",
                    confirmed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("session_id", transaction.id)
                  .eq("status", "pending");

                // Move pending_balance to available_balance if optimistic credit was used
                await supabase.rpc("confirm_pending_balance", {
                  p_canonical_user_id: transaction.user_id,
                  p_amount: topUpAmount,
                  p_currency: "USD",
                });
              } catch (pendingErr) {
                // Not critical - optimistic crediting is optional
                console.warn(
                  `[commerce-webhook][${requestId}] Could not update pending_topups:`,
                  pendingErr,
                );
              }

              // Extract payment information from the charge
              const charge = eventData;
              const payments = charge.payments || [];
              const payment =
                payments.length > 0 ? payments[payments.length - 1] : null; // Get the most recent payment
              const payerWallet =
                payment?.payer_addresses?.[0] || walletAddress || null;

              // Update user_transactions status (for wallet history display)
              // PATCH request to update transaction with payment details and classification
              const txnId = metadata.transaction_id;
              // Validate transaction ID format (should be a UUID)
              if (
                supabaseUrl &&
                supabaseServiceKey &&
                txnId &&
                typeof txnId === "string" &&
                txnId.length > 0
              ) {
                try {
                  // Extract blockchain tx hash from payment if available
                  const blockchainTxHash =
                    payment?.transaction_id || payment?.payment_id || "";
                  // Complete update payload with all critical fields
                  const updatePayload = {
                    type: "topup", // CRITICAL: Mark as top-up transaction for proper classification
                    payment_provider: "coinbase_commerce", // CRITICAL: Set payment provider for filtering
                    status: "completed",
                    payment_status: "completed",
                    tx_id: blockchainTxHash || charge.id, // Use blockchain tx hash when available, fallback to charge ID
                    wallet_address: payerWallet,
                    network: payment?.network || "base",
                    payment_id: payment?.payment_id || payment?.transaction_id,
                    // CRITICAL: Update canonical_user_id if it's NULL (fixes stuck topups from create-charge session_id bug)
                    canonical_user_id: transaction.user_id,
                    // CRITICAL: Also update charge_id, charge_code for future webhook matching
                    charge_id: charge.id,
                    charge_code: charge.code,
                    checkout_url: charge.hosted_url,
                    completed_at: new Date().toISOString(),
                    credit_synced: true,
                    posted_to_balance: creditSuccess,
                  };

                  console.log(
                    `[commerce-webhook][${requestId}] Updating transaction ${txnId} with payload:`,
                    updatePayload,
                  );

                  await fetch(
                    `${supabaseUrl}/rest/v1/user_transactions?id=eq.${encodeURIComponent(txnId)}`,
                    {
                      method: "PATCH",
                      headers: {
                        "Content-Type": "application/json",
                        apikey: supabaseServiceKey,
                        Authorization: `Bearer ${supabaseServiceKey}`,
                        Prefer: "return=minimal",
                      },
                      body: JSON.stringify(updatePayload),
                    },
                  );
                  console.log(
                    `[commerce-webhook][${requestId}] Updated user_transactions with payment details`,
                  );
                } catch (updateError) {
                  console.error(
                    `[commerce-webhook][${requestId}] Failed to update user_transactions via REST API:`,
                    updateError,
                  );
                }
              }
            }
          }
        } else {
          console.warn(
            `[commerce-webhook][${requestId}] Top-up has invalid amount (${topUpAmount}) or missing user_id`,
          );
        }

        console.log(
          `[commerce-webhook][${requestId}] ✅ Top-up transaction processed`,
        );
      }

      // Success summary log for easy verification
      console.log(
        `[commerce-webhook][${requestId}] ========================================`,
      );
      console.log(
        `[commerce-webhook][${requestId}] ✅ WEBHOOK PROCESSING COMPLETE`,
      );
      console.log(
        `[commerce-webhook][${requestId}] Transaction ID: ${transaction.id}`,
      );
      console.log(
        `[commerce-webhook][${requestId}] Charge ID: ${eventData.id}`,
      );
      console.log(
        `[commerce-webhook][${requestId}] Type: ${transaction.competition_id ? "ENTRY PURCHASE" : "TOP-UP"}`,
      );
      console.log(
        `[commerce-webhook][${requestId}] User: ${transaction.user_id}`,
      );
      console.log(
        `[commerce-webhook][${requestId}] Amount: $${transaction.amount}`,
      );
      console.log(
        `[commerce-webhook][${requestId}] Status: ${transaction.status}`,
      );
      if (transaction.competition_id) {
        console.log(
          `[commerce-webhook][${requestId}] Competition: ${transaction.competition_id}`,
        );
        console.log(
          `[commerce-webhook][${requestId}] Tickets: ${transaction.ticket_count || 0}`,
        );
      }
      console.log(
        `[commerce-webhook][${requestId}] ========================================`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "Payment processed",
          transactionId: transaction.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } else if (eventType === "charge:failed") {
      console.log(`[commerce-webhook][${requestId}] Payment failed`);

      await supabase
        .from("user_transactions")
        .update({
          status: "failed",
          payment_status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", transaction.id);

      return new Response(
        JSON.stringify({ success: true, message: "Payment failed" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } else if (
      eventType === "charge:pending" ||
      eventType === "charge:delayed"
    ) {
      console.log(
        `[commerce-webhook][${requestId}] Payment ${eventType.split(":")[1]}`,
      );

      // For TOP-UPS: treat pending as confirmed (user requirement: "pending is as good as confirmed for topups")
      // This provides instant crediting for wallet top-ups without waiting for full blockchain confirmation
      if (!transaction.competition_id && eventType === "charge:pending") {
        console.log(
          `[commerce-webhook][${requestId}] 🚀 Processing PENDING top-up immediately (pending = confirmed for top-ups)`,
        );

        const topUpAmount = Number(transaction.amount) || 0;

        if (
          topUpAmount > 0 &&
          transaction.user_id &&
          !transaction.posted_to_balance
        ) {
          try {
            // Credit balance immediately for pending top-ups
            const { data: creditResult, error: rpcError } = await supabase.rpc(
              "credit_balance_with_first_deposit_bonus",
              {
                p_canonical_user_id: transaction.user_id,
                p_amount: topUpAmount,
                p_reason: "commerce_topup_pending",
                p_reference_id: transaction.id, // Use transaction ID, not charge ID, to avoid duplicates
              },
            );

            if (rpcError) {
              // Check if it's a duplicate key error - means already processed
              if (rpcError.code === "23505") {
                console.log(
                  `[commerce-webhook][${requestId}] ℹ️ Top-up already credited (duplicate key), marking as complete`,
                );
                await supabase
                  .from("user_transactions")
                  .update({
                    status: "completed",
                    posted_to_balance: true,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", transaction.id);

                return new Response(
                  JSON.stringify({
                    success: true,
                    message: "Top-up already processed",
                  }),
                  {
                    status: 200,
                    headers: {
                      ...corsHeaders,
                      "Content-Type": "application/json",
                    },
                  },
                );
              }
              console.error(
                `[commerce-webhook][${requestId}] ❌ Failed to credit pending top-up:`,
                rpcError,
              );
            } else if (creditResult?.success) {
              console.log(
                `[commerce-webhook][${requestId}] ✅ Pending top-up credited: ${topUpAmount}`,
              );
              console.log(
                `[commerce-webhook][${requestId}] Bonus applied: ${creditResult.bonus_applied}, Amount: ${creditResult.bonus_amount}`,
              );

              // Mark as credited and update status
              // NOTE: For top-ups, we use a dual-status pattern:
              // - status = "completed" means the balance has been credited (user can spend it)
              // - payment_status = "pending" means blockchain confirmation is still in progress
              // This allows us to provide instant crediting while tracking actual payment state
              await supabase
                .from("user_transactions")
                .update({
                  status: "completed", // Balance is credited - user can spend immediately
                  payment_status: "pending", // Blockchain confirmation still in progress
                  posted_to_balance: true,
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", transaction.id);

              return new Response(
                JSON.stringify({
                  success: true,
                  message: "Pending top-up credited immediately",
                  amount: topUpAmount,
                  bonus_applied: creditResult.bonus_applied,
                  total_credited: creditResult.total_credited,
                }),
                {
                  status: 200,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }
          } catch (creditError) {
            console.error(
              `[commerce-webhook][${requestId}] ❌ Exception crediting pending top-up:`,
              creditError,
            );
          }
        }
      }

      // For competition entries or if crediting failed, just update status
      await supabase
        .from("user_transactions")
        .update({
          status: "processing",
          payment_status: eventType.split(":")[1],
          updated_at: new Date().toISOString(),
        })
        .eq("id", transaction.id);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Payment ${eventType.split(":")[1]}`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } else {
      console.log(
        `[commerce-webhook][${requestId}] Unhandled event type: ${eventType}`,
      );

      return new Response(
        JSON.stringify({ success: true, message: "Event acknowledged" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } catch (error) {
    console.error(`[commerce-webhook] Unhandled error:`, error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: (error as Error).message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
