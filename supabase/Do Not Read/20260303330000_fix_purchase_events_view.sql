-- ============================================================================
-- FIX: purchase_events VIEW using jc.competitionid
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
  AND (t.purchase_key IS NULL OR NOT t.purchase_key LIKE 'bal_%')

UNION ALL

-- Purchases from joincompetition table - FIXED: use competition_id NOT competitionid
SELECT 
  jc.id::text AS source_row_id,
  'joincompetition'::text AS source_table,
  jc.canonical_user_id AS user_id,
  jc.competition_id::text AS competition_id,  -- CHANGED FROM competitionid
  jc.amount_spent AS amount,
  jc.created_at AS occurred_at,
  NULL AS purchase_key
FROM public.joincompetition jc
WHERE jc.competition_id IS NOT NULL  -- CHANGED FROM competitionid
  AND jc.amount_spent IS NOT NULL
  AND jc.created_at IS NOT NULL;

COMMENT ON VIEW public.purchase_events IS 
'Unified view of all purchase events from tickets and joincompetition tables.';

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'FIXED: purchase_events VIEW';
  RAISE NOTICE 'NOW USES jc.competition_id (NOT competitionid)';
  RAISE NOTICE 'THIS WAS THE ROOT CAUSE OF THE ERROR';
  RAISE NOTICE '========================================================';
END $$;
