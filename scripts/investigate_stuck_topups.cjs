/**
 * Investigate the stuck topups with no ledger entry
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

  const stuck = await client.query(`
    SELECT 
      ut.id,
      ut.canonical_user_id,
      ut.amount,
      ut.payment_provider,
      ut.status,
      ut.payment_status,
      ut.tx_id,
      ut.created_at,
      ut.notes
    FROM user_transactions ut
    LEFT JOIN balance_ledger bl ON bl.reference_id = ut.tx_id
    WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
      AND ut.type = 'topup'
      AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
      AND bl.id IS NULL
    ORDER BY ut.created_at DESC
  `);

  console.log(
    "=== " + stuck.rowCount + " STUCK TOPUPS (NO LEDGER ENTRY) ===\n",
  );

  const byProvider = {};
  const byUser = {};

  stuck.rows.forEach((row, i) => {
    // Count by provider
    byProvider[row.payment_provider] =
      (byProvider[row.payment_provider] || 0) + 1;
    // Count by user
    const userKey = row.canonical_user_id?.substring(0, 50) || "NULL";
    byUser[userKey] = (byUser[userKey] || 0) + parseFloat(row.amount);

    console.log(i + 1 + ". $" + row.amount + " - " + row.payment_provider);
    console.log(
      "   user: " + (row.canonical_user_id || "NULL")?.substring(0, 50),
    );
    console.log("   tx_id: " + (row.tx_id || "NULL")?.substring(0, 40));
    console.log("   status: " + row.status + "/" + row.payment_status);
    console.log("   created: " + row.created_at);
    if (row.notes) console.log("   notes: " + row.notes?.substring(0, 60));
    console.log("");
  });

  console.log("=== SUMMARY BY PROVIDER ===");
  Object.entries(byProvider).forEach(([p, c]) =>
    console.log("  " + p + ": " + c),
  );

  console.log("\n=== TOTAL UNCREDITED BY USER ===");
  Object.entries(byUser)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([u, a]) => console.log("  " + u + ": $" + a.toFixed(2)));

  await client.end();
}

investigate().catch(console.error);
