-- DIAGNOSTIC: Check actual amounts in database for competition 98ea9cbc-5d9b-409b-b757-acb9d0292a95
-- Run this in Supabase SQL Editor to see actual data

-- 1. Check competition ticket_price
SELECT 
  id,
  title,
  ticket_price,
  status
FROM competitions
WHERE id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95';

-- 2. Check joincompetition entries (shows what's actually stored)
SELECT 
  id,
  canonical_user_id,
  numberoftickets,
  amount_spent,
  ticketnumbers,
  created_at
FROM joincompetition
WHERE competitionid = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check tickets entries (shows what's actually stored)
SELECT 
  id,
  canonical_user_id,
  user_id,
  ticket_number,
  purchase_price,
  created_at
FROM tickets
WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
ORDER BY created_at DESC
LIMIT 20;

-- 4. Check purchase_events view (after deduplication)
SELECT 
  source_table,
  source_row_id,
  user_id,
  amount,
  occurred_at,
  purchase_key
FROM purchase_events
WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
ORDER BY occurred_at DESC
LIMIT 20;

-- 5. Check purchase_groups view (what actually displays in Purchase Breakdown)
SELECT 
  user_id,
  competition_id,
  purchase_group_number,
  group_start_at,
  events_in_group,
  total_amount,
  any_purchase_key
FROM purchase_groups
WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
ORDER BY group_start_at DESC
LIMIT 10;

-- 6. Check what get_comprehensive_user_dashboard_entries returns
-- REPLACE 'YOUR_USER_ID' with your actual canonical_user_id
SELECT 
  id,
  competition_id,
  title,
  total_tickets,
  total_amount_spent,
  ticket_price,
  purchase_date
FROM get_comprehensive_user_dashboard_entries('YOUR_USER_ID')
WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95';
