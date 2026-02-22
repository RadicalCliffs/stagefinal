/**
 * Credit +50% welcome bonus for all top-ups in the last hour
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  console.log('=' + '='.repeat(79));
  console.log('+50% WELCOME BONUS CREDIT FOR LAST HOUR TOP-UPS');
  console.log('=' + '='.repeat(79));

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  // 1. Find all completed top-ups in the last hour
  console.log('\n📊 1. Finding completed top-ups from last hour...\n');
  
  const { data: topups, error: topupErr } = await supabase
    .from('user_transactions')
    .select('id, canonical_user_id, amount, created_at, metadata')
    .eq('type', 'topup')
    .eq('status', 'completed')
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false });
  
  if (topupErr) {
    console.error('Error fetching top-ups:', topupErr);
    return;
  }
  
  console.log(`Found ${topups?.length || 0} completed top-ups in the last hour`);
  
  if (!topups || topups.length === 0) {
    console.log('No top-ups to process.');
    return;
  }

  // 2. Check which ones already have a bonus credit
  console.log('\n📊 2. Checking for existing bonus credits...\n');
  
  const { data: existingBonuses } = await supabase
    .from('balance_ledger')
    .select('reference_id')
    .eq('transaction_type', 'bonus_credit')
    .gte('created_at', oneHourAgo);
  
  const existingRefs = new Set((existingBonuses || []).map(b => b.reference_id));
  
  // Filter out top-ups that already have bonus
  const topupsNeedingBonus = topups.filter(t => !existingRefs.has(`bonus:${t.id}`));
  
  console.log(`${topups.length - topupsNeedingBonus.length} already have bonus credits`);
  console.log(`${topupsNeedingBonus.length} need bonus credits`);
  
  if (topupsNeedingBonus.length === 0) {
    console.log('All top-ups already have bonuses!');
    return;
  }

  // 3. Credit +50% bonus for each
  console.log('\n📊 3. Crediting +50% welcome bonus...\n');
  
  for (const topup of topupsNeedingBonus) {
    const bonusAmount = Number(topup.amount) * 0.5;
    const canonicalUserId = topup.canonical_user_id;
    
    console.log(`Processing: ${canonicalUserId?.substring(0, 40)}...`);
    console.log(`  Top-up amount: $${topup.amount}`);
    console.log(`  Bonus amount: $${bonusAmount.toFixed(2)}`);
    
    // Get current balance
    const { data: currentBalance } = await supabase
      .from('sub_account_balances')
      .select('available_balance')
      .eq('canonical_user_id', canonicalUserId)
      .eq('currency', 'USD')
      .single();
    
    const currentBal = Number(currentBalance?.available_balance || 0);
    const newBalance = currentBal + bonusAmount;
    
    // Update balance
    const { error: updateErr } = await supabase
      .from('sub_account_balances')
      .update({ 
        available_balance: newBalance,
        last_updated: new Date().toISOString()
      })
      .eq('canonical_user_id', canonicalUserId)
      .eq('currency', 'USD');
    
    if (updateErr) {
      console.error(`  ❌ Error updating balance:`, updateErr);
      continue;
    }
    
    // Add ledger entry
    const { error: ledgerErr } = await supabase
      .from('balance_ledger')
      .insert({
        canonical_user_id: canonicalUserId,
        transaction_type: 'bonus_credit',
        amount: bonusAmount,
        balance_before: currentBal,
        balance_after: newBalance,
        description: `+50% Welcome Bonus on $${topup.amount} top-up`,
        reference_id: `bonus:${topup.id}`,
        currency: 'USD'
      });
    
    if (ledgerErr) {
      console.error(`  ⚠️ Ledger entry failed:`, ledgerErr);
    }
    
    console.log(`  ✅ Balance: $${currentBal.toFixed(2)} → $${newBalance.toFixed(2)}`);
  }

  // 4. Summary
  console.log('\n' + '='.repeat(80));
  console.log('BONUS CREDITS COMPLETE');
  console.log(`Credited ${topupsNeedingBonus.length} accounts with +50% welcome bonus`);
  console.log('='.repeat(80));
}

main().catch(console.error);
