#!/usr/bin/env node

/**
 * VRF Transaction Hash Verification Script
 * 
 * This script checks that VRF transaction hashes are properly stored and
 * accessible for all completed competitions.
 * 
 * Usage:
 *   node scripts/verify-vrf-hashes.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   - VITE_SUPABASE_URL or SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Verification Functions
// ============================================================================

async function checkVRFFieldsExist() {
  console.log('\n📋 Checking VRF field existence...');
  
  try {
    // Try to query with VRF fields
    const { data, error } = await supabase
      .from('competitions')
      .select('id, vrf_tx_hash, rng_tx_hash, vrf_status, onchain_competition_id, vrf_draw_requested_at, vrf_draw_completed_at')
      .limit(1);
    
    if (error) {
      console.error('❌ Error checking fields:', error.message);
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        console.error('⚠️  Migration has not been applied yet!');
        console.error('   Run: supabase db push or apply the migration manually');
      }
      return false;
    }
    
    console.log('✅ All VRF fields exist in competitions table');
    return true;
  } catch (err) {
    console.error('❌ Error:', err.message);
    return false;
  }
}

async function checkCompletedCompetitions() {
  console.log('\n🔍 Checking completed competitions...');
  
  const { data: competitions, error } = await supabase
    .from('competitions')
    .select(`
      id,
      title,
      status,
      uid,
      onchain_competition_id,
      vrf_status,
      vrf_tx_hash,
      rng_tx_hash,
      vrf_pregenerated_tx_hash,
      vrf_draw_requested_at,
      vrf_draw_completed_at,
      winner_address,
      draw_date
    `)
    .in('status', ['completed', 'drawn'])
    .order('draw_date', { ascending: false, nullsFirst: false })
    .limit(20);
  
  if (error) {
    console.error('❌ Error fetching competitions:', error.message);
    return;
  }
  
  if (!competitions || competitions.length === 0) {
    console.log('ℹ️  No completed/drawn competitions found');
    return;
  }
  
  console.log(`\n📊 Found ${competitions.length} completed/drawn competitions\n`);
  
  let stats = {
    total: competitions.length,
    withVrfTxHash: 0,
    withRngTxHash: 0,
    withPregeneratedTxHash: 0,
    withAnyTxHash: 0,
    withOnchainId: 0,
    withWinner: 0,
    withVrfStatus: 0,
    complete: 0, // Has all VRF data
  };
  
  for (const comp of competitions) {
    const hasVrfTxHash = !!comp.vrf_tx_hash;
    const hasRngTxHash = !!comp.rng_tx_hash;
    const hasPregeneratedTxHash = !!comp.vrf_pregenerated_tx_hash;
    const hasAnyTxHash = hasVrfTxHash || hasRngTxHash || hasPregeneratedTxHash;
    const hasOnchainId = !!comp.onchain_competition_id;
    const hasWinner = !!comp.winner_address;
    const hasVrfStatus = !!comp.vrf_status;
    
    const isComplete = hasVrfTxHash && hasOnchainId && hasWinner && hasVrfStatus;
    
    if (hasVrfTxHash) stats.withVrfTxHash++;
    if (hasRngTxHash) stats.withRngTxHash++;
    if (hasPregeneratedTxHash) stats.withPregeneratedTxHash++;
    if (hasAnyTxHash) stats.withAnyTxHash++;
    if (hasOnchainId) stats.withOnchainId++;
    if (hasWinner) stats.withWinner++;
    if (hasVrfStatus) stats.withVrfStatus++;
    if (isComplete) stats.complete++;
    
    // Show incomplete competitions
    if (!isComplete) {
      console.log(`⚠️  ${comp.title} (${comp.uid || comp.id.substring(0, 8)})`);
      console.log(`   Status: ${comp.status}`);
      console.log(`   VRF TX Hash: ${hasVrfTxHash ? '✓' : '❌'}`);
      console.log(`   RNG TX Hash: ${hasRngTxHash ? '✓' : '❌'}`);
      console.log(`   Pregenerated TX: ${hasPregeneratedTxHash ? '✓' : '❌'}`);
      console.log(`   On-chain ID: ${hasOnchainId ? '✓' : '❌'}`);
      console.log(`   Winner: ${hasWinner ? '✓' : '❌'}`);
      console.log(`   VRF Status: ${comp.vrf_status || '❌'}`);
      console.log('');
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 STATISTICS');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Total competitions: ${stats.total}`);
  console.log(`With vrf_tx_hash: ${stats.withVrfTxHash} (${(stats.withVrfTxHash/stats.total*100).toFixed(1)}%)`);
  console.log(`With rng_tx_hash: ${stats.withRngTxHash} (${(stats.withRngTxHash/stats.total*100).toFixed(1)}%)`);
  console.log(`With pregenerated TX: ${stats.withPregeneratedTxHash} (${(stats.withPregeneratedTxHash/stats.total*100).toFixed(1)}%)`);
  console.log(`With any TX hash: ${stats.withAnyTxHash} (${(stats.withAnyTxHash/stats.total*100).toFixed(1)}%)`);
  console.log(`With on-chain ID: ${stats.withOnchainId} (${(stats.withOnchainId/stats.total*100).toFixed(1)}%)`);
  console.log(`With winner: ${stats.withWinner} (${(stats.withWinner/stats.total*100).toFixed(1)}%)`);
  console.log(`With VRF status: ${stats.withVrfStatus} (${(stats.withVrfStatus/stats.total*100).toFixed(1)}%)`);
  console.log(`Complete (all VRF data): ${stats.complete} (${(stats.complete/stats.total*100).toFixed(1)}%)`);
  console.log('═══════════════════════════════════════════════════\n');
  
  if (stats.withVrfTxHash === stats.total) {
    console.log('✅ All competitions have vrf_tx_hash!');
  } else if (stats.withAnyTxHash === stats.total) {
    console.log('⚠️  All competitions have some TX hash, but not all use vrf_tx_hash');
    console.log('   Consider running data migration to copy from rng_tx_hash/vrf_pregenerated_tx_hash');
  } else {
    console.log('❌ Some competitions missing TX hashes!');
    console.log(`   ${stats.total - stats.withAnyTxHash} competitions need VRF transaction data`);
  }
}

async function checkWinnersTable() {
  console.log('\n🏆 Checking winners table...');
  
  const { data: winners, error } = await supabase
    .from('competition_winners')
    .select(`
      competition_id,
      wallet_address,
      vrf_tx_hash,
      tx_hash,
      txhash,
      rngtrxhash,
      competitions (
        title,
        status,
        vrf_tx_hash
      )
    `)
    .eq('is_winner', true)
    .limit(50);
  
  if (error) {
    console.error('❌ Error fetching winners:', error.message);
    return;
  }
  
  if (!winners || winners.length === 0) {
    console.log('ℹ️  No winners found');
    return;
  }
  
  console.log(`Found ${winners.length} winners\n`);
  
  let withVrfTxHash = 0;
  let withAnyTxHash = 0;
  let matchingCompetition = 0;
  
  for (const winner of winners) {
    const hasVrfTxHash = !!winner.vrf_tx_hash;
    const hasAnyTxHash = !!(winner.vrf_tx_hash || winner.tx_hash || winner.txhash || winner.rngtrxhash);
    const compHasVrfTxHash = !!(winner.competitions as any)?.vrf_tx_hash;
    const txHashesMatch = winner.vrf_tx_hash === (winner.competitions as any)?.vrf_tx_hash;
    
    if (hasVrfTxHash) withVrfTxHash++;
    if (hasAnyTxHash) withAnyTxHash++;
    if (txHashesMatch) matchingCompetition++;
    
    if (!hasVrfTxHash && compHasVrfTxHash) {
      console.log(`⚠️  Winner missing vrf_tx_hash but competition has it`);
      console.log(`   Competition: ${(winner.competitions as any)?.title}`);
      console.log(`   Competition TX: ${(winner.competitions as any)?.vrf_tx_hash}`);
      console.log('');
    }
  }
  
  console.log(`Winners with vrf_tx_hash: ${withVrfTxHash}/${winners.length}`);
  console.log(`Winners with any TX hash: ${withAnyTxHash}/${winners.length}`);
  console.log(`Matching competition TX: ${matchingCompetition}/${winners.length}`);
  
  if (withVrfTxHash === winners.length) {
    console.log('✅ All winners have vrf_tx_hash!');
  } else {
    console.log('⚠️  Some winners missing vrf_tx_hash');
  }
}

async function testVRFView() {
  console.log('\n🔎 Testing vrf_competition_status view...');
  
  try {
    const { data, error } = await supabase
      .from('vrf_competition_status')
      .select('*')
      .limit(10);
    
    if (error) {
      console.error('❌ View query failed:', error.message);
      if (error.message.includes('does not exist')) {
        console.error('   View not created yet - migration needs to be applied');
      }
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('ℹ️  No competitions in VRF view');
      return;
    }
    
    console.log(`✅ View working - found ${data.length} competitions`);
    
    // Show sample
    const sample = data[0];
    console.log('\nSample entry:');
    console.log(`  Title: ${sample.title}`);
    console.log(`  Status: ${sample.status}`);
    console.log(`  TX Hash Status: ${sample.tx_hash_status}`);
    console.log(`  Effective TX: ${sample.effective_tx_hash ? sample.effective_tx_hash.substring(0, 20) + '...' : 'None'}`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═════════════════════════════════════════════════════════');
  console.log('  🎲 VRF Transaction Hash Verification');
  console.log('  📡 Chain: Base Mainnet');
  console.log('═════════════════════════════════════════════════════════');
  
  try {
    // Check if migration has been applied
    const fieldsExist = await checkVRFFieldsExist();
    
    if (!fieldsExist) {
      console.log('\n⚠️  MIGRATION NOT APPLIED');
      console.log('Please apply the migration:');
      console.log('  cd supabase');
      console.log('  supabase db push');
      console.log('\nOr manually in SQL editor:');
      console.log('  Run the contents of: supabase/migrations/20260228_standardize_vrf_fields.sql');
      process.exit(1);
    }
    
    // Run all checks
    await checkCompletedCompetitions();
    await checkWinnersTable();
    await testVRFView();
    
    console.log('\n✅ Verification complete!');
    console.log('\nNext steps:');
    console.log('1. If any competitions are missing vrf_tx_hash, the migration will copy from rng_tx_hash');
    console.log('2. For future draws, the webhook will populate vrf_tx_hash automatically');
    console.log('3. UI will display transaction hashes from vrf_tx_hash field');
    console.log('4. Use the vrf_competition_status view to monitor VRF status');
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
