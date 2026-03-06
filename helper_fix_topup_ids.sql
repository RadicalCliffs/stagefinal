-- Helper function to fix missing canonical_user_id in topups
-- Can be called by JavaScript fix script

CREATE OR REPLACE FUNCTION fix_topup_canonical_ids()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fixed_count INTEGER := 0;
BEGIN
  -- Fix topups with missing canonical_user_id (extract from webhook_ref)
  WITH fixed AS (
    UPDATE user_transactions
    SET 
      canonical_user_id = regexp_replace(webhook_ref, '^TOPUP_(prize:pid:0x[a-f0-9]+)_.*$', '\1'),
      type = 'topup'
    WHERE type = 'topup'
      AND canonical_user_id IS NULL
      AND webhook_ref LIKE 'TOPUP_prize:pid:%'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_fixed_count FROM fixed;
  
  RETURN v_fixed_count;
END;
$$;

COMMENT ON FUNCTION fix_topup_canonical_ids IS
  'Fixes missing canonical_user_id in topup transactions by extracting from webhook_ref';
