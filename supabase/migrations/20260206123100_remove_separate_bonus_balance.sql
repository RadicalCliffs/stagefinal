-- Migration: Remove bonus_balance from being tracked separately
-- Date: 2026-02-06
-- Issue: bonus_balance should not exist as a separate field - it's all one balance
-- The 50% first deposit bonus just adds to the regular balance
-- Fix: get_user_balance should only return the single balance number

BEGIN;

-- Update get_user_balance to return only one balance (no separate bonus_balance)
DROP FUNCTION IF EXISTS get_user_balance(TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION get_user_balance(p_user_identifier TEXT DEFAULT NULL, p_canonical_user_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_balance NUMERIC := 0;
  search_wallet TEXT;
  identifier TEXT;
BEGIN
  -- Use whichever parameter was provided
  identifier := COALESCE(p_user_identifier, p_canonical_user_id);
  
  IF identifier IS NULL OR identifier = '' THEN
    RETURN jsonb_build_object(
      'success', true,
      'balance', 0,
      'bonus_balance', 0,  -- Keep for backward compatibility but always 0
      'total_balance', 0
    );
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(identifier FROM 11));
  ELSIF identifier LIKE '0x%' AND LENGTH(identifier) = 42 THEN
    search_wallet := LOWER(identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Try sub_account_balances first (newest balance system)
  -- ONLY get available_balance - ignore bonus_balance column
  BEGIN
    SELECT 
      COALESCE(available_balance, 0)
    INTO user_balance
    FROM public.sub_account_balances
    WHERE currency = 'USD'
      AND (
        canonical_user_id = identifier
        OR canonical_user_id = LOWER(identifier)
        OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
        OR user_id = identifier
        OR privy_user_id = identifier
      )
    ORDER BY available_balance DESC NULLS LAST
    LIMIT 1;

    IF user_balance IS NOT NULL AND user_balance > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'balance', user_balance,
        'bonus_balance', 0,  -- Keep for backward compatibility but always 0
        'total_balance', user_balance  -- Total is same as balance
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Fallback to canonical_users
  -- ONLY get usdc_balance - ignore bonus_balance column
  BEGIN
    SELECT 
      COALESCE(usdc_balance, 0)
    INTO user_balance
    FROM public.canonical_users
    WHERE
      canonical_user_id = identifier
      OR canonical_user_id = LOWER(identifier)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
      OR LOWER(wallet_address) = LOWER(identifier)
      OR privy_user_id = identifier
    ORDER BY usdc_balance DESC NULLS LAST
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    user_balance := 0;
  END;

  -- Return single balance
  -- bonus_balance is kept in response for backward compatibility but always 0
  -- The 50% first deposit bonus is already added to the main balance
  RETURN jsonb_build_object(
    'success', true,
    'balance', COALESCE(user_balance, 0),
    'bonus_balance', 0,  -- Always 0 - bonus is in main balance
    'total_balance', COALESCE(user_balance, 0)  -- Total equals balance
  );
END;
$$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: Removed separate bonus_balance tracking';
  RAISE NOTICE '- get_user_balance now returns only one balance number';
  RAISE NOTICE '- bonus_balance field kept in response for compatibility but always 0';
  RAISE NOTICE '- 50%% first deposit bonus is added directly to available_balance';
  RAISE NOTICE '- There is only ONE internal wallet balance';
END $$;
