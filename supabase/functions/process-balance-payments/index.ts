import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isWalletAddress, isPrizePid } from "../_shared/userId.ts";

/**
 * Crypto Entry Purchase Acknowledgment Handler
 *
 * PURPOSE: This function processes completed crypto payment transactions for ENTRY PURCHASES ONLY.
 * 
 * ENTRY PURCHASES (competition_id IS NOT NULL):
 *   - Marks crypto entry purchase transactions as processed
 *   - NO balance changes (user paid directly with crypto to treasury)
 *   - Entry creation is handled by confirm-pending-tickets-proxy.mts
 * 
 * TOP-UPS (competition_id IS NULL):
 *   - Should NEVER reach this function
 *   - Top-ups are handled by dedicated functions that set wallet_credited=true immediately:
 *     * instant-topup.mts (Base Account top-ups)
 *     * onramp-complete.ts (Coinbase Onramp top-ups)
 *     * commerce-webhook.ts (Coinbase Commerce top-ups)
 *   - These functions credit sub_account_balances directly
 *   - If a top-up reaches here, it's marked as processed with a warning
 * 
 * PAY WITH BALANCE:
 *   - Uses payment_provider='balance' (NOT filtered by this function)
 *   - Handled by purchase-tickets-with-bonus edge function
 *   - Debits sub_account_balances via purchase_tickets_with_balance RPC
 * 
 * Transactions filtered by:
 * - payment_provider IN ('base-cdp', 'coinbase', 'coinbase_onramp', 'onchainkit', 'privy_base_wallet')
 * - status IN ('completed', 'complete', 'finished', 'confirmed', 'success', 'paid')
 * - wallet_credited = false
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false'
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[process-balance-payments][${requestId}] Starting balance payment processing...`);

    // Get all completed balance-based payments that need processing
    // IMPORTANT: user_transactions table does NOT have a 'type' column
    // The type is inferred from competition_id:
    // - competition_id IS NULL → top-up (credit user's USD ledger)
    // - competition_id IS NOT NULL → entry purchase (tickets already allocated)
    // NOTE: Using case-insensitive status matching with .ilike for Supabase queries
    const { data: pendingTransactions, error: fetchError } = await supabase
      .from('user_transactions')
      .select('*')
      .in('payment_provider', ['base-cdp', 'coinbase', 'coinbase_onramp', 'onchainkit', 'privy_base_wallet'])
      .or('status.ilike.completed,status.ilike.complete,status.ilike.finished,status.ilike.confirmed,status.ilike.success,status.ilike.paid')
      .eq('wallet_credited', false)
      .order('completed_at', { ascending: true });

    if (fetchError) {
      console.error(`[process-balance-payments][${requestId}] Error fetching transactions:`, fetchError);
      throw fetchError;
    }

    console.log(`[process-balance-payments][${requestId}] Found ${pendingTransactions?.length || 0} pending balance payments`);

    if (!pendingTransactions || pendingTransactions.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending balance payments to process',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const results: any[] = [];
    let processed = 0;

    // Process each pending transaction
    for (const transaction of pendingTransactions) {
      try {
        console.log(`[process-balance-payments][${requestId}] Processing transaction ${transaction.id} (${transaction.payment_provider})`);

        // Check transaction type based on competition_id
        const isTopup = !transaction.competition_id;
        const isEntryPurchase = !!transaction.competition_id;

        if (isTopup) {
          // TOP-UP TRANSACTIONS: Should NOT be processed here
          // Top-ups are handled by dedicated functions:
          // - instant-topup.mts (Base Account top-ups)
          // - onramp-complete.ts (Coinbase Onramp top-ups)
          // - commerce-webhook.ts (Coinbase Commerce top-ups)
          // 
          // These functions credit sub_account_balances and set wallet_credited=true immediately.
          // If a top-up reaches here, it's either:
          // 1. Already processed (shouldn't happen due to wallet_credited filter)
          // 2. A data anomaly that needs manual reconciliation
          console.warn(`[process-balance-payments][${requestId}] ⚠️ Top-up transaction ${transaction.id} reached process-balance-payments - this should not happen. Top-ups are handled by dedicated functions. Marking as processed to prevent retry loops.`);

          // Mark as processed to prevent infinite retries
          await supabase
            .from('user_transactions')
            .update({ 
              wallet_credited: true,
              notes: 'Marked as processed by process-balance-payments - top-ups should be handled by dedicated functions'
            })
            .eq('id', transaction.id);

          results.push({
            transactionId: transaction.id,
            status: 'topup_unexpected',
            message: 'Top-up should have been handled by dedicated function',
          });
          processed++;
          continue;
        }

        if (isEntryPurchase) {
          // ENTRY PURCHASE VIA CRYPTO: Mark as processed without touching balance
          // 
          // CONTEXT: Entry purchases via Base/crypto are direct payments to treasury.
          // No balance debit is needed because the user paid with crypto, not site balance.
          // 
          // Entry creation is handled by confirm-pending-tickets-proxy.mts when tickets
          // are allocated during the payment flow. This function just marks the transaction
          // as processed to prevent reprocessing attempts.
          console.log(`[process-balance-payments][${requestId}] Processing entry purchase via crypto for transaction ${transaction.id}`);
          
          // Check if entry already exists (for logging/debugging only)
          const { data: existingEntry } = await supabase
            .from('joincompetition')
            .select('uid')
            .eq('transactionhash', transaction.id)
            .maybeSingle();

          if (existingEntry) {
            console.log(`[process-balance-payments][${requestId}] ✅ Entry exists for transaction ${transaction.id}, marking as processed`);
          } else {
            // Entry doesn't exist yet - likely still being processed by confirm-pending-tickets-proxy
            // or payment flow is not complete. Mark as processed anyway to avoid retry loops.
            console.log(`[process-balance-payments][${requestId}] ⚠️ Entry not found for transaction ${transaction.id}. Expected to be created by confirm-pending-tickets-proxy.mts or payment flow. Marking as processed to prevent retries.`);
          }

          // Mark transaction as wallet_credited to prevent reprocessing
          // NOTE: For crypto entry purchases, "wallet_credited" is a misnomer - it just means "processed".
          // No actual wallet/balance crediting occurs for entry purchases - the field name is reused
          // for transaction state management across multiple payment types.
          await supabase
            .from('user_transactions')
            .update({ wallet_credited: true })
            .eq('id', transaction.id);

          results.push({
            transactionId: transaction.id,
            status: 'entry_purchase_via_crypto',
            message: 'Entry purchase via crypto - no balance change needed',
            entryExists: !!existingEntry,
          });
          processed++;
          continue;
        }

        // Fallback: mark as credited without side effects to avoid infinite retries
        console.log(`[process-balance-payments][${requestId}] Unknown transaction type, marking as credited:`, transaction.type);
        await supabase
          .from('user_transactions')
          .update({ wallet_credited: true })
          .eq('id', transaction.id);

        results.push({
          transactionId: transaction.id,
          status: 'marked_credited_unknown_type',
          type: transaction.type,
        });

        processed++;

      } catch (error) {
        console.error(`[process-balance-payments][${requestId}] Error processing transaction ${transaction.id}:`, error);

        results.push({
          transactionId: transaction.id,
          status: 'error',
          error: (error as Error).message
        });
      }
    }

    console.log(`[process-balance-payments][${requestId}] Completed processing. Processed: ${processed}, Results: ${results.length}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${processed} balance payments`,
      processed,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`[process-balance-payments][${requestId}] Fatal error:`, error);

    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
