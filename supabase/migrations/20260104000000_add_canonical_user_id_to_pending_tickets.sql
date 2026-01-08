-- Add canonical_user_id column to pending_tickets table
-- This ensures consistent user identification across the payment flow

-- Add the column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_tickets' 
    AND column_name = 'canonical_user_id'
  ) THEN
    ALTER TABLE pending_tickets ADD COLUMN canonical_user_id TEXT;
    
    -- Create index for fast lookups by canonical user ID
    CREATE INDEX IF NOT EXISTS idx_pending_tickets_canonical_user_id 
      ON pending_tickets(canonical_user_id);
    
    -- Create compound index for common queries
    CREATE INDEX IF NOT EXISTS idx_pending_tickets_canonical_comp_status 
      ON pending_tickets(canonical_user_id, competition_id, status);
      
    RAISE NOTICE 'Added canonical_user_id column to pending_tickets table';
  ELSE
    RAISE NOTICE 'canonical_user_id column already exists in pending_tickets table';
  END IF;
END $$;

-- Backfill existing records: populate canonical_user_id from user_id
-- Convert user_id to canonical format (prize:pid:xxx)
UPDATE pending_tickets
SET canonical_user_id = CASE
  -- Already in canonical format
  WHEN user_id LIKE 'prize:pid:%' THEN user_id
  -- Ethereum address format (0x followed by 40 hex chars)
  WHEN user_id ~ '^0x[a-fA-F0-9]{40}$' THEN 'prize:pid:' || LOWER(user_id)
  -- Privy DID format (did:privy:xxx)
  WHEN user_id LIKE 'did:privy:%' THEN 'prize:pid:' || user_id
  -- Privy user ID without prefix (only if it looks like a Privy format: lowercase alphanumeric with dashes, length 20-40)
  WHEN user_id ~ '^[a-z0-9]{8,12}-[a-z0-9]{4,6}-[a-z0-9]{4,6}-[a-z0-9]{4,6}-[a-z0-9]{8,12}$' THEN 'prize:pid:did:privy:' || user_id
  -- Fallback: use as-is with prefix
  ELSE 'prize:pid:' || user_id
END
WHERE canonical_user_id IS NULL;

-- Update RLS policy to also allow access by canonical_user_id
DROP POLICY IF EXISTS "Users can view own pending tickets" ON pending_tickets;
CREATE POLICY "Users can view own pending tickets"
    ON pending_tickets FOR SELECT
    USING (
      auth.uid()::text = user_id OR 
      auth.jwt() ->> 'sub' = user_id OR
      auth.uid()::text = canonical_user_id OR
      auth.jwt() ->> 'sub' = canonical_user_id
    );

-- Add comment for documentation
COMMENT ON COLUMN pending_tickets.canonical_user_id IS 'Canonical user ID in prize:pid:xxx format for consistent user identification';
