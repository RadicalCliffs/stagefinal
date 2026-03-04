-- ============================================================================
-- COMPREHENSIVE FIX: Update ALL functions referencing competitionid
-- ============================================================================
-- NO DROPS, NO CASCADES - Just fixing function bodies
-- Changes jc.competitionid -> jc.competition_id everywhere
-- ============================================================================

-- ============================================================================
-- 1. check_and_mark_competition_sold_out
-- ============================================================================
CREATE OR REPLACE FUNCTION check_and_mark_competition_sold_out(p_competition_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_total_tickets INTEGER;
  v_sold_count INTEGER;
  v_is_sold_out BOOLEAN := FALSE;
BEGIN
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN FALSE;
  END IF;

  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_competition_uuid FROM competitions WHERE uid = p_competition_id LIMIT 1;
    IF v_competition_uuid IS NULL THEN RETURN FALSE; END IF;
  END;

  SELECT total_tickets INTO v_total_tickets FROM competitions WHERE id = v_competition_uuid;
  IF v_total_tickets IS NULL THEN RETURN FALSE; END IF;

  SELECT COALESCE(SUM(numberoftickets), 0) INTO v_sold_count
  FROM joincompetition
  WHERE competition_id = v_competition_uuid;  -- FIXED: was competitionid

  IF v_sold_count >= v_total_tickets THEN
    v_is_sold_out := TRUE;
    UPDATE competitions SET status = 'sold_out' WHERE id = v_competition_uuid AND status != 'sold_out';
  END IF;

  RETURN v_is_sold_out;
END;
$$;

-- ============================================================================
-- 2. get_unavailable_tickets (UUID version)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_unavailable_tickets(competition_id UUID)
RETURNS INT4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  IF competition_id IS NULL THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- joincompetition - FIXED: use competition_id column
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE joincompetition.competition_id = get_unavailable_tickets.competition_id  -- FIXED: was competitionid
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  SELECT COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets
  FROM tickets
  WHERE tickets.competition_id = get_unavailable_tickets.competition_id;

  SELECT COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[])
  INTO v_pending
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE pending_tickets.competition_id = get_unavailable_tickets.competition_id
      AND status IN ('pending', 'processing')
      AND expires_at > NOW()
  ) AS pt;

  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;
  
  SELECT array_agg(DISTINCT t) INTO v_unavailable
  FROM unnest(v_unavailable) AS t
  WHERE t IS NOT NULL;

  RETURN COALESCE(v_unavailable, ARRAY[]::INTEGER[]);
END;
$$;

