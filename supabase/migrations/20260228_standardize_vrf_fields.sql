-- ============================================================================
-- Migration: Standardize VRF Transaction Hash Fields
-- Date: 2026-02-28
-- ============================================================================
-- 
-- Problem: Multiple inconsistent field names for VRF transaction hashes:
--   - competitions: vrf_pregenerated_tx_hash, rng_tx_hash
--   - competition_winners: vrf_tx_hash, tx_hash, txhash, rngtrxhash  
--   - rng_triggers: vrf_tx_hash
--
-- Solution: Standardize on `vrf_tx_hash` as the primary field and ensure
-- it's populated correctly across all tables for UI display.
-- ============================================================================

-- Add vrf_tx_hash to competitions table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'competitions' 
    AND column_name = 'vrf_tx_hash'
  ) THEN
    ALTER TABLE public.competitions 
    ADD COLUMN vrf_tx_hash TEXT;
    
    COMMENT ON COLUMN public.competitions.vrf_tx_hash IS 
      'VRF transaction hash from Chainlink VRF callback (Base blockchain)';
  END IF;
END $$;

-- Migrate existing data from rng_tx_hash to vrf_tx_hash if needed
UPDATE public.competitions
SET vrf_tx_hash = rng_tx_hash
WHERE vrf_tx_hash IS NULL 
  AND rng_tx_hash IS NOT NULL
  AND rng_tx_hash != '';

-- Also copy from vrf_pregenerated_tx_hash if still null
UPDATE public.competitions
SET vrf_tx_hash = vrf_pregenerated_tx_hash
WHERE vrf_tx_hash IS NULL 
  AND vrf_pregenerated_tx_hash IS NOT NULL
  AND vrf_pregenerated_tx_hash != '';

-- Ensure competition_winners table has vrf_tx_hash
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'competition_winners' 
    AND column_name = 'vrf_tx_hash'
  ) THEN
    ALTER TABLE public.competition_winners 
    ADD COLUMN vrf_tx_hash TEXT;
    
    COMMENT ON COLUMN public.competition_winners.vrf_tx_hash IS 
      'VRF transaction hash for winner verification';
  END IF;
END $$;

-- Migrate existing winner data
UPDATE public.competition_winners
SET vrf_tx_hash = COALESCE(
  vrf_tx_hash,
  tx_hash,
  txhash,
  rngtrxhash
)
WHERE vrf_tx_hash IS NULL;

-- Create index for VRF transaction hash lookups
CREATE INDEX IF NOT EXISTS idx_competitions_vrf_tx_hash 
  ON public.competitions(vrf_tx_hash) 
  WHERE vrf_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competition_winners_vrf_tx_hash 
  ON public.competition_winners(vrf_tx_hash) 
  WHERE vrf_tx_hash IS NOT NULL;

-- Add VRF status field if missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'competitions' 
    AND column_name = 'vrf_status'
  ) THEN
    ALTER TABLE public.competitions 
    ADD COLUMN vrf_status TEXT;
    
    COMMENT ON COLUMN public.competitions.vrf_status IS 
      'VRF processing status: pending, processing, completed, failed';
  END IF;
END $$;

-- Add VRF request tracking fields if missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'competitions' 
    AND column_name = 'vrf_request_id'
  ) THEN
    ALTER TABLE public.competitions 
    ADD COLUMN vrf_request_id TEXT;
    
    COMMENT ON COLUMN public.competitions.vrf_request_id IS 
      'Chainlink VRF request ID for tracking';
  END IF;
END $$;

-- Add timestamps for VRF draw tracking
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'competitions' 
    AND column_name = 'vrf_draw_requested_at'
  ) THEN
    ALTER TABLE public.competitions 
    ADD COLUMN vrf_draw_requested_at TIMESTAMPTZ;
    
    COMMENT ON COLUMN public.competitions.vrf_draw_requested_at IS 
      'When VRF draw was requested';
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'competitions' 
    AND column_name = 'vrf_draw_completed_at'
  ) THEN
    ALTER TABLE public.competitions 
    ADD COLUMN vrf_draw_completed_at TIMESTAMPTZ;
    
    COMMENT ON COLUMN public.competitions.vrf_draw_completed_at IS 
      'When VRF draw was completed and winners synced';
  END IF;
END $$;

-- Add on-chain competition ID if missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'competitions' 
    AND column_name = 'onchain_competition_id'
  ) THEN
    ALTER TABLE public.competitions 
    ADD COLUMN onchain_competition_id BIGINT;
    
    COMMENT ON COLUMN public.competitions.onchain_competition_id IS 
      'Competition ID on the VRF smart contract (Base blockchain)';
    
    CREATE INDEX IF NOT EXISTS idx_competitions_onchain_id 
      ON public.competitions(onchain_competition_id) 
      WHERE onchain_competition_id IS NOT NULL;
  END IF;
END $$;

-- Create a view for easy VRF status checking
CREATE OR REPLACE VIEW public.vrf_competition_status AS
SELECT 
  c.id,
  c.uid,
  c.title,
  c.status,
  c.onchain_competition_id,
  c.vrf_status,
  c.vrf_request_id,
  c.vrf_tx_hash,
  c.rng_tx_hash,
  c.vrf_pregenerated_tx_hash,
  c.vrf_draw_requested_at,
  c.vrf_draw_completed_at,
  c.winner_address,
  c.draw_date,
  CASE 
    WHEN c.vrf_tx_hash IS NOT NULL THEN 'has_vrf_tx'
    WHEN c.rng_tx_hash IS NOT NULL THEN 'has_rng_tx'
    WHEN c.vrf_pregenerated_tx_hash IS NOT NULL THEN 'has_pregenerated_tx'
    ELSE 'no_tx_hash'
  END as tx_hash_status,
  COALESCE(c.vrf_tx_hash, c.rng_tx_hash, c.vrf_pregenerated_tx_hash) as effective_tx_hash
FROM public.competitions c
WHERE c.status IN ('completed', 'drawn', 'drawing')
  OR c.vrf_draw_requested_at IS NOT NULL
ORDER BY c.vrf_draw_requested_at DESC NULLS LAST;

COMMENT ON VIEW public.vrf_competition_status IS 
  'View showing VRF status and transaction hashes for all competitions with VRF draws';

-- Grant appropriate permissions
GRANT SELECT ON public.vrf_competition_status TO authenticated;
GRANT SELECT ON public.vrf_competition_status TO anon;
