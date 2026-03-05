-- Check what Jerry actually has in the database
SELECT 
  'JERRY USER' as source,
  canonical_user_id,
  username,
  email,
  wallet_address
FROM canonical_users
WHERE username = 'jerry'
LIMIT 1;

-- Check Jerry's joincompetition entries
SELECT 
  'JOINCOMPETITION ENTRIES' as source,
  jc.id,
  jc.competition_id,
  jc.ticketnumbers,
  jc.canonical_user_id,
  jc.created_at
FROM joincompetition jc
WHERE jc.canonical_user_id = (
  SELECT canonical_user_id FROM canonical_users WHERE username = 'jerry' LIMIT 1
)
ORDER BY jc.created_at DESC
LIMIT 5;

-- Check Jerry's tickets table entries  
SELECT 
  'TICKETS TABLE ENTRIES' as source,
  t.id,
  t.competition_id,
  t.ticket_number,
  t.canonical_user_id,
  t.created_at
FROM tickets t
WHERE t.canonical_user_id = (
  SELECT canonical_user_id FROM canonical_users WHERE username = 'jerry' LIMIT 1
)
ORDER BY t.created_at DESC
LIMIT 5;

-- Test RPC on any recent competition (not specific to Jerry)
SELECT 
  'SAMPLE RPC TEST' as source,
  c.id as competition_id,
  c.title,
  array_length(get_unavailable_tickets(c.id::TEXT), 1) as unavailable_count
FROM competitions c
WHERE c.status IN ('active', 'completed')
  AND c.created_at > NOW() - INTERVAL '7 days'
ORDER BY c.created_at DESC
LIMIT 3;
