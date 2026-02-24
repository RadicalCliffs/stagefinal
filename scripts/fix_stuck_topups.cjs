/**
 * Fix stuck topups that already have ledger entries
 * (Balance was credited, just posted_to_balance flag not set)
 */
const { Client } = require("pg");

async function fixStuckTopups() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("=== FIXING STUCK TOPUPS ===\n");

  try {
    // First check the constraint
    const constraint = await client.query(`
      SELECT pg_get_constraintdef(oid) as def
      FROM pg_constraint 
      WHERE conname = 'user_tx_posted_balance_chk'
    `);
    console.log("Constraint:", constraint.rows[0]?.def);

    // Check current payment providers
    const providers = await client.query(`
      SELECT DISTINCT payment_provider, COUNT(*) as cnt
      FROM user_transactions
      WHERE type = 'topup'
        AND (posted_to_balance = false OR posted_to_balance IS NULL)
      GROUP BY payment_provider
    `);
    console.log("Stuck topup payment providers:");
    providers.rows.forEach((row) =>
      console.log(`  ${row.payment_provider}: ${row.cnt}`),
    );

    // Find and fix stuck topups that HAVE ledger entries
    // Also fix payment_provider to cdp_commerce so constraint passes
    const result = await client.query(`
      WITH stuck AS (
        SELECT ut.id, ut.tx_id
        FROM user_transactions ut
        JOIN balance_ledger bl ON bl.reference_id = ut.tx_id
        WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
          AND ut.type = 'topup'
          AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
      )
      UPDATE user_transactions ut
      SET posted_to_balance = true, 
          payment_provider = 'cdp_commerce',
          updated_at = NOW()
      FROM stuck
      WHERE ut.id = stuck.id
      RETURNING ut.id, ut.amount, ut.tx_id
    `);

    console.log(`Fixed ${result.rowCount} stuck topups (had ledger entries)`);
    result.rows.forEach((row, i) => {
      console.log(
        `  ${i + 1}. $${row.amount} - tx: ${row.tx_id?.substring(0, 20)}...`,
      );
    });

    // Show remaining stuck (no ledger entry)
    const remaining = await client.query(`
      SELECT COUNT(*) as count
      FROM user_transactions ut
      LEFT JOIN balance_ledger bl ON bl.reference_id = ut.tx_id
      WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
        AND ut.type = 'topup'
        AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
        AND bl.id IS NULL
    `);
    console.log(
      `\nRemaining stuck topups (NO ledger entry): ${remaining.rows[0].count}`,
    );
    console.log(
      "These may need manual investigation or the balance was never credited.",
    );

    console.log("\n=== FIX COMPLETE ===");
  } finally {
    await client.end();
  }
}

fixStuckTopups().catch(console.error);
