-- EMERGENCY: Find missing $290 purchase for user 0x0ff51ec0ecc9ae1e5e6048976ba307c849781363
-- Run this in Supabase SQL Editor

SET search_path TO public;

-- 1. Check all joincompetition entries for this user on this competition
SELECT 
  'joincompetition' as source,
  id,
  numberoftickets,
  amount_spent,
  created_at,
  LEFT(ticketnumbers, 100) as first_100_chars_of_tickets
FROM joincompetition
WHERE competitionid = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
  AND canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY created_at DESC;

-- 2. Check pending_tickets for this user (might be stuck here)
SELECT 
  'pending_tickets' as source,
  id,
  status,
  ticket_count,
  ARRAY_LENGTH(ticket_numbers, 1) as ticket_numbers_count,
  purchase_price,
  created_at,
  confirmed_at
FROM pending_tickets
WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
  AND canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
ORDER BY created_at DESC
LIMIT 5;

-- 3. Count individual tickets created recently (last hour)
SELECT 
  'recent_tickets' as source,
  COUNT(*) as ticket_count,
  SUM(COALESCE(purchase_price, 0.50)) as estimated_total,
  MIN(created_at) as first_ticket_time,
  MAX(created_at) as last_ticket_time
FROM tickets
WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
  AND canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
  AND created_at > NOW() - INTERVAL '1 hour';

-- 4. Check if tickets exist but aren't aggregated in joincompetition yet
SELECT 
  'orphan_tickets' as source,
  ticket_number,
  purchase_price,
  created_at
FROM tickets
WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
  AND canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY ticket_number
LIMIT 50;

-- 5. Check user_transactions for the payment
SELECT 
  'user_transactions' as source,
  id,
  transaction_type,
  amount,
  status,
  created_at,
  metadata
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 5;
