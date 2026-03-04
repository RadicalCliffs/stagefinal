import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  const userId = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363';
  
  // Get Win 10 ETH competition
  const { data: comps } = await supabase
    .from('competitions')
    .select('id, title, ticket_price')
    .ilike('title', '%ETH%');
  
  console.log('ETH Competitions:', comps?.map(c => c.title));
  
  const comp = comps?.find(c => c.title === 'Win 10 ETH!');
  
  console.log('Competition:', comp);
  
  if (!comp) return;
  
  // Get the entry
  const { data: entry } = await supabase
    .from('competition_entries')
    .select('*')
    .eq('competition_id', comp.id)
    .eq('canonical_user_id', userId)
    .single();
  
  console.log('\nEntry:', entry);
  
  // Get ALL tickets for this competition/user
  const { data: tickets } = await supabase
    .from('tickets')
    .select('id, ticket_number, transaction_hash, purchase_key, purchase_price, purchased_at')
    .eq('competition_id', comp.id)
    .eq('canonical_user_id', userId)
    .order('ticket_number');
  
  console.log(`\nFound ${tickets?.length} tickets`);
  
  // Group by transaction_hash to see the issue
  const groups = {};
  tickets?.forEach(t => {
    const key = t.transaction_hash || 'NULL';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(t);
  });
  
  console.log(`\nGrouped by transaction_hash: ${Object.keys(groups).length} groups\n`);
  
  for (const [hash, tix] of Object.entries(groups)) {
    console.log(`Transaction: ${hash.substring(0, 10)}...`);
    console.log(`  Tickets: ${tix.length}`);
    console.log(`  Ticket numbers: ${tix.map(t => t.ticket_number).slice(0, 5).join(', ')}${tix.length > 5 ? '...' : ''}`);
    console.log(`  Purchase key: ${tix[0].purchase_key || 'NULL'}`);
    console.log(`  Purchase price: $${tix[0].purchase_price}`);
    console.log(`  Purchased at: ${tix[0].purchased_at}`);
    console.log();
  }
  
  // Check if purchase_key would work better
  const pkeyGroups = {};
  tickets?.forEach(t => {
    const key = t.purchase_key || 'NULL';
    if (!pkeyGroups[key]) {
      pkeyGroups[key] = [];
    }
    pkeyGroups[key].push(t);
  });
  
  console.log(`\nGrouped by purchase_key: ${Object.keys(pkeyGroups).length} groups\n`);
  
  for (const [key, tix] of Object.entries(pkeyGroups)) {
    console.log(`Purchase Key: ${key.substring(0, 30)}...`);
    console.log(`  Tickets: ${tix.length}`);
    console.log(`  Ticket numbers: ${tix.map(t => t.ticket_number).slice(0, 5).join(', ')}${tix.length > 5 ? '...' : ''}`);
    console.log();
  }
}

diagnose().catch(console.error);
