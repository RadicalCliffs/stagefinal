/**
 * Diagnose the exact path of balance data from database to UI
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const JERRY_CANONICAL = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';

async function main() {
  console.log('=' + '='.repeat(79));
  console.log('TRACING BALANCE FROM DB TO FRONTEND FOR JERRY');
  console.log('=' + '='.repeat(79));

  // 1. THE EXACT RPC CALL THE FRONTEND MAKES
  console.log('\n📊 1. GET_USER_BALANCE RPC (what the frontend actually calls):');
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('get_user_balance', {
    p_canonical_user_id: JERRY_CANONICAL
  });
  
  console.log('  RPC Response:', JSON.stringify(rpcResult, null, 2));
  if (rpcErr) console.log('  RPC Error:', rpcErr);

  // 2. Check sub_account_balances directly
  console.log('\n📊 2. SUB_ACCOUNT_BALANCES (source of truth):');
  const { data: balances, error: balErr } = await supabase
    .from('sub_account_balances')
    .select('*')
    .or(`canonical_user_id.eq.${JERRY_CANONICAL},user_id.eq.${JERRY_CANONICAL},wallet_address.ilike.%0x0ff51ec%`);
  
  if (balErr) console.log('  ERROR:', balErr.message);
  else {
    console.log(`  Found ${balances?.length || 0} records:`);
    balances?.forEach((b, i) => {
      console.log(`  ${i+1}. id: ${b.id}`);
      console.log(`     user_id: ${b.user_id}`);
      console.log(`     canonical_user_id: ${b.canonical_user_id}`);
      console.log(`     available_balance: $${b.available_balance}`);
      console.log(`     wallet_address: ${b.wallet_address || 'NULL'}`);
    });
  }

  // 3. Check with LOWER() matching like the RPC should
  console.log('\n📊 3. LOWER() MATCHING (what RPC should use):');
  const { data: lowerMatch } = await supabase
    .from('sub_account_balances')
    .select('canonical_user_id, user_id, available_balance')
    .filter('canonical_user_id', 'ilike', JERRY_CANONICAL);
  
  console.log('  ilike match:', lowerMatch);

  // 4. Check ALL records with wallet address
  console.log('\n📊 4. ALL RECORDS WITH THIS WALLET:');
  const { data: walletRecords } = await supabase
    .from('sub_account_balances')
    .select('id, user_id, canonical_user_id, available_balance, wallet_address')
    .or('user_id.ilike.%0x0ff51%,canonical_user_id.ilike.%0x0ff51%,wallet_address.ilike.%0x0ff51%');
  
  console.log(`  Found ${walletRecords?.length || 0} records:`);
  walletRecords?.forEach((r, i) => {
    console.log(`  ${i+1}. user_id: "${r.user_id}"`);
    console.log(`     canonical_user_id: "${r.canonical_user_id}"`);
    console.log(`     wallet_address: "${r.wallet_address || 'NULL'}"`);
    console.log(`     available_balance: $${r.available_balance}`);
    console.log('');
  });

  // 5. Check canonical_users for this user
  console.log('\n📊 5. CANONICAL_USERS record:');
  const { data: cuData } = await supabase
    .from('canonical_users')
    .select('canonical_user_id, username, wallet_address')
    .eq('canonical_user_id', JERRY_CANONICAL);
  
  console.log('  Record:', cuData);

  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
