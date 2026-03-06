-- ============================================================================
-- TOP-UP DASHBOARD FIX - Copy-paste this entire file into Supabase SQL Editor
-- ============================================================================
-- What this fixes:
-- 1. Creates missing balance records for new users
-- 2. Marks "stuck" topups as posted (if balance already credited)
-- 3. Fills in missing fields so topups show in dashboard
-- 4. Creates trigger so new users auto-initialize
-- ============================================================================
-- SAFE: Doesn't modify any balances, just fixes tracking fields
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Initialize missing balance records
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'STEP 1: Creating missing balance records...';
  
  WITH new_records AS (
    INSERT INTO sub_account_balances (
      canonical_user_id,
      canonical_user_id_norm,
      user_id,
      privy_user_id,
      wallet_address,
      currency,
      available_balance,
      pending_balance,
      bonus_balance,
      last_updated
    )
    SELECT 
      cu.canonical_user_id,
      LOWER(cu.canonical_user_id),
      cu.canonical_user_id,
      cu.privy_user_id,
      cu.wallet_address,
      'USD',
      COALESCE(cu.available_balance, 0),
      0,
      0,
      NOW()
    FROM canonical_users cu
    WHERE NOT EXISTS (
      SELECT 1 FROM sub_account_balances sab 
      WHERE sab.canonical_user_id = cu.canonical_user_id 
        AND sab.currency = 'USD'
    )
    ON CONFLICT (canonical_user_id, currency) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM new_records;
  
  RAISE NOTICE '✅ Created % new balance records', v_count;
END $$;

-- ============================================================================
-- STEP 2: Fix "stuck" topup flags
-- ============================================================================

DO $$
DECLARE
  v_stuck RECORD;
  v_marked INTEGER := 0;
  v_truly_stuck INTEGER := 0;
  v_ref TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'STEP 2: Fixing topup flags...';
  
  FOR v_stuck IN
    SELECT 
      id, canonical_user_id, amount, webhook_ref, tx_id, charge_id
    FROM user_transactions
    WHERE type = 'topup'
      AND (status = 'completed' OR payment_status = 'completed')
      AND (posted_to_balance IS NULL OR posted_to_balance = false)
      AND amount > 0
      AND canonical_user_id IS NOT NULL
  LOOP
    v_ref := COALESCE(v_stuck.webhook_ref, v_stuck.tx_id, v_stuck.charge_id, v_stuck.id::text);
    
    IF EXISTS (
      SELECT 1 FROM balance_ledger 
      WHERE canonical_user_id = v_stuck.canonical_user_id
        AND (
          reference_id = v_ref
          OR reference_id = v_stuck.webhook_ref
          OR reference_id = v_stuck.tx_id
          OR reference_id = v_stuck.charge_id
          OR reference_id = v_stuck.id::text
        )
    ) THEN
      UPDATE user_transactions
      SET posted_to_balance = true
      WHERE id = v_stuck.id;
      v_marked := v_marked + 1;
    ELSE
      v_truly_stuck := v_truly_stuck + 1;
      RAISE WARNING '🚨 Truly stuck: % - $% (needs manual review)', v_stuck.id, v_stuck.amount;
    END IF;
  END LOOP;
  
  RAISE NOTICE '✅ Marked % topups as posted', v_marked;
  IF v_truly_stuck > 0 THEN
    RAISE WARNING '⚠️  Found % truly stuck topups (needs manual investigation)', v_truly_stuck;
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Fix missing dashboard fields
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'STEP 3: Fixing dashboard visibility...';
  
  -- Fix missing canonical_user_id
  WITH fixed AS (
    UPDATE user_transactions
    SET 
      canonical_user_id = regexp_replace(webhook_ref, '^TOPUP_(prize:pid:0x[a-f0-9]+)_.*$', '\1'),
      type = 'topup'
    WHERE type = 'topup'
      AND canonical_user_id IS NULL
      AND webhook_ref LIKE 'TOPUP_prize:pid:%'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM fixed;
  RAISE NOTICE '✅ Fixed % missing canonical_user_id', v_count;
  
  -- Fix missing completed_at
  UPDATE user_transactions
  SET completed_at = COALESCE(completed_at, updated_at, created_at)
  WHERE type = 'topup'
    AND (status = 'completed' OR payment_status = 'completed')
    AND completed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '✅ Fixed % missing completed_at', v_count;
  
  -- Fix missing type
  UPDATE user_transactions
  SET type = 'topup'
  WHERE (type IS NULL OR type = '')
    AND competition_id IS NULL
    AND amount > 0
    AND (webhook_ref LIKE 'TOPUP_%' OR payment_provider IN ('coinbase_commerce', 'cdp_commerce'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '✅ Fixed % missing type', v_count;
  
  -- Fix missing wallet_address
  WITH fixed AS (
    UPDATE user_transactions
    SET wallet_address = regexp_replace(canonical_user_id, '^prize:pid:', '')
    WHERE type = 'topup'
      AND wallet_address IS NULL
      AND canonical_user_id LIKE 'prize:pid:0x%'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM fixed;
  RAISE NOTICE '✅ Fixed % missing wallet_address', v_count;
END $$;

-- ============================================================================
-- STEP 4: Create auto-initialization trigger
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'STEP 4: Creating auto-initialization trigger...';
END $$;

DROP TRIGGER IF EXISTS trg_auto_init_user_balance ON canonical_users;
DROP FUNCTION IF EXISTS fn_auto_init_user_balance();

CREATE OR REPLACE FUNCTION fn_auto_init_user_balance()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO sub_account_balances (
    canonical_user_id,
    canonical_user_id_norm,
    user_id,
    privy_user_id,
    wallet_address,
    currency,
    available_balance,
    pending_balance,
    bonus_balance,
    last_updated
  ) VALUES (
    NEW.canonical_user_id,
    LOWER(NEW.canonical_user_id),
    NEW.canonical_user_id,
    NEW.privy_user_id,
    NEW.wallet_address,
    'USD',
    0,
    0,
    0,
    NOW()
  )
  ON CONFLICT (canonical_user_id, currency) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_init_user_balance
  AFTER INSERT ON canonical_users
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_init_user_balance();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_no_balance INTEGER;
  v_still_stuck INTEGER;
  v_negative INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== VERIFICATION ===';
  
  SELECT COUNT(DISTINCT cu.canonical_user_id)
  INTO v_no_balance
  FROM canonical_users cu
  WHERE NOT EXISTS (
    SELECT 1 FROM sub_account_balances sab 
    WHERE sab.canonical_user_id = cu.canonical_user_id 
      AND sab.currency = 'USD'
  );
  
  SELECT COUNT(*)
  INTO v_still_stuck
  FROM user_transactions
  WHERE type = 'topup'
    AND (status = 'completed' OR payment_status = 'completed')
    AND (posted_to_balance IS NULL OR posted_to_balance = false);
  
  SELECT COUNT(*)
  INTO v_negative
  FROM sub_account_balances
  WHERE available_balance < 0;
  
  RAISE NOTICE 'Users without balance records: %', v_no_balance;
  RAISE NOTICE 'Topups still flagged as not posted: %', v_still_stuck;
  RAISE NOTICE 'Negative balances: %', v_negative;
  
  IF v_negative > 0 THEN
    RAISE WARNING '🚨 NEGATIVE BALANCES DETECTED - DO NOT COMMIT!';
  ELSIF v_no_balance = 0 AND v_still_stuck <= 5 THEN
    RAISE NOTICE '';
    RAISE NOTICE '✅✅✅ SUCCESS! ✅✅✅';
    RAISE NOTICE 'Top-ups should now appear in dashboard';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  Some issues remain (check details above)';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- DONE! 
-- After running this, deploy the updated webhook:
-- npx supabase functions deploy commerce-webhook
-- ============================================================================
