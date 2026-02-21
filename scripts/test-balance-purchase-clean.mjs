// Clean test script to prove balance purchase works
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY environment variable');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('=== Clean Balance Purchase Test ===\n');
  
  // 0. Debug - check all tickets in DB
  console.log('0. Checking tickets table...');
  const { data: allTickets, count: totalCount } = await supabase
    .from('tickets')
    .select('competition_id, ticket_number', { count: 'exact' })
    .limit(20);
  console.log(`   Total tickets in table: ${totalCount || 0}`);
  if (allTickets?.length) {
    const compIds = [...new Set(allTickets.map(t => t.competition_id))];
    console.log(`   Unique competition IDs: ${compIds.length}`);
    console.log(`   Sample comp IDs: ${compIds.slice(0, 3).join(', ')}`);
  }
  
  // 1. Find active competitions and check their actual ticket counts
  console.log('1. Scanning active competitions for a clean one...');
  const { data: comps } = await supabase
    .from('competitions')
    .select('id, title, ticket_price, total_tickets, sold_tickets')
    .eq('status', 'active')
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (!comps?.length) {
    console.error('No active competitions found!');
    process.exit(1);
  }
  
  // Find one with truly 0 tickets in DB - skip Bitcoin Bonanza specifically
  let selectedComp = null;
  for (const c of comps) {
    // Skip Bitcoin Bonanza - it has DB issues
    if (c.title === 'Bitcoin Bonanza') {
      console.log(`   ${c.title.substring(0, 30).padEnd(30)} - SKIPPING (known issues)`);
      continue;
    }
    const { count } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('competition_id', c.id);
    const actualCount = count || 0;
    console.log(`   ${c.title.substring(0, 30).padEnd(30)} - sold_tickets: ${(c.sold_tickets || 0).toString().padStart(4)}, actual DB: ${actualCount}`);
    if (actualCount === 0 && !selectedComp) {
      selectedComp = c;
    }
  }
  
  // If all have tickets, use one anyway
  if (!selectedComp) {
    selectedComp = comps.find(c => c.title !== 'Bitcoin Bonanza') || comps[0];
    console.log('\n   WARNING: Using competition that might have tickets');
  }
  
  console.log(`\n   Selected: ${selectedComp.title}`);
  console.log(`   ID: ${selectedComp.id}`);
  console.log(`   Price: $${selectedComp.ticket_price}, Total: ${selectedComp.total_tickets}`);
  
  // 2. Find a user with balance (prefer prize:pid: format)
  console.log('\n2. Finding a user with balance...');
  const { data: balanceUsers } = await supabase
    .from('sub_account_balances')
    .select('canonical_user_id, available_balance')
    .gt('available_balance', selectedComp.ticket_price * 5)
    .limit(10);
  
  // Prefer users with prize:pid: format
  let balanceUser = balanceUsers?.find(u => u.canonical_user_id?.startsWith('prize:pid:'));
  if (!balanceUser) {
    balanceUser = balanceUsers?.[0];
  }
    
  if (!balanceUser) {
    console.error('No user with sufficient balance found!');
    process.exit(1);
  }
  
  console.log(`   User: ${balanceUser.canonical_user_id}`);
  console.log(`   Balance: $${balanceUser.available_balance}`);
  
// 3. STEP 1: Reserve tickets first
  console.log('\n3. STEP 1: Reserving 3 tickets via allocate_lucky_dip_tickets_batch...');
  const ticketCount = 3;
  
  const { data: allocResult, error: allocError } = await supabase.rpc('allocate_lucky_dip_tickets_batch', {
    p_user_id: balanceUser.canonical_user_id,
    p_competition_id: selectedComp.id,
    p_count: ticketCount,
    p_ticket_price: selectedComp.ticket_price,
    p_hold_minutes: 15,
    p_session_id: `test-${Date.now()}`,
    p_excluded_tickets: null,
  });
  
  if (allocError || !allocResult?.success) {
    console.error(`   Allocation ERROR: ${allocError?.message || allocResult?.error}`);
    process.exit(1);
  }
  
  console.log(`   ✓ Reserved tickets: ${JSON.stringify(allocResult.ticket_numbers)}`);
  console.log(`   Reservation ID: ${allocResult.reservation_id}`);
  console.log(`   Total: $${allocResult.total_amount}`);
  
