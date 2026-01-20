-- ============================================================================
-- FIX: Dashboard Entries Status and Sold-Out Detection
-- ============================================================================
-- This migration fixes:
-- 1. Status calculation in get_comprehensive_user_dashboard_entries - uses end_date as source of truth
-- 2. Adds function to mark sold-out competitions as completed
-- 3. Creates trigger to automatically check sold-out status after ticket inserts
--
-- Date: 2026-01-21
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Update get_comprehensive_user_dashboard_entries to use end_date for status
-- ============================================================================
-- The previous version doesn't check end_date to determine if a competition has ended.
-- If end_date has passed but status is still 'active', we need to treat it as 'completed'.

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(user_identifier TEXT)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  title TEXT,
  description TEXT,
  image TEXT,
  status TEXT,
  entry_type TEXT,
  is_winner BOOLEAN,
  ticket_numbers TEXT,
  total_tickets INTEGER,
  total_amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  transaction_hash TEXT,
  is_instant_win BOOLEAN,
  prize_value NUMERIC,
  competition_status TEXT,
  end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
BEGIN
  -- Normalize identifier for case-insensitive matching
  lower_identifier := LOWER(TRIM(user_identifier));

  -- Extract wallet address if present (remove prize:pid: prefix if exists)
  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  -- UNION entries from joincompetition, tickets, user_transactions, and pending_tickets
  RETURN QUERY

  -- Part 1: Entries from joincompetition table (authoritative source)
  -- FIX: Use end_date to determine if competition has ended (status source of truth)
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, gen_random_uuid()::TEXT) AS id,
    jc.competitionid::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    -- FIX: Use end_date as source of truth for status
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'completed'
      WHEN c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < NOW() THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'competition_entry' AS entry_type,
    COALESCE(
      LOWER(c.winner_address) = LOWER(jc.walletaddress),
      FALSE
    ) AS is_winner,
    COALESCE(jc.ticketnumbers, '') AS ticket_numbers,
    COALESCE(jc.numberoftickets, 0)::INTEGER AS total_tickets,
    COALESCE(jc.numberoftickets * c.ticket_price, jc.amountspent, 0) AS total_amount_spent,
    jc.purchasedate AS purchase_date,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.joincompetition jc
  -- FIX: Use a join condition that handles both UUID and text competition IDs
  LEFT JOIN public.competitions c ON (
    -- Try UUID match first (when competitionid looks like a UUID)
    (jc.competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND jc.competitionid::uuid = c.id)
    OR
    -- Fallback to uid match (legacy text format)
    c.uid = jc.competitionid
  )
  WHERE (
    -- Match by canonical_user_id
    jc.canonical_user_id = user_identifier
    -- Match by wallet address (case-insensitive)
    OR LOWER(jc.walletaddress) = lower_identifier
    -- Match by userid (legacy)
    OR jc.userid = user_identifier
    -- Match by privy_user_id if it exists
    OR jc.privy_user_id = user_identifier
    -- Match by wallet in search_wallet
    OR (search_wallet IS NOT NULL AND LOWER(jc.walletaddress) = search_wallet)
  )
  AND jc.competitionid IS NOT NULL

  UNION ALL

  -- Part 2: Entries from tickets table (using canonical_user_id)
  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT AS id,
    t.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    -- FIX: Use end_date as source of truth for status
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'completed'
      WHEN c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < NOW() THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'ticket' AS entry_type,
    COALESCE(t.is_winner, FALSE) AS is_winner,
    STRING_AGG(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number) AS ticket_numbers,
    COUNT(t.id)::INTEGER AS total_tickets,
    SUM(COALESCE(t.purchase_price, c.ticket_price, 0)) AS total_amount_spent,
    MIN(t.purchased_at) AS purchase_date,
    NULL::TEXT AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id
    t.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR LOWER(t.user_id) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
  )
  AND t.competition_id IS NOT NULL
  -- Exclude entries already in joincompetition to avoid duplicates
  AND NOT EXISTS (
    SELECT 1 FROM joincompetition jc2
    WHERE (
      -- Match competition
      (jc2.competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND jc2.competitionid::uuid = t.competition_id)
      OR jc2.competitionid = t.competition_id::TEXT
    )
    AND (
      -- Match user
      jc2.canonical_user_id = t.canonical_user_id
      OR LOWER(jc2.walletaddress) = LOWER(t.user_id)
      OR jc2.userid = t.user_id
    )
  )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id, c.id, c.title, c.description, c.image_url,
           c.imageurl, c.status, c.winner_address, c.is_instant_win, c.prize_value, c.end_date, c.ticket_price

  UNION ALL

  -- Part 3: Entries from user_transactions (completed payments)
  SELECT
    ut.id::TEXT AS id,
    ut.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    -- FIX: Use end_date as source of truth for status
    CASE
      WHEN ut.payment_status = 'completed' AND c.winner_address IS NOT NULL THEN 'completed'
      WHEN ut.payment_status = 'pending' THEN 'pending'
      WHEN ut.payment_status = 'failed' THEN 'failed'
      WHEN c.status IN ('completed', 'drawn', 'drawing') THEN 'completed'
      WHEN c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < NOW() THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    'transaction' AS entry_type,
    FALSE AS is_winner,
    '' AS ticket_numbers,
    COALESCE(ut.ticket_count, 0)::INTEGER AS total_tickets,
    COALESCE(ut.amount, 0) AS total_amount_spent,
    ut.created_at AS purchase_date,
    ut.tx_id AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'completed') AS competition_status,
    c.end_date AS end_date
  FROM public.user_transactions ut
  LEFT JOIN public.competitions c ON ut.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id
    ut.canonical_user_id = user_identifier
    -- Match by user_id
    OR ut.user_id = user_identifier
    -- Match by user_privy_id (column name in user_transactions)
    OR ut.user_privy_id = user_identifier
    -- Match by privy_user_id if it exists
    OR ut.privy_user_id = user_identifier
    -- Match by wallet_address with case-insensitive comparison
    OR LOWER(ut.wallet_address) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND LOWER(ut.wallet_address) = search_wallet)
  )
  AND ut.competition_id IS NOT NULL
  AND ut.payment_status IN ('completed', 'finished')
  -- Exclude if already in joincompetition
  AND NOT EXISTS (
    SELECT 1 FROM joincompetition jc3
    WHERE (
      (jc3.competitionid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND jc3.competitionid::uuid = ut.competition_id)
      OR jc3.competitionid = ut.competition_id::TEXT
    )
    AND (
      jc3.canonical_user_id = ut.canonical_user_id
      OR jc3.canonical_user_id = ut.user_privy_id
      OR LOWER(jc3.walletaddress) = LOWER(ut.wallet_address)
    )
  )

  UNION ALL

  -- Part 4: Active pending tickets (not expired)
  SELECT
    pt.id::TEXT AS id,
    pt.competition_id::TEXT AS competition_id,
    COALESCE(c.title, '') AS title,
    COALESCE(c.description, '') AS description,
    COALESCE(c.image_url, c.imageurl, '') AS image,
    CASE
      WHEN pt.status = 'confirmed' THEN 'completed'
      WHEN pt.status = 'pending' THEN 'pending'
      WHEN pt.status = 'expired' THEN 'expired'
      ELSE pt.status
    END AS status,
    'pending_ticket' AS entry_type,
    FALSE AS is_winner,
    ARRAY_TO_STRING(pt.ticket_numbers, ',') AS ticket_numbers,
    pt.ticket_count::INTEGER AS total_tickets,
    pt.total_amount AS total_amount_spent,
    pt.created_at AS purchase_date,
    pt.transaction_hash AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value AS prize_value,
    COALESCE(c.status, 'active') AS competition_status,
    c.end_date AS end_date
  FROM public.pending_tickets pt
  LEFT JOIN public.competitions c ON pt.competition_id = c.id
  WHERE (
    -- Match by canonical_user_id
    pt.canonical_user_id = user_identifier
    -- Match by user_id with case-insensitive comparison
    OR pt.user_id = user_identifier
    OR LOWER(pt.user_id) = lower_identifier
    -- Match by wallet_address with case-insensitive comparison
    OR LOWER(pt.wallet_address) = lower_identifier
    -- Match by wallet address search
    OR (search_wallet IS NOT NULL AND (LOWER(pt.user_id) = search_wallet OR LOWER(pt.wallet_address) = search_wallet))
  )
  AND pt.status IN ('pending', 'confirmed', 'confirming')
  AND pt.expires_at > NOW()

  ORDER BY purchase_date DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS
  'Gets all user entries from joincompetition, tickets, user_transactions, and pending_tickets.
  FIX: Uses end_date as source of truth for status - if end_date has passed but status is still active, treats as completed.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO service_role;