-- ============================================================================
-- 3. get_competition_unavailable_tickets (UUID version)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id UUID)
RETURNS TABLE(ticket_number INTEGER, source TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_uid TEXT;
BEGIN
  SELECT uid INTO v_comp_uid FROM competitions WHERE id = p_competition_id;

  RETURN QUERY

  -- From joincompetition - FIXED: use competition_id column
  SELECT
    CAST(trim(t_num) AS INTEGER) AS ticket_number,
    'sold'::TEXT AS source
  FROM (
    SELECT unnest(string_to_array(ticketnumbers, ',')) AS t_num
    FROM joincompetition
    WHERE competition_id = p_competition_id  -- FIXED: was competitionid
      AND ticketnumbers IS NOT NULL
      AND trim(ticketnumbers) != ''
  ) jc_parsed
  WHERE t_num IS NOT NULL AND trim(t_num) != ''

  UNION ALL

  SELECT
    t.ticket_number,
    'sold'::TEXT
  FROM tickets t
  WHERE t.competition_id = p_competition_id

  UNION ALL

  SELECT
    unnest(pt.ticket_numbers) AS ticket_number,
    'pending'::TEXT
  FROM pending_tickets pt
  WHERE pt.competition_id = p_competition_id
    AND pt.status = 'pending'
    AND pt.expires_at > NOW();
END;
$$;

-- ============================================================================
-- 4. get_competition_ticket_availability_text (TEXT wrapper)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_competition_ticket_availability_text(competition_id_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_competition_id_as_text TEXT;
  v_total_tickets INTEGER := 0;
  v_available_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_count INTEGER := 0;
  v_available_count INTEGER := 0;
  v_sold_tickets_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets_t INTEGER[] := ARRAY[]::INTEGER[];
  v_pending_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_all_sold INTEGER[] := ARRAY[]::INTEGER[];
  v_competition_exists BOOLEAN := FALSE;
  v_comp_uid TEXT;
BEGIN
  IF competition_id_text IS NULL OR TRIM(competition_id_text) = '' THEN
    RETURN json_build_object(
      'competition_id', competition_id_text, 'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[], 'sold_count', 0, 'available_count', 0
    );
  END IF;

  BEGIN
    v_competition_uuid := competition_id_text::UUID;
    v_competition_id_as_text := competition_id_text;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c WHERE c.uid = competition_id_text LIMIT 1;
    v_competition_id_as_text := competition_id_text;
  END;

  IF v_competition_uuid IS NULL THEN
    RETURN json_build_object(
      'competition_id', competition_id_text, 'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[], 'sold_count', 0,
      'available_count', 0, 'error', 'Competition not found'
    );
  END IF;

  SELECT TRUE, COALESCE(c.total_tickets, 1000), c.uid
  INTO v_competition_exists, v_total_tickets, v_comp_uid
  FROM competitions c WHERE c.id = v_competition_uuid;

  IF NOT COALESCE(v_competition_exists, FALSE) THEN
    RETURN json_build_object(
      'competition_id', competition_id_text, 'total_tickets', 0,
      'available_tickets', ARRAY[]::INTEGER[], 'sold_count', 0,
      'available_count', 0, 'error', 'Competition not found'
    );
  END IF;

  -- joincompetition - FIXED: use competition_id column
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE competition_id = v_competition_uuid  -- FIXED: was competitionid
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  SELECT COALESCE(array_agg(ticket_number), ARRAY[]::INTEGER[])
  INTO v_sold_tickets_t
  FROM tickets
  WHERE competition_id = v_competition_uuid;

  SELECT COALESCE(array_agg(ticket_num), ARRAY[]::INTEGER[])
  INTO v_pending_tickets
  FROM (
    SELECT unnest(ticket_numbers) AS ticket_num
    FROM pending_tickets
    WHERE competition_id = v_competition_uuid
      AND status = 'pending'
      AND expires_at > NOW()
  ) AS pt;

  v_all_sold := v_sold_tickets_jc || v_sold_tickets_t || v_pending_tickets;

  SELECT array_agg(DISTINCT ticket_num) INTO v_all_sold
  FROM unnest(v_all_sold) AS ticket_num
  WHERE ticket_num IS NOT NULL;

  v_sold_count := COALESCE(array_length(v_all_sold, 1), 0);

  SELECT array_agg(n) INTO v_available_tickets
  FROM generate_series(1, v_total_tickets) AS n
  WHERE n != ALL(COALESCE(v_all_sold, ARRAY[]::INTEGER[]));

  v_available_count := COALESCE(array_length(v_available_tickets, 1), 0);

  RETURN json_build_object(
    'competition_id', v_competition_uuid,
    'total_tickets', v_total_tickets,
    'available_tickets', COALESCE(v_available_tickets, ARRAY[]::INTEGER[]),
    'sold_count', v_sold_count,
    'available_count', v_available_count
  );
END;
$$;

-- ============================================================================
-- 5. get_competition_entries_bypass_rls
-- ============================================================================
CREATE OR REPLACE FUNCTION get_competition_entries_bypass_rls(competition_identifier TEXT)
RETURNS TABLE (
  uid TEXT, competitionid TEXT, userid TEXT, privy_user_id TEXT,
  numberoftickets INTEGER, ticketnumbers TEXT, amountspent NUMERIC,
  wallet_address TEXT, chain TEXT, transactionhash TEXT,
  purchasedate TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  comp_uuid UUID := NULL;
  comp_uid_text TEXT := NULL;
BEGIN
  IF competition_identifier IS NULL OR TRIM(competition_identifier) = '' THEN
    RETURN;
  END IF;

  BEGIN
    comp_uuid := competition_identifier::UUID;
    comp_uid_text := competition_identifier;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO comp_uuid, comp_uid_text
    FROM competitions c WHERE c.uid = competition_identifier LIMIT 1;
  END;

  IF comp_uuid IS NOT NULL AND (comp_uid_text IS NULL OR comp_uid_text = competition_identifier) THEN
    SELECT c.uid INTO comp_uid_text FROM competitions c WHERE c.id = comp_uuid LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid::TEXT, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competition_id::TEXT, '')::TEXT,  -- FIXED: was competitionid
    COALESCE(jc.userid::TEXT, '')::TEXT,
    COALESCE(jc.privy_user_id, jc.wallet_address, '')::TEXT,
    COALESCE(jc.numberoftickets, 1)::INTEGER,
    COALESCE(jc.ticketnumbers, '')::TEXT,
    COALESCE(jc.amountspent, 0)::NUMERIC,
    COALESCE(jc.wallet_address, '')::TEXT,
    COALESCE(jc.chain, 'Base')::TEXT,
    COALESCE(jc.transactionhash, '')::TEXT,
    COALESCE(jc.purchasedate, jc.created_at, NOW())::TIMESTAMPTZ,
    COALESCE(jc.created_at, NOW())::TIMESTAMPTZ
  FROM joincompetition jc
  WHERE jc.competition_id = comp_uuid  -- FIXED: was competitionid = competition_identifier

  UNION ALL

  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'unknown') || '-' || t.competition_id::TEXT)::TEXT,
    COALESCE(t.competition_id::TEXT, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COALESCE(t.user_id, '')::TEXT,
    COUNT(*)::INTEGER,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number)::TEXT,
    COALESCE(SUM(t.purchase_price), 0)::NUMERIC,
    COALESCE(t.user_id, '')::TEXT,
    'USDC'::TEXT,
    ''::TEXT,
    MIN(t.created_at)::TIMESTAMPTZ,
    MIN(t.created_at)::TIMESTAMPTZ
  FROM tickets t
  WHERE comp_uuid IS NOT NULL
    AND t.competition_id = comp_uuid
    AND NOT EXISTS (
      SELECT 1 FROM joincompetition jc2
      WHERE jc2.competition_id = comp_uuid  -- FIXED: was competitionid
        AND (jc2.canonical_user_id = t.canonical_user_id
          OR LOWER(jc2.wallet_address) = LOWER(t.user_id)
          OR jc2.userid::TEXT = t.user_id)
    )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id

  UNION ALL

  SELECT
    ('pending-' || pt.id::TEXT)::TEXT,
    COALESCE(pt.competition_id::TEXT, '')::TEXT,
    COALESCE(pt.user_id, '')::TEXT,
    COALESCE(pt.user_id, '')::TEXT,
    COALESCE(pt.ticket_count, 0)::INTEGER,
    COALESCE(array_to_string(pt.ticket_numbers, ','), '')::TEXT,
    COALESCE(pt.total_amount, 0)::NUMERIC,
    COALESCE(pt.user_id, '')::TEXT,
    'USDC'::TEXT,
    ''::TEXT,
    COALESCE(pt.created_at, NOW())::TIMESTAMPTZ,
    COALESCE(pt.created_at, NOW())::TIMESTAMPTZ
  FROM pending_tickets pt
  WHERE pt.competition_id = comp_uuid
    AND pt.status = 'pending'
    AND pt.expires_at > NOW();
