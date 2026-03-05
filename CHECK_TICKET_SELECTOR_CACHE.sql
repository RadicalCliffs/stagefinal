-- ============================================================================
-- DIAGNOSTIC: Check if get_unavailable_tickets is returning Jerry's tickets
-- ============================================================================

-- Step 1: Get Jerry's most recent competition and tickets
WITH jerry_comp AS (
  SELECT 
    jc.competition_id,
    c.title,
    jc.ticketnumbers,
    jc.created_at
  FROM joincompetition jc
  JOIN canonical_users cu ON cu.canonical_user_id = jc.canonical_user_id
  LEFT JOIN competitions c ON c.id = jc.competition_id OR c.uid = jc.competition_id
  WHERE cu.username = 'jerry'
  ORDER BY jc.created_at DESC
  LIMIT 1
)
SELECT 
  'JERRY LATEST PURCHASE' as check,
  competition_id,
  title,
  ticketnumbers,
  created_at
FROM jerry_comp;

-- Step 2: Test get_unavailable_tickets RPC for Jerry's competition
WITH jerry_comp AS (
  SELECT jc.competition_id
  FROM joincompetition jc
  JOIN canonical_users cu ON cu.canonical_user_id = jc.canonical_user_id
  WHERE cu.username = 'jerry'
  ORDER BY jc.created_at DESC
  LIMIT 1
)
SELECT 
  'RPC RESULT' as check,
  jc.competition_id,
  get_unavailable_tickets(jc.competition_id::TEXT) as unavailable_tickets,
  array_length(get_unavailable_tickets(jc.competition_id::TEXT), 1) as count
FROM jerry_comp jc;

-- Step 3: Parse Jerry's tickets and compare
WITH jerry_comp AS (
  SELECT 
    jc.competition_id,
    jc.ticketnumbers
  FROM joincompetition jc
  JOIN canonical_users cu ON cu.canonical_user_id = jc.canonical_user_id
  WHERE cu.username = 'jerry'
  ORDER BY jc.created_at DESC
  LIMIT 1
),
jerry_tickets AS (
  SELECT 
    competition_id,
    CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) as ticket_num
  FROM jerry_comp
  WHERE ticketnumbers IS NOT NULL
),
rpc_result AS (
  SELECT 
    jc.competition_id,
    unnest(get_unavailable_tickets(jc.competition_id::TEXT)) as unavailable_ticket
  FROM jerry_comp jc
)
SELECT 
  'MISSING TICKETS' as check,
  jt.ticket_num as jerry_ticket,
  CASE 
    WHEN rr.unavailable_ticket IS NULL THEN '❌ NOT IN RPC RESULT'
    ELSE '✅ IN RPC RESULT'
  END as status
FROM jerry_tickets jt
LEFT JOIN rpc_result rr ON rr.unavailable_ticket = jt.ticket_num
ORDER BY jt.ticket_num;

-- Step 4: Check if there are ANY tickets from joincompetition in the RPC result
WITH jerry_comp AS (
  SELECT jc.competition_id
  FROM joincompetition jc
  JOIN canonical_users cu ON cu.canonical_user_id = jc.canonical_user_id
  WHERE cu.username = 'jerry'
  ORDER BY jc.created_at DESC
  LIMIT 1
)
SELECT 
  'ALL TICKETS IN JOINCOMPETITION' as check,
  COUNT(*) as total_tickets
FROM joincompetition jc
CROSS JOIN jerry_comp jcomp
WHERE jc.competition_id = jcomp.competition_id;
