-- =====================================================
-- FIX BALANCE FUNCTIONS TO SUPPORT CANONICAL USER ID
-- =====================================================
-- The get_user_wallet_balance, credit_user_balance, and debit_user_balance
-- functions were not updated to support the canonical prize:pid: format.
--
-- This migration adds canonical_user_id lookup to all balance functions.
--
-- ROOT CAUSE:
-- The migration 20251223150000_migrate_to_canonical_prize_pid.sql added the
-- canonical_user_id column and converted all identifiers to prize:pid: format.
-- However, the balance functions (defined in 20251122000000) only check:
-- - privy_user_id, id, uid, wallet_address, email
--
-- When AuthContext calls get_user_wallet_balance with 'prize:pid:0x...',
-- none of these columns match, so it returns 0.
--
-- FIX:
-- Add canonical_user_id to all balance function lookups.
-- Also add case-insensitive wallet address matching.
-- =====================================================

-- Fix get_user_wallet_balance function
DROP FUNCTION IF EXISTS get_user_wallet_balance(TEXT);

CREATE OR REPLACE FUNCTION get_user_wallet_balance(user_identifier TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  balance NUMERIC;
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  -- e.g., 'prize:pid:0x1234...' -> '0x1234...'
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Get balance from privy_user_connections
  -- Check all possible identifier columns including canonical_user_id
  -- Use case-insensitive matching for wallet addresses
  SELECT COALESCE(usdc_balance, 0) INTO balance
  FROM privy_user_connections
  WHERE
    -- Match by canonical_user_id (primary for new system)
    canonical_user_id = user_identifier
    -- Match by canonical_user_id with lowercase (case-insensitive)
    OR canonical_user_id = LOWER(user_identifier)
    -- Match by wallet address extracted from prize:pid:
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    -- Match by base wallet address
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    -- Legacy matches
    OR privy_user_id = user_identifier
    OR id::text = user_identifier
    OR uid = user_identifier
    OR LOWER(wallet_address) = LOWER(user_identifier)
    OR email = user_identifier
  LIMIT 1;

  -- Return 0 if user not found
  RETURN COALESCE(balance, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_wallet_balance(TEXT) TO service_role;


-- Fix credit_user_balance function
DROP FUNCTION IF EXISTS credit_user_balance(TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION credit_user_balance(
  user_identifier TEXT,
  amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance NUMERIC;
  rows_updated INTEGER;
  search_wallet TEXT;
BEGIN
  IF amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Update balance using all possible identifier columns
  UPDATE privy_user_connections
  SET usdc_balance = usdc_balance + amount,
      updated_at = NOW()
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR privy_user_id = user_identifier
    OR id::text = user_identifier
    OR uid = user_identifier
    OR LOWER(wallet_address) = LOWER(user_identifier)
    OR email = user_identifier
  RETURNING usdc_balance INTO new_balance;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE EXCEPTION 'User not found: %', user_identifier;
  END IF;

  RETURN new_balance;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_user_balance(TEXT, NUMERIC) TO service_role;


-- Fix debit_user_balance function
DROP FUNCTION IF EXISTS debit_user_balance(TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION debit_user_balance(
  user_identifier TEXT,
  amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance NUMERIC;
  new_balance NUMERIC;
  rows_updated INTEGER;
  search_wallet TEXT;
BEGIN
  IF amount <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive';
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Get current balance
  SELECT usdc_balance INTO current_balance
  FROM privy_user_connections
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR privy_user_id = user_identifier
    OR id::text = user_identifier
    OR uid = user_identifier
    OR LOWER(wallet_address) = LOWER(user_identifier)
    OR email = user_identifier
  LIMIT 1;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'User not found: %', user_identifier;
  END IF;

  IF current_balance < amount THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', current_balance, amount;
  END IF;

  -- Update balance
  UPDATE privy_user_connections
  SET usdc_balance = usdc_balance - amount,
      updated_at = NOW()
  WHERE
    canonical_user_id = user_identifier
    OR canonical_user_id = LOWER(user_identifier)
    OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
    OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
    OR privy_user_id = user_identifier
    OR id::text = user_identifier
    OR uid = user_identifier
    OR LOWER(wallet_address) = LOWER(user_identifier)
    OR email = user_identifier
  RETURNING usdc_balance INTO new_balance;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE EXCEPTION 'Failed to update user balance';
  END IF;

  RETURN new_balance;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_user_balance(TEXT, NUMERIC) TO service_role;


-- =====================================================
-- Also fix get_user_active_tickets to support canonical IDs
-- =====================================================
DROP FUNCTION IF EXISTS get_user_active_tickets(TEXT);

CREATE OR REPLACE FUNCTION get_user_active_tickets(user_identifier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket_count INTEGER;
  search_wallet TEXT;
BEGIN
  -- Handle null or empty identifier
  IF user_identifier IS NULL OR user_identifier = '' THEN
    RETURN 0;
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' AND LENGTH(user_identifier) = 42 THEN
    search_wallet := LOWER(user_identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Count tickets from joincompetition for active competitions
  SELECT COALESCE(SUM(numberoftickets), 0)::INTEGER INTO ticket_count
  FROM joincompetition jc
  INNER JOIN competitions c ON jc.competitionid = c.id
  WHERE c.status = 'active'
    AND (
      -- Match by canonical userid (prize:pid: format)
      jc.userid = user_identifier
      OR jc.userid = LOWER(user_identifier)
      -- Match by wallet address (extracted from prize:pid: or direct)
      OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
      -- Match by privy_user_id column
      OR jc.privy_user_id = user_identifier
      -- Legacy wallet address match
      OR LOWER(jc.wallet_address) = LOWER(user_identifier)
    );

  RETURN COALESCE(ticket_count, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_active_tickets(TEXT) TO service_role;
