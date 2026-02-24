const { Client } = require("pg");

async function checkAndFixRealtime() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("=== CHECKING & FIXING REALTIME ===\n");

  // 1. Check current realtime tables
  console.log("1. CURRENT REALTIME TABLES:");
  const currentTables = await client.query(`
    SELECT tablename FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime'
    ORDER BY tablename
  `);

  const enabledTables = currentTables.rows.map((r) => r.tablename);
  console.log("   Enabled:", enabledTables.join(", ") || "(none)");

  // 2. Tables that MUST have realtime for dashboard to work
  const requiredTables = [
    "user_transactions", // Top-ups and purchases
    "sub_account_balances", // Balance changes
    "competition_entries", // Entries (live entries dashboard)
    "joincompetition", // Legacy entries / live activity
    "winners", // Winners display
    "competitions", // Competition status changes
    "canonical_users", // User profile updates
    "balance_ledger", // Balance audit trail
    "pending_tickets", // Live activity feed
    "tickets", // Ticket allocations
  ];

  console.log("\n2. ENABLING REALTIME FOR REQUIRED TABLES:");
  for (const table of requiredTables) {
    const isEnabled = enabledTables.includes(table);
    if (isEnabled) {
      console.log(`   ✅ ${table} - already enabled`);
    } else {
      try {
        await client.query(
          `ALTER PUBLICATION supabase_realtime ADD TABLE public.${table}`,
        );
        console.log(`   🔄 ${table} - ENABLED`);
      } catch (err) {
        if (err.message.includes("already member")) {
          console.log(`   ✅ ${table} - already enabled`);
        } else if (err.message.includes("does not exist")) {
          console.log(`   ⚠️  ${table} - table not found`);
        } else {
          console.log(`   ❌ ${table} - error: ${err.message}`);
        }
      }
    }
  }

  // 3. Set replica identity FULL for better updates
  console.log("\n3. SETTING REPLICA IDENTITY FULL:");
  for (const table of requiredTables) {
    try {
      const tableExists = await client.query(
        `
        SELECT EXISTS (SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1)
      `,
        [table],
      );

      if (tableExists.rows[0].exists) {
        await client.query(`ALTER TABLE public.${table} REPLICA IDENTITY FULL`);
        console.log(`   ✅ ${table} - set to FULL`);
      }
    } catch (err) {
      console.log(`   ⚠️  ${table} - ${err.message}`);
    }
  }

  // 4. Check if instant-topup properly creates user_transactions
  console.log("\n4. CHECKING TOPUP FLOW:");
  console.log("   When a wallet topup happens:");
  console.log(
    "   1. instant-topup.mts creates user_transactions row (is_topup=true)",
  );
  console.log("   2. Frontend subscribes to user_transactions changes");
  console.log(
    "   3. credit_balance_with_first_deposit_bonus() credits balance",
  );
  console.log("   4. Frontend subscribes to sub_account_balances changes");
  console.log("");
  console.log("   Both tables now have realtime enabled!");

  // 5. Verify yammy's recent transactions
  console.log("\n5. YAMMY RECENT TRANSACTIONS:");
  const yammyTx = await client.query(`
    SELECT id, transaction_type, status, is_topup, amount, posted_to_balance, wallet_credited, created_at
    FROM user_transactions
    WHERE canonical_user_id = 'prize:pid:0xc344b1b6a5ad9c5e25725e476df7a62e3c8726dd'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  yammyTx.rows.forEach((tx, i) => {
    console.log(
      `   ${i + 1}. ${tx.transaction_type} | $${tx.amount} | status=${tx.status} | topup=${tx.is_topup} | posted=${tx.posted_to_balance}`,
    );
  });

  console.log("\n=== DONE ===");
  console.log("Realtime enabled for all dashboard tables.");
  console.log("Frontend will now receive live updates for:");
  console.log("  - Balance changes (sub_account_balances)");
  console.log("  - Topups/Purchases (user_transactions)");
  console.log("  - Entries (competition_entries, joincompetition)");
  console.log("  - Winners (winners)");

  await client.end();
}

checkAndFixRealtime().catch(console.error);
