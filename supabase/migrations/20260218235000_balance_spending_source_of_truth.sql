-- Balance and Spending Source of Truth Implementation
-- This migration ensures:
-- 1. sub_account_balances.available_balance is the source of truth for balance
-- 2. joincompetition is the source of truth for spending (with payment_provider filter)
-- 3. Spending calculation: if payment_provider != 'base_account', it was paid with balance

-- ============================================================================
-- Function: get_user_balance_spending
-- Returns user's current balance and total spent using balance payments
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_balance_spending(
  p_user_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
  v_available_balance NUMERIC := 0;
  v_bonus_balance NUMERIC := 0;
  v_pending_balance NUMERIC := 0;
  v_total_spent NUMERIC := 0;
BEGIN
  -- Normalize user identifier to canonical format
  IF p_user_identifier LIKE 'prize:pid:%' THEN
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := LOWER(REPLACE(p_user_identifier, 'prize:pid:', ''));
  ELSIF p_user_identifier LIKE '0x%' THEN
    v_wallet_address := LOWER(p_user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_wallet_address;
  ELSE
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := p_user_identifier;
  END IF;

  -- Get balance from sub_account_balances (SOURCE OF TRUTH for balance)
  SELECT 
    COALESCE(available_balance, 0),
    COALESCE(bonus_balance, 0),
    COALESCE(pending_balance, 0)
  INTO 
    v_available_balance,
    v_bonus_balance,
    v_pending_balance
  FROM public.sub_account_balances
  WHERE canonical_user_id = v_canonical_user_id
    AND currency = 'USD'
  LIMIT 1;

  -- Get total spent from joincompetition (SOURCE OF TRUTH for spending)
  -- CRITICAL: Only count entries where payment_provider != 'base_account'
  -- If payment_provider is NOT base_account, it means the user paid with their balance
  SELECT COALESCE(SUM(
    CASE 
      WHEN jc.ticketCount IS NOT NULL AND c.ticket_price IS NOT NULL THEN
        jc.ticketCount * c.ticket_price
      ELSE 0
    END
  ), 0)
  INTO v_total_spent
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id
  WHERE (
    -- Match by canonical_user_id or userid or wallet
    jc.userid = v_canonical_user_id
    OR LOWER(jc.userid) = v_wallet_address
    OR jc.canonical_user_id = v_canonical_user_id
  )
  AND (
    -- CRITICAL FILTER: Only count balance payments
    -- If payment_provider is NULL or empty, assume it's a balance payment (legacy entries)
    -- If payment_provider exists and is NOT 'base_account', it's a balance payment
    jc.payment_provider IS NULL
    OR jc.payment_provider = ''
    OR jc.payment_provider != 'base_account'
  );

  RETURN jsonb_build_object(
    'success', true,
    'balance', v_available_balance,
    'bonus_balance', v_bonus_balance,
    'pending_balance', v_pending_balance,
    'total_balance', v_available_balance + v_bonus_balance,
    'total_spent_with_balance', v_total_spent,
    'canonical_user_id', v_canonical_user_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_code', 'INTERNAL_ERROR'
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_user_balance_spending(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_balance_spending(TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION public.get_user_balance_spending IS 
'Returns user balance and spending statistics.
Balance source: sub_account_balances.available_balance
Spending source: joincompetition table (filtered by payment_provider != base_account)';

-- ============================================================================
-- Function: get_user_competition_entries
-- Returns detailed competition entries for a user with spending info
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(
  p_user_identifier TEXT
)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  user_id TEXT,
  canonical_user_id TEXT,
  wallet_address TEXT,
  ticket_numbers INTEGER[],
  ticket_count INTEGER,
  amount_paid NUMERIC,
  currency TEXT,
  transaction_hash TEXT,
  payment_provider TEXT,
  entry_status TEXT,
  is_winner BOOLEAN,
  prize_claimed BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  competition_title TEXT,
  competition_description TEXT,
  competition_image_url TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  competition_prize_value NUMERIC,
  competition_is_instant_win BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
BEGIN
  -- Normalize user identifier
  IF p_user_identifier LIKE 'prize:pid:%' THEN
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := LOWER(REPLACE(p_user_identifier, 'prize:pid:', ''));
  ELSIF p_user_identifier LIKE '0x%' THEN
    v_wallet_address := LOWER(p_user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_wallet_address;
  ELSE
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := p_user_identifier;
  END IF;

  RETURN QUERY
  SELECT
    jc.uid::TEXT AS id,
    jc.competitionid AS competition_id,
    jc.userid AS user_id,
    jc.canonical_user_id,
    jc.wallet_address,
    jc.tickets AS ticket_numbers,
    jc.ticketCount AS ticket_count,
    -- Calculate amount from joincompetition (source of truth)
    CASE 
      WHEN jc.ticketCount IS NOT NULL AND c.ticket_price IS NOT NULL THEN
        jc.ticketCount * c.ticket_price
      ELSE 0
    END AS amount_paid,
    'USD' AS currency,
    jc.transactionhash AS transaction_hash,
    COALESCE(jc.payment_provider, 'balance_payment') AS payment_provider,
    COALESCE(jc.status, 'completed') AS entry_status,
    COALESCE(jc.is_winner, false) AS is_winner,
    COALESCE(jc.prize_claimed, false) AS prize_claimed,
    jc.created_at,
    COALESCE(jc.updated_at, jc.created_at) AS updated_at,
    c.title AS competition_title,
    c.description AS competition_description,
    c.image_url AS competition_image_url,
    c.status AS competition_status,
    c.end_date AS competition_end_date,
    c.prize_value AS competition_prize_value,
    COALESCE(c.is_instant_win, false) AS competition_is_instant_win
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id
  WHERE (
    jc.userid = v_canonical_user_id
    OR LOWER(jc.userid) = v_wallet_address
    OR jc.canonical_user_id = v_canonical_user_id
  )
  ORDER BY jc.created_at DESC;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_competition_entries(TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION public.get_user_competition_entries IS 
'Returns all competition entries for a user.
Source: joincompetition table (source of truth for entries and spending)
Amount calculation: ticketCount * competition.ticket_price';

-- ============================================================================
-- Function: get_comprehensive_user_dashboard_entries
-- Returns dashboard entries with competition details
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_comprehensive_user_dashboard_entries(
  p_user_identifier TEXT
)
RETURNS TABLE (
  id TEXT,
  competition_id TEXT,
  title TEXT,
  description TEXT,
  image TEXT,
  status TEXT,
  entry_type TEXT,
  expires_at TIMESTAMPTZ,
  is_winner BOOLEAN,
  ticket_numbers TEXT,
  number_of_tickets INTEGER,
  amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  wallet_address TEXT,
  transaction_hash TEXT,
  is_instant_win BOOLEAN,
  prize_value TEXT,
  competition_status TEXT,
  end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_wallet_address TEXT;
BEGIN
  -- Normalize user identifier
  IF p_user_identifier LIKE 'prize:pid:%' THEN
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := LOWER(REPLACE(p_user_identifier, 'prize:pid:', ''));
  ELSIF p_user_identifier LIKE '0x%' THEN
    v_wallet_address := LOWER(p_user_identifier);
    v_canonical_user_id := 'prize:pid:' || v_wallet_address;
  ELSE
    v_canonical_user_id := p_user_identifier;
    v_wallet_address := p_user_identifier;
  END IF;

  RETURN QUERY
  SELECT
    jc.uid::TEXT AS id,
    jc.competitionid AS competition_id,
    c.title,
    c.description,
    c.image_url AS image,
    CASE
      WHEN c.status = 'completed' OR c.status = 'drawn' THEN 'completed'
      WHEN c.status = 'active' OR c.status = 'live' THEN 'live'
      ELSE COALESCE(c.status, 'pending')
    END AS status,
    'finalized' AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at,
    COALESCE(jc.is_winner, false) AS is_winner,
    array_to_string(jc.tickets, ',') AS ticket_numbers,
    jc.ticketCount AS number_of_tickets,
    -- Calculate amount from joincompetition (source of truth for spending)
    CASE 
      WHEN jc.ticketCount IS NOT NULL AND c.ticket_price IS NOT NULL THEN
        jc.ticketCount * c.ticket_price
      ELSE 0
    END AS amount_spent,
    jc.created_at AS purchase_date,
    jc.wallet_address,
    jc.transactionhash AS transaction_hash,
    COALESCE(c.is_instant_win, false) AS is_instant_win,
    c.prize_value::TEXT AS prize_value,
    c.status AS competition_status,
    c.end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competitionid = c.id
  WHERE (
    jc.userid = v_canonical_user_id
    OR LOWER(jc.userid) = v_wallet_address
    OR jc.canonical_user_id = v_canonical_user_id
  )
  ORDER BY jc.created_at DESC;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_comprehensive_user_dashboard_entries(TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION public.get_comprehensive_user_dashboard_entries IS 
'Returns comprehensive dashboard entries for a user.
Source: joincompetition table (source of truth for entries and spending)
Amount calculation: ticketCount * competition.ticket_price';
