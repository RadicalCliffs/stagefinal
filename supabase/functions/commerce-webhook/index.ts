import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";

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
 * Endpoint: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-CC-Webhook-Signature",
};

/**
 * Verify Coinbase Commerce webhook signature
 * https://docs.cloud.coinbase.com/commerce/docs/webhooks-security
 */
async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const expectedSignature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );

    const expectedHex = Array.from(new Uint8Array(expectedSignature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return signature === expectedHex;
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[commerce-webhook][${requestId}] Incoming request: method=${req.method}`);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Support both COINBASE_COMMERCE_WEBHOOK_SECRET and COMMERCE_WEBHOOK_SECRET for flexibility
    const webhookSecret = Deno.env.get("COINBASE_COMMERCE_WEBHOOK_SECRET") || Deno.env.get("COMMERCE_WEBHOOK_SECRET");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Read raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get("X-CC-Webhook-Signature");

    console.log(`[commerce-webhook][${requestId}] Received webhook, signature present: ${!!signature}`);

    // Verify signature if secret is configured
    if (webhookSecret && signature) {
      const isValid = await verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        console.error(`[commerce-webhook][${requestId}] Invalid webhook signature`);
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      console.log(`[commerce-webhook][${requestId}] ✅ Signature verified`);
    } else if (webhookSecret) {
      console.warn(`[commerce-webhook][${requestId}] ⚠️ Webhook secret configured but no signature provided`);
    } else {
      console.warn(`[commerce-webhook][${requestId}] ⚠️ COINBASE_COMMERCE_WEBHOOK_SECRET not configured - signature verification skipped`);
    }

    // Parse the webhook payload
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      console.error(`[commerce-webhook][${requestId}] JSON parse error:`, parseError, `Raw body: ${rawBody.substring(0, 200)}`);
      return new Response(
        JSON.stringify({ error: "Invalid JSON payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    console.log(`[commerce-webhook][${requestId}] Event type: ${payload.event?.type}`);

    // Log webhook event for audit
    try {
      await supabase.from("payment_webhook_events").insert({
        provider: "coinbase_commerce",
        payload,
        status: 200,
      });
    } catch (logError) {
      console.error(`[commerce-webhook][${requestId}] Failed to log webhook event:`, logError);
    }

    const eventType = payload.event?.type;
    const eventData = payload.event?.data;

    if (!eventType || !eventData) {
      console.error(`[commerce-webhook][${requestId}] Missing event type or data`);
      return new Response(
        JSON.stringify({ error: "Invalid webhook payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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
    
    // Extract wallet address from metadata or canonical user_id format (prize:pid:0x...)
    let walletAddress = metadata.wallet_address;
    if (!walletAddress && inputUserId) {
      // Try to extract from prize:pid:0x... format
      if (typeof inputUserId === 'string' && inputUserId.startsWith('prize:pid:0x')) {
        walletAddress = inputUserId.substring(10); // Remove 'prize:pid:' prefix
      } else if (typeof inputUserId === 'string' && inputUserId.startsWith('0x') && inputUserId.length === 42) {
        walletAddress = inputUserId;
      }
    }

    // CRITICAL: Check if this is a smart contract wallet and resolve to parent wallet
    if (walletAddress && supabaseUrl && supabaseServiceKey) {
      try {
        console.log(`[commerce-webhook][${requestId}] Checking if ${walletAddress} is a smart contract wallet`);
        const smartWalletLookup = await fetch(
          `${supabaseUrl}/rest/v1/canonical_users?smart_wallet_address=eq.${walletAddress}&select=wallet_address,canonical_user_id`,
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
            console.log(`[commerce-webhook][${requestId}] Smart wallet detected, resolving to parent:`, parentUsers[0].wallet_address);
            walletAddress = parentUsers[0].wallet_address;
            // Also update the userId if we have the canonical form
            if (parentUsers[0].canonical_user_id) {
              inputUserId = parentUsers[0].canonical_user_id;
              console.log(`[commerce-webhook][${requestId}] Updated userId to canonical:`, inputUserId);
            } else if (parentUsers[0].wallet_address) {
              // Create canonical ID from parent wallet if not stored
              inputUserId = parentUsers[0].wallet_address;
              console.log(`[commerce-webhook][${requestId}] Updated userId to parent wallet:`, inputUserId);
            }
          } else {
            console.log(`[commerce-webhook][${requestId}] No smart wallet mapping found, using original address`);
          }
        }
      } catch (lookupError) {
        console.error(`[commerce-webhook][${requestId}] Error looking up smart wallet:`, lookupError);
        // Continue with original address if lookup fails
      }
    }

    // Convert to canonical format
    const userId = toPrizePid(inputUserId);
    console.log(`[commerce-webhook][${requestId}] Canonical user ID: ${userId}`);

    console.log(`[commerce-webhook][${requestId}] Transaction: ${transactionId}, User: ${userId}, Competition: ${competitionId}`);

    // Find the transaction in our database
    let transaction;
    if (transactionId) {
      const { data, error } = await supabase
        .from("user_transactions")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle();

      if (error) {
        console.error(`[commerce-webhook][${requestId}] Error fetching transaction:`, error);
      } else {
        transaction = data;
      }
    }

    // If no transaction found by ID, try to find by charge ID
    if (!transaction && eventData.id) {
      const { data, error } = await supabase
        .from("user_transactions")
        .select("*")
        .eq("tx_id", eventData.id)
        .maybeSingle();

      if (!error && data) {
        transaction = data;
      }
    }

    if (!transaction) {
      console.warn(`[commerce-webhook][${requestId}] Transaction not found for charge ${eventData.id}`);
      return new Response(
        JSON.stringify({ success: true, message: "Transaction not found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[commerce-webhook][${requestId}] Found transaction: ${transaction.id}, current status: ${transaction.status}`);

    // Handle different event types
    if (eventType === "charge:confirmed") {
      console.log(`[commerce-webhook][${requestId}] Processing confirmed payment`);

      // Check if already processed (idempotency) - case-insensitive comparison
      const statusLower = (transaction.status || '').toLowerCase().trim();
      if (statusLower === "finished" || statusLower === "completed" || statusLower === "confirmed" || statusLower === "success" || statusLower === "paid") {
        console.log(`[commerce-webhook][${requestId}] Transaction already processed`);
        return new Response(
          JSON.stringify({ success: true, message: "Already processed" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
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
        console.log(`[commerce-webhook][${requestId}] Processing competition entry`);

        // Check for idempotency - if tickets already allocated
        const { data: existingEntry } = await supabase
          .from("joincompetition")
          .select("id")
          .eq("competitionid", transaction.competition_id)
          .eq("userid", transaction.user_id)
          .eq("transactionhash", eventData.id)
          .maybeSingle();

        if (existingEntry) {
          console.log(`[commerce-webhook][${requestId}] Entry already exists, skipping`);
          return new Response(
            JSON.stringify({ success: true, message: "Entry already processed" }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // STEP 1: Update pending_tickets status to 'confirmed' if reservation exists
        let pendingTicketId: string | null = null;
        if (reservationId) {
          console.log(`[commerce-webhook][${requestId}] Updating pending_tickets status to 'confirmed' for reservation: ${reservationId}`);
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
            console.error(`[commerce-webhook][${requestId}] Error updating pending_tickets:`, updateError);
          } else {
            console.log(`[commerce-webhook][${requestId}] ✅ Updated pending_tickets status to 'confirmed'`);
            pendingTicketId = reservationId;
          }
        } else if (transactionId) {
          // Try to find pending ticket by session_id (transactionId)
          console.log(`[commerce-webhook][${requestId}] Looking for pending_tickets by session_id: ${transactionId}`);
          const { data: pendingTicket, error: findError } = await supabase
            .from("pending_tickets")
            .select("id")
            .eq("session_id", transactionId)
            .eq("status", "pending")
            .maybeSingle();

          if (!findError && pendingTicket) {
            console.log(`[commerce-webhook][${requestId}] Found pending_tickets by session_id: ${pendingTicket.id}`);
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
              console.log(`[commerce-webhook][${requestId}] ✅ Updated pending_tickets status to 'confirmed'`);
              pendingTicketId = pendingTicket.id;
            }
          }
        }

        // STEP 2: Call confirm-pending-tickets function to handle ticket allocation
        console.log(`[commerce-webhook][${requestId}] Calling confirm-pending-tickets function`);
        
        // Parse selected tickets if provided
        let selectedTickets: number[] | undefined;
        if (selectedTicketsStr) {
          try {
            const parsed = JSON.parse(selectedTicketsStr);
            if (Array.isArray(parsed)) {
              selectedTickets = parsed.map(n => Number(n)).filter(n => Number.isFinite(n));
            }
          } catch (e) {
            console.warn(`[commerce-webhook][${requestId}] Failed to parse selected_tickets:`, e);
          }
        }

        const confirmPayload = {
          reservationId: pendingTicketId,
          userId: userId,
          competitionId: transaction.competition_id,
          transactionHash: eventData.id,
          paymentProvider: "coinbase_commerce",
          walletAddress: normalizeWalletAddress(transaction.wallet_address) || normalizeWalletAddress(transaction.user_id),
          sessionId: transactionId,
          selectedTickets,
          ticketCount: transaction.ticket_count || entryCount,
        };

        // ROBUST ENTRY CONFIRMATION: Retry up to 3 times with exponential backoff
        let confirmSuccess = false;
        let confirmResult: Record<string, unknown> | null = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`[commerce-webhook][${requestId}] Confirm tickets attempt ${attempt}/3`);

            const confirmResponse = await fetch(
              `${supabaseUrl}/functions/v1/confirm-pending-tickets`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify(confirmPayload),
              }
            );

            confirmResult = await confirmResponse.json();

            if (confirmResponse.ok && confirmResult?.success) {
              confirmSuccess = true;
              console.log(`[commerce-webhook][${requestId}] ✅ Tickets confirmed on attempt ${attempt}:`, {
                ticketCount: confirmResult.ticketCount,
                ticketNumbers: (confirmResult.ticketNumbers as number[])?.slice(0, 5),
                instantWins: (confirmResult.instantWins as unknown[])?.length || 0,
              });
              break;
            } else if (confirmResult?.alreadyConfirmed) {
              // Already confirmed - that's fine, idempotent success
              confirmSuccess = true;
              console.log(`[commerce-webhook][${requestId}] Tickets already confirmed (idempotent)`);
              break;
            } else {
              throw new Error(String(confirmResult?.error) || 'Unknown confirmation error');
            }
          } catch (confirmError) {
            console.error(`[commerce-webhook][${requestId}] Confirm attempt ${attempt} failed:`, confirmError);

            if (attempt < 3) {
              // Exponential backoff: 1s, 2s, 4s
              const delay = Math.pow(2, attempt - 1) * 1000;
              console.log(`[commerce-webhook][${requestId}] Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        // FALLBACK: If confirm-pending-tickets failed, mark for reconciliation
        if (!confirmSuccess) {
          console.error(`[commerce-webhook][${requestId}] ⚠️ ALL CONFIRM ATTEMPTS FAILED - marking for reconciliation`);
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

        console.log(`[commerce-webhook][${requestId}] ✅ Payment processed ${confirmSuccess ? 'successfully' : 'with reconciliation needed'}`);
      } else {
        // This is a top-up transaction - credit the user's balance with GUARANTEED delivery
        console.log(`[commerce-webhook][${requestId}] Processing wallet top-up for user ${transaction.user_id}`);

        const topUpAmount = Number(transaction.amount) || 0;

        if (topUpAmount > 0 && transaction.user_id) {
          // Check if this top-up was already credited (idempotency)
          if (transaction.wallet_credited === true) {
            console.log(`[commerce-webhook][${requestId}] Top-up already credited, skipping balance update`);
          } else {
            // ROBUST CREDITING: Retry up to 3 times with exponential backoff
            let creditSuccess = false;
            let creditError: Error | null = null;
            let newBalance = 0;

            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                console.log(`[commerce-webhook][${requestId}] Credit attempt ${attempt}/3 for user ${transaction.user_id}`);

                // Use the credit_sub_account_balance function which is the primary balance system
                const { data: creditResult, error: rpcError } = await supabase.rpc(
                  'credit_sub_account_balance',
                  {
                    p_canonical_user_id: transaction.user_id,
                    p_amount: topUpAmount,
                    p_currency: 'USD'
                  }
                );

                if (rpcError) {
                  throw new Error(`RPC error: ${rpcError.message}`);
                }

                newBalance = creditResult?.[0]?.new_balance ?? topUpAmount;
                creditSuccess = creditResult?.[0]?.success ?? false;

                if (creditSuccess) {
                  console.log(`[commerce-webhook][${requestId}] ✅ Credit succeeded on attempt ${attempt}`);
                  break;
                } else {
                  throw new Error(creditResult?.[0]?.error_message || 'Credit returned failure');
                }
              } catch (err) {
                creditError = err as Error;
                console.error(`[commerce-webhook][${requestId}] Credit attempt ${attempt} failed:`, err);

                if (attempt < 3) {
                  // Exponential backoff: 1s, 2s, 4s
                  const delay = Math.pow(2, attempt - 1) * 1000;
                  console.log(`[commerce-webhook][${requestId}] Retrying in ${delay}ms...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
            }

            // FALLBACK: If RPC failed, try direct table update as last resort
            if (!creditSuccess) {
              console.log(`[commerce-webhook][${requestId}] RPC failed, attempting direct balance update...`);
              try {
                // Check if user has a balance record
                const { data: existingBalance } = await supabase
                  .from('sub_account_balances')
                  .select('id, available_balance')
                  .eq('canonical_user_id', transaction.user_id)
                  .eq('currency', 'USD')
                  .maybeSingle();

                if (existingBalance) {
                  // Update existing record
                  const newBalanceValue = (Number(existingBalance.available_balance) || 0) + topUpAmount;
                  const { error: updateError } = await supabase
                    .from('sub_account_balances')
                    .update({
                      available_balance: newBalanceValue,
                      last_updated: new Date().toISOString()
                    })
                    .eq('id', existingBalance.id);

                  if (!updateError) {
                    creditSuccess = true;
                    newBalance = newBalanceValue;
                    console.log(`[commerce-webhook][${requestId}] ✅ Direct balance update succeeded`);
                  }
                } else {
                  // Create new record
                  const { error: insertError } = await supabase
                    .from('sub_account_balances')
                    .insert({
                      canonical_user_id: transaction.user_id,
                      user_id: transaction.user_id,
                      currency: 'USD',
                      available_balance: topUpAmount,
                      pending_balance: 0,
                      last_updated: new Date().toISOString()
                    });

                  if (!insertError) {
                    creditSuccess = true;
                    newBalance = topUpAmount;
                    console.log(`[commerce-webhook][${requestId}] ✅ Created new balance record`);
                  }
                }
              } catch (directErr) {
                console.error(`[commerce-webhook][${requestId}] Direct balance update also failed:`, directErr);
              }
            }

            // LAST RESORT: Mark transaction for manual reconciliation if all else fails
            if (!creditSuccess) {
              console.error(`[commerce-webhook][${requestId}] ⚠️ ALL CREDIT ATTEMPTS FAILED - marking for reconciliation`);
              await supabase
                .from('user_transactions')
                .update({
                  status: 'needs_reconciliation',
                  payment_status: 'confirmed',
                  credit_synced: false,
                  wallet_credited: false,
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', transaction.id);
            }

            if (creditSuccess) {
              console.log(`[commerce-webhook][${requestId}] ✅ Credited ${topUpAmount} USDC to user ${transaction.user_id}. New balance: ${newBalance}`);

              // Also confirm any pending_topups record (from optimistic crediting)
              try {
                await supabase
                  .from('pending_topups')
                  .update({
                    status: 'confirmed',
                    confirmed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  })
                  .eq('session_id', transaction.id)
                  .eq('status', 'pending');

                // Move pending_balance to available_balance if optimistic credit was used
                await supabase.rpc('confirm_pending_balance', {
                  p_canonical_user_id: transaction.user_id,
                  p_amount: topUpAmount,
                  p_currency: 'USD'
                });
              } catch (pendingErr) {
                // Not critical - optimistic crediting is optional
                console.warn(`[commerce-webhook][${requestId}] Could not update pending_topups:`, pendingErr);
              }

              // Extract payment information from the charge
              const charge = eventData;
              const payments = charge.payments || [];
              const payment = payments.length > 0 ? payments[payments.length - 1] : null; // Get the most recent payment
              const payerWallet = payment?.payer_addresses?.[0] || walletAddress || null;

              // Update user_transactions status (for wallet history display)
              const txnId = metadata.transaction_id;
              // Validate transaction ID format (should be a UUID)
              if (supabaseUrl && supabaseServiceKey && txnId && typeof txnId === 'string' && txnId.length > 0) {
                try {
                  await fetch(
                    `${supabaseUrl}/rest/v1/user_transactions?id=eq.${encodeURIComponent(txnId)}`,
                    {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseServiceKey,
                        'Authorization': `Bearer ${supabaseServiceKey}`,
                        'Prefer': 'return=minimal'
                      },
                      body: JSON.stringify({
                        status: 'completed',
                        payment_status: 'completed',
                        tx_id: charge.id,
                        wallet_address: payerWallet,
                        network: payment?.network || 'base',
                        payment_id: payment?.payment_id || payment?.transaction_id,
                        completed_at: new Date().toISOString(),
                        credit_synced: true,
                        wallet_credited: creditSuccess
                      })
                    }
                  );
                  console.log(`[commerce-webhook][${requestId}] Updated user_transactions with payment details`);
                } catch (updateError) {
                  console.error(`[commerce-webhook][${requestId}] Failed to update user_transactions via REST API:`, updateError);
                }
              }
            }
          }
        } else {
          console.warn(`[commerce-webhook][${requestId}] Top-up has invalid amount (${topUpAmount}) or missing user_id`);
        }

        console.log(`[commerce-webhook][${requestId}] ✅ Top-up transaction processed`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Payment processed",
          transactionId: transaction.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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
        }
      );

    } else if (eventType === "charge:pending" || eventType === "charge:delayed") {
      console.log(`[commerce-webhook][${requestId}] Payment ${eventType.split(':')[1]}`);

      await supabase
        .from("user_transactions")
        .update({
          status: "processing",
          payment_status: eventType.split(':')[1],
          updated_at: new Date().toISOString(),
        })
        .eq("id", transaction.id);

      return new Response(
        JSON.stringify({ success: true, message: `Payment ${eventType.split(':')[1]}` }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );

    } else {
      console.log(`[commerce-webhook][${requestId}] Unhandled event type: ${eventType}`);

      return new Response(
        JSON.stringify({ success: true, message: "Event acknowledged" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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
      }
    );
  }
});
