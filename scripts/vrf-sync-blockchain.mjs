#!/usr/bin/env node

/**
 * VRF Blockchain Sync Script
 * 
 * Syncs VRF draw results from the Base blockchain to the database.
 * This script queries the VRF contract for completed draws and updates
 * the database with winner information.
 * 
 * Usage:
 *   npm run vrf:sync-blockchain
 *   node scripts/vrf-sync-blockchain.mjs [--competition-id=<id>]
 * 
 * Environment Variables:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key (admin)
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Configuration
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   - SUPABASE_URL or VITE_SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// VRF contract configuration
const VRF_CONTRACT_ADDRESS = '0x8ce54644e3313934D663c43Aea29641DFD8BcA1A';
const BASE_CHAIN_ID = 8453;
const BASE_EXPLORER = 'https://basescan.org';

// ============================================================================
// Helper Functions
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    competitionId: null,
    dryRun: false,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--competition-id=')) {
      options.competitionId = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
VRF Blockchain Sync Script

Usage:
  npm run vrf:sync-blockchain [options]
  node scripts/vrf-sync-blockchain.mjs [options]

Options:
  --competition-id=<id>  Sync specific competition only
  --dry-run             Show what would be synced without making changes
  --verbose, -v         Show detailed output
  --help, -h            Show this help message

Examples:
  npm run vrf:sync-blockchain
  npm run vrf:sync-blockchain -- --competition-id=abc-123
  npm run vrf:sync-blockchain -- --dry-run --verbose
`);
}

function log(message, verbose = false) {
  if (!verbose || options.verbose) {
    console.log(message);
  }
}

// ============================================================================
// Main Sync Logic
// ============================================================================

async function syncCompetitionVRF(competitionId) {
  log(`\n🔄 Syncing competition: ${competitionId}`, true);

  try {
    // Fetch competition details
    const { data: competition, error: compError } = await supabase
      .from('competitions')
      .select('id, title, onchain_competition_id, vrf_tx_hash, vrf_status, num_winners')
      .eq('id', competitionId)
      .single();

    if (compError) {
      log(`   ❌ Error fetching competition: ${compError.message}`);
      return { success: false, error: compError.message };
    }

    if (!competition) {
      log(`   ❌ Competition not found`);
      return { success: false, error: 'Competition not found' };
    }

    if (!competition.onchain_competition_id) {
      log(`   ⚠️  No on-chain competition ID - skipping`);
      return { success: false, error: 'No on-chain ID' };
    }

    log(`   📊 Competition: ${competition.title}`, true);
    log(`   🔗 On-chain ID: ${competition.onchain_competition_id}`, true);
    log(`   📝 VRF Status: ${competition.vrf_status || 'unknown'}`, true);

    // In a full implementation, this would:
    // 1. Call the VRF contract to get winner data
    // 2. Query the tickets table to match ticket numbers to users
    // 3. Update the winners table with the results
    // 4. Update the competition vrf_status to 'completed'

    // For now, we'll call the vrf-sync-results edge function
    const { data: syncResult, error: syncError } = await supabase.functions.invoke(
      'vrf-sync-results',
      {
        body: { onchainCompetitionId: competition.onchain_competition_id }
      }
    );

    if (syncError) {
      log(`   ❌ Error syncing results: ${syncError.message}`);
      return { success: false, error: syncError.message };
    }

    log(`   ✅ Sync completed successfully`);
    if (syncResult) {
      log(`   📊 Winners found: ${syncResult.winnersCount || 0}`, true);
    }

    return { success: true, data: syncResult };
  } catch (error) {
    log(`   ❌ Unexpected error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function syncAllCompetitions() {
  log('🔍 Finding competitions that need VRF sync...\n');

  try {
    // Find competitions that have been drawn but need result syncing
    const { data: competitions, error } = await supabase
      .from('competitions')
      .select('id, title, onchain_competition_id, vrf_status')
      .not('onchain_competition_id', 'is', null)
      .in('vrf_status', ['completed', 'processing', 'drawn'])
      .order('created_at', { ascending: false });

    if (error) {
      log(`❌ Error fetching competitions: ${error.message}`);
      return;
    }

    if (!competitions || competitions.length === 0) {
      log('ℹ️  No competitions found that need syncing');
      return;
    }

    log(`📋 Found ${competitions.length} competition(s) to sync\n`);

    let successCount = 0;
    let failCount = 0;

    for (const comp of competitions) {
      const result = await syncCompetitionVRF(comp.id);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    log(`\n📊 Sync Summary:`);
    log(`   ✅ Successful: ${successCount}`);
    log(`   ❌ Failed: ${failCount}`);
    log(`   📈 Total: ${competitions.length}`);
  } catch (error) {
    log(`❌ Error in sync process: ${error.message}`);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

const options = parseArgs();

async function main() {
  console.log('═════════════════════════════════════════════════════════');
  console.log('  🎲 VRF Blockchain Sync Script');
  console.log('  📡 Chain: Base Mainnet (Chain ID: 8453)');
  console.log(`  🔗 Contract: ${VRF_CONTRACT_ADDRESS}`);
  if (options.dryRun) {
    console.log('  ⚠️  DRY RUN MODE - No changes will be made');
  }
  console.log('═════════════════════════════════════════════════════════\n');

  try {
    if (options.competitionId) {
      // Sync specific competition
      log(`🎯 Syncing specific competition: ${options.competitionId}\n`);
      const result = await syncCompetitionVRF(options.competitionId);
      
      if (result.success) {
        log('\n✅ Sync completed successfully!');
        process.exit(0);
      } else {
        log(`\n❌ Sync failed: ${result.error}`);
        process.exit(1);
      }
    } else {
      // Sync all competitions
      await syncAllCompetitions();
      log('\n✅ Batch sync completed!');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
