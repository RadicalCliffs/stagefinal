/**
 * Check for data inconsistencies in the database
 */
const { Client } = require("pg");

async function checkDataConsistency() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("=== DATA CONSISTENCY CHECK ===\n");

  try {
    // 1. Check for stuck transactions - completed but not credited
    const stuck = await client.query(`
      SELECT COUNT(*) as count
      FROM user_transactions
      WHERE (status = 'completed' OR payment_status = 'completed')
        AND type = 'topup'
        AND (posted_to_balance = false OR posted_to_balance IS NULL)
    `);
    console.log(
      "1. Stuck completed topups (not credited):",
      stuck.rows[0].count,
    );

    // 2. Check for orphaned balance_ledger entries
    const orphan = await client.query(`
      SELECT COUNT(*) as count
      FROM balance_ledger bl
      LEFT JOIN canonical_users cu ON cu.canonical_user_id = bl.canonical_user_id
      WHERE cu.id IS NULL
    `);
    console.log("2. Orphaned ledger entries:", orphan.rows[0].count);

    // 3. Check for balance discrepancies (ledger sum vs actual balance)
    const discrepancy = await client.query(`
      WITH ledger_totals AS (
        SELECT 
          canonical_user_id,
          SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as credits,
          SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as debits,
          SUM(amount) as net
        FROM balance_ledger
        GROUP BY canonical_user_id
      )
      SELECT COUNT(*) as count
      FROM ledger_totals lt
      JOIN sub_account_balances sab ON sab.canonical_user_id = lt.canonical_user_id
      WHERE ABS(lt.net - (sab.available_balance + COALESCE(sab.bonus_balance, 0))) > 0.01
    `);
    console.log("3. Balance/ledger discrepancies:", discrepancy.rows[0].count);

    // 4. Check for duplicate reference_ids in balance_ledger
    const dupes = await client.query(`
      SELECT COUNT(*) as count
      FROM (
        SELECT reference_id, COUNT(*) as cnt
        FROM balance_ledger
        WHERE reference_id IS NOT NULL
        GROUP BY reference_id
        HAVING COUNT(*) > 1
      ) d
    `);
    console.log("4. Duplicate reference_ids in ledger:", dupes.rows[0].count);

    // 5. Check for topups without matching ledger entry
    const missingLedger = await client.query(`
      SELECT COUNT(*) as count
      FROM user_transactions ut
      LEFT JOIN balance_ledger bl ON bl.reference_id = ut.tx_id
      WHERE ut.type = 'topup'
        AND ut.posted_to_balance = true
        AND ut.tx_id IS NOT NULL
        AND ut.tx_id LIKE '0x%'
        AND bl.id IS NULL
    `);
    console.log(
      "5. Credited topups without ledger entry:",
      missingLedger.rows[0].count,
    );

    // 6. Check for users with negative balance
    const negative = await client.query(`
      SELECT COUNT(*) as count
      FROM sub_account_balances
      WHERE available_balance < 0 OR bonus_balance < 0
    `);
    console.log("6. Users with negative balance:", negative.rows[0].count);

    console.log("\n=== CHECK COMPLETE ===");
  } finally {
    await client.end();
  }
}

checkDataConsistency().catch(console.error);
