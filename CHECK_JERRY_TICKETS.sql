-- ============================================================================
-- DIAGNOSTIC: Check why Jerry's tickets don't show as owned
-- ============================================================================

-- Step 1: Find Jerry's canonical_user_id
SELECT 
  'JERRY USER INFO' as check,
  canonical_user_id,
  username,
  email,
  wallet_address
FROM canonical_users
WHERE username = 'jerry';

-- Step 2: Check Jerry's tickets in joincompetition table
SELECT 
  'JERRY TICKETS IN JOINCOMPETITION' as check,
  competition_id,
  ticketnumbers,
  canonical_user_id,
  user_id,
  created_at
FROM joincompetition
WHERE canonical_user_id ILIKE '%jerry%' 
   OR user_id ILIKE '%jerry%'
ORDER BY created_at DESC
LIMIT 10;

-- Step 3: Check Jerry's tickets in tickets table
SELECT 
  'JERRY TICKETS IN TICKETS TABLE' as check,
  competition_id,
  ticket_number,
  canonical_user_id,
  user_id,
  created_at
FROM tickets
WHERE canonical_user_id ILIKE '%jerry%' 
   OR user_id ILIKE '%jerry%'
ORDER BY created_at DESC
LIMIT 10;

-- Step 4: Get the competition Jerry just bought tickets for (most recent)
WITH jerry_user AS (
  SELECT canonical_user_id 
  FROM canonical_users 
  WHERE username = 'jerry'
  LIMIT 1
)
SELECT 
  'MOST RECENT COMPETITION' as check,
  jc.competition_id,
  c.title as competition_name,
  jc.ticketnumbers,
  jc.created_at
FROM joincompetition jc
CROSS JOIN jerry_user ju
LEFT JOIN competitions c ON c.id = jc.competition_id OR c.uid = jc.competition_id
WHERE jc.canonical_user_id = ju.canonical_user_id
ORDER BY jc.created_at DESC
LIMIT 1;

-- Step 5: Test get_unavailable_tickets for Jerry's most recent competition
WITH jerry_user AS (
  SELECT canonical_user_id 
  FROM canonical_users 
  WHERE username = 'jerry'
  LIMIT 1
),
recent_comp AS (
  SELECT jc.competition_id
  FROM joincompetition jc
  CROSS JOIN jerry_user ju
  WHERE jc.canonical_user_id = ju.canonical_user_id
  ORDER BY jc.created_at DESC
  LIMIT 1
)
SELECT 
  'GET_UNAVAILABLE_TICKETS RETURNS' as check,
  rc.competition_id,
  get_unavailable_tickets(rc.competition_id) as unavailable_tickets,
  array_length(get_unavailable_tickets(rc.competition_id), 1) as count
FROM recent_comp rc;

-- Step 6: Compare Jerry's tickets to what RPC returns
WITH jerry_user AS (
  SELECT canonical_user_id 
  FROM canonical_users 
  WHERE username = 'jerry'
  LIMIT 1
),
recent_comp AS (
  SELECT jc.competition_id, jc.ticketnumbers
  FROM joincompetition jc
  CROSS JOIN jerry_user ju
  WHERE jc.canonical_user_id = ju.canonical_user_id
  ORDER BY jc.created_at DESC
  LIMIT 1
),
jerry_tickets_array AS (
  SELECT 
    rc.competition_id,
    ARRAY(
      SELECT CAST(TRIM(unnest(string_to_array(rc.ticketnumbers::TEXT, ','))) AS INTEGER)
      FROM recent_comp rc
      WHERE rc.ticketnumbers IS NOT NULL
    ) as jerrys_tickets
  FROM recent_comp rc
),
rpc_tickets AS (
  SELECT 
    rc.competition_id,
    get_unavailable_tickets(rc.competition_id) as unavailable_from_rpc
  FROM recent_comp rc
)
SELECT 
  'COMPARISON' as check,
  jt.competition_id,
  jt.jerrys_tickets as jerry_bought,
  rt.unavailable_from_rpc as rpc_returns,
  ARRAY(
    SELECT unnest(jt.jerrys_tickets)
    EXCEPT
    SELECT unnest(rt.unavailable_from_rpc)
  ) as missing_from_rpc
FROM jerry_tickets_array jt
JOIN rpc_tickets rt ON jt.competition_id = rt.competition_id;

-- Step 7: Check if RPC function exists and has correct signature
SELECT 
  'RPC FUNCTION INFO' as check,
  p.proname AS function_name,
  pg_get_function_result(p.oid) AS return_type,
  pg_get_function_arguments(p.oid) AS arguments,
  p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'get_unavailable_tickets'
  AND n.nspname = 'public';
