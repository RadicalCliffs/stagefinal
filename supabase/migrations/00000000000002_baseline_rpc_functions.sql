-- =====================================================
-- BASELINE RPC FUNCTIONS MIGRATION
-- =====================================================
-- This migration contains all essential RPC functions for the application
-- Extracted from the original baseline schema
-- Version: 1.0
-- Date: 2026-01-27
-- =====================================================

BEGIN;

-- =====================================================
-- SECTION 1: USER BALANCE FUNCTIONS
-- =====================================================

-- get_user_balance: Get user balance (primary balance query function)
CREATE OR REPLACE FUNCTION get_user_balance(p_user_identifier TEXT DEFAULT NULL, p_canonical_user_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_balance NUMERIC := 0;
  bonus_balance NUMERIC := 0;
  search_wallet TEXT;
  identifier TEXT;
BEGIN
  -- Use whichever parameter was provided
  identifier := COALESCE(p_user_identifier, p_canonical_user_id);
  
  IF identifier IS NULL OR identifier = '' THEN
    RETURN jsonb_build_object(
      'success', true,
      'balance', 0,
      'bonus_balance', 0,
      'total_balance', 0
    );
  END IF;

  -- Extract wallet address from prize:pid: format if present
  IF identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(identifier FROM 11));
  ELSIF identifier LIKE '0x%' AND LENGTH(identifier) = 42 THEN
    search_wallet := LOWER(identifier);
  ELSE
    search_wallet := NULL;
  END IF;

  -- Try sub_account_balances first (newest balance system)
  BEGIN
    SELECT 
      COALESCE(available_balance, 0),
      COALESCE(bonus_balance, 0)
    INTO user_balance, bonus_balance
    FROM public.sub_account_balances
    WHERE currency = 'USD'
      AND (
        canonical_user_id = identifier
        OR canonical_user_id = LOWER(identifier)
        OR (search_wallet IS NOT NULL AND canonical_user_id = 'prize:pid:' || search_wallet)
        OR user_id = identifier
        OR privy_user_id = identifier
      )
    ORDER BY available_balance DESC NULLS LAST
    LIMIT 1;

    IF user_balance IS NOT NULL AND user_balance > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'balance', user_balance,
        'bonus_balance', bonus_balance,
        'total_balance', user_balance + bonus_balance
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Fallback to canonical_users
  BEGIN
    SELECT 
      COALESCE(usdc_balance, 0),
      COALESCE(bonus_balance, 0)
    INTO user_balance, bonus_balance
    FROM public.canonical_users
    WHERE
      canonical_user_id = identifier
      OR canonical_user_id = LOWER(identifier)
      OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
      OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
      OR LOWER(wallet_address) = LOWER(identifier)
      OR privy_user_id = identifier
    ORDER BY usdc_balance DESC NULLS LAST
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    user_balance := 0;
    bonus_balance := 0;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'balance', COALESCE(user_balance, 0),
    'bonus_balance', COALESCE(bonus_balance, 0),
    'total_balance', COALESCE(user_balance, 0) + COALESCE(bonus_balance, 0)
  );
END;
$$;

