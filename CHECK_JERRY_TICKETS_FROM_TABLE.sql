-- Check if Jerry's tickets from tickets table are in the RPC result
WITH jerry_tickets_from_table AS (
  SELECT 
    t.competition_id,
    t.ticket_number,
    c.title
  FROM tickets t
  JOIN canonical_users cu ON cu.canonical_user_id = t.canonical_user_id
  LEFT JOIN competitions c ON c.id = t.competition_id
  WHERE cu.username = 'jerry'
    AND t.competition_id = '12cccfb1-df68-4b3e-a168-07dfeaeb06cc'
  ORDER BY t.ticket_number
),
rpc_unavailable AS (
  SELECT unnest(get_unavailable_tickets('12cccfb1-df68-4b3e-a168-07dfeaeb06cc'::TEXT)) as ticket_num
)
SELECT 
  jt.competition_id,
  jt.title,
  jt.ticket_number as jerry_ticket,
  CASE 
    WHEN ru.ticket_num IS NOT NULL THEN '✅ IN RPC'
    ELSE '❌ MISSING'  
  END as status
FROM jerry_tickets_from_table jt
LEFT JOIN rpc_unavailable ru ON ru.ticket_num = jt.ticket_number
ORDER BY jt.ticket_number;
