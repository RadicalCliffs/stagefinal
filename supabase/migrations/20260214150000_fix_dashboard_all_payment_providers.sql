-- =====================================================
-- FIX DASHBOARD TO SHOW ALL PAYMENT PROVIDERS
-- =====================================================
-- This migration fixes the dashboard to show entries from ALL payment providers:
-- - base_account (Base Account SDK payments)
-- - balance (wallet balance deductions)
-- - coinbase_commerce, coinbase_onramp, etc.
-- 
-- Issues fixed:
-- 1. Orders tab showing "Unknown Competition" - ensure competition JOIN works
-- 2. Entries tab missing base_account entries - sync from user_transactions
-- 3. Competition detail page needs purchase grouping
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Fix get_user_transactions to handle all cases
-- =====================================================
-- Drop and recreate with improved competition name handling
DROP FUNCTION IF EXISTS get_user_transactions(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_transactions(user_identifier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE 
  v_transactions JSONB; 
  v_canonical_user_id TEXT; 
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF user_identifier LIKE 'prize:pid:0x%' THEN 
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN 
    search_wallet := LOWER(user_identifier); 
  END IF;

  -- Resolve canonical user ID
  SELECT cu.canonical_user_id INTO v_canonical_user_id FROM canonical_users cu
  WHERE cu.canonical_user_id = user_identifier 
     OR cu.uid = user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(cu.wallet_address) = search_wallet) 
  LIMIT 1;

  -- Build transactions with competition data enrichment
  -- Improved: Try multiple competition ID formats (id, uid) and handle NULL gracefully
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ut.id,
      'type', ut.type,
      'amount', ut.amount,
      'currency', ut.currency,
      'status', ut.status,
      'payment_status', ut.payment_status,
      'competition_id', ut.competition_id,
      -- FIXED: Better competition name handling with uid fallback
      'competition_name', COALESCE(
        c.title,
        c2.title,
        CASE 
          WHEN ut.type = 'topup' THEN 'Wallet Top-Up'
          WHEN ut.competition_id IS NOT NULL THEN 'Unknown Competition'
          ELSE NULL
        END
      ),
      'competition_image', COALESCE(c.image_url, c2.image_url),
      'ticket_count', ut.ticket_count,
      'ticket_numbers', ut.ticket_numbers,
      'created_at', ut.created_at,
      'completed_at', ut.completed_at,
      'payment_method', ut.method,
      'payment_provider', COALESCE(ut.payment_provider, 'unknown'),
      'tx_id', ut.tx_id,
      'transaction_hash', ut.transaction_hash,
      'order_id', ut.order_id,
      'webhook_ref', ut.webhook_ref,
      'metadata', COALESCE(ut.metadata, '{}'::jsonb),
      'balance_before', ut.balance_before,
      'balance_after', ut.balance_after,
      'is_topup', (ut.type = 'topup'),
      -- Additional fields for Orders tab
      'purchase_date', COALESCE(ut.completed_at, ut.created_at),
      'end_date', COALESCE(c.end_date, c.end_time, c2.end_date, c2.end_time),
      'is_winner', false  -- Not tracked in user_transactions
    ) 
    ORDER BY ut.created_at DESC
  ) INTO v_transactions
  FROM user_transactions ut
  LEFT JOIN competitions c ON ut.competition_id = c.id
  LEFT JOIN competitions c2 ON ut.competition_id::text = c2.uid
  WHERE ut.user_id = user_identifier 
     OR ut.canonical_user_id = v_canonical_user_id 
     OR ut.user_id = v_canonical_user_id
     OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  LIMIT 200; -- Increased limit to show more history

  -- Return array directly
  RETURN COALESCE(v_transactions, '[]'::jsonb);
