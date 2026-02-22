-- Optimistic Top-up Credit Trigger
-- Auto-credits balance on PENDING status (not waiting for completion)
-- Applies +50% welcome bonus
-- Run this in Supabase Dashboard SQL Editor

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
