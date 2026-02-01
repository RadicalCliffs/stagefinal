-- ============================================================================
-- Test Script: Temporary User Placeholder Flow
-- ============================================================================
-- Tests the email-first auth flow with temporary placeholders
-- ============================================================================

BEGIN;

-- Clean up any test data
DELETE FROM canonical_users WHERE uid LIKE 'test_%' OR canonical_user_id LIKE '%test%';

-- ============================================================================
-- TEST 1: Allocate temporary placeholder
-- ============================================================================
DO $$
DECLARE
  v_result JSONB;
  v_uid TEXT;
  v_canonical_user_id TEXT;
BEGIN
  RAISE NOTICE '=== TEST 1: Allocate temporary placeholder ===';
  
  -- Allocate temp user
  SELECT allocate_temp_canonical_user() INTO v_result;
  v_uid := v_result->>'uid';
  v_canonical_user_id := v_result->>'canonical_user_id';
  
  RAISE NOTICE 'Allocated: uid=%, canonical_user_id=%', v_uid, v_canonical_user_id;
  
  -- Verify format
  IF v_canonical_user_id NOT LIKE 'prize:pid:temp%' THEN
    RAISE EXCEPTION 'FAILED: canonical_user_id does not match temp format: %', v_canonical_user_id;
  END IF;
  
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FAILED: uid is NULL';
  END IF;
  
  RAISE NOTICE 'PASSED: Placeholder allocation works correctly';
END $$;

-- ============================================================================
-- TEST 2: Create user with temporary placeholder
-- ============================================================================
DO $$
DECLARE
  v_alloc JSONB;
  v_uid TEXT;
  v_canonical_user_id TEXT;
  v_result JSONB;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 2: Create user with temporary placeholder ===';
  
  -- Allocate temp user
  SELECT allocate_temp_canonical_user() INTO v_alloc;
  v_uid := v_alloc->>'uid';
  v_canonical_user_id := v_alloc->>'canonical_user_id';
  
  -- Create user with placeholder
  SELECT upsert_canonical_user(
    p_uid := v_uid,
    p_canonical_user_id := v_canonical_user_id,
    p_email := 'test@example.com',
    p_username := 'testuser',
    p_first_name := 'Test',
    p_last_name := 'User'
  ) INTO v_result;
  
  RAISE NOTICE 'User created: %', v_result;
  
  -- Verify user exists with placeholder
  PERFORM 1 FROM canonical_users 
  WHERE uid = v_uid 
    AND canonical_user_id = v_canonical_user_id
    AND email = 'test@example.com';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAILED: User not created with placeholder ID';
  END IF;
  
  RAISE NOTICE 'PASSED: User created with temporary placeholder';
END $$;