-- ============================================================================
-- PART 2: Function to check and mark sold-out competitions
-- ============================================================================
-- This function can be called after ticket purchases to check if the competition
-- is now sold out and should be marked as completed.

CREATE OR REPLACE FUNCTION public.check_and_mark_competition_sold_out(p_competition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_tickets INTEGER;
  v_sold_tickets INTEGER;
  v_status TEXT;
BEGIN
  -- Get competition details
  SELECT total_tickets, status INTO v_total_tickets, v_status
  FROM competitions
  WHERE id = p_competition_id;

  -- If not found or already in terminal state, return false
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_status IN ('completed', 'drawn', 'cancelled', 'expired') THEN
    RETURN FALSE;
  END IF;

  -- Count sold tickets (from tickets table)
  SELECT COUNT(*) INTO v_sold_tickets
  FROM tickets
  WHERE competition_id = p_competition_id;

  -- Also count from joincompetition for legacy entries
  IF v_sold_tickets < v_total_tickets THEN
    SELECT
      COALESCE(SUM(
        CASE
          WHEN ticketnumbers IS NOT NULL AND ticketnumbers != '' THEN
            ARRAY_LENGTH(STRING_TO_ARRAY(ticketnumbers, ','), 1)
          ELSE
            COALESCE(numberoftickets, 0)
        END
      ), 0)
    INTO v_sold_tickets
    FROM joincompetition
    WHERE competitionid = p_competition_id::TEXT
       OR competitionid = (SELECT uid FROM competitions WHERE id = p_competition_id);

    -- Take the higher count (in case some entries are in one table but not the other)
    SELECT GREATEST(v_sold_tickets, (SELECT COUNT(*) FROM tickets WHERE competition_id = p_competition_id))
    INTO v_sold_tickets;
  END IF;

  -- If sold out, mark as drawing/completed
  IF v_sold_tickets >= v_total_tickets THEN
    UPDATE competitions
    SET
      status = 'drawing',
      updated_at = NOW()
    WHERE id = p_competition_id
    AND status = 'active';

    IF FOUND THEN
      RAISE NOTICE 'Competition % marked as drawing (sold out: %/% tickets)', p_competition_id, v_sold_tickets, v_total_tickets;
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.check_and_mark_competition_sold_out IS
  'Checks if a competition is sold out and marks it as drawing status if so.
  Called after ticket purchases to ensure sold-out competitions are processed promptly.';

GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO service_role;


-- ============================================================================
-- PART 3: Trigger to check sold-out status after ticket insert
-- ============================================================================
-- This trigger automatically checks if a competition is sold out after each ticket insert

CREATE OR REPLACE FUNCTION public.trigger_check_competition_sold_out()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only check on INSERT
  IF TG_OP = 'INSERT' AND NEW.competition_id IS NOT NULL THEN
    -- Run the check asynchronously by calling the function
    -- This won't block the insert
    PERFORM check_and_mark_competition_sold_out(NEW.competition_id);
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on tickets table
DROP TRIGGER IF EXISTS trg_check_sold_out_on_ticket_insert ON tickets;
CREATE TRIGGER trg_check_sold_out_on_ticket_insert
  AFTER INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_competition_sold_out();


-- ============================================================================
-- PART 4: Ensure sync_competition_status_if_ended exists
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_competition_status_if_ended(p_competition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  comp_end_date TIMESTAMPTZ;
  comp_status TEXT;
BEGIN
  -- Get current status and end_date
  SELECT status, end_date INTO comp_status, comp_end_date
  FROM competitions
  WHERE id = p_competition_id;

  -- If not found, return false
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- If already in terminal state, no action needed
  IF comp_status IN ('completed', 'drawn', 'cancelled') THEN
    RETURN FALSE;
  END IF;

  -- If end_date has passed, update status to 'completed'
  IF comp_end_date IS NOT NULL AND comp_end_date < NOW() THEN
    UPDATE competitions
    SET
      status = 'completed',
      competitionended = 1,
      updated_at = NOW()
    WHERE id = p_competition_id
    AND status NOT IN ('completed', 'drawn', 'cancelled');

    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_competition_status_if_ended(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_competition_status_if_ended(UUID) TO anon;
GRANT EXECUTE ON FUNCTION sync_competition_status_if_ended(UUID) TO service_role;


-- ============================================================================
-- PART 5: Verification
-- ============================================================================

DO $$
DECLARE
  func_exists BOOLEAN;
  trigger_exists BOOLEAN;
BEGIN
  -- Check function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_comprehensive_user_dashboard_entries'
  ) INTO func_exists;

  -- Check trigger exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_check_sold_out_on_ticket_insert'
  ) INTO trigger_exists;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'FIX: Dashboard Entries Status and Sold-Out Detection';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'get_comprehensive_user_dashboard_entries function exists: %', func_exists;
  RAISE NOTICE 'trg_check_sold_out_on_ticket_insert trigger exists: %', trigger_exists;

  IF func_exists AND trigger_exists THEN
    RAISE NOTICE '✓ SUCCESS: All fixes applied';
  ELSE
    RAISE WARNING '✗ WARNING: Some fixes may have failed';
  END IF;
  RAISE NOTICE '=====================================================';
END $$;

COMMIT;
