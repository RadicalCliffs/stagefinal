-- ============================================================================
-- Migration: Clean Up UUID-Format Canonical IDs
-- ============================================================================
-- Date: 2026-02-02
-- Purpose: Fix existing records that have wrong-format canonical_user_id
--          (prize:pid:{uuid} instead of prize:pid:0x{wallet} or prize:pid:temp{N})
--
-- This migration:
-- 1. Identifies all wrong-format canonical_user_ids
-- 2. Replaces them with correct format based on available data
-- 3. Updates all related tables (sub_account_balances, balance_ledger, etc.)
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Create temp table to track changes
-- ============================================================================

CREATE TEMP TABLE canonical_id_fixes (
  user_table_id UUID,
  old_canonical_id TEXT,
  new_canonical_id TEXT,
  fix_method TEXT
);

-- ============================================================================
-- SECTION 2: Identify and fix wrong-format IDs
-- ============================================================================

-- Insert records that need fixing into temp table
INSERT INTO canonical_id_fixes (user_table_id, old_canonical_id, new_canonical_id, fix_method)
SELECT 
  cu.id,
  cu.canonical_user_id AS old_canonical_id,
  CASE
    -- If user has wallet, use wallet-based ID
    WHEN cu.wallet_address IS NOT NULL THEN
      'prize:pid:' || util.normalize_evm_address(cu.wallet_address)
    WHEN cu.base_wallet_address IS NOT NULL THEN
      'prize:pid:' || util.normalize_evm_address(cu.base_wallet_address)
    WHEN cu.eth_wallet_address IS NOT NULL THEN
      'prize:pid:' || util.normalize_evm_address(cu.eth_wallet_address)
    -- No wallet - allocate temp placeholder
    ELSE
      'prize:pid:temp' || nextval('temp_user_sequence')::TEXT
  END AS new_canonical_id,
  CASE
    WHEN cu.wallet_address IS NOT NULL THEN 'wallet_address'
    WHEN cu.base_wallet_address IS NOT NULL THEN 'base_wallet_address'
    WHEN cu.eth_wallet_address IS NOT NULL THEN 'eth_wallet_address'
    ELSE 'temp_placeholder'
  END AS fix_method
FROM canonical_users cu
WHERE cu.canonical_user_id IS NOT NULL
  AND cu.canonical_user_id ~ 'prize:pid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  AND cu.canonical_user_id NOT LIKE 'prize:pid:0x%'
  AND cu.canonical_user_id NOT LIKE 'prize:pid:temp%';

-- ============================================================================
-- SECTION 3: Update canonical_users table
-- ============================================================================

UPDATE canonical_users cu
SET 
  canonical_user_id = fix.new_canonical_id,
  updated_at = NOW()
FROM canonical_id_fixes fix
WHERE cu.id = fix.user_table_id;

-- ============================================================================
-- SECTION 4: Update sub_account_balances table
-- ============================================================================

-- Update canonical_user_id
UPDATE sub_account_balances sab
SET 
  canonical_user_id = fix.new_canonical_id,
  last_updated = NOW()
FROM canonical_id_fixes fix
WHERE sab.canonical_user_id = fix.old_canonical_id;

-- Update user_id (which was incorrectly copied from canonical_user_id)
UPDATE sub_account_balances sab
SET 
  user_id = fix.new_canonical_id,
  last_updated = NOW()
FROM canonical_id_fixes fix
WHERE sab.user_id = fix.old_canonical_id;

-- ============================================================================
-- SECTION 5: Update balance_ledger table
-- ============================================================================

UPDATE balance_ledger bl
SET canonical_user_id = fix.new_canonical_id
FROM canonical_id_fixes fix
WHERE bl.canonical_user_id = fix.old_canonical_id;

-- ============================================================================
-- SECTION 6: Update user_transactions table
-- ============================================================================

UPDATE user_transactions ut
SET canonical_user_id = fix.new_canonical_id
FROM canonical_id_fixes fix
WHERE ut.canonical_user_id = fix.old_canonical_id;