END;
$function$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_transactions(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_user_transactions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_transactions(TEXT) TO service_role;

-- =====================================================
-- PART 2: Create trigger to sync user_transactions → competition_entries
-- =====================================================
-- This ensures that entries from ALL payment providers (base_account, balance, etc.)
-- are properly tracked in competition_entries, not just joincompetition entries

CREATE OR REPLACE FUNCTION public.sync_competition_entries_from_user_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_existing_entry_id uuid;
BEGIN
  -- Only process completed competition entries (not top-ups)
  IF NEW.type != 'topup' 
     AND NEW.competition_id IS NOT NULL 
     AND NEW.status IN ('completed', 'confirmed', 'success')
     AND NEW.ticket_count > 0
  THEN
    -- Resolve canonical_user_id
    v_canonical_user_id := COALESCE(NEW.canonical_user_id, NEW.user_privy_id, NEW.user_id);
    
    IF v_canonical_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Check if entry already exists
    SELECT id INTO v_existing_entry_id
    FROM public.competition_entries
    WHERE canonical_user_id = v_canonical_user_id
      AND competition_id = NEW.competition_id;

    IF v_existing_entry_id IS NOT NULL THEN
      -- Update existing entry
      UPDATE public.competition_entries
      SET
        tickets_count = COALESCE(tickets_count, 0) + COALESCE(NEW.ticket_count, 0),
        amount_spent = COALESCE(amount_spent, 0) + COALESCE(ABS(NEW.amount), 0),
        latest_purchase_at = GREATEST(
          COALESCE(latest_purchase_at, NEW.completed_at, NEW.created_at),
          COALESCE(NEW.completed_at, NEW.created_at)
        ),
        updated_at = NOW()
      WHERE id = v_existing_entry_id;
    ELSE
      -- Insert new entry
      INSERT INTO public.competition_entries (
        id,
        canonical_user_id,
        competition_id,
        wallet_address,
        tickets_count,
        amount_spent,
        latest_purchase_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_canonical_user_id,
        NEW.competition_id,
        NEW.wallet_address,
        COALESCE(NEW.ticket_count, 0),
        COALESCE(ABS(NEW.amount), 0),
        COALESCE(NEW.completed_at, NEW.created_at),
        NOW(),
        NOW()
      )
      ON CONFLICT (canonical_user_id, competition_id) 
      DO UPDATE SET
        tickets_count = competition_entries.tickets_count + COALESCE(NEW.ticket_count, 0),
        amount_spent = competition_entries.amount_spent + COALESCE(ABS(NEW.amount), 0),
        latest_purchase_at = GREATEST(
          competition_entries.latest_purchase_at,
          COALESCE(NEW.completed_at, NEW.created_at)
        ),
        updated_at = NOW();
    END IF;

    -- Also ensure the purchase is recorded in competition_entries_purchases
    INSERT INTO public.competition_entries_purchases (
      id,
      canonical_user_id,
      competition_id,
      purchase_key,
      tickets_count,
      amount_spent,
      ticket_numbers_csv,
      purchased_at,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_canonical_user_id,
      NEW.competition_id,
      'ut_' || NEW.id::text,
      COALESCE(NEW.ticket_count, 0),
      COALESCE(ABS(NEW.amount), 0),
      NEW.ticket_numbers,
      COALESCE(NEW.completed_at, NEW.created_at),
      NOW()
    )
    ON CONFLICT (canonical_user_id, competition_id, purchase_key)
    DO UPDATE SET
      tickets_count = EXCLUDED.tickets_count,
      amount_spent = EXCLUDED.amount_spent,
      ticket_numbers_csv = EXCLUDED.ticket_numbers_csv,
      purchased_at = EXCLUDED.purchased_at;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on user_transactions table
DROP TRIGGER IF EXISTS trg_sync_competition_entries_from_ut ON public.user_transactions;
CREATE TRIGGER trg_sync_competition_entries_from_ut
  AFTER INSERT OR UPDATE ON public.user_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_competition_entries_from_user_transactions();

-- =====================================================
-- PART 3: Backfill missing entries from user_transactions
-- =====================================================
-- This ensures all historical base_account and other payment provider entries
-- are present in competition_entries

DO $$
DECLARE
  v_result RECORD;
  v_inserted_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  -- Insert/update entries from user_transactions that aren't in competition_entries
  -- Count inserts and updates using a CTE
  WITH aggregated_transactions AS (
    SELECT
      COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id) as canonical_user_id,
      ut.competition_id,
      ut.wallet_address,
      SUM(COALESCE(ut.ticket_count, 0)) as total_tickets,
      SUM(COALESCE(ABS(ut.amount), 0)) as total_amount,
      MAX(COALESCE(ut.completed_at, ut.created_at)) as latest_purchase,
      MIN(ut.created_at) as first_purchase
    FROM user_transactions ut
    WHERE ut.type != 'topup'
      AND ut.competition_id IS NOT NULL
      AND ut.status IN ('completed', 'confirmed', 'success')
      AND ut.ticket_count > 0
      AND COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id) IS NOT NULL
    GROUP BY 
      COALESCE(ut.canonical_user_id, ut.user_privy_id, ut.user_id),
      ut.competition_id,
      ut.wallet_address
  ),
  upsert_results AS (
    INSERT INTO competition_entries (
      id,
      canonical_user_id,
      competition_id,
      wallet_address,
      tickets_count,
      amount_spent,
      latest_purchase_at,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      at.canonical_user_id,
      at.competition_id,
      at.wallet_address,
      at.total_tickets,
      at.total_amount,
      at.latest_purchase,
      at.first_purchase,
      NOW()
    FROM aggregated_transactions at
    ON CONFLICT (canonical_user_id, competition_id)
    DO UPDATE SET
      tickets_count = competition_entries.tickets_count + EXCLUDED.tickets_count,
      amount_spent = competition_entries.amount_spent + EXCLUDED.amount_spent,
      latest_purchase_at = GREATEST(competition_entries.latest_purchase_at, EXCLUDED.latest_purchase_at),
      updated_at = NOW()
    RETURNING 
      CASE WHEN xmax = 0 THEN 1 ELSE 0 END as is_insert,
      CASE WHEN xmax != 0 THEN 1 ELSE 0 END as is_update
  )
  SELECT 
    SUM(is_insert) as inserts,
    SUM(is_update) as updates
  INTO v_result
  FROM upsert_results;

  v_inserted_count := COALESCE(v_result.inserts, 0);
  v_updated_count := COALESCE(v_result.updates, 0);

  RAISE NOTICE 'Backfill complete: % new entries, % updated entries', v_inserted_count, v_updated_count;
END $$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260214150000 complete: Dashboard now shows all payment providers';
  RAISE NOTICE '- get_user_transactions improved with better competition name handling';
  RAISE NOTICE '- Trigger created to sync user_transactions → competition_entries';
  RAISE NOTICE '- Historical entries backfilled from user_transactions';
  RAISE NOTICE '- All payment providers (base_account, balance, etc.) now tracked';
END $$;
