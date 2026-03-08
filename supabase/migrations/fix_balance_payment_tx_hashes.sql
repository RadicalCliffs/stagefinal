-- Fix for fake blockchain hashes on balance payments
-- This updates the ticket tx_id generation to use real topup blockchain hashes

-- Step 1: Create helper function to get user's topup blockchain hash at time of purchase
CREATE OR REPLACE FUNCTION get_user_topup_blockchain_hash(
  p_canonical_user_id TEXT,
  p_payment_provider TEXT,
  p_ticket_created_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_topup_charge_id TEXT;
  v_blockchain_hash TEXT;
BEGIN
  -- Only look up topup hash for balance payments
  IF p_payment_provider != 'balance' THEN
    RETURN NULL;
  END IF;

  -- Get the topup charge ID that was active when this ticket was purchased
  -- This finds the most recent topup BEFORE the ticket was created
  SELECT tx_id INTO v_topup_charge_id
  FROM user_transactions
  WHERE canonical_user_id = p_canonical_user_id
    AND type = 'topup'
    AND tx_id IS NOT NULL
    AND tx_id != ''
    AND tx_id NOT LIKE '0x%'  -- Exclude blockchain hashes
    AND tx_id NOT LIKE 'BAL_%'  -- Exclude balance prefixes
    AND created_at <= p_ticket_created_at  -- Must be before or at ticket purchase time
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no topup found, return NULL (will generate placeholder)
  IF v_topup_charge_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Look up blockchain hash from webhook payload
  -- Try to find confirmed webhook with this charge ID
  SELECT 
    COALESCE(
      payload->'payments'->0->>'transaction_id',
      payload->'event'->'data'->'payments'->0->>'transaction_id',
      payload->'data'->'payments'->0->>'transaction_id',
      payload->'event'->'data'->'web3_data'->'success_events'->0->>'tx_hsh',
      payload->'data'->'web3_data'->'success_events'->0->>'tx_hsh',
      payload->'timeline'->0->'payment'->>'transaction_id',
      payload->'event'->'data'->'timeline'->0->'payment'->>'transaction_id'
    ) INTO v_blockchain_hash
  FROM payment_webhook_events
  WHERE payload::text LIKE '%' || v_topup_charge_id || '%'
    AND (
      event_type = 'charge:confirmed'
      OR payload::text LIKE '%transaction_id%'
      OR payload::text LIKE '%tx_hsh%'
    )
  ORDER BY created_at DESC
  LIMIT 1;

  -- Return blockchain hash if found (should be 0x format, 66 chars)
  IF v_blockchain_hash IS NOT NULL 
     AND v_blockchain_hash LIKE '0x%' 
     AND LENGTH(v_blockchain_hash) = 66 THEN
    RETURN v_blockchain_hash;
  END IF;

  -- No blockchain hash found
  RETURN NULL;
END;
$function$;

-- Step 2: Update tickets_tx_id_fill to use real topup hashes for balance payments
CREATE OR REPLACE FUNCTION public.tickets_tx_id_fill()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_topup_hash TEXT;
BEGIN
  IF NEW.tx_id IS NULL OR NEW.tx_id = '' THEN
    -- For balance payments, try to get the real topup blockchain hash
    IF NEW.payment_provider = 'balance' THEN
      v_topup_hash := get_user_topup_blockchain_hash(
        NEW.canonical_user_id,
        NEW.payment_provider,
        COALESCE(NEW.created_at, now())
      );
      
      IF v_topup_hash IS NOT NULL THEN
        -- Use the real topup blockchain hash
        NEW.tx_id := v_topup_hash;
        RETURN NEW;
      END IF;
      
      -- If no topup hash found, use NULL instead of fake hash
      -- This indicates it was a balance payment without traceable topup
      NEW.tx_id := NULL;
      RETURN NEW;
    END IF;

    -- For non-balance payments, generate deterministic hash as before
    NEW.tx_id := public.gen_ticket_tx_id(
      NEW.id::uuid,
      NEW.competition_id::uuid,
      NEW.ticket_number::bigint,
      COALESCE(NEW.canonical_user_id, '')::text,
      COALESCE(NEW.wallet_address, '')::text,
      COALESCE(NEW.payment_provider, '')::text,
      COALESCE(NEW.payment_amount, 0)::numeric,
      COALESCE(NEW.payment_tx_hash, '')::text,
      COALESCE(NEW.created_at, now())::timestamptz
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Step 3: Add comment explaining the fix
COMMENT ON FUNCTION get_user_topup_blockchain_hash IS 
'Retrieves the blockchain transaction hash from the topup that was active when the ticket was purchased.
Finds the most recent topup BEFORE the ticket creation time for the specific user.
Used to link balance-purchased tickets to their actual on-chain topup transactions.
Returns NULL if no topup or blockchain hash found.';

COMMENT ON FUNCTION tickets_tx_id_fill IS 
'Trigger function that fills tx_id for tickets. 
For balance payments: uses real topup blockchain hash from webhooks.
For direct crypto payments: generates deterministic hash from ticket properties.';
