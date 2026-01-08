/*
  # Add VRF On-Chain Competition Support

  1. Changes
    - Add `onchain_competition_id` column to competitions table for linking to on-chain VRF contract
    - Add `vrf_error` column to track VRF-related errors during draw attempts
    - Add `vrf_draw_requested_at` column to track when VRF draw was requested
    - Add `vrf_draw_completed_at` column to track when VRF draw completed
    - Create index on onchain_competition_id for efficient lookups

  2. Notes
    - onchain_competition_id must be set for VRF draws to work
    - vrf_error stores error messages when draw attempts fail
    - These columns enable proper VRF integration with the on-chain contract
*/

-- Add onchain_competition_id column for linking to on-chain VRF contract
ALTER TABLE competitions
ADD COLUMN IF NOT EXISTS onchain_competition_id integer;

-- Add vrf_error column to track VRF-related errors
ALTER TABLE competitions
ADD COLUMN IF NOT EXISTS vrf_error text;

-- Add vrf_draw_requested_at to track when VRF draw was requested
ALTER TABLE competitions
ADD COLUMN IF NOT EXISTS vrf_draw_requested_at timestamptz;

-- Add vrf_draw_completed_at to track when VRF draw completed
ALTER TABLE competitions
ADD COLUMN IF NOT EXISTS vrf_draw_completed_at timestamptz;

-- Create index on onchain_competition_id for efficient lookups
CREATE INDEX IF NOT EXISTS idx_competitions_onchain_id ON competitions(onchain_competition_id);

-- Create index on vrf_error for filtering competitions with errors
CREATE INDEX IF NOT EXISTS idx_competitions_vrf_error ON competitions(vrf_error) WHERE vrf_error IS NOT NULL;

COMMENT ON COLUMN competitions.onchain_competition_id IS 'The on-chain competition ID from the VRF contract. Required for VRF draws.';
COMMENT ON COLUMN competitions.vrf_error IS 'Error message from the last VRF draw attempt. NULL means no error or not attempted.';
COMMENT ON COLUMN competitions.vrf_draw_requested_at IS 'Timestamp when a VRF draw was last requested.';
COMMENT ON COLUMN competitions.vrf_draw_completed_at IS 'Timestamp when the VRF draw was successfully completed.';
