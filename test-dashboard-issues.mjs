import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Testing Dashboard Issues ===\n");

const testUserId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

// Issue 1: Check if amount_spent is showing in dashboard entries
console.log("Issue 1: Checking dashboard entries amount_spent...");
const { data: dashboardData, error: dashboardError } = await supabase.rpc(
  "get_comprehensive_user_dashboard_entries",
  {
    user_identifier: testUserId,
  },
);

if (dashboardError) {
  console.log("❌ Error fetching dashboard entries:", dashboardError.message);
} else {
  console.log("✅ Dashboard entries returned:", dashboardData?.length || 0);
  if (dashboardData && dashboardData.length > 0) {
    const entry = dashboardData[0];
    console.log("\nFirst entry:");
    console.log("  Competition:", entry.title);
    console.log("  Total tickets:", entry.total_tickets);
    console.log("  Total amount spent:", entry.total_amount_spent);
    console.log("  Entry type:", entry.entry_type);
    console.log("  Transaction hash:", entry.transaction_hash);

    if (!entry.total_amount_spent || entry.total_amount_spent === 0) {
      console.log("\n⚠️  WARNING: total_amount_spent is 0 or null!");
    } else {
      console.log("\n✅ Amount spent is populated correctly");
    }
  }
}

// Issue 2: Check topup transactions
console.log("\n\nIssue 2: Checking topup transactions...");
const { data: topupData, error: topupError } = await supabase
  .from("user_transactions")
  .select(
    "id, tx_id, canonical_user_id, wallet_address, amount, created_at, type, status",
  )
  .eq("canonical_user_id", testUserId)
  .eq("type", "topup")
  .in("status", ["completed", "confirmed"])
  .not("tx_id", "is", null)
  .order("created_at", { ascending: false })
  .limit(5);

if (topupError) {
  console.log("❌ Error fetching topup transactions:", topupError.message);
} else {
  console.log("✅ Topup transactions found:", topupData?.length || 0);
  if (topupData && topupData.length > 0) {
    console.log("\nMost recent topup:");
    const topup = topupData[0];
    console.log("  TX ID:", topup.tx_id);
    console.log("  Amount:", topup.amount);
    console.log("  Date:", topup.created_at);
    console.log("  Wallet:", topup.wallet_address);

    if (
      topup.tx_id &&
      topup.tx_id.startsWith("0x") &&
      topup.tx_id.length === 66
    ) {
      console.log("\n✅ Valid blockchain tx_id found");
    } else {
      console.log("\n⚠️  WARNING: tx_id is not a valid blockchain hash");
    }
  } else {
    console.log("\n⚠️  No topup transactions found");
  }
}

// Issue 2 cont: Check competition entries to see what transaction hashes are stored
console.log("\n\nChecking competition entries transaction hashes...");
const testCompId = "799a8e12-38f2-4989-ad24-15c995d673a6";
const { data: entriesData, error: entriesError } = await supabase.rpc(
  "get_competition_entries",
  {
    competition_identifier: testCompId,
  },
);

if (entriesError) {
  console.log("❌ Error fetching competition entries:", entriesError.message);
} else {
  // Filter to user's entries
  const userEntries =
    entriesData?.filter(
      (e) =>
        e.walletaddress?.toLowerCase() ===
          "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363" ||
        e.canonical_user_id === testUserId,
    ) || [];

  console.log("✅ User entries in this competition:", userEntries.length);
  if (userEntries.length > 0) {
    console.log("\nTransaction hashes in entries:");
    userEntries.slice(0, 3).forEach((e, i) => {
      console.log(`  Entry ${i + 1}:`, e.transactionhash || "No hash");
      if (
        e.transactionhash &&
        e.transactionhash.startsWith("balance_payment_")
      ) {
        console.log("    ⚠️  This is a balance_payment_ placeholder!");
      }
    });
  }
}

console.log("\n" + "=".repeat(70));
console.log("Test complete. Check results above for issues.");
console.log("=".repeat(70));

process.exit(0);
