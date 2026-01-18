#!/usr/bin/env node
/**
 * Payment Reconciliation Script
 * 
 * This script finds payments that completed successfully but weren't
 * properly reflected in Supabase (stuck in pending, not confirmed, etc.)
 * and attempts to reconcile them.
 * 
 * Usage:
 *   node reconcile_payments.mjs [--dry-run] [--hours=24]
 * 
 * Options:
 *   --dry-run    Show what would be reconciled without making changes
 *   --hours=N    Look back N hours (default: 24)
 *   --help       Show this help message
 * 
 * Requirements:
 *   - SUPABASE_URL environment variable
 *   - SUPABASE_SERVICE_ROLE_KEY environment variable
 * 
 * Examples:
 *   # Dry run - see what would be fixed
 *   node reconcile_payments.mjs --dry-run
 * 
 *   # Actually fix stuck payments from last 24 hours
 *   node reconcile_payments.mjs
 * 
 *   # Fix stuck payments from last 7 days
 *   node reconcile_payments.mjs --hours=168
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const hoursArg = args.find(arg => arg.startsWith('--hours='));
const lookbackHours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 24;
const showHelp = args.includes('--help');

if (showHelp) {
  console.log(`
Payment Reconciliation Script

Usage: node reconcile_payments.mjs [OPTIONS]

Options:
  --dry-run       Show what would be reconciled without making changes
  --hours=N       Look back N hours (default: 24)
  --help          Show this help message

Environment Variables Required:
  SUPABASE_URL                Your Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY   Your Supabase service role key

Examples:
  node reconcile_payments.mjs --dry-run
  node reconcile_payments.mjs --hours=168
  `);
  process.exit(0);
}

// Check environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables:');
  console.error('   Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Set them in your environment or .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('========================================');
console.log('Payment Reconciliation Script');
console.log('========================================');
console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes)' : '🔧 LIVE (will make changes)'}`);
console.log(`Lookback: ${lookbackHours} hours`);
console.log('');

/**
 * Find completed payments that need reconciliation
 */
async function findStuckPayments() {
  console.log('🔍 Finding stuck payments...');
  
  // Find entries that completed payment but tickets not confirmed
  const { data: stuckEntries, error: entriesError } = await supabase
    .from('user_transactions')
    .select(`
      id,
      user_id,
      competition_id,
      amount,
      ticket_count,
      status,
      payment_status,
      tx_id,
      created_at,
      updated_at
    `)
    .not('competition_id', 'is', null)
    .in('status', ['finished', 'completed'])
    .gte('created_at', new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });

  if (entriesError) {
    console.error('❌ Error fetching stuck entries:', entriesError);
    return { stuckEntries: [], stuckTopups: [] };
  }

  // Filter to only those without confirmed tickets
  const stuckEntriesFiltered = [];
  for (const entry of stuckEntries || []) {
    const { data: tickets } = await supabase
      .from('tickets')
      .select('id')
      .eq('order_id', entry.id)
      .limit(1);
    
    if (!tickets || tickets.length === 0) {
      stuckEntriesFiltered.push(entry);
    }
  }

  // Find top-ups that completed but weren't credited
  const { data: stuckTopups, error: topupsError } = await supabase
    .from('user_transactions')
    .select(`
      id,
      user_id,
      amount,
      status,
      wallet_credited,
      credit_synced,
      tx_id,
      created_at
    `)
    .is('competition_id', null)
    .in('status', ['finished', 'completed'])
    .or('wallet_credited.is.null,wallet_credited.eq.false')
    .gte('created_at', new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });

  if (topupsError) {
    console.error('❌ Error fetching stuck top-ups:', topupsError);
    return { stuckEntries: stuckEntriesFiltered, stuckTopups: [] };
  }

  return {
    stuckEntries: stuckEntriesFiltered,
    stuckTopups: stuckTopups || []
  };
}

/**
 * Reconcile a stuck entry purchase
 */