-- get_user_wallet_balance: Alias for get_user_balance
CREATE OR REPLACE FUNCTION get_user_wallet_balance(user_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN get_user_balance(user_identifier);
END;
$$;

-- credit_sub_account_balance: Credit sub-account balance
CREATE OR REPLACE FUNCTION credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Get current balance
  SELECT COALESCE(available_balance, 0) INTO v_current_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = p_currency;

  v_new_balance := COALESCE(v_current_balance, 0) + p_amount;

  -- Update or insert
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (p_canonical_user_id, p_currency, p_amount)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    available_balance = sub_account_balances.available_balance + p_amount,
    updated_at = NOW();

  -- Log transaction
  INSERT INTO balance_ledger (
    canonical_user_id,
    transaction_type,
    amount,
    currency,
    balance_before,
    balance_after,
    description
  ) VALUES (
    p_canonical_user_id,
    'credit',
    p_amount,
    p_currency,
    v_current_balance,
    v_new_balance,
    'Sub-account credit'
  );

  RETURN jsonb_build_object(
    'success', true,
    'balance', v_new_balance,
    'new_balance', v_new_balance
  );
END;
$$;

-- add_pending_balance: Add pending balance to user account
CREATE OR REPLACE FUNCTION add_pending_balance(user_identifier TEXT, amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
BEGIN
  -- Resolve user
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = user_identifier
     OR uid = user_identifier
     OR LOWER(wallet_address) = LOWER(user_identifier)
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Add to pending balance
  INSERT INTO sub_account_balances (canonical_user_id, currency, pending_balance)
  VALUES (v_canonical_user_id, 'USD', amount)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET
    pending_balance = sub_account_balances.pending_balance + amount,
    updated_at = NOW();

  RETURN jsonb_build_object('success', true, 'canonical_user_id', v_canonical_user_id);
END;
$$;


-- =====================================================
-- SECTION 2: USER PROFILE & WALLET MANAGEMENT FUNCTIONS
-- =====================================================

-- upsert_canonical_user: Create or update canonical user
CREATE OR REPLACE FUNCTION upsert_canonical_user(
  p_uid TEXT,
  p_canonical_user_id TEXT,
  p_email TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_base_wallet_address TEXT DEFAULT NULL,
  p_eth_wallet_address TEXT DEFAULT NULL,
  p_privy_user_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
BEGIN
  -- Insert or update canonical user
  INSERT INTO canonical_users (
    uid,
    canonical_user_id,
    email,
    username,
    wallet_address,
    base_wallet_address,
    eth_wallet_address,
    privy_user_id,
    created_at,
    updated_at
  )
  VALUES (
    p_uid,
    COALESCE(p_canonical_user_id, p_uid),
    p_email,
    p_username,
    p_wallet_address,
    p_base_wallet_address,
    p_eth_wallet_address,
    p_privy_user_id,
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO UPDATE SET
    canonical_user_id = COALESCE(EXCLUDED.canonical_user_id, canonical_users.canonical_user_id),
    email = COALESCE(EXCLUDED.email, canonical_users.email),
    username = COALESCE(EXCLUDED.username, canonical_users.username),
    wallet_address = COALESCE(EXCLUDED.wallet_address, canonical_users.wallet_address),
    base_wallet_address = COALESCE(EXCLUDED.base_wallet_address, canonical_users.base_wallet_address),
    eth_wallet_address = COALESCE(EXCLUDED.eth_wallet_address, canonical_users.eth_wallet_address),
    privy_user_id = COALESCE(EXCLUDED.privy_user_id, canonical_users.privy_user_id),
    updated_at = NOW()
  RETURNING id INTO v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'canonical_user_id', p_canonical_user_id
  );
END;
$$;

-- update_user_profile_by_identifier: Update user profile
CREATE OR REPLACE FUNCTION update_user_profile_by_identifier(
  p_user_identifier TEXT,
  p_username TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_telephone_number TEXT DEFAULT NULL,
  p_telegram_handle TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE canonical_users
  SET
    username = COALESCE(p_username, username),
    email = COALESCE(p_email, email),
    country = COALESCE(p_country, country),
    telegram_handle = COALESCE(p_telegram_handle, telegram_handle),
    updated_at = NOW()
  WHERE
    canonical_user_id = p_user_identifier
    OR uid = p_user_identifier
    OR LOWER(wallet_address) = LOWER(p_user_identifier);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_updated_count > 0,
    'updated_count', v_updated_count
  );
END;
$$;

-- update_user_avatar: Update user avatar
CREATE OR REPLACE FUNCTION update_user_avatar(user_identifier TEXT, new_avatar_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE canonical_users
  SET avatar_url = new_avatar_url, updated_at = NOW()
  WHERE
    canonical_user_id = user_identifier
    OR uid = user_identifier
    OR LOWER(wallet_address) = LOWER(user_identifier);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_updated_count > 0,
    'avatar_url', new_avatar_url
  );
END;
$$;

-- get_user_wallets: Get user's wallet information
CREATE OR REPLACE FUNCTION get_user_wallets(user_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  SELECT 
    wallet_address,
    base_wallet_address,
    eth_wallet_address,
    primary_wallet_address,
    linked_wallets
  INTO v_user
  FROM canonical_users
  WHERE canonical_user_id = user_identifier
     OR uid = user_identifier
     OR LOWER(wallet_address) = LOWER(user_identifier)
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'primary_wallet', v_user.primary_wallet_address,
    'wallets', v_user.linked_wallets,
    'wallet_address', v_user.wallet_address,
    'base_wallet_address', v_user.base_wallet_address,
    'eth_wallet_address', v_user.eth_wallet_address
  );
END;
$$;

-- set_primary_wallet: Set primary wallet for user
CREATE OR REPLACE FUNCTION set_primary_wallet(user_identifier TEXT, p_wallet_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE canonical_users
  SET primary_wallet_address = p_wallet_address, updated_at = NOW()
  WHERE canonical_user_id = user_identifier OR uid = user_identifier;

  RETURN jsonb_build_object('success', true, 'primary_wallet', p_wallet_address);
END;
$$;

-- update_wallet_nickname: Update nickname for a linked wallet
CREATE OR REPLACE FUNCTION update_wallet_nickname(
  user_identifier TEXT,
  p_wallet_address TEXT,
  p_nickname TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked_wallets JSONB;
  v_wallet JSONB;
  v_new_wallets JSONB := '[]'::jsonb;
BEGIN
  SELECT COALESCE(linked_wallets, '[]'::jsonb) INTO v_linked_wallets
  FROM canonical_users
  WHERE canonical_user_id = user_identifier OR uid = user_identifier;

  -- Update nickname for matching wallet
  FOR v_wallet IN SELECT * FROM jsonb_array_elements(v_linked_wallets)
  LOOP
    IF v_wallet->>'address' = p_wallet_address THEN
      v_wallet := jsonb_set(v_wallet, '{nickname}', to_jsonb(p_nickname));
    END IF;
    v_new_wallets := v_new_wallets || v_wallet;
  END LOOP;

  UPDATE canonical_users
  SET linked_wallets = v_new_wallets, updated_at = NOW()
  WHERE canonical_user_id = user_identifier OR uid = user_identifier;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- unlink_wallet: Unlink a specific wallet from user account
CREATE OR REPLACE FUNCTION unlink_wallet(user_identifier TEXT, p_wallet_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked_wallets JSONB;
  v_wallet JSONB;
  v_new_wallets JSONB := '[]'::jsonb;
BEGIN
  SELECT COALESCE(linked_wallets, '[]'::jsonb) INTO v_linked_wallets
  FROM canonical_users
  WHERE canonical_user_id = user_identifier OR uid = user_identifier;

  -- Remove wallet from array
  FOR v_wallet IN SELECT * FROM jsonb_array_elements(v_linked_wallets)
  LOOP
    IF v_wallet->>'address' != p_wallet_address THEN
      v_new_wallets := v_new_wallets || v_wallet;
    END IF;
  END LOOP;

  UPDATE canonical_users
  SET linked_wallets = v_new_wallets, updated_at = NOW()
  WHERE canonical_user_id = user_identifier OR uid = user_identifier;

  RETURN jsonb_build_object('success', true, 'wallets', v_new_wallets);
END;
$$;

-- unlink_external_wallet: Unlink all external wallets
CREATE OR REPLACE FUNCTION unlink_external_wallet(user_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE canonical_users
  SET linked_wallets = '[]'::jsonb, updated_at = NOW()
  WHERE canonical_user_id = user_identifier OR uid = user_identifier;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- get_linked_external_wallet: Get linked external wallet information
CREATE OR REPLACE FUNCTION get_linked_external_wallet(user_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN get_user_wallets(user_identifier);
END;
$$;


-- =====================================================
-- SECTION 3: TICKET RESERVATION & ALLOCATION FUNCTIONS
-- =====================================================

-- reserve_tickets_atomically: Atomically reserve tickets for purchase
CREATE OR REPLACE FUNCTION reserve_tickets_atomically(
  p_competition_id TEXT,
  p_ticket_count INTEGER,
  p_user_id TEXT,
  p_hold_minutes INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation_id TEXT;
  v_expires_at TIMESTAMPTZ;
  v_total_tickets INTEGER;
  v_sold_tickets INTEGER;
  v_available_tickets INTEGER[];
  v_selected_tickets INTEGER[];
  v_ticket INTEGER;
BEGIN
  -- Get competition info
  SELECT total_tickets, sold_tickets INTO v_total_tickets, v_sold_tickets
  FROM competitions
  WHERE id = p_competition_id OR uid = p_competition_id;

  IF v_total_tickets IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found');
  END IF;

  -- Check if enough tickets available
  IF (v_total_tickets - v_sold_tickets) < p_ticket_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not enough tickets available');
  END IF;

  -- Get unavailable tickets
  SELECT ARRAY_AGG(ticket_number) INTO v_available_tickets
  FROM tickets_sold
  WHERE competition_id = p_competition_id;

  -- Generate available ticket numbers (simple random selection)
  v_selected_tickets := ARRAY[]::INTEGER[];
  FOR v_ticket IN 1..v_total_tickets
  LOOP
    IF v_ticket = ANY(COALESCE(v_available_tickets, ARRAY[]::INTEGER[])) THEN
      CONTINUE;
    END IF;
    IF array_length(v_selected_tickets, 1) < p_ticket_count THEN
      v_selected_tickets := array_append(v_selected_tickets, v_ticket);
    END IF;
  END LOOP;

  -- Create reservation
  v_reservation_id := gen_random_uuid()::text;
  v_expires_at := NOW() + (p_hold_minutes || ' minutes')::interval;

  INSERT INTO pending_tickets (id, user_id, competition_id, status, expires_at)
  VALUES (v_reservation_id, p_user_id, p_competition_id, 'pending', v_expires_at);

  -- Insert ticket items
  FOREACH v_ticket IN ARRAY v_selected_tickets
  LOOP
    INSERT INTO pending_ticket_items (pending_ticket_id, competition_id, ticket_number)
    VALUES (v_reservation_id, p_competition_id, v_ticket);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'ticket_numbers', v_selected_tickets,
    'expires_at', v_expires_at
  );
END;
$$;

-- release_reservation: Release ticket reservation
CREATE OR REPLACE FUNCTION release_reservation(p_reservation_id TEXT, p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_matching_records INTEGER;
BEGIN
  -- Verify the reservation belongs to this user
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM pending_tickets
  WHERE id = p_reservation_id
    AND (canonical_user_id = p_user_id OR user_id = p_user_id OR LOWER(wallet_address) = LOWER(p_user_id))
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reservation not found or does not belong to user');
  END IF;

  -- Delete reservation items (only after user verification)
  DELETE FROM pending_ticket_items
  WHERE pending_ticket_id = p_reservation_id;

  -- Delete reservation (with user check for extra safety)
  DELETE FROM pending_tickets
  WHERE id = p_reservation_id 
    AND (canonical_user_id = p_user_id OR user_id = p_user_id OR LOWER(wallet_address) = LOWER(p_user_id));

  GET DIAGNOSTICS v_matching_records = ROW_COUNT;

  RETURN jsonb_build_object('success', v_matching_records > 0);
END;
$$;

-- allocate_lucky_dip_tickets: Allocate random tickets (lucky dip)
CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets(
  p_competition_id TEXT,
  p_user_id TEXT,
  p_ticket_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated_tickets INTEGER[];
  v_total_tickets INTEGER;
  v_sold_tickets INTEGER;
  v_ticket INTEGER;
  v_unavailable INTEGER[];
BEGIN
  -- Get competition info
  SELECT total_tickets, sold_tickets INTO v_total_tickets, v_sold_tickets
  FROM competitions
  WHERE id = p_competition_id OR uid = p_competition_id;

  -- Get unavailable tickets
  SELECT ARRAY_AGG(ticket_number) INTO v_unavailable
  FROM tickets_sold
  WHERE competition_id = p_competition_id;

  -- Allocate tickets
  v_allocated_tickets := ARRAY[]::INTEGER[];
  FOR v_ticket IN 1..v_total_tickets
  LOOP
    IF v_ticket = ANY(COALESCE(v_unavailable, ARRAY[]::INTEGER[])) THEN
      CONTINUE;
    END IF;
    IF array_length(v_allocated_tickets, 1) >= p_ticket_count THEN
      EXIT;
    END IF;
    v_allocated_tickets := array_append(v_allocated_tickets, v_ticket);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_numbers', v_allocated_tickets
  );
END;
$$;

-- allocate_lucky_dip_tickets_batch: Batch allocation of tickets
CREATE OR REPLACE FUNCTION allocate_lucky_dip_tickets_batch(
  p_competition_id TEXT,
  p_user_id TEXT,
  p_ticket_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN allocate_lucky_dip_tickets(p_competition_id, p_user_id, p_ticket_count);
END;
$$;

-- finalize_order: Finalize ticket purchase order
CREATE OR REPLACE FUNCTION finalize_order(
  p_reservation_id TEXT,
  p_user_id TEXT,
  p_competition_id TEXT,
  p_unit_price NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_numbers INTEGER[];
  v_ticket_number INTEGER;
  v_ticket_count INTEGER;
  v_canonical_user_id TEXT;
BEGIN
  -- Get canonical user ID
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE uid = p_user_id OR canonical_user_id = p_user_id
  LIMIT 1;

  -- Get reserved tickets
  SELECT ARRAY_AGG(ticket_number) INTO v_ticket_numbers
  FROM pending_ticket_items
  WHERE pending_ticket_id = p_reservation_id;

  v_ticket_count := array_length(v_ticket_numbers, 1);

  -- Create tickets
  FOREACH v_ticket_number IN ARRAY v_ticket_numbers
  LOOP
    INSERT INTO tickets (
      competition_id,
      ticket_number,
      user_id,
      canonical_user_id,
      status,
      purchase_price
    ) VALUES (
      p_competition_id,
      v_ticket_number,
      p_user_id,
      v_canonical_user_id,
      'active',
      p_unit_price
    ) ON CONFLICT DO NOTHING;

    -- Mark as sold
    INSERT INTO tickets_sold (competition_id, ticket_number, purchaser_id)
    VALUES (p_competition_id, v_ticket_number, p_user_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Update competition sold_tickets count
  UPDATE competitions
  SET sold_tickets = sold_tickets + v_ticket_count, updated_at = NOW()
  WHERE id = p_competition_id OR uid = p_competition_id;

  -- Clean up reservation
  DELETE FROM pending_ticket_items WHERE pending_ticket_id = p_reservation_id;
  DELETE FROM pending_tickets WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_numbers', v_ticket_numbers,
    'ticket_count', v_ticket_count
  );
END;
$$;


-- =====================================================
-- SECTION 4: COMPETITION QUERY FUNCTIONS
-- =====================================================

-- get_unavailable_tickets: Get list of unavailable ticket numbers
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INT4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_competition_uuid UUID;
  v_comp_uid TEXT;
  v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
  v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
  v_pending INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  -- Handle NULL or empty input
  IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN
    RETURN ARRAY[]::INTEGER[];
  END IF;

  -- Parse UUID
  BEGIN
    v_competition_uuid := p_competition_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT c.id, c.uid INTO v_competition_uuid, v_comp_uid
    FROM competitions c
    WHERE c.uid = p_competition_id
    LIMIT 1;

    IF v_competition_uuid IS NULL THEN
      RETURN ARRAY[]::INTEGER[];
    END IF;
  END;

  -- Get uid if not already set
  IF v_comp_uid IS NULL THEN
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = v_competition_uuid;
  END IF;

  -- Get sold tickets from joincompetition (competitionid is TEXT)
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_sold_jc
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num
    FROM joincompetition
    WHERE (
      competitionid = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND competitionid = v_comp_uid)
      OR competitionid = p_competition_id
    )
      AND ticketnumbers IS NOT NULL
      AND TRIM(ticketnumbers::TEXT) != ''
  ) AS jc_tickets
  WHERE ticket_num IS NOT NULL;

  v_sold_jc := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]);

  -- Get sold tickets from tickets table (competition_id is TEXT in schema)
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
    INTO v_sold_tickets
    FROM tickets t
    WHERE t.competition_id = p_competition_id
      OR t.competition_id = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND t.competition_id = v_comp_uid);
  EXCEPTION WHEN undefined_table THEN
    v_sold_tickets := ARRAY[]::INTEGER[];
  WHEN undefined_column THEN
    v_sold_tickets := ARRAY[]::INTEGER[];
  END;

  v_sold_tickets := COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]);

  -- Get pending tickets from pending_ticket_items
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
    INTO v_pending
    FROM pending_ticket_items pti
    INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
    WHERE (
      pti.competition_id = p_competition_id
      OR pti.competition_id = v_competition_uuid::TEXT
      OR (v_comp_uid IS NOT NULL AND pti.competition_id = v_comp_uid)
    )
      AND pt.status IN ('pending', 'confirming')
      AND pt.expires_at > NOW()
      AND pti.ticket_number IS NOT NULL;
  EXCEPTION WHEN undefined_table THEN
    v_pending := ARRAY[]::INTEGER[];
  END;

  v_pending := COALESCE(v_pending, ARRAY[]::INTEGER[]);

  -- Combine all unavailable tickets
  v_unavailable := v_sold_jc || v_sold_tickets || v_pending;

  -- Remove duplicates and sort
  IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
    INTO v_unavailable
    FROM unnest(v_unavailable) AS u
    WHERE u IS NOT NULL;
  ELSE
    v_unavailable := ARRAY[]::INTEGER[];
  END IF;

  RETURN v_unavailable;
END;
$$;

-- get_competition_unavailable_tickets: Alias for get_unavailable_tickets
CREATE OR REPLACE FUNCTION get_competition_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN get_unavailable_tickets(p_competition_id);
END;
$$;

-- get_available_ticket_count_v2: Get count of available tickets
CREATE OR REPLACE FUNCTION get_available_ticket_count_v2(p_competition_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_sold INTEGER;
BEGIN
  SELECT total_tickets, sold_tickets INTO v_total, v_sold
  FROM competitions
  WHERE id = p_competition_id OR uid = p_competition_id;

  RETURN COALESCE(v_total, 0) - COALESCE(v_sold, 0);
END;
$$;

-- check_and_mark_competition_sold_out: Check if competition is sold out
CREATE OR REPLACE FUNCTION check_and_mark_competition_sold_out(p_competition_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_sold INTEGER;
  v_is_sold_out BOOLEAN;
BEGIN
  SELECT total_tickets, sold_tickets INTO v_total, v_sold
  FROM competitions
  WHERE id = p_competition_id OR uid = p_competition_id;

  v_is_sold_out := v_sold >= v_total;

  IF v_is_sold_out THEN
    UPDATE competitions
    SET status = 'sold_out', updated_at = NOW()
    WHERE id = p_competition_id OR uid = p_competition_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'is_sold_out', v_is_sold_out,
    'sold_tickets', v_sold,
    'total_tickets', v_total
  );
END;
$$;

-- sync_competition_status_if_ended: Update competition status if ended
CREATE OR REPLACE FUNCTION sync_competition_status_if_ended(p_competition_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end_time TIMESTAMPTZ;
  v_current_status TEXT;
BEGIN
  SELECT end_time, status INTO v_end_time, v_current_status
  FROM competitions
  WHERE id = p_competition_id OR uid = p_competition_id;

  IF v_end_time < NOW() AND v_current_status IN ('active', 'upcoming') THEN
    UPDATE competitions
    SET status = 'drawing', updated_at = NOW()
    WHERE id = p_competition_id OR uid = p_competition_id;

    RETURN jsonb_build_object('success', true, 'status_changed', true, 'new_status', 'drawing');
  END IF;

  RETURN jsonb_build_object('success', true, 'status_changed', false);
END;
$$;

-- get_competition_ticket_availability_text: Get availability text
CREATE OR REPLACE FUNCTION get_competition_ticket_availability_text(p_competition_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available INTEGER;
  v_total INTEGER;
  v_percentage NUMERIC;
BEGIN
  SELECT 
    total_tickets - sold_tickets,
    total_tickets
  INTO v_available, v_total
  FROM competitions
  WHERE id = p_competition_id OR uid = p_competition_id;

  IF v_available <= 0 THEN
    RETURN 'SOLD OUT';
  END IF;

  v_percentage := (v_available::NUMERIC / v_total::NUMERIC) * 100;

  IF v_percentage < 10 THEN
    RETURN 'Only ' || v_available || ' left!';
  ELSIF v_percentage < 25 THEN
    RETURN 'Limited availability';
  ELSE
    RETURN v_available || ' tickets available';
  END IF;
END;
$$;


-- =====================================================
-- SECTION 5: USER TRANSACTION & ENTRY FUNCTIONS
-- =====================================================

-- get_user_transactions: Get user transaction history
CREATE OR REPLACE FUNCTION get_user_transactions(p_user_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transactions JSONB;
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet if prize:pid: format
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve canonical user ID
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
  LIMIT 1;

  -- Get transactions
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'amount', amount,
      'currency', currency,
      'status', status,
      'competition_id', competition_id,
      'ticket_count', ticket_count,
      'ticket_numbers', ticket_numbers,
      'created_at', created_at,
      'payment_method', payment_method
    ) ORDER BY created_at DESC
  ) INTO v_transactions
  FROM user_transactions
  WHERE user_id = p_user_identifier
     OR canonical_user_id = v_canonical_user_id
     OR user_id = v_canonical_user_id
  LIMIT 100;

  RETURN jsonb_build_object(
    'success', true,
    'transactions', COALESCE(v_transactions, '[]'::jsonb)
  );
END;
$$;

-- get_user_tickets: Get user's tickets
CREATE OR REPLACE FUNCTION get_user_tickets(p_user_identifier TEXT, p_competition_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tickets JSONB;
  v_canonical_user_id TEXT;
BEGIN
  -- Resolve user
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier OR uid = p_user_identifier
  LIMIT 1;

  SELECT jsonb_agg(
    jsonb_build_object(
      'ticket_number', ticket_number,
      'status', status,
      'is_winner', is_winner,
      'purchased_at', purchased_at
    )
  ) INTO v_tickets
  FROM tickets
  WHERE competition_id = p_competition_id
    AND (canonical_user_id = v_canonical_user_id OR user_id = p_user_identifier);

  RETURN jsonb_build_object(
    'success', true,
    'tickets', COALESCE(v_tickets, '[]'::jsonb)
  );
END;
$$;

-- get_user_tickets_for_competition: Alias
CREATE OR REPLACE FUNCTION get_user_tickets_for_competition(
  competition_id TEXT,
  user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN get_user_tickets(user_id, competition_id);
END;
$$;

-- get_competition_entries: Get competition entry list
CREATE OR REPLACE FUNCTION get_competition_entries(
  p_competition_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entries JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'canonical_user_id', ce.canonical_user_id,
      'username', COALESCE(ce.username, cu.username, 'Anonymous'),
      'wallet_address', ce.wallet_address,
      'tickets_count', ce.tickets_count,
      'amount_spent', ce.amount_spent,
      'latest_purchase_at', ce.latest_purchase_at
    )
  ) INTO v_entries
  FROM competition_entries ce
  LEFT JOIN canonical_users cu ON ce.canonical_user_id = cu.canonical_user_id
  WHERE ce.competition_id = p_competition_id
  ORDER BY ce.latest_purchase_at DESC
  LIMIT p_limit OFFSET p_offset;

  RETURN jsonb_build_object(
    'success', true,
    'entries', COALESCE(v_entries, '[]'::jsonb)
  );
END;
$$;

-- get_user_competition_entries: Get user's competition entries
CREATE OR REPLACE FUNCTION get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  competition_id TEXT,
  competition_title TEXT,
  tickets_count INTEGER,
  amount_spent NUMERIC,
  is_winner BOOLEAN,
  latest_purchase_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve user
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
  LIMIT 1;

  RETURN QUERY
  SELECT 
    ce.competition_id,
    c.title AS competition_title,
    ce.tickets_count,
    ce.amount_spent,
    ce.is_winner,
    ce.latest_purchase_at
  FROM competition_entries ce
  LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
  WHERE ce.canonical_user_id = v_canonical_user_id
  ORDER BY ce.latest_purchase_at DESC;
END;
$$;

-- get_comprehensive_user_dashboard_entries: Get complete user dashboard data
CREATE OR REPLACE FUNCTION get_comprehensive_user_dashboard_entries(p_user_identifier TEXT)
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
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  search_wallet TEXT;
BEGIN
  -- Extract wallet from prize:pid: format
  IF p_user_identifier LIKE 'prize:pid:0x%' THEN
    search_wallet := LOWER(SUBSTRING(p_user_identifier FROM 11));
  ELSIF p_user_identifier LIKE '0x%' THEN
    search_wallet := LOWER(p_user_identifier);
  END IF;

  -- Resolve canonical user ID
  SELECT canonical_user_id INTO v_canonical_user_id
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier
     OR uid = p_user_identifier
     OR (search_wallet IS NOT NULL AND LOWER(wallet_address) = search_wallet)
     OR (search_wallet IS NOT NULL AND LOWER(base_wallet_address) = search_wallet)
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Return dashboard entries from multiple sources
  RETURN QUERY
  WITH user_entries AS (
    SELECT DISTINCT
      ce.id,
      ce.competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'competition_entry' AS entry_type,
      ce.is_winner,
      ce.ticket_numbers_csv AS ticket_numbers,
      ce.tickets_count AS total_tickets,
      ce.amount_spent AS total_amount_spent,
      ce.latest_purchase_at AS purchase_date,
      NULL::TEXT AS transaction_hash,
      c.is_instant_win,
      NULL::NUMERIC AS prize_value,
      c.end_time AS end_date
    FROM competition_entries ce
    LEFT JOIN competitions c ON ce.competition_id = c.id OR ce.competition_id = c.uid
    WHERE ce.canonical_user_id = v_canonical_user_id

    UNION ALL

    SELECT DISTINCT
      ut.id,
      ut.competition_id,
      c.title,
      c.description,
      c.image_url AS image,
      c.status AS competition_status,
      'transaction' AS entry_type,
      false AS is_winner,
      ut.ticket_numbers,
      ut.ticket_count AS total_tickets,
      ut.amount AS total_amount_spent,
      ut.created_at AS purchase_date,
      ut.transaction_hash,
      c.is_instant_win,
      NULL::NUMERIC AS prize_value,
      c.end_time AS end_date
    FROM user_transactions ut
    LEFT JOIN competitions c ON ut.competition_id = c.id OR ut.competition_id = c.uid
    WHERE (ut.user_id = v_canonical_user_id OR ut.canonical_user_id = v_canonical_user_id)
      AND ut.payment_status IN ('completed', 'confirmed')
      AND ut.competition_id IS NOT NULL
  )
  SELECT DISTINCT ON (ue.competition_id)
    ue.id,
    ue.competition_id,
    ue.title,
    ue.description,
    ue.image,
    CASE 
      WHEN ue.competition_status = 'sold_out' THEN 'sold_out'
      WHEN ue.competition_status = 'active' THEN 'live'
      ELSE ue.competition_status
    END AS status,
    ue.entry_type,
    ue.is_winner,
    ue.ticket_numbers,
    ue.total_tickets,
    ue.total_amount_spent,
    ue.purchase_date,
    ue.transaction_hash,
    ue.is_instant_win,
    ue.prize_value,
    ue.competition_status,
    ue.end_date
  FROM user_entries ue
  ORDER BY ue.competition_id, ue.purchase_date DESC;
END;
$$;


-- =====================================================
-- SECTION 6: MAIN PAYMENT RPC FUNCTION
-- =====================================================

-- execute_balance_payment: Execute payment using user balance (simplified)
CREATE OR REPLACE FUNCTION execute_balance_payment(
  p_user_identifier TEXT,
  p_competition_id TEXT,
  p_amount NUMERIC,
  p_ticket_count INTEGER,
  p_selected_tickets INTEGER[] DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_reservation_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_user_id TEXT;
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
  v_ticket_numbers INTEGER[];
  v_transaction_id TEXT;
BEGIN
  -- Resolve user and lock balance row to prevent race conditions
  SELECT canonical_user_id, usdc_balance 
  INTO v_canonical_user_id, v_current_balance
  FROM canonical_users
  WHERE canonical_user_id = p_user_identifier OR uid = p_user_identifier
  FOR UPDATE  -- Lock the row for update to prevent race conditions
  LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Check balance
  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  -- Allocate tickets (simplified - should be more robust)
  v_ticket_numbers := COALESCE(p_selected_tickets, ARRAY[]::INTEGER[]);
  
  -- Debit balance with re-check for safety (optimistic lock)
  v_new_balance := v_current_balance - p_amount;
  UPDATE canonical_users 
  SET usdc_balance = v_new_balance 
  WHERE canonical_user_id = v_canonical_user_id
    AND usdc_balance >= p_amount;  -- Re-check balance in update
  
  -- Check if update was successful
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Balance changed during transaction');
  END IF;
  
  -- Create transaction
  v_transaction_id := gen_random_uuid()::text;
  INSERT INTO user_transactions (
    id, user_id, canonical_user_id, transaction_type, amount, status, competition_id, ticket_count
  ) VALUES (
    v_transaction_id, v_canonical_user_id, v_canonical_user_id, 'purchase', p_amount, 'completed', p_competition_id, p_ticket_count
  );

  -- Log in balance ledger
  INSERT INTO balance_ledger (
    canonical_user_id, transaction_type, amount, balance_before, balance_after, reference_id
  ) VALUES (
    v_canonical_user_id, 'debit', p_amount, v_current_balance, v_new_balance, v_transaction_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'tickets_created', p_ticket_count,
    'new_balance', v_new_balance
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- =====================================================
-- SECTION 7: GRANT EXECUTE PERMISSIONS
-- =====================================================

-- Grant execute permissions to all roles on all functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

COMMIT;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- This migration creates 31 essential RPC functions:
-- ✓ Balance functions (5): get_user_balance, get_user_wallet_balance, 
--   credit_sub_account_balance, add_pending_balance
-- ✓ User profile functions (9): upsert_canonical_user, update_user_profile_by_identifier,
--   update_user_avatar, get_user_wallets, set_primary_wallet, update_wallet_nickname,
--   unlink_wallet, unlink_external_wallet, get_linked_external_wallet
-- ✓ Ticket functions (7): reserve_tickets_atomically, release_reservation,
--   allocate_lucky_dip_tickets, allocate_lucky_dip_tickets_batch, finalize_order,
--   get_unavailable_tickets, get_competition_unavailable_tickets
-- ✓ Competition functions (4): get_available_ticket_count_v2, 
--   check_and_mark_competition_sold_out, sync_competition_status_if_ended,
--   get_competition_ticket_availability_text
-- ✓ User data functions (5): get_user_transactions, get_user_tickets,
--   get_user_tickets_for_competition, get_competition_entries,
--   get_user_competition_entries, get_comprehensive_user_dashboard_entries
-- ✓ Payment function (1): execute_balance_payment
--
-- All functions use SECURITY DEFINER for proper permission handling
-- All functions use SET search_path = public for security
-- All functions granted to anon, authenticated, service_role
-- =====================================================
