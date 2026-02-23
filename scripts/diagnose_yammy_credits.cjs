/**
 * Diagnose yammy's exact topup credits
 * Run: node scripts/diagnose_yammy_credits.cjs
 */

const { Client } = require("pg");

async function diagnose() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
  });

  try {
    await client.connect();
    console.log("Connected to database\n");

    // Find yammy's canonical_user_id
    console.log("=== 1. FINDING YAMMY ===");
    const userResult = await client.query(`
      SELECT canonical_user_id, wallet_address, username, has_used_new_user_bonus, created_at
      FROM canonical_users
      WHERE wallet_address ILIKE '%0xc344%'
         OR canonical_user_id ILIKE '%0xc344%'
         OR username = 'yammy'
    `);
    console.log("User record:", userResult.rows[0] || "NOT FOUND");

    if (!userResult.rows[0]) {
      console.log("Cannot find yammy - exiting");
      return;
    }

    const canonicalUserId = userResult.rows[0].canonical_user_id;
    const walletAddress = userResult.rows[0].wallet_address;
    console.log(`\nCanonical User ID: ${canonicalUserId}`);
    console.log(`Wallet Address: ${walletAddress}`);
    console.log(
      `Has used bonus: ${userResult.rows[0].has_used_new_user_bonus}`,
    );

    // Check current balance
    console.log("\n=== 2. CURRENT BALANCE ===");
    const balanceResult = await client.query(
      `
      SELECT available_balance, bonus_balance, pending_balance, updated_at
      FROM sub_account_balances
      WHERE canonical_user_id = $1 OR LOWER(canonical_user_id) = LOWER($1)
    `,
      [canonicalUserId],
    );
    console.log("Balance record:", balanceResult.rows[0] || "NOT FOUND");

    // Check ALL balance_ledger entries - this shows EVERY credit
    console.log("\n=== 3. BALANCE LEDGER (ALL CREDITS) ===");
    const ledgerResult = await client.query(
      `
      SELECT id, transaction_type, amount, balance_before, balance_after, 
             description, reference_id, created_at
      FROM balance_ledger
      WHERE canonical_user_id = $1 OR LOWER(canonical_user_id) = LOWER($1)
      ORDER BY created_at ASC
    `,
      [canonicalUserId],
    );

    console.log(`Found ${ledgerResult.rows.length} ledger entries:`);
    let totalCredited = 0;
    ledgerResult.rows.forEach((row, i) => {
      console.log(`\n  Entry ${i + 1}:`);
      console.log(`    Type: ${row.transaction_type}`);
      console.log(`    Amount: $${row.amount}`);
      console.log(
        `    Before: $${row.balance_before} -> After: $${row.balance_after}`,
      );
      console.log(`    Description: ${row.description}`);
      console.log(`    Reference: ${row.reference_id}`);
      console.log(`    Time: ${row.created_at}`);
      totalCredited += parseFloat(row.amount) || 0;
    });
    console.log(`\n  TOTAL CREDITED: $${totalCredited}`);

    // Check user_transactions for topups
    console.log("\n=== 4. USER_TRANSACTIONS (TOPUPS) ===");
    const txResult = await client.query(
      `
      SELECT id, amount, status, payment_status, payment_provider, type,
             tx_id, charge_id, posted_to_balance, wallet_credited, 
             notes, created_at, completed_at
      FROM user_transactions
      WHERE (canonical_user_id = $1 OR LOWER(canonical_user_id) = LOWER($1) OR user_id = $1)
        AND type = 'topup'
      ORDER BY created_at ASC
    `,
      [canonicalUserId],
    );

    console.log(`Found ${txResult.rows.length} topup transactions:`);
    txResult.rows.forEach((row, i) => {
      console.log(`\n  Transaction ${i + 1}:`);
      console.log(`    ID: ${row.id}`);
      console.log(`    Amount: $${row.amount}`);
      console.log(`    Status: ${row.status} / ${row.payment_status}`);
      console.log(`    Provider: ${row.payment_provider}`);
      console.log(`    TX ID: ${row.tx_id}`);
      console.log(`    Charge ID: ${row.charge_id}`);
      console.log(`    Posted to balance: ${row.posted_to_balance}`);
      console.log(`    Wallet credited: ${row.wallet_credited}`);
      console.log(`    Notes: ${row.notes}`);
      console.log(`    Created: ${row.created_at}`);
    });

    // Check for duplicate reference_ids in ledger
    console.log("\n=== 5. DUPLICATE REFERENCE CHECK ===");
    const dupeResult = await client.query(
      `
      SELECT reference_id, COUNT(*) as count, SUM(amount) as total_amount
      FROM balance_ledger
      WHERE canonical_user_id = $1 OR LOWER(canonical_user_id) = LOWER($1)
      GROUP BY reference_id
      HAVING COUNT(*) > 1
    `,
      [canonicalUserId],
    );

    if (dupeResult.rows.length > 0) {
      console.log("DUPLICATES FOUND:");
      dupeResult.rows.forEach((row) => {
        console.log(
          `  Reference: ${row.reference_id} - ${row.count} times = $${row.total_amount}`,
        );
      });
    } else {
      console.log("No duplicate reference_ids found");
    }

    // Check what triggers exist
    console.log("\n=== 6. ACTIVE TRIGGERS ON user_transactions ===");
    const triggerResult = await client.query(`
      SELECT trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'user_transactions'
    `);
    console.log(`Found ${triggerResult.rows.length} triggers:`);
    triggerResult.rows.forEach((row) => {
      console.log(`  - ${row.trigger_name} (${row.event_manipulation})`);
    });

    console.log("\n=== DIAGNOSIS COMPLETE ===");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

diagnose();
