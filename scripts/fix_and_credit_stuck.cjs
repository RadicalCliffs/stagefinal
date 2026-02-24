/**
 * Fix the credit function and missing users, then credit stuck topups
 */
const { Client } = require("pg");

async function fixAndCredit() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("=== FIXING CREDIT FUNCTION AND CREDITING STUCK TOPUPS ===\n");

  try {
    // Step 1: Update the credit function to NOT reference wallet_credited
    console.log("Step 1: Updating credit function...");
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
        v_norm TEXT;
      BEGIN
        -- Normalize the canonical_user_id
        v_norm := LOWER(REPLACE(p_canonical_user_id, 'prize:pid:', ''));
        
        -- Ensure user exists in canonical_users first
        INSERT INTO canonical_users (canonical_user_id, created_at, updated_at)
        VALUES (p_canonical_user_id, NOW(), NOW())
        ON CONFLICT (canonical_user_id) DO NOTHING;
        
        -- Lock and get current balance
        SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_prev_balance
        FROM sub_account_balances
        WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD'
        FOR UPDATE;
        
        IF v_prev_balance IS NULL THEN
          v_prev_balance := 0;
        END IF;

        -- IDEMPOTENCY CHECK: Return early if already credited
        IF EXISTS (
          SELECT 1 FROM balance_ledger
          WHERE reference_id = p_reference_id
        ) THEN
          RAISE NOTICE 'IDEMPOTENCY: Reference % already in ledger', p_reference_id;
          RETURN jsonb_build_object(
            'success', true,
            'already_credited', true,
            'credited_amount', 0,
            'bonus_amount', 0,
            'bonus_applied', false,
            'total_credited', 0,
            'new_balance', v_prev_balance
          );
        END IF;
        
        -- Also check user_transactions posted_to_balance
        IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
          IF EXISTS (
            SELECT 1 FROM user_transactions 
            WHERE tx_id = p_reference_id
              AND posted_to_balance = true
          ) THEN
            RETURN jsonb_build_object(
              'success', true,
              'already_credited', true,
              'credited_amount', 0,
              'bonus_amount', 0,
              'bonus_applied', false,
              'total_credited', 0,
              'new_balance', v_prev_balance
            );
          END IF;
        END IF;

        -- FIRST DEPOSIT CHECK
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
          END IF;
        END IF;

        v_total_credit := p_amount + v_bonus_amount;

        -- INSERT LEDGER FIRST (atomic idempotency claim)
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
            'new_balance', COALESCE(v_new_balance, 0)
          );
        END;

        -- Credit balance
        IF v_is_first_deposit THEN
          UPDATE canonical_users
          SET has_used_new_user_bonus = true, updated_at = NOW()
          WHERE canonical_user_id = p_canonical_user_id;

          INSERT INTO sub_account_balances (canonical_user_id, canonical_user_id_norm, currency, bonus_balance, available_balance)
          VALUES (p_canonical_user_id, v_norm, 'USD', v_bonus_amount, 0)
          ON CONFLICT (canonical_user_id, currency)
          DO UPDATE SET
            bonus_balance = COALESCE(sub_account_balances.bonus_balance, 0) + v_bonus_amount,
            updated_at = NOW();
        END IF;

        INSERT INTO sub_account_balances (canonical_user_id, canonical_user_id_norm, currency, available_balance)
        VALUES (p_canonical_user_id, v_norm, 'USD', p_amount)
        ON CONFLICT (canonical_user_id, currency)
        DO UPDATE SET
          available_balance = COALESCE(sub_account_balances.available_balance, 0) + p_amount,
          canonical_user_id_norm = COALESCE(sub_account_balances.canonical_user_id_norm, v_norm),
          updated_at = NOW();

        SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_new_balance
        FROM sub_account_balances
        WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

        UPDATE balance_ledger 
        SET balance_after = v_new_balance
        WHERE id = v_ledger_id;

        -- Mark user_transactions as posted (without wallet_credited)
        IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
          UPDATE user_transactions
          SET posted_to_balance = true, updated_at = NOW()
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
    console.log("✅ Credit function updated\n");

    // Step 2: Credit all stuck topups
    console.log("Step 2: Crediting stuck topups...\n");

    const stuck = await client.query(`
      SELECT 
        ut.id,
        ut.canonical_user_id,
        ut.amount,
        ut.payment_provider,
        ut.tx_id
      FROM user_transactions ut
      LEFT JOIN balance_ledger bl ON bl.reference_id = ut.tx_id OR bl.reference_id = 'manual_credit_' || ut.id::text
      WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
        AND ut.type = 'topup'
        AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
        AND bl.id IS NULL
        AND ut.canonical_user_id IS NOT NULL
      ORDER BY ut.created_at
    `);

    console.log(`Found ${stuck.rowCount} stuck topups\n`);

    let credited = 0,
      skipped = 0,
      failed = 0;

    for (const row of stuck.rows) {
      const referenceId = row.tx_id || `manual_credit_${row.id}`;

      try {
        const result = await client.query(
          `
          SELECT credit_balance_with_first_deposit_bonus($1, $2, $3, $4) as result
        `,
          [
            row.canonical_user_id,
            row.amount,
            `Reconciliation: ${row.payment_provider}`,
            referenceId,
          ],
        );

        const r = result.rows[0]?.result;

        if (r?.already_credited) {
          console.log(
            `SKIP: $${row.amount} - ${row.canonical_user_id.substring(0, 40)}`,
          );
          skipped++;
        } else if (r?.success) {
          console.log(
            `✅ $${row.amount} (+$${r.bonus_amount || 0} bonus) → ${row.canonical_user_id.substring(0, 40)}`,
          );
          credited++;

          await client.query(
            `
            UPDATE user_transactions 
            SET posted_to_balance = true, payment_provider = 'cdp_commerce', updated_at = NOW()
            WHERE id = $1
          `,
            [row.id],
          );
        } else {
          console.log(
            `❌ $${row.amount} - ${row.canonical_user_id.substring(0, 40)}`,
          );
          failed++;
        }
      } catch (err) {
        console.log(`❌ $${row.amount} - ${err.message.substring(0, 60)}`);
        failed++;
      }
    }

    console.log(`\n=== DONE ===`);
    console.log(`Credited: ${credited}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
  } finally {
    await client.end();
  }
}

fixAndCredit().catch(console.error);
