import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjU1Mjc0MSwiZXhwIjoyMDQ4MTI4NzQxfQ.-3ySlKeyLeN0esd0xRo-gjfIh_UnmP4hpfn2QSJ_d2I",
);

console.log("🔍 INVESTIGATING USER 'invest' TOPUP ISSUE\n");
console.log("=".repeat(80));

// Step 1: Find user by username
console.log("\n1. Finding user by username 'invest'...\n");
const { data: user, error: userError } = await supabase
  .from("canonical_users")
  .select("canonical_user_id, username, wallet_address, email")
  .ilike("username", "invest")
  .single();

if (userError || !user) {
  console.error("❌ User not found:", userError);
  process.exit(1);
}

console.log("✅ Found user:");
console.log(`   canonical_user_id: ${user.canonical_user_id}`);
console.log(`   username: ${user.username}`);
console.log(`   wallet: ${user.wallet_address}`);
console.log(`   email: ${user.email}`);

const userId = user.canonical_user_id;

// Step 2: Check recent user_transactions (last 24 hours)
console.log("\n" + "=".repeat(80));
console.log("2. Checking RECENT user_transactions (last 24 hours)...\n");

const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const { data: transactions, error: txError } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("canonical_user_id", userId)
  .gte("created_at", oneDayAgo)
  .order("created_at", { ascending: false });

if (txError) {
  console.error("❌ Error fetching transactions:", txError);
} else if (!transactions || transactions.length === 0) {
  console.log("❌ NO TRANSACTIONS FOUND in last 24 hours");
} else {
  console.log(`✅ Found ${transactions.length} recent transaction(s):\n`);
  transactions.forEach((tx, i) => {
    console.log(`Transaction ${i + 1}:`);
    console.log(`   id: ${tx.id}`);
    console.log(`   type: ${tx.type}`);
    console.log(`   amount: $${tx.amount}`);
    console.log(`   status: ${tx.status}`);
    console.log(`   payment_status: ${tx.payment_status}`);
    console.log(`   payment_provider: ${tx.payment_provider}`);
    console.log(`   posted_to_balance: ${tx.posted_to_balance}`);
    console.log(`   tx_id: ${tx.tx_id}`);
    console.log(`   charge_id: ${tx.charge_id}`);
    console.log(`   wallet_address: ${tx.wallet_address}`);
    console.log(`   user_id: ${tx.user_id}`);
    console.log(`   created_at: ${tx.created_at}`);
    console.log(`   completed_at: ${tx.completed_at}`);

    // Check dashboard visibility fields
    const hasDashboardFields =
      tx.type && tx.canonical_user_id && tx.user_id && tx.wallet_address;
    console.log(
      `   ✓ Dashboard fields: ${hasDashboardFields ? "✅ COMPLETE" : "❌ MISSING"}`,
    );

    if (!hasDashboardFields) {
      console.log(
        `      Missing: ${[
          !tx.type && "type",
          !tx.canonical_user_id && "canonical_user_id",
          !tx.user_id && "user_id",
          !tx.wallet_address && "wallet_address",
        ]
          .filter(Boolean)
          .join(", ")}`,
      );
    }
    console.log();
  });
}

// Step 3: Check balance_ledger
console.log("=".repeat(80));
console.log("3. Checking balance_ledger entries (last 24 hours)...\n");

const { data: ledger, error: ledgerError } = await supabase
  .from("balance_ledger")
  .select("*")
  .eq("canonical_user_id", userId)
  .gte("created_at", oneDayAgo)
  .order("created_at", { ascending: false });

if (ledgerError) {
  console.error("❌ Error fetching ledger:", ledgerError);
} else if (!ledger || ledger.length === 0) {
  console.log("❌ NO BALANCE_LEDGER ENTRIES in last 24 hours");
} else {
  console.log(`✅ Found ${ledger.length} recent ledger entry(ies):\n`);
  ledger.forEach((entry, i) => {
    console.log(`Entry ${i + 1}:`);
    console.log(`   transaction_type: ${entry.transaction_type}`);
    console.log(`   amount: $${entry.amount}`);
    console.log(`   balance_before: $${entry.balance_before}`);
    console.log(`   balance_after: $${entry.balance_after}`);
    console.log(`   reference_id: ${entry.reference_id}`);
    console.log(`   created_at: ${entry.created_at}`);
    console.log();
  });
}

// Step 4: Check current balance
console.log("=".repeat(80));
console.log("4. Checking current balance...\n");

const { data: balance, error: balanceError } = await supabase
  .from("sub_account_balances")
  .select("*")
  .eq("canonical_user_id", userId)
  .eq("currency", "USD")
  .single();

if (balanceError) {
  console.log("❌ No balance record found (or error):", balanceError.message);
} else {
  console.log("✅ Current balance:");
  console.log(`   available_balance: $${balance.available_balance}`);
  console.log(`   bonus_balance: $${balance.bonus_balance}`);
  console.log(`   pending_balance: $${balance.pending_balance}`);
  console.log(`   last_updated: ${balance.last_updated}`);
}