-- ============================================================================
-- TEST 3: Replace placeholder with wallet-based canonical_user_id
-- ============================================================================
DO $$
DECLARE
  v_alloc JSONB;
  v_uid TEXT;
  v_canonical_user_id TEXT;
  v_wallet TEXT := '0xabcdef1234567890abcdef1234567890abcdef12';
  v_final_canonical_id TEXT := 'prize:pid:0xabcdef1234567890abcdef1234567890abcdef12';
  v_result JSONB;
  v_stored_canonical_id TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 3: Replace placeholder with wallet ID ===';
  
  -- Allocate and create temp user
  SELECT allocate_temp_canonical_user() INTO v_alloc;
  v_uid := v_alloc->>'uid';
  v_canonical_user_id := v_alloc->>'canonical_user_id';
  
  RAISE NOTICE 'Step 1: Create user with placeholder: %', v_canonical_user_id;
  SELECT upsert_canonical_user(
    p_uid := v_uid,
    p_canonical_user_id := v_canonical_user_id,
    p_email := 'wallet-test@example.com',
    p_username := 'walletuser'
  ) INTO v_result;
  
  -- Now connect wallet (simulate BaseWalletAuthModal flow)
  RAISE NOTICE 'Step 2: Connect wallet and replace placeholder';
  SELECT upsert_canonical_user(
    p_uid := v_uid,
    p_canonical_user_id := v_final_canonical_id,
    p_wallet_address := v_wallet,
    p_base_wallet_address := v_wallet,
    p_wallet_linked := true
  ) INTO v_result;
  
  RAISE NOTICE 'Update result: %', v_result;
  
  -- Verify placeholder was replaced
  SELECT canonical_user_id INTO v_stored_canonical_id
  FROM canonical_users
  WHERE uid = v_uid;
  
  IF v_stored_canonical_id != v_final_canonical_id THEN
    RAISE EXCEPTION 'FAILED: Placeholder not replaced. Expected %, got %', 
      v_final_canonical_id, v_stored_canonical_id;
  END IF;
  
  -- Verify wallet address stored
  PERFORM 1 FROM canonical_users
  WHERE uid = v_uid
    AND wallet_address = v_wallet;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAILED: Wallet address not stored';
  END IF;
  
  -- Verify old placeholder is gone (no duplicate)
  PERFORM 1 FROM canonical_users
  WHERE canonical_user_id = v_canonical_user_id;
  
  IF FOUND THEN
    RAISE EXCEPTION 'FAILED: Old placeholder still exists - duplicate user created!';
  END IF;
  
  RAISE NOTICE 'PASSED: Placeholder replaced with wallet ID, no duplicate user';
END $$;

-- ============================================================================
-- TEST 4: Uniqueness of temporary placeholders
-- ============================================================================
DO $$
DECLARE
  v_alloc1 JSONB;
  v_alloc2 JSONB;
  v_id1 TEXT;
  v_id2 TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 4: Uniqueness of temporary placeholders ===';
  
  SELECT allocate_temp_canonical_user() INTO v_alloc1;
  SELECT allocate_temp_canonical_user() INTO v_alloc2;
  
  v_id1 := v_alloc1->>'canonical_user_id';
  v_id2 := v_alloc2->>'canonical_user_id';
  
  RAISE NOTICE 'Allocated ID 1: %', v_id1;
  RAISE NOTICE 'Allocated ID 2: %', v_id2;
  
  IF v_id1 = v_id2 THEN
    RAISE EXCEPTION 'FAILED: Duplicate placeholder IDs generated!';
  END IF;
  
  RAISE NOTICE 'PASSED: Placeholder IDs are unique';
END $$;

-- ============================================================================
-- TEST 5: Triggers don't break placeholder format
-- ============================================================================
DO $$
DECLARE
  v_alloc JSONB;
  v_uid TEXT;
  v_canonical_user_id TEXT;
  v_stored_canonical_id TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 5: Triggers preserve placeholder format ===';
  
  SELECT allocate_temp_canonical_user() INTO v_alloc;
  v_uid := v_alloc->>'uid';
  v_canonical_user_id := v_alloc->>'canonical_user_id';
  
  -- Insert directly (triggers will run)
  INSERT INTO canonical_users (uid, canonical_user_id, email, username)
  VALUES (v_uid, v_canonical_user_id, 'trigger-test@example.com', 'triggeruser');
  
  -- Verify placeholder preserved
  SELECT canonical_user_id INTO v_stored_canonical_id
  FROM canonical_users
  WHERE uid = v_uid;
  
  IF v_stored_canonical_id != v_canonical_user_id THEN
    RAISE EXCEPTION 'FAILED: Trigger modified placeholder. Expected %, got %',
      v_canonical_user_id, v_stored_canonical_id;
  END IF;
  
  RAISE NOTICE 'PASSED: Triggers preserve placeholder format';
END $$;

-- Clean up test data
DELETE FROM canonical_users WHERE uid LIKE 'test_%' OR email LIKE '%test%' OR email LIKE '%example.com';

ROLLBACK;

-- ============================================================================
-- Summary
-- ============================================================================
-- If you see all PASSED messages, the implementation is correct.
-- ============================================================================