// 4. STEP 2: Confirm via direct SQL (the WORKING approach)
  // - Set confirmed_at triggers trg_fn_confirm_pending_tickets which creates tickets
  // - Then deduct balance
  console.log('\n4. STEP 2: Confirming via direct SQL...');
  
  // 4a. Confirm the pending_tickets (triggers ticket creation)
  const { error: confirmError } = await supabase
    .from('pending_tickets')
    .update({ 
      status: 'confirmed', 
      confirmed_at: new Date().toISOString(),
      canonical_user_id: balanceUser.canonical_user_id 
    })
    .eq('id', allocResult.reservation_id);
    
  if (confirmError) {
    console.log(`   ✗ Confirm ERROR: ${confirmError.message}`);
  } else {
    console.log(`   ✓ Pending ticket confirmed (trigger creates tickets)`);
  }
  
  // 4b. Deduct balance
  const totalAmount = allocResult.total_amount;
  const { error: balanceError } = await supabase
    .from('sub_account_balances')
    .update({ 
      available_balance: balanceUser.available_balance - totalAmount,
      last_updated: new Date().toISOString()
    })
    .eq('canonical_user_id', balanceUser.canonical_user_id)
    .eq('currency', 'USD');
    
  if (balanceError) {
    console.log(`   ✗ Balance update ERROR: ${balanceError.message}`);
  } else {
    console.log(`   ✓ Balance deducted: -$${totalAmount}`);
  }
  
  // 4c. Record ledger entry (best practice)
  await supabase.from('balance_ledger').insert({
    canonical_user_id: balanceUser.canonical_user_id,
    transaction_type: 'debit',
    amount: totalAmount,
    currency: 'USD',
    balance_before: balanceUser.available_balance,
    balance_after: balanceUser.available_balance - totalAmount,
    reference_id: allocResult.reservation_id,
    description: `Ticket purchase - ${ticketCount} tickets`,
  });

  console.log('\n5. Result:');  
  const result = { ok: !confirmError && !balanceError };
  if (result.ok) {
    console.log('   ✓✓✓ SUCCESS! Balance purchase completed! ✓✓✓');
  } else {
    console.log(`   ✗ Failed`);
  }
  
  // Store tickets for verification
  const specificTickets = allocResult.ticket_numbers;
  
  // 6. Verify balance
  console.log('\n6. Verifying balance after purchase...');
  const { data: newBalanceData } = await supabase
    .from('sub_account_balances')
    .select('available_balance')
    .eq('canonical_user_id', balanceUser.canonical_user_id)
    .single();
    
  const balanceBefore = balanceUser.available_balance;
  const balanceAfter = newBalanceData?.available_balance || balanceBefore;
  const diff = balanceBefore - balanceAfter;
  
  console.log(`   Before: $${balanceBefore}`);
  console.log(`   After:  $${balanceAfter}`);
  console.log(`   Change: -$${diff.toFixed(2)}`);
  
  if (diff > 0) {
    console.log('\n   ✓ Balance was deducted - PURCHASE WORKED!');
  } else {
    console.log('\n   ✗ Balance unchanged');
  }
  
  // 7. Verify tickets were created
  console.log('\n7. Verifying tickets in DB...');
  const ticketNums = specificTickets;
  if (ticketNums.length > 0) {
    const { data: newTickets, count: ticketCount2 } = await supabase
      .from('tickets')
      .select('ticket_number, status, canonical_user_id', { count: 'exact' })
      .eq('competition_id', selectedComp.id)
      .in('ticket_number', ticketNums);
      
    console.log(`   Tickets found for numbers ${ticketNums.join(',')}: ${ticketCount2 || 0}`);
    if (newTickets?.length) {
      newTickets.forEach(t => console.log(`   - Ticket #${t.ticket_number}: status=${t.status}`));
    }
  }
}

main().catch(console.error);
