/**
 * Investigate and optionally fix data inconsistencies
 */
const { Client } = require("pg");

async function investigate() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("=== INVESTIGATING DATA ISSUES ===\n");

  try {
    // 1. Show stuck topups details
    console.log("=== STUCK COMPLETED TOPUPS (not credited) ===");
    const stuck = await client.query(`
      SELECT 
        id,
        canonical_user_id,
        type,
        amount,
        status,
        payment_status,
        posted_to_balance,
        tx_id,
        created_at
      FROM user_transactions
      WHERE (status = 'completed' OR payment_status = 'completed')
        AND type = 'topup'
        AND (posted_to_balance = false OR posted_to_balance IS NULL)
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log("Sample stuck topups:");
    stuck.rows.forEach((row, i) => {
      console.log(
        `  ${i + 1}. $${row.amount} - status=${row.status}/${row.payment_status} - posted=${row.posted_to_balance}`,
      );
      console.log(
        `     canonical: ${row.canonical_user_id?.substring(0, 40)}...`,
      );
      console.log(`     tx_id: ${row.tx_id?.substring(0, 20)}...`);
      console.log(`     created: ${row.created_at}`);
    });

    // 2. Show balance/ledger discrepancies
    console.log("\n=== BALANCE/LEDGER DISCREPANCIES ===");
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
      SELECT 
        lt.canonical_user_id,
        lt.credits,
        lt.debits,
        lt.net as ledger_net,
        sab.available_balance,
        sab.bonus_balance,
        (sab.available_balance + COALESCE(sab.bonus_balance, 0)) as actual_balance,
        (lt.net - (sab.available_balance + COALESCE(sab.bonus_balance, 0))) as difference
      FROM ledger_totals lt
      JOIN sub_account_balances sab ON sab.canonical_user_id = lt.canonical_user_id
      WHERE ABS(lt.net - (sab.available_balance + COALESCE(sab.bonus_balance, 0))) > 0.01
      ORDER BY ABS(lt.net - (sab.available_balance + COALESCE(sab.bonus_balance, 0))) DESC
    `);
    console.log("Users with balance/ledger mismatch:");
    discrepancy.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.canonical_user_id?.substring(0, 40)}...`);
      console.log(
        `     Ledger: credits=$${row.credits}, debits=$${row.debits}, net=$${row.ledger_net}`,
      );
      console.log(
        `     Actual: available=$${row.available_balance}, bonus=$${row.bonus_balance}, total=$${row.actual_balance}`,
      );
      console.log(`     DIFFERENCE: $${row.difference}`);
    });

    // 3. Check if stuck topups have reference_ids that ARE in the ledger (already processed)
    console.log("\n=== ANALYZING STUCK TOPUPS ===");
    const analysis = await client.query(`
      SELECT 
        ut.id,
        ut.amount,
        ut.tx_id,
        ut.created_at,
        bl.id as ledger_id,
        CASE WHEN bl.id IS NOT NULL THEN 'Has ledger entry' ELSE 'NO ledger entry' END as ledger_status
      FROM user_transactions ut
      LEFT JOIN balance_ledger bl ON bl.reference_id = ut.tx_id
      WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
        AND ut.type = 'topup'
        AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
      ORDER BY ut.created_at DESC
      LIMIT 20
    `);

    let withLedger = 0,
      withoutLedger = 0;
    analysis.rows.forEach((row) => {
      if (row.ledger_id) withLedger++;
      else withoutLedger++;
    });
    console.log(
      `Stuck topups WITH ledger entry (safe to mark posted): ${withLedger}`,
    );
    console.log(
      `Stuck topups WITHOUT ledger entry (need manual fix): ${withoutLedger}`,
    );

    console.log("\n=== INVESTIGATION COMPLETE ===");
  } finally {
    await client.end();
  }
}

investigate().catch(console.error);