// Step 5: Check recent webhook events
console.log("\n" + "=".repeat(80));
console.log("5. Checking recent webhook events (last 1 hour)...\n");

const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const { data: webhooks, error: webhookError } = await supabase
  .from("payment_webhook_events")
  .select("*")
  .eq("provider", "coinbase_commerce")
  .gte("received_at", oneHourAgo)
  .order("received_at", { ascending: false });

if (webhookError) {
  console.error("❌ Error fetching webhooks:", webhookError);
} else if (!webhooks || webhooks.length === 0) {
  console.log("ℹ️  No recent webhook events (last 1 hour)");
} else {
  console.log(`✅ Found ${webhooks.length} recent webhook event(s):\n`);
  webhooks.forEach((wh, i) => {
    const metadata = wh.payload?.event?.data?.metadata || {};
    console.log(`Webhook ${i + 1}:`);
    console.log(`   event_type: ${wh.event_type}`);
    console.log(`   status: ${wh.status}`);
    console.log(`   charge_id: ${wh.payload?.event?.data?.id}`);
    console.log(`   metadata.user_id: ${metadata.user_id || "MISSING"}`);
    console.log(
      `   metadata.transaction_id: ${metadata.transaction_id || "MISSING"}`,
    );
    console.log(
      `   amount: $${wh.payload?.event?.data?.pricing?.local?.amount || "?"}`,
    );
    console.log(`   received_at: ${wh.received_at}`);
    console.log();
  });
}

// Step 6: Check get_user_topup_transactions RPC
console.log("=".repeat(80));
console.log(
  "6. Checking get_user_topup_transactions RPC (dashboard view)...\n",
);

const { data: rpcResult, error: rpcError } = await supabase.rpc(
  "get_user_topup_transactions",
  { user_identifier: userId },
);

if (rpcError) {
  console.error("❌ RPC Error:", rpcError);
} else if (!rpcResult || rpcResult.length === 0) {
  console.log("❌ RPC returns EMPTY - topups not visible in dashboard");
} else {
  console.log(
    `✅ RPC returns ${rpcResult.length} topup(s) - should be visible in dashboard:`,
  );
  console.log(JSON.stringify(rpcResult, null, 2));
}

// Summary and diagnosis
console.log("\n" + "=".repeat(80));
console.log("DIAGNOSIS SUMMARY");
console.log("=".repeat(80));

if (transactions && transactions.length > 0) {
  const latestTx = transactions[0];
  console.log("\n📋 Latest Transaction Analysis:");
  console.log(`   ✓ Transaction exists: ${latestTx.id}`);
  console.log(`   ✓ Amount: $${latestTx.amount}`);
  console.log(
    `   ✓ Payment confirmed: ${latestTx.payment_status === "confirmed" || latestTx.payment_status === "completed" ? "✅ YES" : "❌ NO"}`,
  );
  console.log(
    `   ✓ Posted to balance: ${latestTx.posted_to_balance ? "✅ YES" : "❌ NO"}`,
  );

  // Check dashboard visibility
  const missingFields = [];
  if (!latestTx.type) missingFields.push("type");
  if (!latestTx.canonical_user_id) missingFields.push("canonical_user_id");
  if (!latestTx.user_id) missingFields.push("user_id");
  if (!latestTx.wallet_address) missingFields.push("wallet_address");

  if (missingFields.length > 0) {
    console.log(
      `\n❌ PROBLEM: Missing dashboard visibility fields: ${missingFields.join(", ")}`,
    );
    console.log(`   SOLUTION: Run UPDATE query to set these fields`);
  } else {
    console.log(`\n✅ Dashboard fields present`);
  }

  // Check if balance was credited
  if (!latestTx.posted_to_balance) {
    console.log(
      `\n❌ PROBLEM: Balance was NOT credited (posted_to_balance=false)`,
    );
    console.log(`   SOLUTION: Need to credit balance manually`);
  } else if (ledger && ledger.length === 0) {
    console.log(
      `\n⚠️  WARNING: posted_to_balance=true but NO balance_ledger entry`,
    );
    console.log(`   This indicates an inconsistent state`);
  } else {
    console.log(`\n✅ Balance was credited`);
  }

  // Check RPC visibility
  if (!rpcResult || rpcResult.length === 0) {
    console.log(`\n❌ PROBLEM: Not visible in get_user_topup_transactions RPC`);
    console.log(`   This is why it's not showing in dashboard`);
    console.log(
      `   Check: type='topup', canonical_user_id, user_id, wallet_address`,
    );
  } else {
    console.log(`\n✅ Visible in RPC - should appear in dashboard`);
  }
} else {
  console.log("\n❌ NO RECENT TRANSACTIONS FOUND");
  console.log("   User may not have completed payment yet");
  console.log("   Or payment is still pending in Coinbase Commerce");
}

console.log("\n" + "=".repeat(80));