-- ============================================================================
-- SECTION 7: Update competition_entries table
-- ============================================================================

UPDATE competition_entries ce
SET canonical_user_id = fix.new_canonical_id
FROM canonical_id_fixes fix
WHERE ce.canonical_user_id = fix.old_canonical_id;

-- ============================================================================
-- SECTION 8: Update joincompetition table
-- ============================================================================

UPDATE joincompetition jc
SET userid = fix.new_canonical_id
FROM canonical_id_fixes fix
WHERE jc.userid = fix.old_canonical_id;

-- ============================================================================
-- SECTION 9: Update notifications table
-- ============================================================================

UPDATE notifications n
SET canonical_user_id = fix.new_canonical_id
FROM canonical_id_fixes fix
WHERE n.canonical_user_id = fix.old_canonical_id;

-- ============================================================================
-- SECTION 10: Update bonus_award_audit table
-- ============================================================================

UPDATE bonus_award_audit baa
SET canonical_user_id = fix.new_canonical_id
FROM canonical_id_fixes fix
WHERE baa.canonical_user_id = fix.old_canonical_id;

-- ============================================================================
-- SECTION 11: Report results
-- ============================================================================

DO $$
DECLARE
  v_total_fixed INTEGER;
  v_wallet_based INTEGER;
  v_temp_placeholder INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_fixed FROM canonical_id_fixes;
  SELECT COUNT(*) INTO v_wallet_based FROM canonical_id_fixes WHERE fix_method != 'temp_placeholder';
  SELECT COUNT(*) INTO v_temp_placeholder FROM canonical_id_fixes WHERE fix_method = 'temp_placeholder';

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'UUID CANONICAL ID CLEANUP COMPLETE';
  RAISE NOTICE '========================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Total IDs fixed: %', v_total_fixed;
  RAISE NOTICE '  - Converted to wallet-based: %', v_wallet_based;
  RAISE NOTICE '  - Converted to temp placeholder: %', v_temp_placeholder;
  RAISE NOTICE '';
  RAISE NOTICE 'Tables updated:';
  RAISE NOTICE '  ✓ canonical_users';
  RAISE NOTICE '  ✓ sub_account_balances (canonical_user_id & user_id)';
  RAISE NOTICE '  ✓ balance_ledger';
  RAISE NOTICE '  ✓ user_transactions';
  RAISE NOTICE '  ✓ competition_entries';
  RAISE NOTICE '  ✓ joincompetition';
  RAISE NOTICE '  ✓ notifications';
  RAISE NOTICE '  ✓ bonus_award_audit';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Run: SELECT * FROM sync_balance_discrepancies();';
  RAISE NOTICE '  2. Verify balances are correct';
  RAISE NOTICE '  3. Test dashboard functionality';
  RAISE NOTICE '';
  RAISE NOTICE '========================================================';
END $$;

-- ============================================================================
-- SECTION 12: Drop temp table
-- ============================================================================

DROP TABLE canonical_id_fixes;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- After running this migration, verify no wrong-format IDs remain:
--
-- SELECT 
--   canonical_user_id,
--   COUNT(*) as count
-- FROM canonical_users
-- WHERE canonical_user_id ~ 'prize:pid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
--   AND canonical_user_id NOT LIKE 'prize:pid:0x%'
--   AND canonical_user_id NOT LIKE 'prize:pid:temp%'
-- GROUP BY canonical_user_id;
-- 
-- Expected result: 0 rows
--
-- Check sub_account_balances format:
--
-- SELECT 
--   user_id,
--   canonical_user_id,
--   COUNT(*) as count
-- FROM sub_account_balances
-- WHERE user_id ~ 'prize:pid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
--   AND user_id NOT LIKE 'prize:pid:0x%'
--   AND user_id NOT LIKE 'prize:pid:temp%'
-- GROUP BY user_id, canonical_user_id;
--
-- Expected result: 0 rows
