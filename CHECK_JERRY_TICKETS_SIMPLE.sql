-- ============================================================================
-- SIMPLE CHECK: Are Jerry's tickets in the RPC result?
-- ============================================================================

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
),
jerry_tickets AS (
  SELECT 
    jcomp.competition_id,
    jcomp.title,
    CAST(TRIM(unnest(string_to_array(jcomp.ticketnumbers::TEXT, ','))) AS INTEGER) as ticket_num
  FROM jerry_comp jcomp
  WHERE jcomp.ticketnumbers IS NOT NULL
),
rpc_result AS (
  SELECT unnest(get_unavailable_tickets(jc.competition_id::TEXT)) as unavailable_ticket
  FROM jerry_comp jc
)
SELECT 
  jt.competition_id,
  jt.title as competition_name,
  jt.ticket_num as jerry_ticket,
  CASE 
    WHEN rr.unavailable_ticket IS NOT NULL THEN '✅ IN RPC'
    ELSE '❌ MISSING FROM RPC'
  END as rpc_status,
  (SELECT array_length(get_unavailable_tickets(jt.competition_id::TEXT), 1)) as total_unavailable_count
FROM jerry_tickets jt
LEFT JOIN rpc_result rr ON rr.unavailable_ticket = jt.ticket_num
ORDER BY jt.ticket_num;