END;
$$;

-- ============================================================================
-- 6. get_user_entries_bypass_rls
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_entries_bypass_rls(user_identifier TEXT)
RETURNS TABLE (
  uid TEXT, competition_id TEXT, title TEXT, description TEXT,
  image TEXT, status TEXT, entry_type TEXT, is_winner BOOLEAN,
  ticket_numbers TEXT, ticket_count INTEGER, amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ, transaction_hash TEXT,
  is_instant_win BOOLEAN, prize_value NUMERIC,
  competition_status TEXT, end_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  resolved_canonical_user_id TEXT;
  resolved_wallet_address TEXT;
  resolved_base_wallet_address TEXT;
  resolved_eth_wallet_address TEXT;
  resolved_privy_user_id TEXT;
  resolved_uid TEXT;
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  lower_identifier := LOWER(TRIM(user_identifier));

  IF user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(user_identifier FROM 11));
  ELSIF user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  SELECT
    cu.privy_user_id,
    LOWER(cu.wallet_address),
    LOWER(cu.base_wallet_address),
    LOWER(cu.eth_wallet_address),
    cu.privy_user_id,
    cu.uid
  INTO
    resolved_canonical_user_id,
    resolved_wallet_address,
    resolved_base_wallet_address,
    resolved_eth_wallet_address,
    resolved_privy_user_id,
    resolved_uid
  FROM canonical_users cu
  WHERE cu.privy_user_id = user_identifier
    OR cu.uid = user_identifier
    OR (search_wallet IS NOT NULL AND (
      LOWER(cu.wallet_address) = search_wallet
      OR LOWER(cu.base_wallet_address) = search_wallet
      OR LOWER(cu.eth_wallet_address) = search_wallet
    ))
  LIMIT 1;

  RETURN QUERY

  SELECT
    COALESCE(jc.uid, 'jc-' || COALESCE(jc.competition_id::TEXT, '') || '-' || COALESCE(jc.wallet_address, '') || '-' || COALESCE(jc.created_at::TEXT, '')),  -- FIXED
    COALESCE(jc.competition_id::TEXT, c.id::TEXT, c.uid),  -- FIXED: was competitionid
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END,
    'competition_entry',
    COALESCE(LOWER(c.winner_address) = LOWER(jc.wallet_address), FALSE),
    COALESCE(jc.ticketnumbers, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.numberoftickets * c.ticket_price, jc.amountspent, 0),
    COALESCE(jc.purchasedate, jc.created_at),
    jc.transactionhash,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'completed'),
    c.end_date
  FROM public.joincompetition jc
  LEFT JOIN public.competitions c ON jc.competition_id = c.id  -- FIXED: simple UUID = UUID join
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND jc.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_wallet_address)
    OR (resolved_base_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_base_wallet_address)
    OR (resolved_eth_wallet_address IS NOT NULL AND LOWER(jc.wallet_address) = resolved_eth_wallet_address)
    OR (resolved_privy_user_id IS NOT NULL AND jc.privy_user_id = resolved_privy_user_id)
    OR (resolved_uid IS NOT NULL AND jc.userid::TEXT = resolved_uid)
    OR (resolved_canonical_user_id IS NULL AND (
      jc.canonical_user_id = user_identifier
      OR LOWER(jc.wallet_address) = lower_identifier
      OR jc.userid::TEXT = user_identifier
      OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
    ))
  )
  AND jc.competition_id IS NOT NULL  -- FIXED: was competitionid
  AND (c.id IS NOT NULL OR jc.competition_id IS NOT NULL)  -- FIXED

  UNION ALL

  SELECT
    ('tickets-' || COALESCE(t.canonical_user_id, t.user_id, 'anon-' || t.competition_id::TEXT) || '-' || t.competition_id::TEXT)::TEXT,
    t.competition_id::TEXT,
    COALESCE(c.title, ''), COALESCE(c.description, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    CASE
      WHEN c.winner_address IS NOT NULL THEN 'completed'
      WHEN c.status = 'active' THEN 'live'
      WHEN c.status IN ('drawn', 'completed') THEN 'completed'
      ELSE COALESCE(c.status, 'live')
    END,
    'competition_entry',
    FALSE,
    string_agg(t.ticket_number::TEXT, ',' ORDER BY t.ticket_number),
    COUNT(*)::INTEGER,
    COALESCE(SUM(t.purchase_price), 0),
    MIN(t.created_at),
    NULL,
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value,
    COALESCE(c.status, 'active'),
    c.end_date
  FROM public.tickets t
  LEFT JOIN public.competitions c ON t.competition_id = c.id
  WHERE (
    (resolved_canonical_user_id IS NOT NULL AND t.canonical_user_id = resolved_canonical_user_id)
    OR (resolved_wallet_address IS NOT NULL AND LOWER(t.user_id) = resolved_wallet_address)
    OR (search_wallet IS NOT NULL AND LOWER(t.user_id) = search_wallet)
  )
  GROUP BY t.competition_id, t.canonical_user_id, t.user_id,
    c.title, c.description, c.image_url, c.imageurl, c.status,
    c.winner_address, c.is_instant_win, c.prize_value, c.end_date

  ORDER BY purchase_date DESC;
END;
$$;

-- ============================================================================
-- 7. get_user_competitions
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_competitions(p_user_identifier TEXT)
RETURNS TABLE (
  uid TEXT, competition_id TEXT, title TEXT, image TEXT,
  ticket_count INTEGER, ticket_numbers TEXT, status TEXT,
  competition_status TEXT, end_date TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  lower_identifier TEXT;
  search_wallet TEXT;
  v_uuid_regex TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  lower_identifier := LOWER(TRIM(p_user_identifier));

  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := lower_identifier;
  ELSE
    search_wallet := NULL;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(jc.uid, jc.id::TEXT, gen_random_uuid()::TEXT),
    COALESCE(jc.competition_id::TEXT, c.id::TEXT),  -- FIXED: was competitionid
    COALESCE(c.title, ''),
    COALESCE(c.image_url, c.imageurl, ''),
    COALESCE(jc.numberoftickets, 0)::INTEGER,
    COALESCE(jc.ticketnumbers, ''),
    'confirmed',
    COALESCE(c.status, 'active'),
    c.end_date,
    COALESCE(jc.created_at, NOW())
  FROM joincompetition jc
  LEFT JOIN competitions c ON jc.competition_id = c.id  -- FIXED: simple UUID = UUID join
  WHERE
    LOWER(jc.wallet_address) = lower_identifier
    OR jc.canonical_user_id = p_user_identifier
    OR jc.privy_user_id = p_user_identifier
    OR jc.userid::TEXT = p_user_identifier
    OR (search_wallet IS NOT NULL AND LOWER(jc.wallet_address) = search_wallet)
  ORDER BY jc.created_at DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_and_mark_competition_sold_out(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_competition_unavailable_tickets(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_user_entries_bypass_rls(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_user_competitions(TEXT) TO authenticated, anon, service_role;

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'COMPREHENSIVE FIX COMPLETE';
  RAISE NOTICE 'Updated ALL functions to use competition_id column';
  RAISE NOTICE 'No data deleted, no cascades, just function updates';
  RAISE NOTICE '========================================================';
END $$;
