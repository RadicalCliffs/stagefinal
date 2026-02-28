#!/usr/bin/env node

/**
 * VRF Test Call Script
 * 
 * Tests the VRF implementation by checking a specific competition
 * or triggering a test VRF callback.
 * 
 * Usage:
 *   node scripts/test-vrf-call.mjs --competition-id=<id>
 *   node scripts/test-vrf-call.mjs --test-webhook
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Parse Arguments
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    competitionId: null,
    testWebhook: false,
    testSync: false,
  };
  
  for (const arg of args) {
    if (arg.startsWith('--competition-id=')) {
      options.competitionId = arg.split('=')[1];
    } else if (arg === '--test-webhook') {
      options.testWebhook = true;
    } else if (arg === '--test-sync') {
      options.testSync = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
VRF Test Call Script

Usage:
  node scripts/test-vrf-call.mjs [options]

Options:
  --competition-id=<id>  Check VRF status for specific competition
  --test-webhook         Simulate a VRF webhook callback (requires setup)
  --test-sync            Test VRF sync from blockchain
  --help, -h             Show this help message

Examples:
  node scripts/test-vrf-call.mjs --competition-id=abc-123-def
  node scripts/test-vrf-call.mjs --test-sync
`);
}

// ============================================================================
// Test Functions
// ============================================================================

async function checkCompetition(competitionId) {
  console.log(`\n🔍 Checking competition: ${competitionId}\n`);
  
  const { data: comp, error } = await supabase
    .from('competitions')
    .select(`
      id,
      title,
      status,
      uid,
      onchain_competition_id,
      vrf_status,
      vrf_request_id,
      vrf_tx_hash,
      rng_tx_hash,
      vrf_pregenerated_tx_hash,
      vrf_draw_requested_at,
      vrf_draw_completed_at,
      winner_address,
      draw_date
    `)
    .eq('id', competitionId)
    .maybeSingle();
  
  if (error) {
    console.error('❌ Error fetching competition:', error.message);
    return;
  }
  
  if (!comp) {
    // Try by UID
    const { data: compByUid, error: uidError } = await supabase
      .from('competitions')
      .select(`
        id,
        title,
        status,
        uid,
        onchain_competition_id,
        vrf_status,
        vrf_request_id,
        vrf_tx_hash,
        rng_tx_hash,
        vrf_pregenerated_tx_hash,
        vrf_draw_requested_at,
        vrf_draw_completed_at,
        winner_address,
        draw_date
      `)
      .eq('uid', competitionId)
      .maybeSingle();
    
    if (uidError || !compByUid) {
      console.error('❌ Competition not found');
      return;
    }
    
    console.log('ℹ️  Found by UID\n');
    console.log(`Competition Details:`);
    console.log(`  ID: ${compByUid.id}`);
    console.log(`  Title: ${compByUid.title}`);
    console.log(`  Status: ${compByUid.status}`);
    console.log(`  UID: ${compByUid.uid}`);
    console.log(`\nVRF Details:`);
    console.log(`  On-chain ID: ${compByUid.onchain_competition_id || 'NOT SET ❌'}`);
    console.log(`  VRF Status: ${compByUid.vrf_status || 'NOT SET ❌'}`);
    console.log(`  VRF Request ID: ${compByUid.vrf_request_id || 'NOT SET'}`);
    console.log(`  VRF TX Hash: ${compByUid.vrf_tx_hash || 'NOT SET ❌'}`);
    console.log(`  RNG TX Hash: ${compByUid.rng_tx_hash || 'NOT SET'}`);
    console.log(`  Pregenerated TX: ${compByUid.vrf_pregenerated_tx_hash || 'NOT SET'}`);
    console.log(`  Draw Requested: ${compByUid.vrf_draw_requested_at || 'NOT SET'}`);
    console.log(`  Draw Completed: ${compByUid.vrf_draw_completed_at || 'NOT SET'}`);
    console.log(`\nWinner Details:`);
    console.log(`  Winner Address: ${compByUid.winner_address || 'NOT SET ❌'}`);
    console.log(`  Draw Date: ${compByUid.draw_date || 'NOT SET'}`);
    
    // Check if complete
    const hasRequiredFields = compByUid.onchain_competition_id && 
                             compByUid.vrf_tx_hash && 
                             compByUid.winner_address &&
                             compByUid.vrf_status;
    
    if (hasRequiredFields) {
      console.log('\n✅ Competition has all required VRF data!');
      
      // Show blockchain link
      if (compByUid.vrf_tx_hash) {
        console.log(`\n🔗 View on Base Explorer:`);
        console.log(`   https://basescan.org/tx/${compByUid.vrf_tx_hash}`);
      }
    } else {
      console.log('\n⚠️  Competition missing some VRF data');
      const missing = [];
      if (!compByUid.onchain_competition_id) missing.push('on-chain ID');
      if (!compByUid.vrf_tx_hash) missing.push('VRF TX hash');
      if (!compByUid.winner_address) missing.push('winner');
      if (!compByUid.vrf_status) missing.push('VRF status');
      console.log(`   Missing: ${missing.join(', ')}`);
    }
    
    return;
  }
  
  console.log('Competition found (same details as above would be shown)');
}

async function testVRFSync() {
  console.log('\n🔄 Testing VRF sync from blockchain...\n');
  
  try {
    console.log('Calling vrf-sync-results function...');
    
    const { data, error } = await supabase.functions.invoke('vrf-sync-results', {
      body: {}
    });
    
    if (error) {
      console.error('❌ Error calling sync function:', error.message);
      return;
    }
    
    console.log('✅ Sync function called successfully\n');
    console.log('Result:', JSON.stringify(data, null, 2));
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const options = parseArgs();
  
  console.log('═════════════════════════════════════════════════════════');
  console.log('  🎲 VRF Test Call');
  console.log('═════════════════════════════════════════════════════════');
  
  if (options.competitionId) {
    await checkCompetition(options.competitionId);
  } else if (options.testSync) {
    await testVRFSync();
  } else {
    console.log('\nNo test specified. Use --help for usage information.');
    console.log('\nQuick check of recent completed competitions:');
    
    const { data: recentComps, error } = await supabase
      .from('competitions')
      .select('id, uid, title, status, vrf_tx_hash, winner_address')
      .in('status', ['completed', 'drawn'])
      .order('draw_date', { ascending: false, nullsFirst: false })
      .limit(5);
    
    if (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
    
    if (!recentComps || recentComps.length === 0) {
      console.log('No completed competitions found');
      process.exit(0);
    }
    
    console.log('\nRecent competitions:');
    for (const comp of recentComps) {
      const hasVrf = !!comp.vrf_tx_hash;
      const hasWinner = !!comp.winner_address;
      console.log(`\n  ${comp.title}`);
      console.log(`    ID: ${comp.id}`);
      console.log(`    UID: ${comp.uid || 'N/A'}`);
      console.log(`    Status: ${comp.status}`);
      console.log(`    VRF TX: ${hasVrf ? '✓' : '❌'}`);
      console.log(`    Winner: ${hasWinner ? '✓' : '❌'}`);
    }
    
    console.log('\n\nUse --competition-id=<id> to check a specific competition');
    console.log('Use --test-sync to test VRF blockchain sync');
  }
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
