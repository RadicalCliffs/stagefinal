-- =====================================================
-- CLEANUP DUPLICATE EMAIL ACCOUNTS
-- =====================================================
-- This migration provides a database function to safely clean up
-- duplicate email accounts by:
-- 1. Deleting redundant accounts (same wallet, same email)
-- 2. Clearing email from accounts with different wallets sharing same email
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: CREATE CLEANUP FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_duplicate_email_accounts(
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_deleted_accounts text[] := ARRAY[]::text[];
  v_cleared_emails text[] := ARRAY[]::text[];
  v_errors text[] := ARRAY[]::text[];
  v_group_info jsonb[] := ARRAY[]::jsonb[];
  r_email RECORD;
  r_account RECORD;
  v_accounts_for_email jsonb[];
  v_keep_account jsonb;
  v_total_deleted integer := 0;
  v_total_cleared integer := 0;
BEGIN
  -- Find all emails with multiple accounts
  FOR r_email IN
    SELECT email, COUNT(*) as cnt
    FROM privy_user_connections
    WHERE email IS NOT NULL AND email != ''
    GROUP BY email
    HAVING COUNT(*) > 1
  LOOP
    v_accounts_for_email := ARRAY[]::jsonb[];
    v_keep_account := NULL;

    -- Get all accounts for this email with activity scores
    FOR r_account IN
      SELECT
        p.id,
        p.privy_user_id,
        p.canonical_user_id,
        p.email,
        LOWER(COALESCE(p.wallet_address, p.base_wallet_address, '')) as effective_wallet,
        p.wallet_address,
        p.base_wallet_address,
        COALESCE(wb.balance, 0) as balance,
        COALESCE((
          SELECT COUNT(*) FROM joincompetition jc
          WHERE jc.userid = p.privy_user_id
             OR LOWER(jc.wallet_address) = LOWER(p.wallet_address)
             OR LOWER(jc.wallet_address) = LOWER(p.base_wallet_address)
             OR jc.privy_user_id = p.privy_user_id
        ), 0) as entry_count,
        COALESCE((
          SELECT COUNT(*) FROM user_transactions ut
          WHERE ut.user_id = p.privy_user_id
             OR LOWER(ut.wallet_address) = LOWER(p.wallet_address)
             OR LOWER(ut.wallet_address) = LOWER(p.base_wallet_address)
        ), 0) as transaction_count,
        -- Activity score: entries*100 + transactions*50 + balance_above_10*10
        COALESCE((
          SELECT COUNT(*) FROM joincompetition jc
          WHERE jc.userid = p.privy_user_id
             OR LOWER(jc.wallet_address) = LOWER(p.wallet_address)
             OR LOWER(jc.wallet_address) = LOWER(p.base_wallet_address)
             OR jc.privy_user_id = p.privy_user_id
        ), 0) * 100 +
        COALESCE((
          SELECT COUNT(*) FROM user_transactions ut
          WHERE ut.user_id = p.privy_user_id
             OR LOWER(ut.wallet_address) = LOWER(p.wallet_address)
             OR LOWER(ut.wallet_address) = LOWER(p.base_wallet_address)
        ), 0) * 50 +
        GREATEST(0, COALESCE(wb.balance, 0) - 10) * 10 as activity_score
      FROM privy_user_connections p
      LEFT JOIN wallet_balances wb ON wb.user_id = p.id
      WHERE LOWER(p.email) = LOWER(r_email.email)
      ORDER BY activity_score DESC, p.created_at ASC
    LOOP
      v_accounts_for_email := array_append(v_accounts_for_email, jsonb_build_object(
        'id', r_account.id,
        'privy_user_id', r_account.privy_user_id,
        'canonical_user_id', r_account.canonical_user_id,
        'effective_wallet', r_account.effective_wallet,
        'balance', r_account.balance,
        'entry_count', r_account.entry_count,
        'transaction_count', r_account.transaction_count,
        'activity_score', r_account.activity_score
      ));

      -- First account (highest activity score) is the one to keep
      IF v_keep_account IS NULL THEN
        v_keep_account := jsonb_build_object(
          'id', r_account.id,
          'privy_user_id', r_account.privy_user_id,
          'effective_wallet', r_account.effective_wallet,
          'activity_score', r_account.activity_score
        );
      ELSE
        -- Process other accounts
        IF r_account.effective_wallet = (v_keep_account->>'effective_wallet') THEN
          -- Same wallet - delete this account entirely
          IF NOT p_dry_run THEN
            -- Delete related records first
            DELETE FROM wallet_balances WHERE user_id = r_account.id;
            DELETE FROM balance_ledger WHERE user_id = r_account.id;
            DELETE FROM pending_tickets WHERE user_id = r_account.privy_user_id OR user_id = r_account.canonical_user_id;
            -- Delete the account
            DELETE FROM privy_user_connections WHERE id = r_account.id;
          END IF;
          v_deleted_accounts := array_append(v_deleted_accounts, r_account.privy_user_id);
          v_total_deleted := v_total_deleted + 1;
        ELSE
          -- Different wallet - just clear the email
          IF NOT p_dry_run THEN
            UPDATE privy_user_connections SET email = NULL, updated_at = NOW() WHERE id = r_account.id;
          END IF;
          v_cleared_emails := array_append(v_cleared_emails, r_account.privy_user_id);
          v_total_cleared := v_total_cleared + 1;
        END IF;
      END IF;
    END LOOP;

    -- Add group info
    v_group_info := array_append(v_group_info, jsonb_build_object(
      'email', r_email.email,
      'account_count', r_email.cnt,
      'keeping', v_keep_account,
      'accounts', v_accounts_for_email
    ));
  END LOOP;

  v_result := jsonb_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'duplicate_email_count', array_length(v_group_info, 1),
    'accounts_deleted', v_total_deleted,
    'emails_cleared', v_total_cleared,
    'deleted_accounts', v_deleted_accounts,
    'cleared_emails', v_cleared_emails,
    'groups', to_jsonb(v_group_info)
  );

  IF p_dry_run THEN
    v_result := v_result || jsonb_build_object(
      'message', 'Dry run completed. No changes made. Call with p_dry_run=FALSE to execute.'
    );
  ELSE
    v_result := v_result || jsonb_build_object(
      'message', format('Cleanup completed. Deleted %s accounts, cleared %s emails.', v_total_deleted, v_total_cleared)
    );
  END IF;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;

-- Grant execute to service role only (admin operation)
GRANT EXECUTE ON FUNCTION cleanup_duplicate_email_accounts(BOOLEAN) TO service_role;

-- =====================================================
-- PART 2: VALIDATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'CLEANUP DUPLICATE EMAIL ACCOUNTS FUNCTION CREATED';
  RAISE NOTICE '=============================================';
  RAISE NOTICE 'Usage:';
  RAISE NOTICE '  Dry run: SELECT cleanup_duplicate_email_accounts(TRUE);';
  RAISE NOTICE '  Execute: SELECT cleanup_duplicate_email_accounts(FALSE);';
  RAISE NOTICE '=============================================';
END $$;

COMMIT;
