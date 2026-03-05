-- Get Jerry's info and recent tickets in ONE query
WITH jerry_user AS (
  SELECT canonical_user_id, username, email, wallet_address
  FROM canonical_users
  WHERE username = 'jerry'
  LIMIT 1
),
jerry_joincomp AS (
  SELECT 
    jc.competition_id,
    jc.ticketnumbers,
    c.title as competition_name,
    jc.created_at
  FROM joincompetition jc
  CROSS JOIN jerry_user ju
  LEFT JOIN competitions c ON c.id = jc.competition_id
  WHERE jc.canonical_user_id = ju.canonical_user_id
  ORDER BY jc.created_at DESC
  LIMIT 1
)
SELECT 
  'JERRY INFO' as check_type,
  ju.canonical_user_id,
  ju.username,
  ju.wallet_address,
  jjc.competition_id,
  jjc.competition_name,
  jjc.ticketnumbers,
  array_length(get_unavailable_tickets(jjc.competition_id::TEXT), 1) as rpc_unavailable_count
FROM jerry_user ju
LEFT JOIN jerry_joincomp jjc ON true;
