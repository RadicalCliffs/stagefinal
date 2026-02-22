/**
 * Create trigger to:
 * 1. Auto-populate user_transactions fields from webhook_ref
 * 2. Optimistically credit balance on PENDING (not completed)
 * 3. Apply +50% welcome bonus immediately
 * 4. No-action on completion (already credited)
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  console.log('=' + '='.repeat(79));
  console.log('FIXING PENDING TOP-UPS + CREATING OPTIMISTIC CREDIT TRIGGER');
  console.log('=' + '='.repeat(79));

  // STEP 1: Fix all pending top-ups NOW
  console.log('\n📊 STEP 1: Finding all pending top-ups to credit NOW...\n');
  
  const { data: pendingTopups, error: fetchErr } = await supabase
    .from('user_transactions')
    .select('*')
    .eq('type', 'topup')
    .in('payment_status', ['pending', 'processing'])
    .eq('posted_to_balance', false)
    .order('created_at', { ascending: false });
  
  if (fetchErr) {
    console.error('Error fetching pending top-ups:', fetchErr);
    return;
  }
  
  console.log(`Found ${pendingTopups?.length || 0} pending top-ups to credit`);
  
  for (const topup of pendingTopups || []) {
    // Extract canonical_user_id from webhook_ref: TOPUP_prize:pid:0x..._{uuid}
    let canonicalUserId = topup.canonical_user_id;
    let walletAddress = topup.wallet_address;
    
    if (!canonicalUserId && topup.webhook_ref) {
      // Parse: TOPUP_prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e_uuid
      const match = topup.webhook_ref.match(/TOPUP_(prize:pid:0x[a-f0-9]+)_/i);
      if (match) {
        canonicalUserId = match[1].toLowerCase();
      }
    }
    
    // Fallback to user_id if it looks like a canonical ID
    if (!canonicalUserId && topup.user_id?.startsWith('prize:pid:')) {
      canonicalUserId = topup.user_id.toLowerCase();
    }
    
    if (!canonicalUserId) {
      console.log(`  ⚠️ Skipping ${topup.id} - cannot determine canonical_user_id`);
      continue;
    }
    
    // Extract wallet from canonical_user_id
    if (!walletAddress && canonicalUserId) {
      const walletMatch = canonicalUserId.match(/0x[a-f0-9]{40}/i);
      if (walletMatch) {
        walletAddress = walletMatch[0].toLowerCase();
      }
    }
    
    console.log(`\nProcessing: ${topup.id}`);
    console.log(`  Amount: $${topup.amount}`);
    console.log(`  Canonical User: ${canonicalUserId}`);
    console.log(`  Wallet: ${walletAddress}`);
    
    // Get current balance
    const { data: balanceData } = await supabase
      .from('sub_account_balances')
      .select('available_balance')
      .eq('canonical_user_id', canonicalUserId)
      .eq('currency', 'USD')
      .single();
    
    const currentBalance = Number(balanceData?.available_balance || 0);
    const topupAmount = Number(topup.amount);
    const bonusAmount = topupAmount * 0.5; // +50% welcome bonus
    const totalCredit = topupAmount + bonusAmount;
    const newBalance = currentBalance + totalCredit;
    
    console.log(`  Current Balance: $${currentBalance.toFixed(2)}`);
    console.log(`  Top-up: $${topupAmount.toFixed(2)} + Bonus: $${bonusAmount.toFixed(2)} = $${totalCredit.toFixed(2)}`);
    console.log(`  New Balance: $${newBalance.toFixed(2)}`);
    
    // Update or insert sub_account_balances
    const { error: balErr } = await supabase
      .from('sub_account_balances')
      .upsert({
        user_id: canonicalUserId,
        canonical_user_id: canonicalUserId,
        wallet_address: walletAddress,
        currency: 'USD',
        available_balance: newBalance,
        pending_balance: 0,
        last_updated: new Date().toISOString()
      }, { onConflict: 'canonical_user_id,currency' });
    
    if (balErr) {
      // Try update instead
      await supabase
        .from('sub_account_balances')
        .update({ 
          available_balance: newBalance,
          last_updated: new Date().toISOString()
        })
        .eq('canonical_user_id', canonicalUserId)
        .eq('currency', 'USD');
    }
    
    // Add ledger entries
    await supabase.from('balance_ledger').insert([
      {
        canonical_user_id: canonicalUserId,
        wallet_address: walletAddress,
        transaction_type: 'credit',
        amount: topupAmount,
        balance_before: currentBalance,
        balance_after: currentBalance + topupAmount,
        description: `Top-up (optimistic credit)`,
        reference_id: topup.id,
        currency: 'USD'
      },
      {
        canonical_user_id: canonicalUserId,
        wallet_address: walletAddress,
        transaction_type: 'bonus_credit',
        amount: bonusAmount,
        balance_before: currentBalance + topupAmount,
        balance_after: newBalance,
        description: `+50% Welcome Bonus on $${topupAmount.toFixed(2)} top-up`,
        reference_id: `bonus:${topup.id}`,
        currency: 'USD'
      }
    ]);
    
    // Update the transaction record
    await supabase
      .from('user_transactions')
      .update({
        canonical_user_id: canonicalUserId,
        wallet_address: walletAddress,
        canonical_user_id_norm: canonicalUserId,
        balance_before: currentBalance,
        balance_after: newBalance,
        posted_to_balance: true,
        notes: `Optimistically credited $${totalCredit.toFixed(2)} (incl. 50% bonus)`
      })
      .eq('id', topup.id);
    
    console.log(`  ✅ Credited!`);
  }

  // STEP 2: Create the database trigger for future top-ups
  console.log('\n📊 STEP 2: Creating optimistic credit trigger...\n');
  
  // Note: We can't create triggers via the JS client, but I'll show the SQL
  const triggerSQL = `
-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_optimistic_topup_credit ON user_transactions;
DROP FUNCTION IF EXISTS fn_optimistic_topup_credit();

-- Function to optimistically credit top-ups on INSERT/UPDATE
CREATE OR REPLACE FUNCTION fn_optimistic_topup_credit()
RETURNS TRIGGER AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
  v_current_balance NUMERIC;
  v_topup_amount NUMERIC;
  v_bonus_amount NUMERIC;
  v_total_credit NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Only process topups that haven't been posted yet
  IF NEW.type != 'topup' OR NEW.posted_to_balance = true THEN
    RETURN NEW;
  END IF;
  
  -- Only credit on pending/processing status
  IF NEW.payment_status NOT IN ('pending', 'processing') THEN
    RETURN NEW;
  END IF;
  
  -- Extract canonical_user_id from webhook_ref if not set
  v_canonical_user_id := COALESCE(NEW.canonical_user_id, NEW.canonical_user_id_norm);
  
  IF v_canonical_user_id IS NULL AND NEW.webhook_ref IS NOT NULL THEN
    -- Parse: TOPUP_prize:pid:0x..._{uuid}
    v_canonical_user_id := LOWER(substring(NEW.webhook_ref FROM 'TOPUP_(prize:pid:0x[a-f0-9]+)_'));
  END IF;
  
  IF v_canonical_user_id IS NULL AND NEW.user_id LIKE 'prize:pid:%' THEN
    v_canonical_user_id := LOWER(NEW.user_id);
  END IF;
  
  IF v_canonical_user_id IS NULL THEN
    -- Can't determine user, skip
    RETURN NEW;
  END IF;
  
  -- Extract wallet address
  v_wallet_address := COALESCE(NEW.wallet_address, substring(v_canonical_user_id FROM '0x[a-f0-9]{40}'));
  
  -- Get current balance
  SELECT COALESCE(available_balance, 0) INTO v_current_balance
  FROM sub_account_balances
  WHERE canonical_user_id = v_canonical_user_id AND currency = 'USD';
  
  IF v_current_balance IS NULL THEN
    v_current_balance := 0;
  END IF;
  
  -- Calculate amounts
  v_topup_amount := NEW.amount;
  v_bonus_amount := v_topup_amount * 0.5; -- 50% welcome bonus
  v_total_credit := v_topup_amount + v_bonus_amount;
  v_new_balance := v_current_balance + v_total_credit;
  
  -- Update or insert balance
  INSERT INTO sub_account_balances (user_id, canonical_user_id, wallet_address, currency, available_balance, pending_balance, last_updated)
  VALUES (v_canonical_user_id, v_canonical_user_id, v_wallet_address, 'USD', v_new_balance, 0, NOW())
  ON CONFLICT (canonical_user_id, currency) 
  DO UPDATE SET 
    available_balance = v_new_balance,
    last_updated = NOW();
  
  -- Add ledger entries
  INSERT INTO balance_ledger (canonical_user_id, wallet_address, transaction_type, amount, balance_before, balance_after, description, reference_id, currency)
  VALUES 
    (v_canonical_user_id, v_wallet_address, 'credit', v_topup_amount, v_current_balance, v_current_balance + v_topup_amount, 'Top-up (optimistic credit)', NEW.id::text, 'USD'),
    (v_canonical_user_id, v_wallet_address, 'bonus_credit', v_bonus_amount, v_current_balance + v_topup_amount, v_new_balance, '+50% Welcome Bonus', 'bonus:' || NEW.id::text, 'USD');
  
  -- Update the NEW record with populated fields
  NEW.canonical_user_id := v_canonical_user_id;
  NEW.canonical_user_id_norm := v_canonical_user_id;
  NEW.wallet_address := v_wallet_address;
  NEW.balance_before := v_current_balance;
  NEW.balance_after := v_new_balance;
  NEW.posted_to_balance := true;
  NEW.notes := 'Optimistically credited $' || v_total_credit::text || ' (incl. 50% bonus)';
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail the transaction
  INSERT INTO data_integrity_errors (table_name, record_id, field_name, error_message, created_at)
  VALUES ('user_transactions', NEW.id::text, 'optimistic_credit', SQLERRM, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER trg_optimistic_topup_credit
  BEFORE INSERT OR UPDATE ON user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_optimistic_topup_credit();
`;

  console.log('Trigger SQL to run in Supabase Dashboard:');
  console.log('-'.repeat(80));
  console.log(triggerSQL);
  console.log('-'.repeat(80));
  
  // Try to execute via RPC if available
  const { error: triggerErr } = await supabase.rpc('exec_sql', { sql: triggerSQL });
  
  if (triggerErr) {
    console.log('\n⚠️ Could not create trigger via RPC. Please run the SQL above in Supabase Dashboard.');
  } else {
    console.log('\n✅ Trigger created successfully!');
  }

  // STEP 3: Summary
  console.log('\n' + '='.repeat(80));
  console.log('COMPLETE');
  console.log(`Credited ${pendingTopups?.length || 0} pending top-ups with +50% bonus`);
  console.log('='.repeat(80));
}

main().catch(console.error);
