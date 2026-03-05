-- ============================================================================
-- DEBUG: WHY ARE TRANSACTIONS NOT SHOWING IN ORDERS TAB
-- ============================================================================

-- Step 1: Verify transactions exist
SELECT 
  'TRANSACTIONS EXIST' as check_name,
  COUNT(*) as count
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05';

-- Step 2: Test the RPC function directly
SELECT 
  'RPC FUNCTION OUTPUT' as check_name,
  get_user_transactions('prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05') as result;

-- Step 3: Check if RPC function exists and has correct permissions
SELECT 
  'FUNCTION PERMISSIONS' as check_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  CASE p.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    WHEN 'v' THEN 'VOLATILE'
  END as volatility,
  p.prosecdef as security_definer,
  array_to_string(p.proacl, ', ') as acl
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'get_user_transactions';

-- Step 4: Check what user the frontend is calling with
SELECT 
  'CANONICAL USER LOOKUP' as check_name,
  canonical_user_id,
  username,
  email,
  wallet_address
FROM canonical_users
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
   OR username = 'invest'
   OR email = 'investors@theprize.io';

-- Step 5: Raw transaction data
SELECT 
  id,
  type,
  canonical_user_id,
  user_id,
  wallet_address,
  amount,
  status,
  payment_status,
  created_at
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05'
ORDER BY created_at DESC;

-- Step 6: Test RPC with different identifier formats
SELECT 'TEST: prize:pid format' as test, 
       jsonb_array_length(get_user_transactions('prize:pid:0x7b343a531688ac9ed7fbce4f16048970d1c7ba05')) as count;

SELECT 'TEST: wallet address format' as test,
       jsonb_array_length(get_user_transactions('0x7b343a531688ac9ed7fbce4f16048970d1c7ba05')) as count;

SELECT 'TEST: username format' as test,
       jsonb_array_length(get_user_transactions('invest')) as count;
