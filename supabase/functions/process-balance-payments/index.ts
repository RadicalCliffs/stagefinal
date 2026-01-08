import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isWalletAddress, isPrizePid } from "../_shared/userId.ts";

/**
 * Simple processor for completed balance-based payment transactions
 *
 * This function marks completed balance payments as processed
 * and creates basic competition entries.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

          // Insert real balance ledger entry
          // balance_ledger columns: id, user_id (UUID), balance_type, source, amount, transaction_id (UUID), metadata, created_at, expires_at
          const ledgerRow = {
            user_id: userUuid, // UUID from canonical_users.id
            balance_type: 'real', // Real USD balance
            source: transaction.payment_provider || 'coinbase_onramp',
            amount: amountUsd,
            transaction_id: transaction.id, // This is already a UUID from user_transactions.id
            metadata: {
              ...(transaction.metadata || {}),
              is_first_topup: isFirstTopup,
              bonus_amount: bonusAmount,
            },
            created_at: new Date().toISOString(),
            expires_at: null, // Real balance doesn't expire
          };

          const { error: ledgerError } = await supabase
            .from('balance_ledger')
            .insert(ledgerRow);

          if (ledgerError) {
            throw new Error(`Failed to credit ledger: ${ledgerError.message}`);
          }

          // Insert bonus ledger entry if applicable
          if (bonusAmount > 0) {
            const bonusLedgerRow = {
              user_id: userUuid,
              balance_type: 'bonus', // Bonus balance type for tracking
              source: 'first_topup_bonus',
              amount: bonusAmount,
              transaction_id: transaction.id,
              metadata: {
                base_topup_amount: amountUsd,
                bonus_percentage: 50,
                original_transaction_id: transaction.id,
              },
              created_at: new Date().toISOString(),
              expires_at: null, // Bonus doesn't expire
            };

            const { error: bonusLedgerError } = await supabase
              .from('balance_ledger')
              .insert(bonusLedgerRow);

            if (bonusLedgerError) {
              console.warn(`[process-balance-payments][${requestId}] Failed to insert bonus ledger entry (non-critical):`, bonusLedgerError.message);
            } else {
              console.log(`[process-balance-payments][${requestId}] ✅ Bonus ledger entry created: ${bonusAmount}`);
            }
          }

          // CRITICAL: Update sub_account_balances.available_balance (primary source of truth)
          // Also update canonical_users.usdc_balance for backwards compatibility
          // Include both the base amount AND the bonus in the total balance
          const currentBalance = Number(userRecord?.usdc_balance || 0);
          const newBalance = currentBalance + totalCredit;

          // First, update sub_account_balances (primary source of truth)
          const { data: subAccountRecord, error: subAccountFetchError } = await supabase
            .from('sub_account_balances')
            .select('id, available_balance, canonical_user_id')
            .eq('currency', 'USD')
            .or(`canonical_user_id.eq.${canonicalUserId},user_id.eq.${userUuid},privy_user_id.eq.${userIdentifier}`)
            .maybeSingle();

          if (subAccountRecord && !subAccountFetchError) {
            // Update existing sub_account_balances record
            const subAccountCurrentBalance = Number(subAccountRecord.available_balance || 0);
            const subAccountNewBalance = subAccountCurrentBalance + totalCredit;

            const { error: subAccountUpdateError } = await supabase
              .from('sub_account_balances')
              .update({
                available_balance: subAccountNewBalance,
                last_updated: new Date().toISOString(),
              })
              .eq('id', subAccountRecord.id);

            if (subAccountUpdateError) {
              console.error(`[process-balance-payments][${requestId}] Error updating sub_account_balances:`, subAccountUpdateError);
            } else {
              console.log(`[process-balance-payments][${requestId}] ✅ sub_account_balances updated: ${subAccountCurrentBalance} → ${subAccountNewBalance} (includes ${bonusAmount} bonus)`);
            }
          } else {
            // Create new sub_account_balances record if it doesn't exist
            console.log(`[process-balance-payments][${requestId}] No sub_account_balances record found, creating new one`);
            const { error: subAccountInsertError } = await supabase
              .from('sub_account_balances')
              .insert({
                canonical_user_id: canonicalUserId,
                user_id: userUuid,
                privy_user_id: isWallet ? null : userIdentifier,
                currency: 'USD',
                available_balance: totalCredit,
                pending_balance: 0,
                last_updated: new Date().toISOString(),
              });

            if (subAccountInsertError) {
              console.error(`[process-balance-payments][${requestId}] Error creating sub_account_balances:`, subAccountInsertError);
            } else {
              console.log(`[process-balance-payments][${requestId}] ✅ sub_account_balances record created with balance: ${totalCredit}`);
            }
          }

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
          // ENTRY PURCHASE: create joincompetition row if missing
          const { data: existingEntry } = await supabase
            .from('joincompetition')
            .select('uid')
            .eq('transactionhash', transaction.id)
            .maybeSingle();

          if (existingEntry) {
            console.log(`[process-balance-payments][${requestId}] Entry already exists for transaction ${transaction.id}`);

            await supabase
              .from('user_transactions')
              .update({ wallet_credited: true })
              .eq('id', transaction.id);

            results.push({
              transactionId: transaction.id,
              status: 'already_processed',
              message: 'Entry already existed',
            });
            continue;
          }

          const ticketCount = transaction.ticket_count || 1;
          const totalCost = Number(transaction.amount ?? amountUsd);

          // Convert user_id to canonical format for consistent storage
          const entryCanonicalUserId = toPrizePid(transaction.user_id);

          // Note: privy_user_id column may not exist in all environments
          // The userid field stores the canonical user identifier
          const entryData = {
            uid: crypto.randomUUID(),
            competitionid: transaction.competition_id,
            userid: entryCanonicalUserId,  // Use canonical ID
            numberoftickets: ticketCount,
            ticketnumbers: '',
            amountspent: totalCost,
            walletaddress: isWalletAddress(transaction.user_id) ? transaction.user_id.toLowerCase() : transaction.user_id,
            chain: 'USDC',
            transactionhash: transaction.id,
            purchasedate: new Date().toISOString(),
            buytime: new Date().toISOString(),
            created_at: new Date().toISOString(),
          } as any;

          console.log(`[process-balance-payments][${requestId}] Inserting entry data:`, JSON.stringify(entryData, null, 2));

          const { error: entryError } = await supabase
            .from('joincompetition')
            .insert(entryData);

          if (entryError) {
            throw new Error(`Failed to create entry: ${entryError.message}`);
          }

          await supabase
            .from('user_transactions')
            .update({ wallet_credited: true })
            .eq('id', transaction.id);

          results.push({
            transactionId: transaction.id,
            status: 'processed_entry',
            ticketsCreated: ticketCount,
            totalCost,
            entryCreated: true,
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
