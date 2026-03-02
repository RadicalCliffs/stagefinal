import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid } from "../_shared/userId.ts";

/**
 * Payment Reconciliation Function
 *
 * This function finds and processes any payments that were confirmed by Coinbase
 * but failed to properly credit the user's balance or entries.
 *
 * Run this periodically (e.g., every 15 minutes) via a cron job or manually
 * to ensure no payments are ever lost.
 *
 * What it reconciles:
 * 1. Top-ups: Confirmed payments not credited to user balance
 * 2. Entries: Confirmed payments not credited to joincompetition
 *
 * Endpoint: POST /functions/v1/reconcile-payments
 * Auth: Requires service role key or admin token
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control, Pragma, Expires",
};

interface ReconciliationResult {
  success: boolean;
  topUpsReconciled: number;
  entriesReconciled: number;
  totalAmountCredited: number;
  errors: string[];
  transactionsProcessed: string[];
}

interface TopUpTransaction {
  id: string;
  user_id: string;
  amount: number;
  status: string;
  payment_status: string;
  wallet_credited: boolean | null;
  payment_provider: string;
}

interface EntryTransaction {
  id: string;
  user_id: string;
  competition_id: string;
  ticket_count: number;
  amount: number;
  tx_id: string;
  payment_provider: string;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[reconcile-payments][${requestId}] Starting reconciliation`);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const result: ReconciliationResult = {
      success: true,
      topUpsReconciled: 0,
      entriesReconciled: 0,
      totalAmountCredited: 0,
      errors: [],
      transactionsProcessed: [],
    };

    // =====================================================
    // PART 1: RECONCILE TOP-UPS
    // =====================================================
    console.log(`[reconcile-payments][${requestId}] Checking for unconfirmed top-ups...`);

    // Find top-up transactions that:
    // - Have confirmed payment status
    // - No competition_id (= top-up)
    // - Not yet credited (wallet_credited = false/null)
    // - At least 5 minutes old (to avoid racing with webhook)
    // - CRITICAL: ONLY onramp/coinbase_onramp payment providers (NOT base_account, coinbase_commerce, etc.)
    const { data: unconfirmedTopUps, error: topUpError } = await supabase
      .from("user_transactions")
      .select("id, user_id, amount, status, payment_status, wallet_credited, payment_provider")
      .is("competition_id", null)
      .in("payment_status", ["confirmed", "completed"])
      .or("wallet_credited.is.null,wallet_credited.eq.false")
      .neq("status", "needs_reconciliation")
      .in("payment_provider", ["onramp", "coinbase_onramp"]) // CRITICAL FIX: Only onramp top-ups, NOT base_account!
      .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(50);

    if (topUpError) {
      console.error(`[reconcile-payments][${requestId}] Error fetching top-ups:`, topUpError);
      result.errors.push(`Top-up fetch error: ${topUpError.message}`);
    } else if (unconfirmedTopUps && unconfirmedTopUps.length > 0) {
      console.log(`[reconcile-payments][${requestId}] Found ${unconfirmedTopUps.length} unconfirmed top-ups`);

      for (const txn of (unconfirmedTopUps as TopUpTransaction[])) {
        try {
          const amount = Number(txn.amount) || 0;
          if (amount <= 0 || !txn.user_id) {
            console.warn(`[reconcile-payments][${requestId}] Skipping invalid top-up ${txn.id}`);
            continue;
          }

          // CRITICAL SAFETY CHECK: Double-check payment_provider
          // Never credit base_account or other external crypto payments
          if (!txn.payment_provider || !['onramp', 'coinbase_onramp'].includes(txn.payment_provider)) {
            console.warn(`[reconcile-payments][${requestId}] SKIPPING non-onramp transaction ${txn.id} with provider: ${txn.payment_provider}`);
            // Mark as wallet_credited to prevent future processing
            await supabase
              .from("user_transactions")
              .update({
                wallet_credited: true,
                updated_at: new Date().toISOString(),
              })
              .eq("id", txn.id);
            continue;
          }

          // Use canonical user ID
          const canonicalUserId = toPrizePid(txn.user_id);

          // Attempt to credit the balance
          const { data: creditResult, error: creditError } = await supabase.rpc(
            'credit_sub_account_balance',
            {
              p_canonical_user_id: canonicalUserId,
              p_amount: amount,
              p_currency: 'USD'
            }
          );

          if (creditError) {
            throw new Error(`RPC error: ${creditError.message}`);
          }

          const creditSuccess = creditResult?.[0]?.success ?? false;

          if (creditSuccess) {
            // Mark as credited
            await supabase
              .from("user_transactions")
              .update({
                wallet_credited: true,
                credit_synced: true,
                status: "completed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", txn.id);

            result.topUpsReconciled++;
            result.totalAmountCredited += amount;
            result.transactionsProcessed.push(txn.id);
            console.log(`[reconcile-payments][${requestId}] ✅ Credited top-up ${txn.id}: $${amount} to ${canonicalUserId}`);
          } else {
            throw new Error(creditResult?.[0]?.error_message || 'Credit failed');
          }
        } catch (err) {
          const errorMsg = `Failed to reconcile top-up ${txn.id}: ${(err as Error).message}`;
          console.error(`[reconcile-payments][${requestId}] ${errorMsg}`);
          result.errors.push(errorMsg);

          // Mark for manual review
          await supabase
            .from("user_transactions")
            .update({
              status: "needs_reconciliation",
              updated_at: new Date().toISOString(),
            })
            .eq("id", txn.id);
        }
      }
    } else {
      console.log(`[reconcile-payments][${requestId}] No unconfirmed top-ups found`);
    }

    // =====================================================
    // PART 1.5: PROCESS CDP WEBHOOK TOP-UPS (BASE ACCOUNT)
    // =====================================================
    console.log(`[reconcile-payments][${requestId}] Processing CDP webhook top-ups...`);

    try {
      // Find unprocessed CDP webhook events that represent USDC transfers
      // CDP webhooks come through cdp_webhooks_v2 table with transfer data in parameters
      const { data: cdpWebhooks, error: cdpError } = await supabase
        .from("cdp_webhooks_v2")
        .select("*")
        .eq("event_signature", "Transfer") // USDC transfer events
        .is("parameters->processed", null) // Not yet processed
        .lt("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString()) // At least 2 min old
        .order("created_at", { ascending: true })
        .limit(50);

      if (cdpError) {
        console.error(`[reconcile-payments][${requestId}] CDP webhook fetch error:`, cdpError);
        result.errors.push(`CDP webhook fetch error: ${cdpError.message}`);
      } else if (cdpWebhooks && cdpWebhooks.length > 0) {
        console.log(`[reconcile-payments][${requestId}] Found ${cdpWebhooks.length} unprocessed CDP webhooks`);

        for (const webhook of cdpWebhooks) {
          try {
            // Extract transfer data from parameters
            const params = webhook.parameters || {};
            const amount = Number(params.value || params.amount || 0);
            const toAddress = params.to || params.to_address;
            
            if (amount <= 0 || !toAddress) {
              console.warn(`[reconcile-payments][${requestId}] Skipping invalid CDP webhook ${webhook.id}`);
              // Mark as processed to skip in future
              await supabase
                .from("cdp_webhooks_v2")
                .update({
                  parameters: { ...params, processed: true, skipped_reason: 'invalid_data' }
                })
                .eq("id", webhook.id);
              continue;
            }

            // Convert address to canonical format
            const canonicalUserId = toPrizePid(toAddress);
            
            // Convert from wei/smallest unit to USD (assuming 6 decimals for USDC)
            const amountUSD = amount / 1_000_000;

            // Credit the balance via RPC
            const { data: creditResult, error: creditError } = await supabase.rpc(
              'credit_sub_account_balance',
              {
                p_canonical_user_id: canonicalUserId,
                p_amount: amountUSD,
                p_currency: 'USD'
              }
            );

            if (creditError) {
              throw new Error(`RPC error: ${creditError.message}`);
            }

            const creditSuccess = creditResult?.[0]?.success ?? false;

            if (creditSuccess) {
              // Mark webhook as processed
              await supabase
                .from("cdp_webhooks_v2")
                .update({
                  parameters: { ...params, processed: true, processed_at: new Date().toISOString() }
                })
                .eq("id", webhook.id);

              result.topUpsReconciled++;
              result.totalAmountCredited += amountUSD;
              result.transactionsProcessed.push(webhook.id);
              console.log(`[reconcile-payments][${requestId}] ✅ Credited CDP top-up ${webhook.id}: $${amountUSD} to ${canonicalUserId}`);
            } else {
              throw new Error(creditResult?.[0]?.error_message || 'Credit failed');
            }
          } catch (err) {
            const errorMsg = `Failed to process CDP webhook ${webhook.id}: ${(err as Error).message}`;
            console.error(`[reconcile-payments][${requestId}] ${errorMsg}`);
            result.errors.push(errorMsg);

            // Mark with error but don't block other webhooks
            const params = webhook.parameters || {};
            await supabase
              .from("cdp_webhooks_v2")
              .update({
                parameters: { ...params, processed: false, processing_error: (err as Error).message }
              })
              .eq("id", webhook.id);
          }
        }
      } else {
        console.log(`[reconcile-payments][${requestId}] No unprocessed CDP webhooks found`);
      }
    } catch (cdpErr) {
      console.error(`[reconcile-payments][${requestId}] CDP processing error:`, cdpErr);
      result.errors.push(`CDP processing error: ${(cdpErr as Error).message}`);
    }

    // =====================================================
    // PART 2: RECONCILE COMPETITION ENTRIES
    // =====================================================
    console.log(`[reconcile-payments][${requestId}] Checking for unconfirmed entries...`);

    // Find entry transactions that:
    // - Have competition_id (= entry purchase)
    // - Have confirmed payment status
    // - Don't have a matching joincompetition entry
    // - At least 5 minutes old
    // NOTE: We process ALL payment providers for entries (including base_account) 
    // because they need joincompetition entries created, but we DON'T credit balance
    const { data: unconfirmedEntries, error: entryError } = await supabase
      .from("user_transactions")
      .select("id, user_id, competition_id, ticket_count, amount, tx_id, payment_provider")
      .not("competition_id", "is", null)
      .in("payment_status", ["confirmed", "completed"])
      .neq("status", "needs_reconciliation")
      .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(50);

    if (entryError) {
      console.error(`[reconcile-payments][${requestId}] Error fetching entries:`, entryError);
      result.errors.push(`Entry fetch error: ${entryError.message}`);
    } else if (unconfirmedEntries && unconfirmedEntries.length > 0) {
      console.log(`[reconcile-payments][${requestId}] Checking ${unconfirmedEntries.length} potential unconfirmed entries`);

      for (const txn of (unconfirmedEntries as EntryTransaction[])) {
        try {
          const canonicalUserId = toPrizePid(txn.user_id);

          // Check if joincompetition entry already exists
          const { data: existingEntry } = await supabase
            .from("joincompetition")
            .select("uid")
            .eq("competitionid", txn.competition_id)
            .eq("transactionhash", txn.tx_id || txn.id)
            .maybeSingle();

          if (existingEntry) {
            // Entry exists - just mark transaction as completed
            await supabase
              .from("user_transactions")
              .update({
                status: "completed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", txn.id);
            continue;
          }

          // Call confirm-pending-tickets to create the entry
          const confirmPayload = {
            userId: canonicalUserId,
            competitionId: txn.competition_id,
            transactionHash: txn.tx_id || txn.id,
            paymentProvider: "coinbase_commerce",
            sessionId: txn.id,
            ticketCount: txn.ticket_count || 1,
          };

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

          const confirmResult = await confirmResponse.json();

          if (confirmResponse.ok && (confirmResult.success || confirmResult.alreadyConfirmed)) {
            await supabase
              .from("user_transactions")
              .update({
                status: "completed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", txn.id);

            result.entriesReconciled++;
            result.transactionsProcessed.push(txn.id);
            console.log(`[reconcile-payments][${requestId}] ✅ Confirmed entry ${txn.id} for competition ${txn.competition_id}`);
          } else {
            throw new Error(confirmResult.error || 'Confirmation failed');
          }
        } catch (err) {
          const errorMsg = `Failed to reconcile entry ${txn.id}: ${(err as Error).message}`;
          console.error(`[reconcile-payments][${requestId}] ${errorMsg}`);
          result.errors.push(errorMsg);

          // Mark for manual review
          await supabase
            .from("user_transactions")
            .update({
              status: "needs_reconciliation",
              updated_at: new Date().toISOString(),
            })
            .eq("id", txn.id);
        }
      }
    } else {
      console.log(`[reconcile-payments][${requestId}] No unconfirmed entries found`);
    }

    // =====================================================
    // PART 3: AUTO-ALLOCATE PAID TICKETS (RECOVERY)
    // =====================================================
    console.log(`[reconcile-payments][${requestId}] Checking for auto-allocation pending tickets...`);

    try {
      // Find pending_tickets created by auto_allocate_paid_tickets trigger
      // These are payments that completed but tickets weren't allocated
      const { data: autoAllocateTickets, error: autoAllocateError } = await supabase
        .from("pending_tickets")
        .select("*")
        .eq("status", "pending")
        .like("note", "%Auto-created by auto_allocate_paid_tickets%")
        .lt("created_at", new Date(Date.now() - 1 * 60 * 1000).toISOString()) // At least 1 min old
        .order("created_at", { ascending: true })
        .limit(20);

      if (autoAllocateError) {
        console.error(`[reconcile-payments][${requestId}] Auto-allocate fetch error:`, autoAllocateError);
        result.errors.push(`Auto-allocate fetch error: ${autoAllocateError.message}`);
      } else if (autoAllocateTickets && autoAllocateTickets.length > 0) {
        console.log(`[reconcile-payments][${requestId}] Found ${autoAllocateTickets.length} auto-allocation tickets`);

        for (const pending of autoAllocateTickets) {
          try {
            // Call confirm-pending-tickets to allocate
            const confirmResponse = await fetch(`${supabaseUrl}/functions/v1/confirm-pending-tickets`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                reservationId: pending.id,
                userId: pending.canonical_user_id || pending.user_id,
                competitionId: pending.competition_id,
                transactionHash: pending.transaction_hash,
                paymentProvider: pending.payment_provider || 'balance',
                walletAddress: pending.wallet_address,
                ticketCount: pending.ticket_count,
                sessionId: pending.session_id,
              }),
            });

            const confirmResult = await confirmResponse.json();

            if (confirmResult.success) {
              result.entriesReconciled++;
              result.transactionsProcessed.push(pending.session_id || pending.id);
              console.log(`[reconcile-payments][${requestId}] ✅ Auto-allocated tickets for pending ${pending.id}: ${pending.ticket_count} tickets`);
            } else {
              throw new Error(confirmResult.error || 'Confirmation failed');
            }
          } catch (err) {
            const errorMsg = `Failed to auto-allocate tickets for ${pending.id}: ${(err as Error).message}`;
            console.error(`[reconcile-payments][${requestId}] ${errorMsg}`);
            result.errors.push(errorMsg);

            // Mark as expired so we don't keep retrying forever
            const retryCount = (pending.note?.match(/retry/gi) || []).length;
            if (retryCount >= 3) {
              await supabase
                .from("pending_tickets")
                .update({
                  status: "failed",
                  note: `${pending.note} | Failed after 3 retries: ${(err as Error).message}`,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", pending.id);
            } else {
              await supabase
                .from("pending_tickets")
                .update({
                  note: `${pending.note} | Retry ${retryCount + 1}: ${(err as Error).message}`,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", pending.id);
            }
          }
        }
      } else {
        console.log(`[reconcile-payments][${requestId}] No auto-allocation tickets found`);
      }
    } catch (autoAllocateErr) {
      console.error(`[reconcile-payments][${requestId}] Auto-allocate processing error:`, autoAllocateErr);
      result.errors.push(`Auto-allocate processing error: ${(autoAllocateErr as Error).message}`);
    }

    // =====================================================
    // PART 4: CLEAN UP EXPIRED PENDING RECORDS
    // =====================================================
    console.log(`[reconcile-payments][${requestId}] Cleaning up expired pending records...`);

    try {
      // Clean up expired pending_topups
      const { data: expiredTopUps } = await supabase
        .from("pending_topups")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("status", "pending")
        .lt("expires_at", new Date().toISOString())
        .select("id");

      if (expiredTopUps && expiredTopUps.length > 0) {
        console.log(`[reconcile-payments][${requestId}] Expired ${expiredTopUps.length} pending top-ups`);
      }

      // Clean up expired pending_tickets using safe cleanup logic
      // CRITICAL: This respects the 15-minute grace period to prevent
      // premature expiration of active reservations
      const gracePeriodMinutes = 15;
      const cutoffTime = new Date(Date.now() - gracePeriodMinutes * 60 * 1000).toISOString();
      
      const { data: expiredTickets } = await supabase
        .from("pending_tickets")
        .update({ 
          status: "expired", 
          updated_at: new Date().toISOString()
          // Note: Cannot append to note field via simple update - would need RPC
        })
        .eq("status", "pending")
        .lt("expires_at", new Date().toISOString())
        .lt("created_at", cutoffTime) // ONLY expire if created > 15 minutes ago
        .select("id");

      if (expiredTickets && expiredTickets.length > 0) {
        console.log(`[reconcile-payments][${requestId}] Expired ${expiredTickets.length} pending tickets (grace period: ${gracePeriodMinutes}min)`);
      }
      
      // Count protected reservations for monitoring
      const { count: protectedCount } = await supabase
        .from("pending_tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("expires_at", new Date().toISOString())
        .gte("created_at", cutoffTime);
      
      if (protectedCount && protectedCount > 0) {
        console.log(`[reconcile-payments][${requestId}] Protected ${protectedCount} recent reservations (within ${gracePeriodMinutes}min grace period)`);
      }
    } catch (cleanupErr) {
      console.warn(`[reconcile-payments][${requestId}] Cleanup error (non-fatal):`, cleanupErr);
    }

    // =====================================================
    // SUMMARY
    // =====================================================
    result.success = result.errors.length === 0;

    console.log(`[reconcile-payments][${requestId}] Reconciliation complete:`, {
      topUpsReconciled: result.topUpsReconciled,
      entriesReconciled: result.entriesReconciled,
      totalAmountCredited: result.totalAmountCredited,
      errors: result.errors.length,
    });

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 207, // 207 = Multi-Status (partial success)
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(`[reconcile-payments][${requestId}] Unhandled error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
