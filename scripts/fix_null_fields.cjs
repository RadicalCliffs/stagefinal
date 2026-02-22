const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.mthwfldcjvpxjtmrqkqm',
  password: 'LetsF4ckenGo!',
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await client.connect();
    console.log('='.repeat(80));
    console.log('DATABASE INTEGRITY AUDIT & FIX');
    console.log('='.repeat(80));

    // ========================================================================
    // STEP 1: AUDIT CURRENT STATE
    // ========================================================================
    console.log('\n📊 STEP 1: AUDIT CURRENT STATE');
    console.log('-'.repeat(40));

    // JoinCompetition table
    const jcStats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(transaction_hash) as has_tx,
        COUNT(payment_provider) as has_provider,
        COUNT(wallet_address) as has_wallet,
        COUNT(canonical_user_id) as has_cuid
      FROM joincompetition
    `);
    const jc = jcStats.rows[0];
    console.log(`\nJOINCOMPETITION (${jc.total} rows):`);
    console.log(`  transaction_hash: ${jc.has_tx}/${jc.total} (${jc.total - jc.has_tx} NULL)`);
    console.log(`  payment_provider: ${jc.has_provider}/${jc.total} (${jc.total - jc.has_provider} NULL)`);
    console.log(`  wallet_address: ${jc.has_wallet}/${jc.total} (${jc.total - jc.has_wallet} NULL)`);
    console.log(`  canonical_user_id: ${jc.has_cuid}/${jc.total} (${jc.total - jc.has_cuid} NULL)`);

    // User transactions
    const utStats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(tx_ref) as has_tx_ref,
        COUNT(payment_provider) as has_provider,
        COUNT(canonical_user_id) as has_cuid
      FROM user_transactions
    `);
    const ut = utStats.rows[0];
    console.log(`\nUSER_TRANSACTIONS (${ut.total} rows):`);
    console.log(`  tx_ref: ${ut.has_tx_ref}/${ut.total} (${ut.total - ut.has_tx_ref} NULL)`);
    console.log(`  payment_provider: ${ut.has_provider}/${ut.total} (${ut.total - ut.has_provider} NULL)`);
    console.log(`  canonical_user_id: ${ut.has_cuid}/${ut.total} (${ut.total - ut.has_cuid} NULL)`);

    // Balance ledger
    const blStats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(reference_id) as has_ref,
        COUNT(top_up_tx_id) as has_topup_tx
      FROM balance_ledger
    `);
    const bl = blStats.rows[0];
    console.log(`\nBALANCE_LEDGER (${bl.total} rows):`);
    console.log(`  reference_id: ${bl.has_ref}/${bl.total} (${bl.total - bl.has_ref} NULL)`);
    console.log(`  top_up_tx_id: ${bl.has_topup_tx}/${bl.total}`);

    // Orders
    const ordStats = await client.query(`
      SELECT 
        COUNT(*) as total,
        MAX(created_at) as latest
      FROM orders
    `);
    console.log(`\nORDERS (${ordStats.rows[0].total} rows, latest: ${ordStats.rows[0].latest || 'N/A'})`);

    // ========================================================================
    // STEP 2: CREATE ERROR_LOG TABLE
    // ========================================================================
    console.log('\n📊 STEP 2: CREATE ERROR_LOG TABLE');
    console.log('-'.repeat(40));

    await client.query(`
      CREATE TABLE IF NOT EXISTS data_integrity_errors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        field_name TEXT,
        expected_value TEXT,
        actual_value TEXT,
        severity TEXT DEFAULT 'warning', -- 'warning', 'error', 'critical'
        resolved BOOLEAN DEFAULT FALSE,
        resolved_at TIMESTAMP WITH TIME ZONE,
        resolved_by TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'::jsonb
      )
    `);
    console.log('✅ Created data_integrity_errors table');

    // Index for efficient lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_data_integrity_errors_unresolved 
      ON data_integrity_errors (table_name, resolved, created_at DESC)
      WHERE resolved = FALSE
    `);
    console.log('✅ Created index on data_integrity_errors');

    // ========================================================================
    // STEP 3: BACKFILL joincompetition NULLS
    // ========================================================================
    console.log('\n📊 STEP 3: BACKFILL joincompetition NULLS');
    console.log('-'.repeat(40));

    // Fix entries missing payment_provider based on context
    // If they have a canonical_user_id, assume balance purchase
    const fixProvider = await client.query(`
      UPDATE joincompetition
      SET payment_provider = 'balance'
      WHERE payment_provider IS NULL
        AND canonical_user_id IS NOT NULL
      RETURNING id
    `);
    console.log(`✅ Fixed ${fixProvider.rowCount} entries with missing payment_provider -> 'balance'`);

    // Fix entries missing transaction_hash - generate internal reference
    const fixTxHash = await client.query(`
      UPDATE joincompetition
      SET transaction_hash = 'bal:' || id::text
      WHERE transaction_hash IS NULL
        AND payment_provider IN ('balance', 'base_account')
      RETURNING id
    `);
    console.log(`✅ Fixed ${fixTxHash.rowCount} balance entries with tx_hash -> 'bal:{id}'`);

    // Fix entries missing wallet_address - derive from canonical_user_id
    const fixWallet = await client.query(`
      UPDATE joincompetition jc
      SET wallet_address = cu.wallet_address
      FROM canonical_users cu
      WHERE jc.canonical_user_id = cu.canonical_user_id
        AND jc.wallet_address IS NULL
        AND cu.wallet_address IS NOT NULL
      RETURNING jc.id
    `);
    console.log(`✅ Fixed ${fixWallet.rowCount} entries with wallet_address from canonical_users`);

    // Fix entries missing canonical_user_id - derive from wallet_address
    const fixCuid = await client.query(`
      UPDATE joincompetition jc
      SET canonical_user_id = cu.canonical_user_id
      FROM canonical_users cu
      WHERE jc.wallet_address = cu.wallet_address
        AND jc.canonical_user_id IS NULL
        AND cu.canonical_user_id IS NOT NULL
      RETURNING jc.id
    `);
    console.log(`✅ Fixed ${fixCuid.rowCount} entries with canonical_user_id from canonical_users`);

    // ========================================================================
    // STEP 4: BACKFILL user_transactions NULLS
    // ========================================================================
    console.log('\n📊 STEP 4: BACKFILL user_transactions NULLS');
    console.log('-'.repeat(40));

    // Fix missing payment_provider
    const fixUtProvider = await client.query(`
      UPDATE user_transactions
      SET payment_provider = COALESCE(provider, 'balance')
      WHERE payment_provider IS NULL
      RETURNING id
    `);
    console.log(`✅ Fixed ${fixUtProvider.rowCount} user_transactions with payment_provider`);

    // Fix missing tx_id - generate from ID (tx_ref is a generated column, cannot be updated directly)
    const fixUtTxId = await client.query(`
      UPDATE user_transactions
      SET tx_id = 'ut:' || id::text
      WHERE tx_id IS NULL
      RETURNING id
    `);
    console.log(`✅ Fixed ${fixUtTxId.rowCount} user_transactions with tx_id -> 'ut:{id}'`);

    // Fix missing canonical_user_id - derive from wallet_address
    const fixUtCuid = await client.query(`
      UPDATE user_transactions ut
      SET canonical_user_id = cu.canonical_user_id
      FROM canonical_users cu
      WHERE ut.wallet_address = cu.wallet_address
        AND ut.canonical_user_id IS NULL
        AND cu.canonical_user_id IS NOT NULL
      RETURNING ut.id
    `);
    console.log(`✅ Fixed ${fixUtCuid.rowCount} user_transactions with canonical_user_id`);

    // ========================================================================
    // STEP 5: BACKFILL balance_ledger NULLS
    // ========================================================================
    console.log('\n📊 STEP 5: BACKFILL balance_ledger NULLS');
    console.log('-'.repeat(40));

    // Fix missing reference_id - generate from ID
    const fixBlRef = await client.query(`
      UPDATE balance_ledger
      SET reference_id = 'bl:' || id::text
      WHERE reference_id IS NULL
      RETURNING id
    `);
    console.log(`✅ Fixed ${fixBlRef.rowCount} balance_ledger with reference_id -> 'bl:{id}'`);

    // ========================================================================
    // STEP 6: CREATE SELF-HEALING TRIGGERS
    // ========================================================================
    console.log('\n📊 STEP 6: CREATE SELF-HEALING TRIGGERS');
    console.log('-'.repeat(40));

    // Trigger function to auto-populate missing fields on joincompetition
    await client.query(`
      CREATE OR REPLACE FUNCTION ensure_joincompetition_integrity()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Auto-populate payment_provider if missing
        IF NEW.payment_provider IS NULL THEN
          IF NEW.canonical_user_id IS NOT NULL THEN
            NEW.payment_provider := 'balance';
          ELSE
            NEW.payment_provider := 'unknown';
          END IF;
          
          -- Log this as a warning
          INSERT INTO data_integrity_errors (table_name, record_id, error_type, error_message, field_name, expected_value, actual_value, severity)
          VALUES ('joincompetition', NEW.id::text, 'auto_populated', 'payment_provider was NULL, auto-populated', 'payment_provider', NEW.payment_provider, NULL, 'warning');
        END IF;
        
        -- Auto-populate transaction_hash if missing (for balance purchases)
        IF NEW.transaction_hash IS NULL THEN
          IF NEW.payment_provider IN ('balance', 'base_account') THEN
            NEW.transaction_hash := 'bal:' || NEW.id::text;
          ELSE
            -- For non-balance, this should have a real tx hash
            INSERT INTO data_integrity_errors (table_name, record_id, error_type, error_message, field_name, expected_value, actual_value, severity)
            VALUES ('joincompetition', NEW.id::text, 'missing_tx_hash', 'Non-balance purchase missing transaction_hash', 'transaction_hash', 'expected on-chain tx', NULL, 'error');
          END IF;
        END IF;
        
        -- Try to populate wallet_address from canonical_users if missing
        IF NEW.wallet_address IS NULL AND NEW.canonical_user_id IS NOT NULL THEN
          SELECT wallet_address INTO NEW.wallet_address
          FROM canonical_users
          WHERE canonical_user_id = NEW.canonical_user_id
          LIMIT 1;
        END IF;
        
        -- Try to populate canonical_user_id from canonical_users if missing
        IF NEW.canonical_user_id IS NULL AND NEW.wallet_address IS NOT NULL THEN
          SELECT canonical_user_id INTO NEW.canonical_user_id
          FROM canonical_users
          WHERE wallet_address = NEW.wallet_address
          LIMIT 1;
        END IF;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✅ Created ensure_joincompetition_integrity() function');

    // Drop existing trigger if exists
    await client.query(`DROP TRIGGER IF EXISTS trg_ensure_joincompetition_integrity ON joincompetition`);
    
    // Create trigger
    await client.query(`
      CREATE TRIGGER trg_ensure_joincompetition_integrity
      BEFORE INSERT OR UPDATE ON joincompetition
      FOR EACH ROW
      EXECUTE FUNCTION ensure_joincompetition_integrity()
    `);
    console.log('✅ Created trigger trg_ensure_joincompetition_integrity');

    // Trigger function for user_transactions
    await client.query(`
      CREATE OR REPLACE FUNCTION ensure_user_transactions_integrity()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Auto-populate tx_ref if missing
        IF NEW.tx_ref IS NULL THEN
          NEW.tx_ref := 'ut:' || NEW.id::text;
          
          INSERT INTO data_integrity_errors (table_name, record_id, error_type, error_message, field_name, expected_value, actual_value, severity)
          VALUES ('user_transactions', NEW.id::text, 'auto_populated', 'tx_ref was NULL, auto-populated', 'tx_ref', NEW.tx_ref, NULL, 'warning');
        END IF;
        
        -- Auto-populate payment_provider if missing
        IF NEW.payment_provider IS NULL THEN
          NEW.payment_provider := COALESCE(NEW.provider, 'balance');
        END IF;
        
        -- Try to populate canonical_user_id from canonical_users if missing
        IF NEW.canonical_user_id IS NULL AND NEW.wallet_address IS NOT NULL THEN
          SELECT canonical_user_id INTO NEW.canonical_user_id
          FROM canonical_users
          WHERE wallet_address = NEW.wallet_address
          LIMIT 1;
        END IF;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✅ Created ensure_user_transactions_integrity() function');

    await client.query(`DROP TRIGGER IF EXISTS trg_ensure_user_transactions_integrity ON user_transactions`);
    await client.query(`
      CREATE TRIGGER trg_ensure_user_transactions_integrity
      BEFORE INSERT OR UPDATE ON user_transactions
      FOR EACH ROW
      EXECUTE FUNCTION ensure_user_transactions_integrity()
    `);
    console.log('✅ Created trigger trg_ensure_user_transactions_integrity');

    // Trigger for balance_ledger
    await client.query(`
      CREATE OR REPLACE FUNCTION ensure_balance_ledger_integrity()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Auto-populate reference_id if missing
        IF NEW.reference_id IS NULL THEN
          NEW.reference_id := 'bl:' || NEW.id::text;
        END IF;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✅ Created ensure_balance_ledger_integrity() function');

    await client.query(`DROP TRIGGER IF EXISTS trg_ensure_balance_ledger_integrity ON balance_ledger`);
    await client.query(`
      CREATE TRIGGER trg_ensure_balance_ledger_integrity
      BEFORE INSERT OR UPDATE ON balance_ledger
      FOR EACH ROW
      EXECUTE FUNCTION ensure_balance_ledger_integrity()
    `);
    console.log('✅ Created trigger trg_ensure_balance_ledger_integrity');

    // ========================================================================
    // STEP 7: VERIFY FINAL STATE
    // ========================================================================
    console.log('\n📊 STEP 7: VERIFY FINAL STATE');
    console.log('-'.repeat(40));

    // Recheck JoinCompetition
    const jcFinal = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(transaction_hash) as has_tx,
        COUNT(payment_provider) as has_provider,
        COUNT(wallet_address) as has_wallet,
        COUNT(canonical_user_id) as has_cuid
      FROM joincompetition
    `);
    const jcf = jcFinal.rows[0];
    console.log(`\nJOINCOMPETITION FINAL:`);
    console.log(`  transaction_hash: ${jcf.has_tx}/${jcf.total} (${jcf.total - jcf.has_tx} NULL)`);
    console.log(`  payment_provider: ${jcf.has_provider}/${jcf.total} (${jcf.total - jcf.has_provider} NULL)`);
    
    // Recheck user_transactions
    const utFinal = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(tx_ref) as has_tx_ref,
        COUNT(payment_provider) as has_provider
      FROM user_transactions
    `);
    const utf = utFinal.rows[0];
    console.log(`\nUSER_TRANSACTIONS FINAL:`);
    console.log(`  tx_ref: ${utf.has_tx_ref}/${utf.total} (${utf.total - utf.has_tx_ref} NULL)`);
    console.log(`  payment_provider: ${utf.has_provider}/${utf.total} (${utf.total - utf.has_provider} NULL)`);

    // Check logged errors
    const errorCount = await client.query(`SELECT COUNT(*) as cnt FROM data_integrity_errors WHERE resolved = FALSE`);
    console.log(`\n📋 Logged ${errorCount.rows[0].cnt} data integrity errors (unresolved)`);

    console.log('\n' + '='.repeat(80));
    console.log('✅ DATABASE INTEGRITY FIX COMPLETE');
    console.log('='.repeat(80));

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  } finally {
    await client.end();
  }
})();