async function reconcileEntry(entry) {
  console.log(`\n📝 Reconciling entry purchase: ${entry.id}`);
  console.log(`   User: ${entry.user_id}`);
  console.log(`   Competition: ${entry.competition_id}`);
  console.log(`   Amount: $${entry.amount}`);
  console.log(`   Tickets: ${entry.ticket_count}`);
  console.log(`   Created: ${entry.created_at}`);

  if (isDryRun) {
    console.log('   ⏭️  DRY RUN: Would call confirm-pending-tickets');
    return { success: true, dryRun: true };
  }

  // Call confirm-pending-tickets function
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/confirm-pending-tickets`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          userId: entry.user_id,
          competitionId: entry.competition_id,
          transactionHash: entry.tx_id || entry.id,
          paymentProvider: 'coinbase_commerce',
          sessionId: entry.id,
          ticketCount: entry.ticket_count
        }),
      }
    );

    const result = await response.json();

    if (response.ok && result.success) {
      console.log(`   ✅ Reconciled: ${result.ticketCount} tickets confirmed`);
      return { success: true, result };
    } else if (result.alreadyConfirmed) {
      console.log(`   ℹ️  Already confirmed (idempotent success)`);
      return { success: true, alreadyConfirmed: true };
    } else {
      console.error(`   ❌ Failed:`, result.error || 'Unknown error');
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error(`   ❌ Exception:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Reconcile a stuck top-up
 */
async function reconcileTopup(topup) {
  console.log(`\n💰 Reconciling top-up: ${topup.id}`);
  console.log(`   User: ${topup.user_id}`);
  console.log(`   Amount: $${topup.amount}`);
  console.log(`   Created: ${topup.created_at}`);

  if (isDryRun) {
    console.log('   ⏭️  DRY RUN: Would credit balance');
    return { success: true, dryRun: true };
  }

  // Credit the balance using RPC
  try {
    const { data, error } = await supabase.rpc('credit_sub_account_balance', {
      p_canonical_user_id: topup.user_id,
      p_amount: topup.amount,
      p_currency: 'USD'
    });

    if (error) {
      console.error(`   ❌ RPC error:`, error);
      return { success: false, error: error.message };
    }

    const result = data?.[0];
    if (result?.success) {
      console.log(`   ✅ Credited: $${topup.amount} to balance`);
      console.log(`   New balance: $${result.new_balance}`);

      // Update transaction as credited
      await supabase
        .from('user_transactions')
        .update({
          wallet_credited: true,
          credit_synced: true,
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', topup.id);

      return { success: true, result };
    } else {
      console.error(`   ❌ Credit failed:`, result?.error_message || 'Unknown error');
      return { success: false, error: result?.error_message };
    }
  } catch (error) {
    console.error(`   ❌ Exception:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main reconciliation process
 */
async function main() {
  const { stuckEntries, stuckTopups } = await findStuckPayments();

  console.log(`\nFound:`);
  console.log(`  - ${stuckEntries.length} stuck entry purchases`);
  console.log(`  - ${stuckTopups.length} stuck top-ups`);

  if (stuckEntries.length === 0 && stuckTopups.length === 0) {
    console.log('\n✅ No stuck payments found - all clear!');
    return;
  }

  console.log('\n========================================');
  console.log('Processing Stuck Payments');
  console.log('========================================');

  const results = {
    entriesReconciled: 0,
    entriesFailed: 0,
    topupsReconciled: 0,
    topupsFailed: 0
  };

  // Reconcile entries
  for (const entry of stuckEntries) {
    const result = await reconcileEntry(entry);
    if (result.success || result.dryRun) {
      results.entriesReconciled++;
    } else {
      results.entriesFailed++;
    }
  }

  // Reconcile top-ups
  for (const topup of stuckTopups) {
    const result = await reconcileTopup(topup);
    if (result.success || result.dryRun) {
      results.topupsReconciled++;
    } else {
      results.topupsFailed++;
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('Reconciliation Summary');
  console.log('========================================');
  console.log(`Entry Purchases:`);
  console.log(`  ✅ Reconciled: ${results.entriesReconciled}`);
  console.log(`  ❌ Failed: ${results.entriesFailed}`);
  console.log(`\nTop-ups:`);
  console.log(`  ✅ Reconciled: ${results.topupsReconciled}`);
  console.log(`  ❌ Failed: ${results.topupsFailed}`);
  console.log('');

  if (isDryRun) {
    console.log('🔍 DRY RUN: No changes were made');
    console.log('   Run without --dry-run to apply changes');
  } else if (results.entriesFailed > 0 || results.topupsFailed > 0) {
    console.log('⚠️  Some reconciliations failed - check logs above');
    console.log('   You may need to investigate and fix these manually');
  } else {
    console.log('✅ All stuck payments reconciled successfully!');
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
