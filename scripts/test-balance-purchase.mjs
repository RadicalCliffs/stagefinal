// Test script to prove purchase_tickets_with_balance RPC works
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY environment variable');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('=== Testing purchase_tickets_with_balance RPC ===\n');
  
  // 1. Find active competitions - skip the first one (might be corrupted)
  console.log('1. Finding a clean active competition (skipping first)...');
  const { data: comps, error: compError } = await supabase
    .from('competitions')
    .select('id, title, ticket_price, total_tickets, sold_tickets, tickets_sold')
    .eq('status', 'active')
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (compError || !comps?.length) {
    console.error('No competitions found:', compError?.message);
    process.exit(1);
  }
  
  // Try to find one with truly 0 tickets
  let comp = null;
  for (const c of comps) {
    const { count } = await supabase
      .from('tickets')
      .select('ticket_number', { count: 'exact', head: true })
      .eq('competition_id', c.id);
    console.log(`   ${c.title}: DB has ${count || 0} tickets, sold_tickets=${c.sold_tickets || 0}`);
    if ((count || 0) === 0 && comp === null) {
      comp = c;
    }
  }
  
  if (!comp) {
    console.log('   All competitions have tickets - using second one');
    comp = comps[1] || comps[0];
  }
  
  console.log(`\n   Selected: ${comp.title} (ID: ${comp.id})`);
  console.log(`   Price: $${comp.ticket_price}, Sold: ${comp.sold_tickets || 0}/${comp.total_tickets}`);
    process.exit(1);
  }
  console.log(`   Found: ${comp.title} (ID: ${comp.id})`);
  console.log(`   Price: $${comp.ticket_price}, Sold: ${comp.sold_tickets || comp.tickets_sold || 0}/${comp.total_tickets}`);
  
  // Direct search for this competition's tickets
  const { data: directTickets, error: directErr } = await supabase
    .from('tickets')
    .select('ticket_number, competition_id')
    .filter('competition_id', 'eq', comp.id)
    .limit(10);
  console.log(`   Direct query tickets: ${directTickets?.length || 0}`);
  if (directErr) console.log(`   Direct query error: ${directErr.message}`);
  
  // Try raw rpc to check
  const { data: rpcCheck } = await supabase.rpc('get_unavailable_tickets', {
    p_competition_id: comp.id,
    p_total_tickets: comp.total_tickets
  }).maybeSingle();
  if (rpcCheck) {
    console.log(`   Unavailable tickets from RPC:`, rpcCheck?.unavailable_tickets?.slice(0, 10));
  }
  
  // 2. Find a user with balance
  console.log('\n2. Finding a user with balance...');
  const { data: balanceUser, error: balanceError } = await supabase
    .from('sub_account_balances')
    .select('canonical_user_id, available_balance')
    .gt('available_balance', comp.ticket_price)
    .limit(1)
    .single();
    
  let userToUse = balanceUser;
  if (balanceError || !balanceUser) {
    console.error('No user with sufficient balance found:', balanceError?.message);
    console.log('\n   Creating test balance for demo user...');
    
    // Use a test canonical user id
    const testUserId = 'prize:pid:test-balance-user-' + Date.now();
    const { error: insertError } = await supabase
      .from('sub_account_balances')
      .upsert({
        canonical_user_id: testUserId,
        available_balance: 100.00,
        currency: 'USD',
        updated_at: new Date().toISOString()
      });
    
    if (insertError) {
      console.error('Failed to create test balance:', insertError.message);
      process.exit(1);
    }
    
    userToUse = { canonical_user_id: testUserId, available_balance: 100.00 };
  }
  
  console.log(`   User: ${userToUse.canonical_user_id}`);
  console.log(`   Balance: $${userToUse.available_balance}`);
  
  // 3. Allocate tickets via allocate_lucky_dip_tickets_batch
  console.log('\n3. Allocating tickets via allocate_lucky_dip_tickets_batch...');
  const ticketCount = 3;
  
  const { data: allocResult, error: allocError } = await supabase.rpc('allocate_lucky_dip_tickets_batch', {
    p_user_id: userToUse.canonical_user_id,  // Uses p_user_id not p_user_canonical_id
    p_competition_id: comp.id,
    p_count: ticketCount,
    p_ticket_price: comp.ticket_price,
    p_hold_minutes: 15,
    p_session_id: `test-session-${Date.now()}`,
    p_excluded_tickets: null,
  });
  
  if (allocError) {
    console.log(`   ✗ Allocation ERROR: ${allocError.message}`);
    if (allocError.hint) console.log(`   Hint: ${allocError.hint}`);
    process.exit(1);
  }
  
  console.log(`   Allocation result:`, JSON.stringify(allocResult, null, 2));
  
  if (!allocResult?.success) {
    console.log(`   Allocation returned success=false: ${allocResult?.error}`);
    process.exit(1);
  }
  
  const reservationId = allocResult.reservation_id;
  const ticketNumbers = allocResult.ticket_numbers;
  console.log(`   Got reservation: ${reservationId}`);
  console.log(`   Got tickets: ${JSON.stringify(ticketNumbers)}`);
  
  // 4. Now call confirm_ticket_purchase (deducts balance and creates tickets)
  console.log('\n4. Calling confirm_ticket_purchase RPC...');
  
  console.log(`   Parameters:`);
  console.log(`     p_pending_ticket_id: ${reservationId}`);
  console.log(`     p_payment_provider: balance`);
  
  const { data: result, error: rpcError } = await supabase.rpc('confirm_ticket_purchase', {
    p_pending_ticket_id: reservationId,
    p_payment_provider: 'balance',
  });
  
  console.log('\n5. Result:');
  if (rpcError) {
    console.log(`   ✗ ERROR: ${rpcError.message}`);
    if (rpcError.details) console.log(`   Details: ${rpcError.details}`);
    if (rpcError.hint) console.log(`   Hint: ${rpcError.hint}`);
    if (rpcError.code) console.log(`   Code: ${rpcError.code}`);
  } else {
    console.log(`   ✓ SUCCESS!`);
    console.log(`   Response:`, JSON.stringify(result, null, 2));
  }
  
  // 6. Verify balance was deducted
  console.log('\n6. Verifying balance after purchase...');
  const { data: newBalance } = await supabase
    .from('sub_account_balances')
    .select('available_balance')
    .eq('canonical_user_id', userToUse.canonical_user_id)
    .single();
    
  if (newBalance) {
    const expectedDeduction = comp.ticket_price * ticketCount;
    console.log(`   Previous balance: $${userToUse.available_balance}`);
    console.log(`   New balance: $${newBalance.available_balance}`);
    console.log(`   Expected deduction: $${expectedDeduction}`);
  }
}

main().catch(console.error);
