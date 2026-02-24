/**
 * FIX: Race condition in credit_balance_with_first_deposit_bonus
 *
 * BUG: The function credits balance BEFORE inserting to balance_ledger.
 * If two concurrent requests race past the idempotency check, both can
 * credit the balance before the unique constraint catches the duplicate.
 *
 * FIX: Insert to balance_ledger FIRST (with unique constraint) to claim
 * the reference_id as a lock. Only if INSERT succeeds do we credit balance.
 * If INSERT fails (unique_violation), we know another request already handled it.
 */
const { Client } = require("pg");

async function main() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("✅ Connected to database\n");

  try {
    console.log("=== FIXING RACE CONDITION IN CREDIT FUNCTION ===\n");

    await client.query(`
      CREATE OR REPLACE FUNCTION credit_balance_with_first_deposit_bonus(
        p_canonical_user_id TEXT,
        p_amount NUMERIC,
        p_reason TEXT,
        p_reference_id TEXT
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      DECLARE
        v_has_used_bonus BOOLEAN;
        v_bonus_amount NUMERIC := 0;
        v_total_credit NUMERIC;
        v_new_balance NUMERIC;
        v_prev_balance NUMERIC;
        v_is_first_deposit BOOLEAN := false;
        v_ledger_id UUID;
      BEGIN
        -- =========================================================================
        -- LOCK THE SUB_ACCOUNT_BALANCES ROW FIRST (prevents concurrent updates)
        -- =========================================================================
        
        SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_prev_balance
        FROM sub_account_balances
        WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD'
        FOR UPDATE;
        
        IF v_prev_balance IS NULL THEN
          v_prev_balance := 0;
        END IF;

        -- =========================================================================
        -- IDEMPOTENCY CHECK: Return early if already credited
        -- =========================================================================
        
        IF EXISTS (
          SELECT 1 FROM balance_ledger
          WHERE reference_id = p_reference_id
            AND canonical_user_id = p_canonical_user_id
        ) THEN
          RAISE NOTICE 'IDEMPOTENCY: Reference % already in ledger', p_reference_id;
          RETURN jsonb_build_object(
            'success', true,
            'already_credited', true,
            'credited_amount', 0,
            'bonus_amount', 0,
            'bonus_applied', false,
            'total_credited', 0,
            'new_balance', v_prev_balance,
            'idempotency_note', 'Credit already applied for reference: ' || p_reference_id
          );
        END IF;
        
        -- Also check user_transactions
        IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
          IF EXISTS (
            SELECT 1 FROM user_transactions 
            WHERE tx_id = p_reference_id
              AND (wallet_credited = true OR posted_to_balance = true)
          ) THEN
            RAISE NOTICE 'IDEMPOTENCY: Transaction % already credited', p_reference_id;
            RETURN jsonb_build_object(
              'success', true,
              'already_credited', true,
              'credited_amount', 0,
              'bonus_amount', 0,
              'bonus_applied', false,
              'total_credited', 0,
              'new_balance', v_prev_balance,
              'idempotency_note', 'Credit already applied for tx: ' || p_reference_id
            );
          END IF;
        END IF;

        -- =========================================================================
        -- FIRST DEPOSIT CHECK
        -- =========================================================================
        
        SELECT COALESCE(has_used_new_user_bonus, false) INTO v_has_used_bonus
        FROM canonical_users
        WHERE canonical_user_id = p_canonical_user_id;

        IF v_has_used_bonus = false OR v_has_used_bonus IS NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM balance_ledger 
            WHERE canonical_user_id = p_canonical_user_id 
              AND transaction_type IN ('deposit', 'credit', 'topup')
              AND amount > 0
          ) THEN
            v_is_first_deposit := true;
            v_bonus_amount := p_amount * 0.50;
            RAISE NOTICE 'FIRST DEPOSIT: Will apply 50%% bonus ($%) for user %', v_bonus_amount, p_canonical_user_id;
          END IF;
        END IF;

        v_total_credit := p_amount + v_bonus_amount;

        -- =========================================================================
        -- CRITICAL: INSERT LEDGER FIRST (atomic idempotency claim)
        -- This INSERT with unique constraint acts as a lock - only one request
        -- can succeed. If another request already inserted, we'll get unique_violation.
        -- =========================================================================
        
        BEGIN
          INSERT INTO balance_ledger (
            canonical_user_id, transaction_type, amount, reference_id, 
            description, balance_before, currency
          ) VALUES (
            p_canonical_user_id, 'deposit', v_total_credit, p_reference_id,
            p_reason || CASE WHEN v_is_first_deposit THEN ' (+ 50% first deposit bonus)' ELSE '' END,
            v_prev_balance, 'USD'
          )
          RETURNING id INTO v_ledger_id;
        EXCEPTION WHEN unique_violation THEN
          -- Another concurrent request already claimed this reference_id
          RAISE NOTICE 'IDEMPOTENCY: Unique violation - another request already credited reference %', p_reference_id;
          
          SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_new_balance
          FROM sub_account_balances
          WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
          
          RETURN jsonb_build_object(
            'success', true,
            'already_credited', true,
            'credited_amount', 0,
            'bonus_amount', 0,
            'bonus_applied', false,
            'total_credited', 0,
            'new_balance', COALESCE(v_new_balance, 0),
            'idempotency_note', 'Concurrent request already credited: ' || p_reference_id
          );
        END;

        -- =========================================================================
        -- NOW SAFE TO CREDIT BALANCE (ledger claim succeeded)
        -- =========================================================================

        IF v_is_first_deposit THEN
          -- Mark bonus as used
          UPDATE canonical_users
          SET has_used_new_user_bonus = true, updated_at = NOW()
          WHERE canonical_user_id = p_canonical_user_id;
          
          IF NOT FOUND THEN
            INSERT INTO canonical_users (canonical_user_id, has_used_new_user_bonus, created_at, updated_at)
            VALUES (p_canonical_user_id, true, NOW(), NOW())
            ON CONFLICT (canonical_user_id) DO UPDATE SET has_used_new_user_bonus = true, updated_at = NOW();
          END IF;

          -- Credit bonus balance
          INSERT INTO sub_account_balances (canonical_user_id, currency, bonus_balance, available_balance)
          VALUES (p_canonical_user_id, 'USD', v_bonus_amount, 0)
          ON CONFLICT (canonical_user_id, currency)
          DO UPDATE SET
            bonus_balance = COALESCE(sub_account_balances.bonus_balance, 0) + v_bonus_amount,
            updated_at = NOW();
        END IF;

        -- Credit main balance
        INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
        VALUES (p_canonical_user_id, 'USD', p_amount)
        ON CONFLICT (canonical_user_id, currency)
        DO UPDATE SET
          available_balance = COALESCE(sub_account_balances.available_balance, 0) + p_amount,
          updated_at = NOW();

        -- Get final balance
        SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_new_balance
        FROM sub_account_balances
        WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

        -- Update ledger with final balance
        UPDATE balance_ledger 
        SET balance_after = v_new_balance
        WHERE id = v_ledger_id;

        -- Mark user_transactions as credited
        IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
          UPDATE user_transactions
          SET wallet_credited = true, posted_to_balance = true, updated_at = NOW()
          WHERE tx_id = p_reference_id;
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'already_credited', false,
          'deposited_amount', p_amount,
          'bonus_amount', v_bonus_amount,
          'bonus_applied', v_is_first_deposit,
          'total_credited', v_total_credit,
          'previous_balance', v_prev_balance,
          'new_balance', COALESCE(v_new_balance, v_prev_balance + v_total_credit)
        );
      END;
      $$;
    `);
    console.log(
      "✅ Updated credit_balance_with_first_deposit_bonus with race-condition-safe ordering",
    );

    // Grant permissions
    await client.query(`
      REVOKE ALL ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;
      GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
    `);
    console.log("✅ Granted permissions");

    console.log("\n=== FIX COMPLETE ===");
    console.log("\nChanges made:");
    console.log("1. Added FOR UPDATE lock on sub_account_balances row");
    console.log("2. Moved ledger INSERT BEFORE balance credit");
    console.log(
      "3. If ledger INSERT fails (unique_violation), return early without crediting",
    );
    console.log("4. Only credit balance AFTER ledger claim succeeds");
    console.log(
      "\nThis ensures only ONE concurrent request can ever credit a given reference_id.",
    );
  } catch (err) {
    console.error("Error:", err.message);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(console.error);
