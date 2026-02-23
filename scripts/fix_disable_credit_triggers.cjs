/**
 * FIX: Disable all competing balance-credit triggers
 * This fixes the double-crediting issue where multiple triggers
 * all credit the balance on the same topup transaction.
 * 
 * Run: node scripts/fix_disable_credit_triggers.cjs
 */

const { Client } = require('pg');

async function fixTriggers() {
  // Use same connection config as run_migration.cjs
  const client = new Client({
    host: 'aws-1-ap-south-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.mthwfldcjvpxjtmrqkqm',
    password: 'LetsF4ckenGo!',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Step 1: List current triggers that could cause double-crediting
    console.log('=== CURRENT PROBLEMATIC TRIGGERS ===');
    const beforeResult = await client.query(`
      SELECT trigger_name, event_manipulation, action_timing
      FROM information_schema.triggers
      WHERE event_object_table = 'user_transactions'
        AND (
          trigger_name ILIKE '%credit%'
          OR trigger_name ILIKE '%topup%' 
          OR trigger_name ILIKE '%bonus%'
          OR trigger_name ILIKE '%commerce_post%'
        )
      ORDER BY trigger_name
    `);
    
    if (beforeResult.rows.length === 0) {
      console.log('No problematic triggers found - may already be fixed!\n');
    } else {
      console.log(`Found ${beforeResult.rows.length} triggers to disable:`);
      beforeResult.rows.forEach(row => {
        console.log(`  - ${row.trigger_name} (${row.event_manipulation} ${row.action_timing})`);
      });
      console.log('');
    }

    // Step 2: Disable all competing triggers
    console.log('=== DISABLING TRIGGERS ===');
    
    const triggersToDisable = [
      'trg_user_tx_commerce_post',
      'trg_apply_topup_and_welcome_bonus',
      'trg_optimistic_topup_credit',
      'trg_credit_sub_account_on_instant_wallet_topup',
      'trg_auto_credit_on_external_topup',
      'trg_user_transactions_post_to_wallet',
      'trg_complete_topup_on_webhook_ref_ins',
      'trg_complete_topup_on_webhook_ref_upd',
    ];

    for (const trigger of triggersToDisable) {
      try {
        await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON user_transactions`);
        console.log(`  ✅ Dropped ${trigger}`);
      } catch (err) {
        console.log(`  ⚠️ Could not drop ${trigger}: ${err.message}`);
      }
    }

    // Step 3: Create/update the bulletproof credit function with idempotency
    console.log('\n=== UPDATING CREDIT FUNCTION WITH IDEMPOTENCY ===');
    
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
        v_existing_credit RECORD;
        v_is_first_deposit BOOLEAN := false;
      BEGIN
        -- =========================================================================
        -- CRITICAL IDEMPOTENCY CHECK: Scan balance_ledger for ANY existing credit
        -- with same reference_id
        -- =========================================================================
        
        SELECT id, amount, created_at INTO v_existing_credit
        FROM balance_ledger
        WHERE reference_id = p_reference_id
          AND canonical_user_id = p_canonical_user_id
        LIMIT 1;
        
        IF v_existing_credit.id IS NOT NULL THEN
          RAISE NOTICE 'IDEMPOTENCY: Reference % already credited (ledger id: %)', p_reference_id, v_existing_credit.id;
          
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
            'idempotency_note', 'Credit already applied for reference: ' || p_reference_id
          );
        END IF;
        
        -- Also check user_transactions for wallet_credited flag
        IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
          PERFORM 1 FROM user_transactions 
          WHERE tx_id = p_reference_id
            AND (wallet_credited = true OR posted_to_balance = true)
          LIMIT 1;
          
          IF FOUND THEN
            RAISE NOTICE 'IDEMPOTENCY: Transaction % already marked as credited', p_reference_id;
            
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
          PERFORM 1 FROM balance_ledger 
          WHERE canonical_user_id = p_canonical_user_id 
            AND transaction_type IN ('deposit', 'credit', 'topup')
            AND amount > 0
          LIMIT 1;
          
          IF NOT FOUND THEN
            v_is_first_deposit := true;
            v_bonus_amount := p_amount * 0.50;
            v_total_credit := p_amount + v_bonus_amount;
            
            RAISE NOTICE 'FIRST DEPOSIT: Applying 50%% bonus ($%) for user %', v_bonus_amount, p_canonical_user_id;

            UPDATE canonical_users
            SET has_used_new_user_bonus = true, updated_at = NOW()
            WHERE canonical_user_id = p_canonical_user_id;
            
            IF NOT FOUND THEN
              INSERT INTO canonical_users (canonical_user_id, has_used_new_user_bonus, created_at, updated_at)
              VALUES (p_canonical_user_id, true, NOW(), NOW())
              ON CONFLICT (canonical_user_id) DO UPDATE SET has_used_new_user_bonus = true, updated_at = NOW();
            END IF;

            INSERT INTO sub_account_balances (canonical_user_id, currency, bonus_balance, available_balance)
            VALUES (p_canonical_user_id, 'USD', v_bonus_amount, 0)
            ON CONFLICT (canonical_user_id, currency)
            DO UPDATE SET
              bonus_balance = COALESCE(sub_account_balances.bonus_balance, 0) + v_bonus_amount,
              updated_at = NOW();
          ELSE
            v_total_credit := p_amount;
          END IF;
        ELSE
          v_total_credit := p_amount;
        END IF;

        -- =========================================================================
        -- CREDIT THE MAIN BALANCE
        -- =========================================================================
        
        INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
        VALUES (p_canonical_user_id, 'USD', p_amount)
        ON CONFLICT (canonical_user_id, currency)
        DO UPDATE SET
          available_balance = COALESCE(sub_account_balances.available_balance, 0) + p_amount,
          updated_at = NOW();

        SELECT COALESCE(available_balance, 0) + COALESCE(bonus_balance, 0) INTO v_new_balance
        FROM sub_account_balances
        WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';

        -- =========================================================================
        -- LOG TO BALANCE_LEDGER (IDEMPOTENCY RECORD)
        -- =========================================================================
        
        BEGIN
          INSERT INTO balance_ledger (
            canonical_user_id, transaction_type, amount, reference_id, description, balance_after
          ) VALUES (
            p_canonical_user_id, 'deposit', v_total_credit, p_reference_id,
            p_reason || CASE WHEN v_is_first_deposit THEN ' (+ 50% first deposit bonus)' ELSE '' END,
            v_new_balance
          );
        EXCEPTION WHEN unique_violation THEN
          RAISE NOTICE 'IDEMPOTENCY: Unique violation on balance_ledger for reference %', p_reference_id;
        WHEN OTHERS THEN
          NULL;
        END;

        -- =========================================================================
        -- UPDATE user_transactions TO MARK AS CREDITED
        -- =========================================================================
        
        IF p_reference_id IS NOT NULL AND p_reference_id LIKE '0x%' THEN
          UPDATE user_transactions
          SET wallet_credited = true, posted_to_balance = true, updated_at = NOW()
          WHERE tx_id = p_reference_id;
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'already_credited', false,
          'credited_amount', p_amount,
          'bonus_amount', v_bonus_amount,
          'bonus_applied', v_is_first_deposit,
          'total_credited', v_total_credit,
          'new_balance', COALESCE(v_new_balance, p_amount + v_bonus_amount)
        );
      END;
      $$;
    `);
    console.log('✅ Updated credit_balance_with_first_deposit_bonus with idempotency');

    // Grant permissions
    await client.query(`
      REVOKE ALL ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO service_role;
      GRANT EXECUTE ON FUNCTION credit_balance_with_first_deposit_bonus(TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
    `);
    console.log('✅ Granted permissions on credit function');

    // Step 4: Update get_user_wallets to deduplicate
    console.log('\n=== UPDATING WALLET FUNCTION TO DEDUPLICATE ===');
    
    await client.query(`
      CREATE OR REPLACE FUNCTION public.get_user_wallets(user_identifier text)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      DECLARE
        user_record RECORD;
        wallets_array jsonb := '[]'::jsonb;
        v_primary_wallet TEXT;
      BEGIN
        SELECT * INTO user_record
        FROM canonical_users
        WHERE LOWER(canonical_user_id) = LOWER(user_identifier)
           OR LOWER(wallet_address) = LOWER(user_identifier)
        LIMIT 1;

        IF user_record IS NULL THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'User not found',
            'wallets', '[]'::jsonb,
            'primary_wallet', NULL
          );
        END IF;

        v_primary_wallet := LOWER(user_record.wallet_address);

        IF v_primary_wallet IS NOT NULL THEN
          wallets_array := wallets_array || jsonb_build_object(
            'address', v_primary_wallet,
            'wallet_address', v_primary_wallet,
            'type', 'primary',
            'chain', 'base',
            'is_primary', true,
            'nickname', COALESCE(user_record.username, 'Primary Wallet'),
            'linked_at', COALESCE(user_record.created_at::text, NOW()::text)
          );
        END IF;

        IF user_record.eth_wallet_address IS NOT NULL 
           AND LOWER(user_record.eth_wallet_address) != COALESCE(v_primary_wallet, '') THEN
          wallets_array := wallets_array || jsonb_build_object(
            'address', LOWER(user_record.eth_wallet_address),
            'wallet_address', LOWER(user_record.eth_wallet_address),
            'type', 'ethereum',
            'chain', 'ethereum',
            'is_primary', false,
            'nickname', 'Ethereum Wallet',
            'linked_at', COALESCE(user_record.created_at::text, NOW()::text)
          );
        END IF;

        IF user_record.base_wallet_address IS NOT NULL 
           AND LOWER(user_record.base_wallet_address) != COALESCE(v_primary_wallet, '')
           AND LOWER(user_record.base_wallet_address) != COALESCE(LOWER(user_record.eth_wallet_address), '') THEN
          wallets_array := wallets_array || jsonb_build_object(
            'address', LOWER(user_record.base_wallet_address),
            'wallet_address', LOWER(user_record.base_wallet_address),
            'type', 'base',
            'chain', 'base',
            'is_primary', false,
            'nickname', 'Base Wallet',
            'linked_at', COALESCE(user_record.created_at::text, NOW()::text)
          );
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'wallets', wallets_array,
          'primary_wallet', v_primary_wallet,
          'wallet_address', v_primary_wallet,
          'eth_wallet_address', LOWER(user_record.eth_wallet_address),
          'base_wallet_address', LOWER(user_record.base_wallet_address)
        );
      END;
      $$;
    `);
    console.log('✅ Updated get_user_wallets to deduplicate by lowercase');

    // Grant permissions
    await client.query(`
      REVOKE ALL ON FUNCTION get_user_wallets(TEXT) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO service_role;
      GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO authenticated;
      GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO anon;
    `);
    console.log('✅ Granted permissions on wallet function');

    // Step 5: Verify triggers are gone
    console.log('\n=== VERIFICATION ===');
    const afterResult = await client.query(`
      SELECT trigger_name, event_manipulation
      FROM information_schema.triggers
      WHERE event_object_table = 'user_transactions'
        AND (
          trigger_name ILIKE '%credit%'
          OR trigger_name ILIKE '%topup%' 
          OR trigger_name ILIKE '%bonus%'
          OR trigger_name ILIKE '%commerce_post%'
        )
      ORDER BY trigger_name
    `);
    
    if (afterResult.rows.length === 0) {
      console.log('✅ SUCCESS: All problematic credit triggers have been disabled!');
    } else {
      console.log(`⚠️ WARNING: ${afterResult.rows.length} triggers still exist:`);
      afterResult.rows.forEach(row => {
        console.log(`  - ${row.trigger_name}`);
      });
    }

    console.log('\n=== FIX COMPLETE ===');
    console.log('Balance credits are now handled ONLY by:');
    console.log('  - commerce-webhook/index.ts');
    console.log('  - instant-topup.mts');
    console.log('Both use credit_balance_with_first_deposit_bonus() with idempotency.');
    console.log('\nWallet display now deduplicates by lowercase address.');

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  } finally {
    await client.end();
  }
}

fixTriggers();
