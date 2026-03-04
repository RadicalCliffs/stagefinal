import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== DIAGNOSING HIGHBLOCK & LUXE TOPUP ISSUES ===\n");

// Search for users named "Highblock" or "luxe"
console.log("1. Finding users...\n");

const { data: users, error: usersError } = await supabase
  .from("canonical_users")
  .select(
    "id, canonical_user_id, username, first_name, last_name, email, has_used_new_user_bonus",
  )
  .or(
    "username.ilike.%highblock%,username.ilike.%luxe%,email.ilike.%highblock%,email.ilike.%luxe%,first_name.ilike.%highblock%,first_name.ilike.%luxe%,last_name.ilike.%highblock%,last_name.ilike.%luxe%",
  );

if (usersError) {
  console.error("Error finding users:", usersError);
  process.exit(1);
}

if (!users || users.length === 0) {
  console.log("❌ No users found matching 'Highblock' or 'luxe'\n");
  console.log("Searching for recent topups from the last 7 days instead...\n");

  // Look for recent topup attempts
  const { data: recentTopups, error: topupsError } = await supabase
    .from("user_transactions")
    .select("*")
    .eq("type", "topup")
    .gte(
      "created_at",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (topupsError) {
    console.error("Error finding recent topups:", topupsError);
    process.exit(1);
  }

  console.log(
    `Found ${recentTopups?.length || 0} recent topups in last 7 days:\n`,
  );

  for (const tx of recentTopups || []) {
    console.log(`📦 Transaction ${tx.id}`);
    console.log(`   User: ${tx.canonical_user_id || tx.user_id}`);
    console.log(`   Amount: $${tx.amount}`);
    console.log(`   Status: ${tx.status} / Payment: ${tx.payment_status}`);
    console.log(`   Posted to balance: ${tx.posted_to_balance}`);
    console.log(`   Wallet credited: ${tx.wallet_credited}`);
    console.log(`   Payment provider: ${tx.payment_provider}`);
    console.log(`   Created: ${tx.created_at}`);
    console.log(`   Completed: ${tx.completed_at || "N/A"}`);

    // Check if balance was credited
    if (tx.posted_to_balance) {
      console.log(`   ✅ Balance was posted`);
    } else {
      console.log(`   ❌ BALANCE NOT POSTED - STUCK TOPUP!`);
    }

    // Check balance_ledger for this transaction
    const { data: ledger, error: ledgerError } = await supabase
      .from("balance_ledger")
      .select("*")
      .or(
        `reference_id.eq.${tx.webhook_ref},reference_id.eq.${tx.tx_id},reference_id.eq.${tx.charge_id},reference_id.eq.${tx.id}`,
      )
      .eq("canonical_user_id", tx.canonical_user_id || tx.user_id);

    if (ledgerError) {
      console.log(
        `   ⚠️ Error checking balance_ledger: ${ledgerError.message}`,
      );
    } else if (ledger && ledger.length > 0) {
      console.log(`   📒 Found ${ledger.length} balance_ledger entries`);
      for (const entry of ledger) {
        console.log(
          `      - ${entry.transaction_type}: $${entry.amount} (${entry.description})`,
        );
      }
    } else {
      console.log(`   ❌ NO BALANCE_LEDGER ENTRIES - PAYMENT NOT RECORDED!`);
    }

    console.log();
  }

  process.exit(0);
}

console.log(`Found ${users.length} matching users:\n`);

for (const user of users) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(
    `👤 User: ${user.username || user.first_name || user.last_name || "Unknown"}`,
  );
  console.log(`   ID: ${user.id}`);
  console.log(`   Canonical ID: ${user.canonical_user_id}`);
  console.log(`   Email: ${user.email || "N/A"}`);
  console.log(`   Has used bonus: ${user.has_used_new_user_bonus}`);

  // Check balance
  const { data: balance, error: balanceError } = await supabase
    .from("sub_account_balances")
    .select("*")
    .eq("canonical_user_id", user.canonical_user_id)
    .eq("currency", "USD")
    .single();

  if (balanceError) {
    console.log(`   ⚠️ No balance record found`);
  } else {
    console.log(
      `   💰 Balance: $${balance.available_balance || 0} available, $${balance.bonus_balance || 0} bonus`,
    );
  }

  // Check transactions
  const { data: transactions, error: txError } = await supabase
    .from("user_transactions")
    .select("*")
    .or(
      `canonical_user_id.eq.${user.canonical_user_id},user_id.eq.${user.canonical_user_id}`,
    )
    .eq("type", "topup")
    .order("created_at", { ascending: false })
    .limit(10);

  if (txError) {
    console.log(`   ❌ Error fetching transactions: ${txError.message}`);
  } else if (!transactions || transactions.length === 0) {
    console.log(`   ⚠️ No topup transactions found`);
  } else {
    console.log(`\n   📊 Topup Transactions (${transactions.length}):`);

    for (const tx of transactions) {
      console.log(`\n   📦 Transaction ${tx.id}`);
      console.log(`      Amount: $${tx.amount}`);
      console.log(`      Status: ${tx.status} / Payment: ${tx.payment_status}`);
      console.log(`      Posted to balance: ${tx.posted_to_balance}`);
      console.log(`      Wallet credited: ${tx.wallet_credited}`);
      console.log(`      Payment provider: ${tx.payment_provider}`);
      console.log(`      Created: ${tx.created_at}`);
      console.log(`      Completed: ${tx.completed_at || "N/A"}`);
      console.log(`      webhook_ref: ${tx.webhook_ref || "N/A"}`);
      console.log(`      tx_id: ${tx.tx_id || "N/A"}`);
      console.log(`      charge_id: ${tx.charge_id || "N/A"}`);

      if (
        !tx.posted_to_balance &&
        (tx.payment_status === "completed" || tx.payment_status === "confirmed")
      ) {
        console.log(
          `      ⚠️  STUCK TOPUP - Payment confirmed but balance not credited!`,
        );
      }

      // Check balance_ledger
      const { data: ledger, error: ledgerError } = await supabase
        .from("balance_ledger")
        .select("*")
        .or(
          `reference_id.eq.${tx.webhook_ref},reference_id.eq.${tx.tx_id},reference_id.eq.${tx.charge_id},reference_id.eq.${tx.id}`,
        )
        .eq("canonical_user_id", user.canonical_user_id);

      if (ledgerError) {
        console.log(
          `      ⚠️ Error checking balance_ledger: ${ledgerError.message}`,
        );
      } else if (ledger && ledger.length > 0) {
        console.log(`      📒 Balance ledger entries: ${ledger.length}`);
        for (const entry of ledger) {
          console.log(
            `         - ${entry.transaction_type}: $${entry.amount} (${entry.description || "No description"})`,
          );
        }
      } else {
        console.log(`      ❌ NO BALANCE_LEDGER ENTRIES!`);
      }
    }
  }
}

console.log(`\n${"=".repeat(80)}`);
console.log("\n=== SUMMARY ===\n");
console.log(
  "If you see STUCK TOPUPS above (payment confirmed but balance not credited),",
);
console.log(
  "run CREDIT_ALL_STUCK_TOPUPS_WITH_BONUS.mjs to credit them with 50% bonus.\n",
);
