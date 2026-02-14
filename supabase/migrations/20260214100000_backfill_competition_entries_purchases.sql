-- =====================================================
-- BACKFILL COMPETITION ENTRIES PURCHASES TABLE
-- =====================================================
-- This migration backfills the competition_entries_purchases table
-- with historical purchase data from joincompetition and user_transactions tables.
-- This is required for PR #333 changes to work properly with existing data.
-- =====================================================

BEGIN;

-- First, ensure the competition_entries_purchases table exists (idempotent)
CREATE TABLE IF NOT EXISTS competition_entries_purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_user_id text NOT NULL,
  competition_id uuid NOT NULL,
  purchase_key text NOT NULL,
  tickets_count integer NOT NULL DEFAULT 0,
  amount_spent numeric NOT NULL DEFAULT 0,
  ticket_numbers_csv text,
  purchased_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT competition_entries_purchases_pkey PRIMARY KEY (id)
);

-- Create unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_cep_user_comp_key'
  ) THEN
    ALTER TABLE competition_entries_purchases
    ADD CONSTRAINT uq_cep_user_comp_key UNIQUE (canonical_user_id, competition_id, purchase_key);
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_cep_user ON competition_entries_purchases(canonical_user_id);
CREATE INDEX IF NOT EXISTS idx_cep_comp ON competition_entries_purchases(competition_id);
CREATE INDEX IF NOT EXISTS idx_cep_user_comp ON competition_entries_purchases(canonical_user_id, competition_id);
CREATE INDEX IF NOT EXISTS idx_cep_user_comp_latest ON competition_entries_purchases(canonical_user_id, competition_id, purchased_at DESC);

-- Backfill from joincompetition table
-- Only insert records that don't already exist (based on unique constraint)
INSERT INTO competition_entries_purchases (
  canonical_user_id,
  competition_id,
  purchase_key,
  tickets_count,
  amount_spent,
  ticket_numbers_csv,
  purchased_at,
  created_at
)
SELECT DISTINCT ON (
  COALESCE(jc.canonical_user_id, jc.privy_user_id, jc.userid, LOWER(jc.wallet_address), 'unknown'),
  jc.competitionid,
  'jc_' || jc.id::text
)
  COALESCE(jc.canonical_user_id, jc.privy_user_id, jc.userid, LOWER(jc.wallet_address), 'unknown') as canonical_user_id,
  jc.competitionid as competition_id,
  'jc_' || jc.id::text as purchase_key,
  COALESCE(jc.numberoftickets, 0) as tickets_count,
  COALESCE(jc.amountspent, 0) as amount_spent,
  jc.ticketnumbers as ticket_numbers_csv,
  COALESCE(jc.purchasedate, jc.created_at, now()) as purchased_at,
  COALESCE(jc.created_at, now()) as created_at
FROM joincompetition jc
WHERE jc.competitionid IS NOT NULL
  AND COALESCE(jc.canonical_user_id, jc.privy_user_id, jc.userid, jc.wallet_address) IS NOT NULL
  AND jc.status != 'cancelled'
ON CONFLICT (canonical_user_id, competition_id, purchase_key) 
DO NOTHING;

-- Backfill from user_transactions table (for transactions not in joincompetition)
-- Only transactions that represent competition entries
INSERT INTO competition_entries_purchases (
  canonical_user_id,
  competition_id,
  purchase_key,
  tickets_count,
  amount_spent,
  ticket_numbers_csv,
  purchased_at,
  created_at
)
SELECT DISTINCT ON (
  COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, LOWER(ut.wallet_address), 'unknown'),
  ut.competition_id,
  'ut_' || ut.id::text
)
  COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, LOWER(ut.wallet_address), 'unknown') as canonical_user_id,
  ut.competition_id,
  'ut_' || ut.id::text as purchase_key,
  COALESCE(ut.ticket_count, 0) as tickets_count,
  COALESCE(ABS(ut.amount), 0) as amount_spent,
  NULL as ticket_numbers_csv, -- user_transactions doesn't store individual ticket numbers
  COALESCE(ut.completed_at, ut.created_at, now()) as purchased_at,
  COALESCE(ut.created_at, now()) as created_at
FROM user_transactions ut
WHERE ut.competition_id IS NOT NULL
  AND COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id, ut.wallet_address) IS NOT NULL
  AND ut.type IN ('purchase', 'competition_entry', 'ticket_purchase')
  AND ut.status = 'completed'
  AND ut.ticket_count > 0
ON CONFLICT (canonical_user_id, competition_id, purchase_key)
DO NOTHING;

-- After backfilling, recompute the aggregated competition_entries
-- This ensures the parent table is in sync with the individual purchases
DO $$
DECLARE
  v_user text;
  v_comp uuid;
BEGIN
  -- Loop through all unique user+competition combinations in competition_entries_purchases
  FOR v_user, v_comp IN 
    SELECT DISTINCT canonical_user_id, competition_id 
    FROM competition_entries_purchases
  LOOP
    -- Call the recompute function if it exists
    BEGIN
      PERFORM recompute_competition_entry(v_user, v_comp);
    EXCEPTION WHEN OTHERS THEN
      -- If function doesn't exist or fails, skip silently
      -- The data is still in competition_entries_purchases and will be used by the RPC
      NULL;
    END;
  END LOOP;
END $$;

COMMIT;
