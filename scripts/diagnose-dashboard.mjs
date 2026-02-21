import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  'https://mthwfldcjvpxjtmrqkqm.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function diagnose() {
  const userId = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';
  const wallet = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';
  const competitionId = 'bbbb5077-3e4c-4371-9ec5-c4963d33330d';
  
  console.log('=== DIAGNOSTIC: Recent purchases for user ===');
  console.log('Canonical User ID:', userId);
  console.log('Wallet:', wallet);
  console.log('Competition:', competitionId);
  
  // 1. Check pending_tickets
  console.log('\n--- 1. pending_tickets (last 5) ---');
  const { data: pending, error: e1 } = await supabase
    .from('pending_tickets')
    .select('id, competition_id, ticket_numbers, status, confirmed_at, canonical_user_id, wallet_address, created_at')
    .or(`user_id.eq.${userId},canonical_user_id.eq.${userId},wallet_address.ilike.${wallet}`)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (e1) console.log('Error:', e1.message);
  else pending?.forEach(p => console.log(JSON.stringify(p, null, 2)));
  
  // 2. Check tickets table
  console.log('\n--- 2. tickets table (last 5) ---');
  const { data: tickets, error: e2 } = await supabase
    .from('tickets')
    .select('id, competition_id, ticket_number, canonical_user_id, wallet_address, status, purchased_at')
    .or(`canonical_user_id.eq.${userId},wallet_address.ilike.${wallet},user_id.ilike.${wallet}`)
    .order('purchased_at', { ascending: false })
    .limit(5);
  
  if (e2) console.log('Error:', e2.message);
  else if (tickets?.length === 0) console.log('NO TICKETS FOUND!');
  else tickets?.forEach(t => console.log(JSON.stringify(t, null, 2)));
  
  // 3. Check tickets for this specific competition
  console.log('\n--- 3. All tickets for competition', competitionId, '(last 10) ---');
  const { data: compTickets, error: e3 } = await supabase
    .from('tickets')
    .select('id, ticket_number, canonical_user_id, wallet_address, status, purchased_at')
    .eq('competition_id', competitionId)
    .order('purchased_at', { ascending: false })
    .limit(10);
  
  if (e3) console.log('Error:', e3.message);
  else {
    console.log('Recent tickets in competition:', compTickets?.length || 0);
    compTickets?.forEach(t => console.log(JSON.stringify(t, null, 2)));
  }
  
  // 4. Test the dashboard RPC
  console.log('\n--- 4. Dashboard RPC result ---');
  const { data: dashboard, error: e4 } = await supabase.rpc('get_comprehensive_user_dashboard_entries', {
    p_user_identifier: userId
  });
  
  if (e4) console.log('RPC Error:', e4.message);
  else {
    console.log('Dashboard entries found:', dashboard?.length || 0);
    dashboard?.slice(0, 3).forEach(d => console.log(JSON.stringify(d, null, 2)));
  }
  
  // 5. Check if trigger is working - look at most recent confirmed pending_tickets
  console.log('\n--- 5. Most recent CONFIRMED pending_tickets ---');
  const { data: confirmed, error: e5 } = await supabase
    .from('pending_tickets')
    .select('id, competition_id, ticket_numbers, status, confirmed_at, canonical_user_id, wallet_address')
    .eq('status', 'confirmed')
    .order('confirmed_at', { ascending: false })
    .limit(3);
  
  if (e5) console.log('Error:', e5.message);
  else confirmed?.forEach(c => console.log(JSON.stringify(c, null, 2)));
  
  process.exit(0);
}

diagnose().catch(console.error);
