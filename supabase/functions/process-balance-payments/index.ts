import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isWalletAddress, isPrizePid } from "../_shared/userId.ts";

/**
 * Simple processor for completed balance-based payment transactions
 *
 * PURPOSE: This function processes crypto-to-treasury transactions AFTER payment completion:
 * 
 * 1. TOP-UPS (competition_id IS NULL): 
 *    - Credits user's sub_account_balance via credit_sub_account_balance RPC
 *    - Applies 50% bonus on first top-up
 *    - NOTE: instant-topup.mts handles immediate top-ups and sets wallet_credited=true,
 *      so this is mainly a fallback for delayed/webhook-based top-ups
 * 
 * 2. ENTRY PURCHASES (competition_id IS NOT NULL):
 *    - Marks transaction as processed WITHOUT touching balance
 *    - User paid directly with crypto - no balance debit needed
 *    - Entry creation is handled by payment flow (PaymentModal, etc.)
 * 
 * Transactions are filtered by:
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

        // Infer type from competition_id (no 'type' column exists)
        const isTopup = !transaction.competition_id;
        const isEntryPurchase = !!transaction.competition_id;

        // Normalise amount in USD
        let amountUsd = 0;
        if (typeof transaction.amount === 'number') {
          amountUsd = transaction.amount;
        } else if (transaction.metadata?.payment_total?.value) {
          amountUsd = Number(transaction.metadata.payment_total.value);
        } else if (transaction.metadata?.purchase_amount?.value && transaction.metadata?.exchange_rate?.value) {
          // fallback: crypto amount * rate -> USD
          amountUsd = Number(transaction.metadata.purchase_amount.value) * Number(transaction.metadata.exchange_rate.value);
        }

        if (isTopup) {
          // CREDIT USER USD LEDGER WITH 50% FIRST TOP-UP BONUS
          console.log(`[process-balance-payments][${requestId}] Crediting ledger for topup transaction ${transaction.id} amountUsd=${amountUsd}`);

          if (!transaction.user_id) {
            throw new Error('Missing user_id on topup transaction');
          }

          if (!amountUsd || Number.isNaN(amountUsd)) {
            throw new Error('Invalid amountUsd for topup transaction');
          }

          // Look up the user's UUID from canonical_users
          // The balance_ledger.user_id column is UUID type, referencing canonical_users.id
          // Convert to canonical format for consistent lookups
          const userIdentifier = transaction.user_id;
          const canonicalUserId = toPrizePid(userIdentifier);
          const isWallet = isWalletAddress(userIdentifier);
          const isCanonicalPid = isPrizePid(userIdentifier);

          let userUuid: string | null = null;
          let userRecord: any = null;

          // Strategy 1: Try canonical_user_id lookup first (most reliable)
          const { data: canonicalData } = await supabase
            .from('canonical_users')
            .select('id, uid, usdc_balance, has_used_new_user_bonus')
            .eq('canonical_user_id', canonicalUserId)
            .maybeSingle();

          if (canonicalData) {
            userUuid = canonicalData.id || canonicalData.uid;
            userRecord = canonicalData;
            console.log(`[process-balance-payments][${requestId}] Found user by canonical_user_id: ${canonicalUserId}`);
          }

          // Strategy 2: Wallet address lookup (case-insensitive) - fallback for legacy data
          if (!userUuid && isWallet) {
            const lowerUserId = userIdentifier.toLowerCase();
            const { data: userData } = await supabase
              .from('canonical_users')
              .select('id, uid, usdc_balance, has_used_new_user_bonus')
              .or(`wallet_address.ilike.${lowerUserId},base_wallet_address.ilike.${lowerUserId}`)
              .maybeSingle();
            if (userData) {
              userUuid = userData.id || userData.uid;
              userRecord = userData;
              console.log(`[process-balance-payments][${requestId}] Found user by wallet_address`);
            }
          }

          // Strategy 3: Privy user ID lookup (for legacy DIDs)
          if (!userUuid && !isWallet && !isCanonicalPid) {
            const { data: userData } = await supabase
              .from('canonical_users')
              .select('id, uid, usdc_balance, has_used_new_user_bonus')
              .eq('privy_user_id', userIdentifier)
              .maybeSingle();
            if (userData) {
              userUuid = userData.id || userData.uid;
              userRecord = userData;
              console.log(`[process-balance-payments][${requestId}] Found user by privy_user_id`);
            }
          }

          if (!userUuid) {
            console.error(`[process-balance-payments][${requestId}] User not found. Identifier: ${userIdentifier}, canonical: ${canonicalUserId}, isWallet: ${isWallet}`);
            throw new Error(`User not found for identifier: ${userIdentifier}`);
          }

          // Calculate 50% bonus for first top-up
          const hasUsedBonus = Boolean(userRecord?.has_used_new_user_bonus);
          const isFirstTopup = !hasUsedBonus;
          const bonusAmount = isFirstTopup ? Math.floor(amountUsd * 0.5 * 100) / 100 : 0; // Round to 2 decimal places
          const totalCredit = amountUsd + bonusAmount;

          console.log(`[process-balance-payments][${requestId}] Bonus calculation: isFirstTopup=${isFirstTopup}, base=${amountUsd}, bonus=${bonusAmount}, total=${totalCredit}`);

          // CRITICAL: Use credit_sub_account_balance RPC to update balance AND create ledger entry
          // This is the proper way to credit user's balance with audit trail
          console.log(`[process-balance-payments][${requestId}] Calling credit_sub_account_balance RPC for ${canonicalUserId}, amount: ${totalCredit}`);
          
          const { data: creditResult, error: creditRpcError } = await supabase
            .rpc('credit_sub_account_balance', {
              p_canonical_user_id: canonicalUserId,
              p_amount: totalCredit,
              p_currency: 'USD',
              p_reference_id: transaction.id,
              p_description: `Top-up ${amountUsd}${bonusAmount > 0 ? ` + bonus ${bonusAmount}` : ''}`
            });

          if (creditRpcError) {
            console.error(`[process-balance-payments][${requestId}] Error calling credit_sub_account_balance RPC:`, creditRpcError);
            throw new Error(`Failed to credit balance via RPC: ${creditRpcError.message}`);
          }

          if (!creditResult || creditResult.length === 0 || !creditResult[0].success) {
            const errorMsg = creditResult?.[0]?.error_message || 'Unknown error';
            console.error(`[process-balance-payments][${requestId}] credit_sub_account_balance RPC failed:`, errorMsg);
            throw new Error(`Failed to credit balance: ${errorMsg}`);
          }

          const { previous_balance, new_balance } = creditResult[0];
          console.log(`[process-balance-payments][${requestId}] ✅ Balance credited via RPC: ${previous_balance} → ${new_balance} (includes ${bonusAmount} bonus)`);

          // Also update canonical_users.usdc_balance for backwards compatibility
          const currentBalance = Number(userRecord?.usdc_balance || 0);
          const newBalance = currentBalance + totalCredit;

          // Also update canonical_users for backwards compatibility
          // Update balance and mark bonus as used if this was first top-up
          const updateData: Record<string, any> = {
            usdc_balance: newBalance,
            updated_at: new Date().toISOString(),
          };

          if (isFirstTopup) {
            updateData.has_used_new_user_bonus = true;
          }

          // Update by uid (primary key) which is more reliable
          const { error: balanceUpdateError, data: updateResult } = await supabase
            .from('canonical_users')
            .update(updateData)
            .eq('uid', userUuid)
            .select('uid');

          if (balanceUpdateError) {
            console.error(`[process-balance-payments][${requestId}] Error updating usdc_balance:`, balanceUpdateError);
          } else if (!updateResult || updateResult.length === 0) {
            console.error(`[process-balance-payments][${requestId}] Balance update did not affect any rows! userUuid: ${userUuid}`);
          } else {
            console.log(`[process-balance-payments][${requestId}] ✅ canonical_users balance updated: ${currentBalance} → ${newBalance} (includes ${bonusAmount} bonus) for uid: ${userUuid}`);
          }

          // Mark transaction as wallet_credited so we don't process again
          await supabase
            .from('user_transactions')
            .update({ wallet_credited: true })
            .eq('id', transaction.id);

          results.push({
            transactionId: transaction.id,
            status: 'credited_ledger',
            amountUsd,
            bonusAmount,
            totalCredit,
            isFirstTopup,
            newBalance,
          });
          processed++;
          continue;
        }

        if (isEntryPurchase) {
          // ENTRY PURCHASE VIA CRYPTO: Mark as processed without touching balance
          // Entry purchases via Base/crypto are direct payments to treasury - NO balance debit needed
          // The entry should have been created by the payment flow (e.g., PaymentModal)
          // We just mark the transaction as processed here to avoid infinite retries
          console.log(`[process-balance-payments][${requestId}] Processing entry purchase via crypto for transaction ${transaction.id}`);
          
          // Check if entry already exists
          const { data: existingEntry } = await supabase
            .from('joincompetition')
            .select('uid')
            .eq('transactionhash', transaction.id)
            .maybeSingle();

          if (existingEntry) {
            console.log(`[process-balance-payments][${requestId}] ✅ Entry exists for transaction ${transaction.id}, marking as processed`);
          } else {
            // Entry doesn't exist yet - this is handled by a different flow
            // Just log and mark as credited to prevent retries
            console.log(`[process-balance-payments][${requestId}] ⚠️ Entry not found for transaction ${transaction.id}, but marking as processed (handled elsewhere)`);
          }

          // Mark transaction as wallet_credited to prevent reprocessing
          // NOTE: For crypto payments, "wallet_credited" means "processed" - no actual balance change occurs
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
