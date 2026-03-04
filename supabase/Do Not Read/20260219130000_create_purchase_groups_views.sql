-- Migration: Create purchase_events and purchase_groups views
-- Purpose: Enable grouping of purchases by date/time for better dashboard visualization
-- Author: GitHub Copilot
-- Date: 2026-02-19

-- ============================================================================
-- PART 1: Create purchase_events view
-- Unifies tickets and joincompetition tables into a single purchase event stream
-- ============================================================================

DROP VIEW IF EXISTS public.purchase_groups CASCADE;
DROP VIEW IF EXISTS public.purchase_events CASCADE;

CREATE OR REPLACE VIEW public.purchase_events AS
-- Purchases from tickets table  
SELECT 
  t.id::text AS source_row_id,
  'tickets'::text AS source_table,
  COALESCE(t.user_id, t.canonical_user_id) AS user_id,
  t.competition_id::text AS competition_id,
  t.purchase_price AS amount,
  t.created_at AS occurred_at,
  t.purchase_key
FROM public.tickets t
WHERE t.competition_id IS NOT NULL
  AND t.purchase_price IS NOT NULL
  AND t.created_at IS NOT NULL
  -- Exclude balance payments (purchase_key starts with 'bal_')
  AND (t.purchase_key IS NULL OR NOT t.purchase_key LIKE 'bal_%')

UNION ALL

-- Purchases from joincompetition table
SELECT 
  jc.id::text AS source_row_id,
  'joincompetition'::text AS source_table,
  jc.canonical_user_id AS user_id,
  jc.competitionid::text AS competition_id,
  jc.amount_spent AS amount,
  jc.created_at AS occurred_at,
  NULL AS purchase_key
FROM public.joincompetition jc
WHERE jc.competitionid IS NOT NULL
  AND jc.amount_spent IS NOT NULL
  AND jc.created_at IS NOT NULL;

COMMENT ON VIEW public.purchase_events IS 
'Unified view of all purchase events from tickets and joincompetition tables. Each row represents a single purchase event with timestamp, amount, and source information.';

-- ============================================================================
-- PART 2: Create purchase_groups view
-- Groups purchase events by user, competition, and purchase session (5-min window)
-- ============================================================================

CREATE OR REPLACE VIEW public.purchase_groups AS
WITH ranked_events AS (
  -- First, get all events with row numbers partitioned by user and competition
  SELECT 
    user_id,
    competition_id,
    source_row_id,
    source_table,
    amount,
    occurred_at,
    purchase_key,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, competition_id 
      ORDER BY occurred_at
    ) AS event_sequence
  FROM public.purchase_events
),
session_starts AS (
  -- Identify session boundaries: a new session starts if >5 minutes since previous event
  SELECT 
    re.*,
    CASE 
      WHEN LAG(occurred_at) OVER (
        PARTITION BY user_id, competition_id 
        ORDER BY event_sequence
      ) IS NULL 
      OR (occurred_at - LAG(occurred_at) OVER (
        PARTITION BY user_id, competition_id 
        ORDER BY event_sequence
      )) > INTERVAL '5 minutes'
      THEN 1
      ELSE 0
    END AS is_session_start
  FROM ranked_events re
),
session_numbers AS (
  -- Assign a session number to each purchase group
  SELECT 
    ss.*,
    SUM(is_session_start) OVER (
      PARTITION BY user_id, competition_id 
      ORDER BY event_sequence
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS purchase_group_number
  FROM session_starts ss
),
grouped_purchases AS (
  -- Aggregate events by session
  SELECT 
    user_id,
    competition_id,
    purchase_group_number,
    MIN(occurred_at) AS group_start_at,
    MAX(occurred_at) AS group_end_at,
    COUNT(*) AS events_in_group,
    SUM(amount) AS total_amount,
    -- Pick any purchase_key from the group (for reference)
    MAX(purchase_key) AS any_purchase_key,
    -- Collect all events in this group as a JSON array
    json_agg(
      json_build_object(
        'source_table', source_table,
        'source_row_id', source_row_id,
        'amount', amount,
        'occurred_at', occurred_at,
        'purchase_key', purchase_key
      ) ORDER BY occurred_at
    ) AS events
  FROM session_numbers
  GROUP BY user_id, competition_id, purchase_group_number
)
SELECT * FROM grouped_purchases;

COMMENT ON VIEW public.purchase_groups IS 
'Groups purchase events into sessions based on 5-minute time windows. Each group represents a logical "purchase session" where a user made one or more purchases for a competition in quick succession.';

-- ============================================================================
-- Grant permissions
-- ============================================================================

-- Grant SELECT permission to authenticated users on both views
GRANT SELECT ON public.purchase_events TO authenticated;
GRANT SELECT ON public.purchase_groups TO authenticated;

-- Grant SELECT permission to anon role (for public access if needed)
GRANT SELECT ON public.purchase_events TO anon;
GRANT SELECT ON public.purchase_groups TO anon;
