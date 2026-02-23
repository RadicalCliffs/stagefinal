-- ============================================================================
-- CRITICAL FIX: DISABLE ALL COMPETING BALANCE CREDIT TRIGGERS
-- ============================================================================
-- PROBLEM: Multiple triggers + webhook code ALL credit balances on topups
-- RESULT: Yammy deposited $3, got credited $6 (or more)
--
-- COMPETING TRIGGERS:
-- 1. trg_user_tx_commerce_post → commerce_post_to_balance() 
-- 2. trg_apply_topup_and_welcome_bonus → apply_topup_and_welcome_bonus()
-- 3. trg_optimistic_topup_credit → fn_optimistic_topup_credit()
-- 4. trg_credit_sub_account_on_instant_wallet_topup → fn_credit_sub_account_on_instant_wallet_topup()
-- 5. trg_auto_credit_on_external_topup → auto_credit_on_external_topup()
--
-- SOLUTION: Disable ALL trigger-based crediting. Let ONLY the webhook code
-- (commerce-webhook/index.ts, instant-topup.mts) handle balance credits 
-- via credit_balance_with_first_deposit_bonus() which has idempotency.
--
-- Run this in Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: DISABLE ALL BALANCE-CREDITING TRIGGERS
-- ============================================================================

-- Drop the commerce post trigger
DROP TRIGGER IF EXISTS trg_user_tx_commerce_post ON user_transactions;

-- Drop the apply topup and bonus trigger  
DROP TRIGGER IF EXISTS trg_apply_topup_and_welcome_bonus ON user_transactions;

-- Drop the optimistic topup credit trigger
DROP TRIGGER IF EXISTS trg_optimistic_topup_credit ON user_transactions;

-- Drop the instant wallet topup trigger
DROP TRIGGER IF EXISTS trg_credit_sub_account_on_instant_wallet_topup ON user_transactions;

-- Drop the auto credit external topup trigger
DROP TRIGGER IF EXISTS trg_auto_credit_on_external_topup ON user_transactions;

-- Drop any other potential topup credit triggers
DROP TRIGGER IF EXISTS trg_user_transactions_post_to_wallet ON user_transactions;
DROP TRIGGER IF EXISTS trg_complete_topup_on_webhook_ref_ins ON user_transactions;
DROP TRIGGER IF EXISTS trg_complete_topup_on_webhook_ref_upd ON user_transactions;

RAISE NOTICE 'Dropped all balance-crediting triggers on user_transactions';

-- ============================================================================
-- STEP 2: CREATE A SIMPLE NOOP TRIGGER TO PREVENT FUTURE RECREATION
-- This acts as a marker that credit triggers should not be recreated
-- ============================================================================

CREATE OR REPLACE FUNCTION public.topup_credit_disabled_notice()
RETURNS TRIGGER AS $$
BEGIN
  -- INTENTIONALLY DOES NOTHING 
  -- Balance credits are handled by webhook code only:
  -- - commerce-webhook/index.ts calls credit_balance_with_first_deposit_bonus()
  -- - instant-topup.mts calls credit_balance_with_first_deposit_bonus()
  -- 
  -- DO NOT RECREATE OLD CREDIT TRIGGERS - THEY CAUSE DOUBLE CREDITING
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.topup_credit_disabled_notice() IS 
  'NOOP trigger. Balance credits handled by webhook code only. DO NOT recreate old credit triggers.';

-- ============================================================================
-- STEP 3: VERIFY ALL CREDIT TRIGGERS ARE GONE
-- ============================================================================

DO $$
DECLARE
  trigger_count INT;
  trigger_names TEXT;
BEGIN
  SELECT COUNT(*), string_agg(trigger_name, ', ')
  INTO trigger_count, trigger_names
  FROM information_schema.triggers
  WHERE event_object_table = 'user_transactions'
    AND trigger_name ILIKE '%credit%'
    OR trigger_name ILIKE '%topup%'
    OR trigger_name ILIKE '%bonus%'
    OR trigger_name ILIKE '%commerce_post%';
    
  IF trigger_count > 0 THEN
    RAISE WARNING 'Found % potential credit triggers still active: %', trigger_count, trigger_names;
  ELSE
    RAISE NOTICE 'SUCCESS: No credit triggers remain on user_transactions';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: List remaining triggers for verification
-- ============================================================================

SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'user_transactions'
ORDER BY trigger_name;

COMMIT;

-- ============================================================================
-- VERIFICATION: After running, verify that only expected triggers remain
-- The webhook code (commerce-webhook, instant-topup) now handles ALL balance 
-- crediting with proper idempotency via credit_balance_with_first_deposit_bonus()
-- ============================================================================
