-- Simple solution: Store most recent topup hash per user

-- Add last_ticket_tx_hash column (last_topup_tx_hash already exists)
ALTER TABLE canonical_users 
ADD COLUMN IF NOT EXISTS last_ticket_tx_hash TEXT;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_canonical_users_last_ticket_hash 
ON canonical_users(last_ticket_tx_hash);

-- Update tickets trigger to use real blockchain hashes
CREATE OR REPLACE FUNCTION public.tickets_tx_id_fill()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_blockchain_hash TEXT;
BEGIN
  IF NEW.tx_id IS NULL OR NEW.tx_id = '' THEN
    -- For balance payments, get stored topup hash from user record
    IF NEW.payment_provider IN ('balance', 'balance_payment') THEN
      SELECT last_topup_tx_hash INTO v_blockchain_hash
      FROM canonical_users
      WHERE canonical_user_id = NEW.canonical_user_id;
      
      IF v_blockchain_hash IS NOT NULL THEN
        NEW.tx_id := v_blockchain_hash;
        RETURN NEW;
      END IF;
      
      -- No topup hash stored
      NEW.tx_id := NULL;
      RETURN NEW;
    END IF;

    -- For direct crypto payments, look up blockchain hash from webhook
    IF NEW.payment_provider IN ('coinbase', 'crypto', 'privy') THEN
      -- First check if payment_tx_hash is already a blockchain hash
      IF NEW.payment_tx_hash IS NOT NULL 
         AND NEW.payment_tx_hash LIKE '0x%' 
         AND LENGTH(NEW.payment_tx_hash) = 66 THEN
        NEW.tx_id := NEW.payment_tx_hash;
        RETURN NEW;
      END IF;

      -- Otherwise look up from webhook (payment_tx_hash might be charge ID)
      IF NEW.payment_tx_hash IS NOT NULL AND NEW.payment_tx_hash != '' THEN
        SELECT 
          COALESCE(
            payload->'payments'->0->>'transaction_id',
            payload->'event'->'data'->'payments'->0->>'transaction_id',
            payload->'data'->'payments'->0->>'transaction_id',
            payload->'event'->'data'->'web3_data'->'success_events'->0->>'tx_hsh',
            payload->'data'->'web3_data'->'success_events'->0->>'tx_hsh'
          ) INTO v_blockchain_hash
        FROM payment_webhook_events
        WHERE payload::text LIKE '%' || NEW.payment_tx_hash || '%'
          AND (payload::text LIKE '%transaction_id%' OR payload::text LIKE '%tx_hsh%')
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_blockchain_hash IS NOT NULL 
           AND v_blockchain_hash LIKE '0x%' 
           AND LENGTH(v_blockchain_hash) = 66 THEN
          NEW.tx_id := v_blockchain_hash;
          RETURN NEW;
        END IF;
      END IF;
    END IF;

    -- No real blockchain hash found - leave as NULL
    NEW.tx_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Trigger to auto-update user's topup hash when they topup
CREATE OR REPLACE FUNCTION update_user_topup_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_blockchain_hash TEXT;
BEGIN
  -- Only for topup transactions
  IF NEW.type != 'topup' OR NEW.tx_id IS NULL OR NEW.tx_id = '' THEN
    RETURN NEW;
  END IF;

  -- Skip if tx_id is already a blockchain hash
  IF NEW.tx_id LIKE '0x%' AND LENGTH(NEW.tx_id) = 66 THEN
    -- Update user record with this hash
    UPDATE canonical_users 
    SET last_topup_tx_hash = NEW.tx_id
    WHERE canonical_user_id = NEW.canonical_user_id;
    RETURN NEW;
  END IF;

  -- It's a charge ID - look up blockchain hash from webhook
  SELECT 
    COALESCE(
      payload->'payments'->0->>'transaction_id',
      payload->'event'->'data'->'payments'->0->>'transaction_id',
      payload->'data'->'payments'->0->>'transaction_id',
      payload->'event'->'data'->'web3_data'->'success_events'->0->>'tx_hsh',
      payload->'data'->'web3_data'->'success_events'->0->>'tx_hsh'
    ) INTO v_blockchain_hash
  FROM payment_webhook_events
  WHERE payload::text LIKE '%' || NEW.tx_id || '%'
    AND (payload::text LIKE '%transaction_id%' OR payload::text LIKE '%tx_hsh%')
  ORDER BY created_at DESC
  LIMIT 1;

  -- Update user record with blockchain hash
  IF v_blockchain_hash IS NOT NULL 
     AND v_blockchain_hash LIKE '0x%' 
     AND LENGTH(v_blockchain_hash) = 66 THEN
    UPDATE canonical_users 
    SET last_topup_tx_hash = v_blockchain_hash
    WHERE canonical_user_id = NEW.canonical_user_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger on user_transactions
DROP TRIGGER IF EXISTS trg_update_topup_hash ON user_transactions;
CREATE TRIGGER trg_update_topup_hash
AFTER INSERT OR UPDATE ON user_transactions
FOR EACH ROW
EXECUTE FUNCTION update_user_topup_hash();

-- Trigger to update user's last ticket hash when ticket is purchased
CREATE OR REPLACE FUNCTION update_user_ticket_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Update user's last ticket hash (use topup hash for balance payments, or the ticket's tx_id)
  IF NEW.tx_id IS NOT NULL AND NEW.tx_id != '' THEN
    UPDATE canonical_users 
    SET last_ticket_tx_hash = NEW.tx_id
    WHERE canonical_user_id = NEW.canonical_user_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_update_ticket_hash ON tickets;
CREATE TRIGGER trg_update_ticket_hash
AFTER INSERT OR UPDATE OF tx_id ON tickets
FOR EACH ROW
EXECUTE FUNCTION update_user_ticket_hash();
