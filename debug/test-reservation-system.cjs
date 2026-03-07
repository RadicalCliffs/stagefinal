const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY';

const supabase = createClient(supabaseUrl, serviceKey);

async function testReservation() {
  try {
    console.log('Testing lucky dip reservation system...\n');
    
    const competitionId = '98ea9cbc-5d9b-409b-b757-acb9d0292a95';
    const canonicalUserId = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';
    const walletAddress = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';
    
    console.log('Test 1: Allocate 5 lucky dip tickets...');
    const { data: allocation, error: allocError } = await supabase.rpc('allocate_lucky_dip_tickets_batch', {
      p_user_id: canonicalUserId,
      p_competition_id: competitionId,
      p_count: 5,
      p_ticket_price: 0.50
    });
    
    if (allocError) {
      console.error('❌ Allocation failed:', JSON.stringify(allocError, null, 2));
      return;
    }
    
    console.log('✅ Allocation succeeded!');
    console.log('  Data:', JSON.stringify(allocation, null, 2));
    
    console.log('\nTest 2: Reserve 3 lucky dip tickets...');
    const { data: reservation, error: reserveError } = await supabase.rpc('reserve_lucky_dip', {
      p_canonical_user_id: canonicalUserId,
      p_wallet_address: walletAddress,
      p_competition_id: competitionId,
      p_ticket_count: 3,
      p_hold_minutes: 15
    });
    
    if (reserveError) {
      console.error('❌ Reservation failed:', JSON.stringify(reserveError, null, 2));
      return;
    }
    
    console.log('✅ Reservation succeeded!');
    console.log('  Result:', JSON.stringify(reservation, null, 2));
    
    console.log('\nTest 3: Get unavailable tickets...');
    const { data: unavailable, error: unavailError } = await supabase.rpc('get_unavailable_tickets', {
      competition_id: competitionId
    });
    
    if (unavailError) {
      console.error('❌ Get unavailable failed:', JSON.stringify(unavailError, null, 2));
      return;
    }
    
    console.log('✅ Get unavailable tickets succeeded!');
    console.log('  Total unavailable:', unavailable.length);
    console.log('  First 10:', unavailable.slice(0, 10));
    
    console.log('\n✅ ALL TESTS PASSED! Reservation system is working correctly.');
  } catch (err) {
    console.error('Exception:', err.message);
    console.error('Stack:', err.stack);
  }
}

testReservation().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
