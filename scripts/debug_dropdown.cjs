/**
 * Debug dropdown data: entry count and balance
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const JERRY_CANONICAL = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';

async function main() {
  console.log('=' + '='.repeat(79));
  console.log('DEBUG DROPDOWN DATA FOR JERRY');
  console.log('=' + '='.repeat(79));

  // 1. get_user_active_tickets RPC (entryCount source)
  console.log('\n📊 1. GET_USER_ACTIVE_TICKETS RPC (entry count):');
  const { data: ticketData, error: ticketErr } = await supabase
    .rpc('get_user_active_tickets', { p_user_identifier: JERRY_CANONICAL });
  
  console.log('  Result:', ticketData);
  if (ticketErr) console.log('  Error:', ticketErr);

  // 2. get_user_balance RPC (balance source for useRealTimeBalance)
  console.log('\n📊 2. GET_USER_BALANCE RPC (balance):');
  const { data: balData, error: balErr } = await supabase
    .rpc('get_user_balance', { p_canonical_user_id: JERRY_CANONICAL });
  
  console.log('  Result:', JSON.stringify(balData, null, 2));
  if (balErr) console.log('  Error:', balErr);

  // 3. Direct count from joincompetition
  console.log('\n📊 3. DIRECT COUNT from joincompetition:');
  const { count: directCount, error: countErr } = await supabase
    .from('joincompetition')
    .select('*', { count: 'exact', head: true })
    .or(`canonical_user_id.eq.${JERRY_CANONICAL},wallet_address.ilike.%0x0ff51ec%`);
  
  console.log('  Count:', directCount);
  if (countErr) console.log('  Error:', countErr);

  // 4. Check for active competitions entries
  console.log('\n📊 4. ACTIVE ENTRIES (competition not ended):');
  const { data: activeEntries, error: activeErr } = await supabase
    .from('joincompetition')
    .select('id, competition_id, ticket_count, created_at')
    .or(`canonical_user_id.eq.${JERRY_CANONICAL},wallet_address.ilike.%0x0ff51ec%`)
    .order('created_at', { ascending: false })
    .limit(10);
  
  console.log(`  Found ${activeEntries?.length || 0} recent entries`);
  activeEntries?.forEach((e, i) => {
    console.log(`  ${i+1}. comp=${e.competition_id}, tickets=${e.ticket_count}, ${e.created_at}`);
  });
  if (activeErr) console.log('  Error:', activeErr);

  // 5. Check sub_account_balances 
  console.log('\n📊 5. SUB_ACCOUNT_BALANCES:');
  const { data: sabData } = await supabase
    .from('sub_account_balances')
    .select('available_balance, pending_balance')
    .eq('canonical_user_id', JERRY_CANONICAL)
    .eq('currency', 'USD')
    .single();
  
  console.log('  Balance:', sabData);

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
